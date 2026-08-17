const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const matter = require("gray-matter");
const { loadCodeProjects } = require("./code-project-loader");

const MODULE_DEFINITIONS = {
  knowledge: {
    title: "八股与专题",
    shortTitle: "知识",
    description: "语言、引擎、架构、网络、图形与性能知识",
    icon: "book-open",
    accent: "teal",
    allowCode: false,
    order: 10
  },
  interviews: {
    title: "真实面经",
    shortTitle: "面经",
    description: "按公司、批次与岗位整理的真实问题和参考答案",
    icon: "messages-square",
    accent: "orange",
    allowCode: false,
    order: 20
  },
  examples: {
    title: "代码示例",
    shortTitle: "示例",
    description: "可运行工程、算法实现与配套源码",
    icon: "braces",
    accent: "gold",
    allowCode: true,
    order: 30
  }
};

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".kt",
  ".lua",
  ".m",
  ".mm",
  ".py",
  ".rs",
  ".sh",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml"
]);

const LANGUAGE_BY_EXTENSION = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".h": "cpp",
  ".hpp": "cpp",
  ".html": "markup",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".kt": "kotlin",
  ".lua": "lua",
  ".m": "objectivec",
  ".mm": "objectivec",
  ".py": "python",
  ".rs": "rust",
  ".sh": "bash",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".xml": "markup",
  ".yaml": "yaml",
  ".yml": "yaml"
};

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function resolveContentRoot() {
  const candidates = [
    process.env.CONTENT_REPO_PATH,
    path.resolve(process.cwd(), "_content"),
    path.resolve(process.cwd(), "../Game-Client-Knowledge")
  ].filter(Boolean);

  const root = candidates.find((candidate) => {
    return fs.existsSync(path.join(candidate, "knowledge"));
  });

  if (!root) {
    throw new Error(
      "Content repository not found. Set CONTENT_REPO_PATH or place it at " +
        "../Game-Client-Knowledge."
    );
  }

  return path.resolve(root);
}

function walkFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  visit(root);
  return files;
}

function humanizeSlug(value) {
  return value
    .replace(/^\d+[-_.\s]*/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function cleanInlineMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_>|~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDescription(markdown, fallback) {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, "");
  const blocks = withoutFences.split(/\n\s*\n/);

  for (const block of blocks) {
    const normalized = block.trim();
    if (
      !normalized ||
      normalized.startsWith("#") ||
      normalized.startsWith("|") ||
      normalized.startsWith("- ") ||
      normalized.startsWith("* ") ||
      /^\d+\.\s/.test(normalized) ||
      normalized.startsWith("```") ||
      normalized.startsWith(":::")
    ) {
      continue;
    }

    const description = cleanInlineMarkdown(normalized.replace(/\n/g, " "));
    if (description) {
      return description.slice(0, 180);
    }
  }

  return fallback;
}

function discoverModuleDefinitions(sourceRoot) {
  const accents = ["teal", "orange", "gold"];
  const entries = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => {
      return (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        fs.existsSync(path.join(sourceRoot, entry.name, "README.md"))
      );
    })
    .map((entry) => entry.name);
  const builtInKeys = Object.keys(MODULE_DEFINITIONS);
  entries.sort((left, right) => {
    const leftIndex = builtInKeys.indexOf(left);
    const rightIndex = builtInKeys.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      return (
        (leftIndex >= 0 ? leftIndex : 1000) -
        (rightIndex >= 0 ? rightIndex : 1000)
      );
    }
    return left.localeCompare(right, "zh-CN", { numeric: true });
  });

  return Object.fromEntries(
    entries.map((key, index) => {
      const readmePath = path.join(sourceRoot, key, "README.md");
      const parsed = matter(fs.readFileSync(readmePath, "utf8"));
      const h1Match = parsed.content.match(/^#\s+(.+?)\s*$/m);
      const title =
        parsed.data.title ||
        (h1Match
          ? cleanInlineMarkdown(h1Match[1])
          : humanizeSlug(key));
      const body = parsed.content.replace(/^#\s+.+?\s*\n+/, "");
      const fallback = MODULE_DEFINITIONS[key] || {};
      const accent = accents.includes(parsed.data.accent)
        ? parsed.data.accent
        : fallback.accent || accents[index % accents.length];
      const shortTitle =
        parsed.data.shortTitle ||
        parsed.data.short_title ||
        fallback.shortTitle ||
        title.slice(0, 6);
      return [
        key,
        {
          title,
          shortTitle,
          description:
            parsed.data.description ||
            extractDescription(
              body,
              fallback.description || `${title} 内容模块`
            ),
          icon: parsed.data.icon || fallback.icon || "folder-kanban",
          accent,
          allowCode:
            parsed.data.allowCode === true ||
            parsed.data.allow_code === true ||
            fallback.allowCode === true,
          order: Number.isFinite(parsed.data.order)
            ? Number(parsed.data.order)
            : fallback.order || 100 + index
        }
      ];
    })
  );
}

function slugifyHeading(value) {
  const slug = cleanInlineMarkdown(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return slug || "section";
}

function extractHeadings(markdown) {
  const used = new Map();
  const headings = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }

    const text = cleanInlineMarkdown(match[2]);
    const baseSlug = slugifyHeading(text);
    const count = used.get(baseSlug) || 0;
    used.set(baseSlug, count + 1);
    headings.push({
      level: match[1].length,
      text,
      id: count === 0 ? baseSlug : `${baseSlug}-${count + 1}`
    });
  }

  return headings;
}

