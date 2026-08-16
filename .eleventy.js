const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const MarkdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const Prism = require("prismjs");
const loadLanguages = require("prismjs/components/");
const {
  loadCatalog,
  resolveContentRoot,
  slugifyHeading
} = require("./lib/content-loader");

loadLanguages([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "go",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "markup",
  "objectivec",
  "python",
  "rust",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "yaml"
]);

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeBasePath(value) {
  if (!value || value === "/") {
    return "";
  }
  return `/${value.replace(/^\/|\/$/g, "")}`;
}

function resolveWebCommit() {
  if (process.env.WEB_COMMIT) {
    return process.env.WEB_COMMIT;
  }
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8"
    }).trim();
  } catch {
    return "local";
  }
}

module.exports = function configureEleventy(eleventyConfig) {
  const catalog = loadCatalog();
  const contentRoot = resolveContentRoot();
  const basePath = normalizeBasePath(process.env.SITE_BASE_PATH);
  const assetVersion = resolveWebCommit().slice(0, 12);

  function withBase(route) {
    if (!route) {
      return basePath || "/";
    }
    if (/^(?:[a-z]+:)?\/\//i.test(route) || route.startsWith("#")) {
      return route;
    }
    return `${basePath}/${route.replace(/^\//, "")}`.replace(/\/+/g, "/");
  }

  function resolveContentLink(href, sourceRelative) {
    if (
      !href ||
      href.startsWith("#") ||
      /^(?:[a-z]+:)?\/\//i.test(href) ||
      /^(mailto|tel):/i.test(href)
    ) {
      return href;
    }

    const hashIndex = href.indexOf("#");
    const queryIndex = href.indexOf("?");
    const suffixIndex = [hashIndex, queryIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];
    const pathname = suffixIndex === undefined ? href : href.slice(0, suffixIndex);
    const suffix = suffixIndex === undefined ? "" : href.slice(suffixIndex);
    let target = path.posix.normalize(
      path.posix.join(path.posix.dirname(sourceRelative), decodeURI(pathname))
    );

    if (pathname.endsWith("/")) {
      target = path.posix.join(target, "README.md");
    }

    const route =
      catalog.sourceRoutes[target] ||
      catalog.sourceRoutes[`${target}.md`] ||
      catalog.sourceRoutes[path.posix.join(target, "README.md")];

    if (route) {
      return `${withBase(route)}${suffix}`;
    }

    const absoluteTarget = path.resolve(contentRoot, target);
    if (
      absoluteTarget.startsWith(contentRoot) &&
      fs.existsSync(absoluteTarget)
    ) {
      return `${withBase(`/raw/${encodeURI(target)}`)}${suffix}`;
    }

    return href;
  }

  function createMarkdownRenderer(sourceRelative) {
    const markdown = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: false,
      highlight(code, language) {
        if (language && Prism.languages[language]) {
          return Prism.highlight(code, Prism.languages[language], language);
        }
        return escapeHtml(code);
      }
    }).use(markdownItAnchor, {
      level: [2, 3],
      slugify: slugifyHeading
    });

    const defaultFence = markdown.renderer.rules.fence.bind(markdown.renderer.rules);
    markdown.renderer.rules.fence = (tokens, index, options, environment, self) => {
      const token = tokens[index];
      const language = token.info.trim().split(/\s+/)[0];
      if (language === "mermaid") {
        return `<div class="mermaid">${escapeHtml(token.content)}</div>`;
      }
      return defaultFence(tokens, index, options, environment, self);
    };

    const defaultLinkOpen =
      markdown.renderer.rules.link_open ||
      ((tokens, index, options, environment, self) => self.renderToken(tokens, index, options));
    markdown.renderer.rules.link_open = (tokens, index, options, environment, self) => {
      const hrefIndex = tokens[index].attrIndex("href");
      if (hrefIndex >= 0) {
        const href = tokens[index].attrs[hrefIndex][1];
        tokens[index].attrs[hrefIndex][1] = resolveContentLink(href, sourceRelative);
        if (/^https?:\/\//i.test(href)) {
          tokens[index].attrSet("rel", "noreferrer");
        }
      }
      return defaultLinkOpen(tokens, index, options, environment, self);
    };

    const defaultImage =
      markdown.renderer.rules.image ||
      ((tokens, index, options, environment, self) => self.renderToken(tokens, index, options));
    markdown.renderer.rules.image = (tokens, index, options, environment, self) => {
      const sourceIndex = tokens[index].attrIndex("src");
      if (sourceIndex >= 0) {
        const source = tokens[index].attrs[sourceIndex][1];
        tokens[index].attrs[sourceIndex][1] = resolveContentLink(source, sourceRelative);
        tokens[index].attrSet("loading", "lazy");
      }
      return defaultImage(tokens, index, options, environment, self);
    };

    markdown.renderer.rules.table_open = () =>
      '<div class="table-scroll" tabindex="0"><table>';
    markdown.renderer.rules.table_close = () => "</table></div>";

    return markdown;
  }

  eleventyConfig.addGlobalData("catalog", catalog);
  eleventyConfig.addGlobalData("site", {
    name: "Game Client Knowledge",
    shortName: "GCK",
    description: "游戏客户端开发与面试知识库",
    basePath,
    assetVersion,
    searchVersion: `${assetVersion}-${catalog.repository.commit}`,
    repositoryUrl: catalog.repositoryUrl,
    joinUrl: process.env.JOIN_URL || "https://join.chenyurui.top",
    editorUrl:
      process.env.EDITOR_URL ||
      "https://knowledge.chenyurui.top/editor/"
  });

  eleventyConfig.addFilter("withBase", withBase);
  eleventyConfig.addFilter("assetUrl", (route) => {
    return `${withBase(route)}?v=${encodeURIComponent(assetVersion)}`;
  });
  eleventyConfig.addFilter("renderMarkdown", (value, sourceRelative) => {
    return createMarkdownRenderer(sourceRelative).render(value || "");
  });
  eleventyConfig.addFilter("highlightCode", (value, language) => {
    if (language && Prism.languages[language]) {
      return Prism.highlight(value, Prism.languages[language], language);
    }
    return escapeHtml(value);
  });
  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));
  eleventyConfig.addFilter("formatDate", (value) => {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(value));
  });
  eleventyConfig.addFilter("moduleByKey", (modules, key) => {
    return modules.find((module) => module.key === key);
  });
  eleventyConfig.addFilter("unitById", (units, id) => {
    return units.find((unit) => unit.id === id);
  });
  eleventyConfig.addFilter("markdownDocuments", (documents) => {
    return documents.filter((document) => document.kind === "markdown");
  });
  eleventyConfig.addFilter("codeDocuments", (documents) => {
    return documents.filter((document) => document.kind === "code");
  });

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  for (const moduleKey of Object.keys(catalog.modules.reduce((result, module) => {
    result[module.key] = true;
    return result;
  }, {}))) {
    eleventyConfig.addPassthroughCopy({
      [path.join(contentRoot, moduleKey)]: `raw/${moduleKey}`
    });
    eleventyConfig.addWatchTarget(path.join(contentRoot, moduleKey));
  }
  eleventyConfig.addPassthroughCopy({
    "node_modules/mermaid/dist/mermaid.min.js": "assets/vendor/mermaid.min.js"
  });
  eleventyConfig.addPassthroughCopy({
    "node_modules/lucide/dist/umd/lucide.js": "assets/vendor/lucide.js"
  });
  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: false,
    pathPrefix: basePath || "/"
  };
};
