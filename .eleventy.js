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
const {
  createMermaidCacheKey,
  loadMermaidCache,
  normalizeMermaidSource
} = require("./lib/mermaid-cache");

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
  const mermaidCache = loadMermaidCache();

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
      catalog.sourceRoutes[path.posix.join(target, "README.md")] ||
      (
        target.toLowerCase() === "readme.md"
          ? catalog.sourceRoutes[
              sourceRelative.split("/").length > 2
                ? `${sourceRelative.split("/")[0]}/${sourceRelative.split("/")[1]}/README.md`
                : `${sourceRelative.split("/")[0]}/README.md`
            ]
          : null
      );

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
    let mermaidIndex = 0;
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
        const source = normalizeMermaidSource(token.content);
        const cacheKey = createMermaidCacheKey(
          sourceRelative,
          mermaidIndex,
          source
        );
        const svg = mermaidCache.diagrams[cacheKey];
        mermaidIndex += 1;
        if (svg) {
          return (
            '<div class="mermaid" data-mermaid-rendered="true">' +
            `${svg}</div>`
          );
        }
        return `<div class="mermaid">${escapeHtml(source)}</div>`;
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
  eleventyConfig.addFilter("formatDateTime", (value) => {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(value));
  });
  eleventyConfig.addFilter("formatNumber", (value) => {
    return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
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
    if (moduleKey === "code") {
      const publishedCodeFiles = new Set([
        ...catalog.modules
          .filter((module) => module.key === "code")
          .map((module) => module.sourceRelative),
        ...catalog.documents
          .filter((document) => document.moduleKey === "code")
          .map((document) => document.sourceRelative),
        ...catalog.codeProjects.flatMap((project) =>
          project.files.map((file) => file.sourcePath)
        )
      ]);
      for (const relative of publishedCodeFiles) {
        eleventyConfig.addPassthroughCopy({
          [path.join(contentRoot, relative)]: `raw/${relative}`
        });
      }
    } else {
      eleventyConfig.addPassthroughCopy({
        [path.join(contentRoot, moduleKey)]: `raw/${moduleKey}`
      });
    }
    eleventyConfig.addWatchTarget(path.join(contentRoot, moduleKey));
  }
  eleventyConfig.addPassthroughCopy({
    "node_modules/lucide/dist/umd/lucide.js": "assets/vendor/lucide.js"
  });
  eleventyConfig.addPassthroughCopy({
    ".cache/vendor/mermaid": "assets/vendor/mermaid"
  });
  eleventyConfig.addPassthroughCopy({
    ".cache/vendor/toastui-editor.js": "assets/vendor/toastui-editor.js"
  });
  eleventyConfig.addPassthroughCopy({
    ".cache/vendor/diff.js": "assets/vendor/diff.js"
  });
  eleventyConfig.addPassthroughCopy({
    ".cache/vendor/code-reader-vendor.js":
      "assets/vendor/code-reader-vendor.js"
  });
  eleventyConfig.addPassthroughCopy({
    ".cache/vendor/star-formula-engine.js":
      "assets/vendor/star-formula-engine.js"
  });
  eleventyConfig.addPassthroughCopy({
    ".cache/vendor/star3d-engine.js": "assets/vendor/star3d-engine.js"
  });
  eleventyConfig.addPassthroughCopy({
    "node_modules/web-tree-sitter/tree-sitter.js":
      "assets/vendor/tree-sitter.js"
  });
  eleventyConfig.addPassthroughCopy({
    "node_modules/web-tree-sitter/tree-sitter.wasm":
      "assets/vendor/tree-sitter.wasm"
  });
  eleventyConfig.addPassthroughCopy({
    "node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm":
      "assets/vendor/tree-sitter-c_sharp.wasm"
  });
  eleventyConfig.addPassthroughCopy({
    "node_modules/tree-sitter-wasms/out/tree-sitter-cpp.wasm":
      "assets/vendor/tree-sitter-cpp.wasm"
  });
  eleventyConfig.addPassthroughCopy({
    "node_modules/@toast-ui/editor/dist/toastui-editor.css":
      "assets/vendor/toastui-editor.css"
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
