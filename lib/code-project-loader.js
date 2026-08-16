const fs = require("fs");
const path = require("path");

const PROJECT_MANIFEST = "code-project.json";
const PROJECT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_PROJECT_FILES = 2000;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;
const DEFAULT_EXCLUDES = new Set([
  ".git",
  ".idea",
  ".vs",
  ".vscode",
  "bin",
  "build",
  "dist",
  "node_modules",
  "obj",
  "packages"
]);

const LANGUAGE_BY_EXTENSION = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".csproj": "xml",
  ".go": "go",
  ".glsl": "glsl",
  ".h": "cpp",
  ".hpp": "cpp",
  ".hlsl": "hlsl",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".kt": "kotlin",
  ".lua": "lua",
  ".md": "markdown",
  ".py": "python",
  ".rs": "rust",
  ".sh": "bash",
  ".shader": "hlsl",
  ".sln": "text",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml"
};

const PARSER_BY_LANGUAGE = {
  c: "c",
  cpp: "cpp",
  csharp: "c_sharp",
  javascript: "javascript",
  typescript: "typescript",
  tsx: "tsx"
};

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function assertRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return path.posix.normalize(value);
}

function discoverManifests(codeRoot) {
  if (!fs.existsSync(codeRoot)) {
    return [];
  }
  const manifests = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || DEFAULT_EXCLUDES.has(entry.name)) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name === PROJECT_MANIFEST) {
        manifests.push(absolute);
      }
    }
  }
  visit(codeRoot);
  return manifests.sort();
}

function collectProjectFiles(projectRoot, config) {
  const excludes = new Set([
    ...DEFAULT_EXCLUDES,
    ...(Array.isArray(config.exclude) ? config.exclude : [])
  ]);
  const extensions = new Set(
    (Array.isArray(config.includeExtensions)
      ? config.includeExtensions
      : Object.keys(LANGUAGE_BY_EXTENSION)
    ).map((value) => {
      const extension = String(value).toLowerCase();
      return extension.startsWith(".") ? extension : `.${extension}`;
    })
  );
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || excludes.has(entry.name)) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (
        !entry.isFile() ||
        entry.name === PROJECT_MANIFEST ||
        !extensions.has(path.extname(entry.name).toLowerCase())
      ) {
        continue;
      }
      const relative = toPosix(path.relative(projectRoot, absolute));
      const source = fs.readFileSync(absolute, "utf8");
      const extension = path.extname(entry.name).toLowerCase();
      const language = LANGUAGE_BY_EXTENSION[extension] || "text";
      files.push({
        path: relative,
        name: entry.name,
        directory: path.posix.dirname(relative),
        sourcePath: "",
        extension,
        language,
        parser: PARSER_BY_LANGUAGE[language] || null,
        size: Buffer.byteLength(source),
        lines: source ? source.split("\n").length : 0
      });
    }
  }

  visit(projectRoot);
  return files;
}

function loadProject(manifestPath, sourceRoot) {
  const projectRoot = path.dirname(manifestPath);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `${toPosix(path.relative(sourceRoot, manifestPath))}: invalid JSON: ${error.message}`
    );
  }
  if (config.schemaVersion !== 1) {
    throw new Error(`${manifestPath}: schemaVersion must be 1`);
  }
  if (!PROJECT_ID_RE.test(config.id || "")) {
    throw new Error(`${manifestPath}: id must be a lowercase kebab-case slug`);
  }
  if (!String(config.title || "").trim()) {
    throw new Error(`${manifestPath}: title is required`);
  }
  const entry = assertRelativePath(config.entry, `${config.id}.entry`);
  const readme = config.readme
    ? assertRelativePath(config.readme, `${config.id}.readme`)
    : null;
  const readingOrder = Array.isArray(config.readingOrder)
    ? config.readingOrder.map((item) =>
        assertRelativePath(item, `${config.id}.readingOrder`)
      )
    : [];
  const projectSourceRoot = toPosix(path.relative(sourceRoot, projectRoot));
  const files = collectProjectFiles(projectRoot, config);
  const filePaths = new Set(files.map((file) => file.path));
  if (files.length > MAX_PROJECT_FILES) {
    throw new Error(
      `${manifestPath}: project exceeds ${MAX_PROJECT_FILES} published files`
    );
  }
  const oversized = files.find(
    (file) => file.size > MAX_SOURCE_FILE_BYTES
  );
  if (oversized) {
    throw new Error(
      `${manifestPath}: ${oversized.path} exceeds the 1 MB text-file limit`
    );
  }
  const sourceBytes = files.reduce((total, file) => total + file.size, 0);
  if (sourceBytes > MAX_PROJECT_BYTES) {
    throw new Error(`${manifestPath}: project exceeds the 16 MB source limit`);
  }
  if (!filePaths.has(entry)) {
    throw new Error(`${manifestPath}: entry file does not exist or is excluded`);
  }
  if (readme && !filePaths.has(readme)) {
    throw new Error(`${manifestPath}: readme file does not exist or is excluded`);
  }
  for (const file of files) {
    file.sourcePath = path.posix.join(projectSourceRoot, file.path);
    file.recommended = readingOrder.includes(file.path);
  }
  const order = new Map(readingOrder.map((file, index) => [file, index]));
  files.sort((left, right) => {
    const leftOrder = order.has(left.path) ? order.get(left.path) : 10000;
    const rightOrder = order.has(right.path) ? order.get(right.path) : 10000;
    return (
      leftOrder - rightOrder ||
      left.path.localeCompare(right.path, "en", { numeric: true })
    );
  });

  return {
    schemaVersion: 1,
    id: config.id,
    title: String(config.title).trim(),
    description: String(config.description || "").trim(),
    language: String(config.language || "text").toLowerCase(),
    entry,
    readme,
    readingOrder,
    sourceRoot: projectSourceRoot,
    manifestPath: toPosix(path.relative(sourceRoot, manifestPath)),
    workspaceRoute: `/code/workspace/?project=${encodeURIComponent(config.id)}`,
    fileCount: files.length,
    sourceBytes,
    lineCount: files.reduce((total, file) => total + file.lines, 0),
    parsers: Array.from(
      new Set(files.map((file) => file.parser).filter(Boolean))
    ),
    files
  };
}

function loadCodeProjects(sourceRoot) {
  const projects = discoverManifests(path.join(sourceRoot, "code")).map(
    (manifest) => loadProject(manifest, sourceRoot)
  );
  const ids = new Set();
  for (const project of projects) {
    if (ids.has(project.id)) {
      throw new Error(`Duplicate code project id: ${project.id}`);
    }
    ids.add(project.id);
  }
  return projects.sort((left, right) =>
    left.title.localeCompare(right.title, "zh-CN", { numeric: true })
  );
}

module.exports = {
  DEFAULT_EXCLUDES,
  LANGUAGE_BY_EXTENSION,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  MAX_SOURCE_FILE_BYTES,
  PARSER_BY_LANGUAGE,
  PROJECT_MANIFEST,
  loadCodeProjects
};