function numericOrder(fileName) {
  const match = fileName.match(/^(\d+)/);
  return match ? Number(match[1]) : 1000;
}

function naturalCompare(left, right) {
  const orderDifference = left.order - right.order;
  if (orderDifference !== 0) {
    return orderDifference;
  }
  return left.sourceRelative.localeCompare(right.sourceRelative, "zh-CN", {
    numeric: true
  });
}

function routeToOutputPath(route) {
  return `${route.replace(/^\/|\/$/g, "")}/index.html`;
}

function getRepositoryState(sourceRoot) {
  if (process.env.CONTENT_COMMIT) {
    return {
      commit: process.env.CONTENT_COMMIT.slice(0, 7),
      updatedAt: process.env.CONTENT_UPDATED_AT || new Date().toISOString()
    };
  }

  try {
    const commit = execFileSync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      { cwd: sourceRoot, encoding: "utf8" }
    ).trim();
    const updatedAt = execFileSync(
      "git",
      ["log", "-1", "--format=%cI"],
      { cwd: sourceRoot, encoding: "utf8" }
    ).trim();
    return { commit, updatedAt };
  } catch {
    return { commit: "local", updatedAt: new Date().toISOString() };
  }
}

function getRepositoryContributors(sourceRoot) {
  const gitDirectory = process.env.CONTENT_GIT_DIR;
  const revision =
    process.env.CONTENT_GIT_REVISION ||
    process.env.CONTENT_COMMIT ||
    "HEAD";
  try {
    const args = gitDirectory
      ? [
          `--git-dir=${gitDirectory}`,
          "log",
          revision,
          "--format=%aN",
          "--max-count=300"
        ]
      : ["log", revision, "--format=%aN", "--max-count=300"];
    const output = execFileSync("git", args, {
      cwd: gitDirectory ? process.cwd() : sourceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const seen = new Set();
    const contributors = [];
    for (const line of output.split("\n")) {
      const name = line.trim().replace(/\s+/g, " ").slice(0, 48);
      const key = name.toLocaleLowerCase("en");
      if (
        !name ||
        key === "unknown" ||
        key === "github contributor" ||
        seen.has(key)
      ) {
        continue;
      }
      seen.add(key);
      contributors.push(name);
      if (contributors.length >= 12) {
        break;
      }
    }
    if (contributors.length) {
      return contributors;
    }
  } catch {
    // Snapshot-only builds may not have repository history.
  }
  return ["sourcecode", "Game Client Knowledge"];
}

function markdownRoute(relativePath) {
  const parsed = path.posix.parse(relativePath);
  const withoutFile = parsed.dir;
  if (parsed.base.toLocaleLowerCase() === "readme.md") {
    return `/${withoutFile}/`.replace(/\/+/g, "/");
  }
  return `/${withoutFile}/${parsed.name}/`.replace(/\/+/g, "/");
}

function codeRoute(relativePath) {
  const parsed = path.posix.parse(relativePath);
  return `/${parsed.dir}/files/${parsed.base}/`.replace(/\/+/g, "/");
}

function loadCatalog() {
  const sourceRoot = resolveContentRoot();
  const allFiles = walkFiles(sourceRoot);
  const moduleDefinitions = discoverModuleDefinitions(sourceRoot);
  const codeProjects = loadCodeProjects(sourceRoot);
  const readmeDirectories = new Set(
    allFiles
      .filter((file) => path.basename(file).toLocaleLowerCase() === "readme.md")
      .map((file) => toPosix(path.relative(sourceRoot, path.dirname(file))))
  );
  const documents = [];
  const moduleIntroductions = new Map();
  const sourceRoutes = {};
  const contributionPath = path.join(sourceRoot, "CONTRIBUTING.md");
  let contribution = null;

  if (fs.existsSync(contributionPath)) {
    const parsed = matter(fs.readFileSync(contributionPath, "utf8"));
    const h1Match = parsed.content.match(/^#\s+(.+?)\s*$/m);
    const body = parsed.content.replace(/^#\s+.+?\s*\n+/, "");
    const route = "/contribute/";
    contribution = {
      id: "CONTRIBUTING.md",
      kind: "markdown",
      moduleKey: "contribute",
      sourceRelative: "CONTRIBUTING.md",
      title:
        parsed.data.title ||
        (h1Match ? cleanInlineMarkdown(h1Match[1]) : "内容更新规范"),
      description:
        parsed.data.description ||
        extractDescription(body, "知识、面经和代码示例的目录、Markdown 与提交约定。"),
      route,
      outputPath: routeToOutputPath(route),
      body,
      headings: extractHeadings(body),
      hasMermaid: /```mermaid\b/.test(body),
      searchText: stripMarkdown(parsed.content)
    };
    sourceRoutes["CONTRIBUTING.md"] = route;
  }

  for (const absolutePath of allFiles) {
    const sourceRelative = toPosix(path.relative(sourceRoot, absolutePath));
    const parts = sourceRelative.split("/");
    const moduleKey = parts[0];
    if (!moduleDefinitions[moduleKey]) {
      continue;
    }

    const extension = path.extname(absolutePath).toLocaleLowerCase();
    if (extension === ".md") {
      const parsed = matter(fs.readFileSync(absolutePath, "utf8"));
      const h1Match = parsed.content.match(/^#\s+(.+?)\s*$/m);
      const title =
        parsed.data.title ||
        (h1Match ? cleanInlineMarkdown(h1Match[1]) : humanizeSlug(path.basename(absolutePath, extension)));
      const body = parsed.content.replace(/^#\s+.+?\s*\n+/, "");
      const route = markdownRoute(sourceRelative);
      const document = {
        id: sourceRelative,
        kind: "markdown",
        moduleKey,
        sourceRelative,
        sourceDirectory: path.posix.dirname(sourceRelative),
        title,
        description:
          parsed.data.description ||
          extractDescription(body, moduleDefinitions[moduleKey].description),
        order:
          Number.isFinite(parsed.data.order)
            ? Number(parsed.data.order)
            : path.basename(absolutePath).toLocaleLowerCase() === "readme.md"
              ? -100
              : numericOrder(path.basename(absolutePath)),
        route,
        outputPath: routeToOutputPath(route),
        body,
        headings: extractHeadings(body),
        hasMermaid: /```mermaid\b/.test(body),
        searchText: stripMarkdown(parsed.content),
        isReadme: path.basename(absolutePath).toLocaleLowerCase() === "readme.md"
      };

      sourceRoutes[sourceRelative] = route;

      if (parts.length === 2 && document.isReadme) {
        moduleIntroductions.set(moduleKey, document);
      } else {
        documents.push(document);
      }
      continue;
    }

    if (
      moduleDefinitions[moduleKey].allowCode &&
      CODE_EXTENSIONS.has(extension)
    ) {
      const route = codeRoute(sourceRelative);
      const source = fs.readFileSync(absolutePath, "utf8");
      documents.push({
        id: sourceRelative,
        kind: "code",
        moduleKey,
        sourceRelative,
        sourceDirectory: path.posix.dirname(sourceRelative),
        title: path.basename(absolutePath),
        description: `示例源码 ${path.basename(absolutePath)}`,
        order: 2000,
        route,
        outputPath: routeToOutputPath(route),
        source,
        language: LANGUAGE_BY_EXTENSION[extension] || "text",
        headings: [],
        hasMermaid: false,
        searchText: source,
        isReadme: false
      });
      sourceRoutes[sourceRelative] = route;
    }
  }

  const unitDirectories = [...readmeDirectories]
    .filter((directory) => directory.split("/").length > 1)
    .sort((left, right) => right.length - left.length);

  for (const document of documents) {
    document.unitDirectory =
      unitDirectories.find((directory) => {
        return (
          document.sourceRelative === `${directory}/README.md` ||
          document.sourceRelative.startsWith(`${directory}/`)
        );
      }) || document.sourceDirectory;
  }

  documents.sort(naturalCompare);

  const units = [];
  for (const unitDirectory of [...new Set(documents.map((item) => item.unitDirectory))]) {
    const unitDocuments = documents
      .filter((item) => item.unitDirectory === unitDirectory)
      .sort(naturalCompare);
    const readme = unitDocuments.find((item) => item.isReadme);
    const firstDocument = readme || unitDocuments[0];
    const directoryParts = unitDirectory.split("/");
    const moduleKey = directoryParts[0];
    const groupSlugs = directoryParts.slice(1, -1);

    unitDocuments.forEach((document, index) => {
      const previous = unitDocuments[index - 1];
      const next = unitDocuments[index + 1];
      document.previous = previous
        ? { title: previous.title, route: previous.route }
        : null;
      document.next = next ? { title: next.title, route: next.route } : null;
      document.unitTitle = firstDocument.title;
    });

    units.push({
      id: unitDirectory,
      moduleKey,
      title: firstDocument.title,
      description: firstDocument.description,
      route: firstDocument.route,
      group: groupSlugs.map(humanizeSlug).join(" / "),
      documents: unitDocuments,
      articleCount: unitDocuments.filter((item) => item.kind === "markdown").length,
      codeCount: unitDocuments.filter((item) => item.kind === "code").length
    });
  }

  units.sort((left, right) => {
    return left.title.localeCompare(right.title, "zh-CN", { numeric: true });
  });

  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  for (const unit of units) {
    const ancestors = [];
    let parentDirectory = path.posix.dirname(unit.id);
    while (parentDirectory.includes("/")) {
      const parent = unitsById.get(parentDirectory);
      if (parent) {
        ancestors.unshift(parent);
      }
      const next = path.posix.dirname(parentDirectory);
      if (next === parentDirectory) {
        break;
      }
      parentDirectory = next;
    }
    const parent = ancestors[ancestors.length - 1] || null;
    unit.parentId = parent ? parent.id : null;
    unit.ancestorIds = ancestors.map((ancestor) => ancestor.id);
    unit.ancestors = ancestors.map((ancestor) => ({
      id: ancestor.id,
      title: ancestor.title,
      route: ancestor.route
    }));
    unit.depth = ancestors.length;
    unit.children = [];
  }
  for (const unit of units) {
    if (unit.parentId) {
      unitsById.get(unit.parentId)?.children.push(unit);
    }
  }
  for (const unit of units) {
    unit.children.sort((left, right) => {
      return left.title.localeCompare(right.title, "zh-CN", {
        numeric: true
      });
    });
  }

  const modules = Object.entries(moduleDefinitions)
    .sort((left, right) => left[1].order - right[1].order)
    .map(([key, definition]) => {
      const introduction = moduleIntroductions.get(key);
      const moduleUnits = units.filter((unit) => unit.moduleKey === key);
      const moduleDocuments = documents.filter(
        (document) => document.moduleKey === key
      );
      const route = `/${key}/`;

      return {
        key,
        ...definition,
        description: introduction
          ? introduction.description
          : definition.description,
        body: introduction ? introduction.body : "",
        hasMermaid: introduction ? introduction.hasMermaid : false,
        sourceRelative: introduction
          ? introduction.sourceRelative
          : `${key}/README.md`,
        route,
        outputPath: routeToOutputPath(route),
        units: moduleUnits,
        rootUnits: moduleUnits.filter((unit) => !unit.parentId),
        documentCount: moduleDocuments.filter(
          (item) => item.kind === "markdown"
        ).length,
        codeCount: moduleDocuments.filter(
          (item) => item.kind === "code"
        ).length
      };
    });

  const repository = getRepositoryState(sourceRoot);
  const contributors = getRepositoryContributors(sourceRoot);

  return {
    sourceRoot,
    sourceRoutes,
    modules,
    units,
    documents,
    codeProjects,
    contribution,
    contributors,
    repository,
    repositoryUrl:
      process.env.CONTENT_REPOSITORY_URL ||
      "https://github.com/Game-Client-Knowledge/Game-Client-Knowledge"
  };
}

module.exports = {
  CODE_EXTENSIONS,
  discoverModuleDefinitions,
  getRepositoryContributors,
  MODULE_DEFINITIONS,
  loadCatalog,
  resolveContentRoot,
  slugifyHeading,
  stripMarkdown,
  toPosix
};
