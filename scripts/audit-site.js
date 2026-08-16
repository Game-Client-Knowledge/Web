const fs = require("fs");
const path = require("path");

const outputRoot = path.resolve(process.cwd(), "_site");
const basePath = (process.env.SITE_BASE_PATH || "").replace(/^\/|\/$/g, "");
const errors = [];
let htmlCount = 0;
let referenceCount = 0;

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function outputTarget(urlPath) {
  let pathname;
  try {
    pathname = decodeURI(urlPath.split(/[?#]/)[0]);
  } catch {
    return null;
  }

  pathname = pathname.replace(/^\//, "");
  if (basePath && pathname.startsWith(`${basePath}/`)) {
    pathname = pathname.slice(basePath.length + 1);
  } else if (basePath && pathname === basePath) {
    pathname = "";
  }

  const target = path.resolve(outputRoot, pathname);
  if (!target.startsWith(outputRoot)) {
    return null;
  }
  if (!path.extname(target) || pathname.endsWith("/")) {
    return path.join(target, "index.html");
  }
  return target;
}

if (!fs.existsSync(outputRoot)) {
  console.error("ERROR _site does not exist; run the build first");
  process.exit(1);
}

for (const file of walk(outputRoot).filter((item) => item.endsWith(".html"))) {
  htmlCount += 1;
  const html = fs.readFileSync(file, "utf8");
  const expression = /\b(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = expression.exec(html)) !== null) {
    const reference = match[1];
    if (
      !reference ||
      reference.startsWith("#") ||
      reference.startsWith("data:") ||
      /^(?:https?:)?\/\//i.test(reference) ||
      /^(mailto|tel):/i.test(reference)
    ) {
      continue;
    }

    referenceCount += 1;
    const target = reference.startsWith("/")
      ? outputTarget(reference)
      : path.resolve(path.dirname(file), reference.split(/[?#]/)[0]);

    if (!target || !fs.existsSync(target)) {
      errors.push(
        `${path.relative(outputRoot, file)}: missing ${reference}`
      );
    }
  }
}

console.log(`Generated HTML files: ${htmlCount}`);
console.log(`Local references checked: ${referenceCount}`);
console.log(`Errors: ${errors.length}`);

for (const error of errors) {
  console.error(`ERROR ${error}`);
}

if (errors.length > 0) {
  process.exitCode = 1;
}
