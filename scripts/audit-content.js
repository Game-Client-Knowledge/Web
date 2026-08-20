const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const {
  loadCatalog,
  resolveContentRoot,
  toPosix
} = require("../lib/content-loader");
const {
  validateMarkdownStructure
} = require("../lib/markdown-structure");

const root = resolveContentRoot();
const errors = [];
const warnings = [];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function report(target, message) {
  errors.push(`${toPosix(path.relative(root, target))}: ${message}`);
}

function parseLinks(markdown) {
  const links = [];
  const expression = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const proseOnly = markdown.replace(/```[\s\S]*?```/g, "");
  let match;
  while ((match = expression.exec(proseOnly)) !== null) {
    const raw = match[1].trim();
    const target = raw.startsWith("<")
      ? raw.slice(1, raw.indexOf(">"))
      : raw.split(/\s+["']/)[0];
    links.push(target);
  }
  return links;
}

function validateMarkdown(file) {
  const source = fs.readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = matter(source);
  } catch (error) {
    report(file, `frontmatter 无法解析：${error.message}`);
    return;
  }

  for (const message of validateMarkdownStructure(parsed.content)) {
    report(file, message);
  }

  for (const href of parseLinks(parsed.content)) {
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("/") ||
      /^(?:[a-z]+:)?\/\//i.test(href) ||
      /^(mailto|tel):/i.test(href)
    ) {
      continue;
    }

    const pathname = decodeURI(href.split(/[?#]/)[0]);
    let target = path.resolve(path.dirname(file), pathname);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, "README.md");
    }
    if (!fs.existsSync(target)) {
      report(file, `相对链接不存在：${href}`);
    }
  }
}

const requiredModules = [
  "program/knowledge",
  "program/interviews",
  "program/examples",
  "program/code",
  "planning/knowledge",
  "planning/interviews",
  "planning/written-tests",
  "planning/cases",
  "planning/templates"
];

for (const requiredTrack of ["program", "planning"]) {
  const readme = path.join(root, requiredTrack, "README.md");
  if (!fs.existsSync(readme)) {
    errors.push(`缺少岗位赛道说明：${requiredTrack}/README.md`);
  }
}

for (const requiredModule of requiredModules) {
  const directory = path.join(root, requiredModule);
  if (!fs.existsSync(directory)) {
    errors.push(`缺少内容模块目录：${requiredModule}/`);
  }
  if (!fs.existsSync(path.join(directory, "README.md"))) {
    errors.push(`缺少内容模块说明：${requiredModule}/README.md`);
  }
}

if (!fs.existsSync(path.join(root, "CONTRIBUTING.md"))) {
  errors.push("缺少内容更新规范：CONTRIBUTING.md");
}

const files = walk(root);
const markdownFiles = files.filter((file) => path.extname(file) === ".md");
markdownFiles.forEach(validateMarkdown);

let catalog;
try {
  catalog = loadCatalog();
} catch (error) {
  errors.push(`内容扫描失败：${error.message}`);
}

if (catalog) {
  const moduleKeys = new Set(
    catalog.modules.map((module) => module.key)
  );
  const routes = new Map();
  for (const document of catalog.documents) {
    if (routes.has(document.route)) {
      errors.push(
        `路由冲突：${document.sourceRelative} 与 ${routes.get(document.route)} -> ${document.route}`
      );
    }
    routes.set(document.route, document.sourceRelative);
  }

  const indexedMarkdown = new Set(
    catalog.documents
      .filter((document) => document.kind === "markdown")
      .map((document) => document.sourceRelative)
  );
  for (const file of markdownFiles) {
    const relative = toPosix(path.relative(root, file));
    const parts = relative.split("/");
    const moduleKey = moduleKeys.has(parts.slice(0, 2).join("/"))
      ? parts.slice(0, 2).join("/")
      : parts[0];
    if (moduleKeys.has(moduleKey)) {
      const isModuleReadme = relative === `${moduleKey}/README.md`;
      if (!isModuleReadme && !indexedMarkdown.has(relative)) {
        report(file, "内容未被网站扫描器收录");
      }
    }
  }

  for (const unit of catalog.units) {
    const readmePath = path.join(root, unit.id, "README.md");
    if (!fs.existsSync(readmePath)) {
      warnings.push(`${unit.id}: 建议添加 README.md 作为专题入口`);
    }
  }
}

console.log(`Markdown documents: ${markdownFiles.length}`);
console.log(`Website documents: ${catalog ? catalog.documents.length : 0}`);
console.log(`Topics: ${catalog ? catalog.units.length : 0}`);
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);

for (const warning of warnings) {
  console.warn(`WARN ${warning}`);
}
for (const error of errors) {
  console.error(`ERROR ${error}`);
}

if (errors.length > 0) {
  process.exitCode = 1;
}
