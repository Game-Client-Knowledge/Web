const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveContentRoot } = require("../lib/content-loader");
const {
  CACHE_VERSION,
  cachePath,
  createMermaidCacheKey,
  normalizeMermaidSource
} = require("../lib/mermaid-cache");

const projectRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(projectRoot, ".cache", "vendor", "mermaid");
const executableCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const playwrightExecutable = chromium.executablePath();
const executablePath =
  executableCandidates.find(fs.existsSync) ||
  (fs.existsSync(playwrightExecutable) ? playwrightExecutable : null);
const mermaidFencePattern =
  /^```[ \t]*mermaid(?:[ \t][^\n]*)?\r?\n([\s\S]*?)^```[ \t]*$/gm;

function walkMarkdownFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === ".md"
      ) {
        files.push(absolutePath);
      }
    }
  }
  visit(root);
  return files.sort();
}

function collectDiagrams(contentRoot) {
  const diagrams = [];
  for (const absolutePath of walkMarkdownFiles(contentRoot)) {
    const sourceRelative = path
      .relative(contentRoot, absolutePath)
      .split(path.sep)
      .join("/");
    const markdown = fs.readFileSync(absolutePath, "utf8");
    let index = 0;
    let match;
    mermaidFencePattern.lastIndex = 0;
    while ((match = mermaidFencePattern.exec(markdown))) {
      const source = normalizeMermaidSource(match[1]);
      const key = createMermaidCacheKey(sourceRelative, index, source);
      diagrams.push({
        id: `gck-mermaid-${key.slice(0, 24)}`,
        key,
        source,
        sourceRelative,
        index
      });
      index += 1;
    }
  }
  return diagrams;
}

function contentType(filePath) {
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  return "application/octet-stream";
}

function createRenderServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/render") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <body>
    <script type="module">
      import { renderMermaidSource } from "/vendor/fallback/mermaid-full.js";
      window.renderMermaidSource = renderMermaidSource;
      window.mermaidRendererReady = true;
    </script>
  </body>
</html>`);
      return;
    }
    if (!pathname.startsWith("/vendor/")) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(pathname.slice("/vendor/".length));
    const absolutePath = path.resolve(vendorRoot, relative);
    if (
      !absolutePath.startsWith(`${vendorRoot}${path.sep}`) ||
      !fs.existsSync(absolutePath)
    ) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(absolutePath),
      "Cache-Control": "no-store"
    });
    fs.createReadStream(absolutePath).pipe(response);
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  if (!executablePath) {
    throw new Error(
      "Chrome or Chromium is required to pre-render Mermaid diagrams. " +
        "Set CHROME_PATH."
    );
  }
  const contentRoot = resolveContentRoot();
  const diagrams = collectDiagrams(contentRoot);
  const rendered = {};
  const server = createRenderServer();
  const port = await listen(server);
  let browser;

  try {
    browser = await chromium.launch({
      executablePath,
      headless: true
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/render`);
    await page.waitForFunction(() => window.mermaidRendererReady === true);

    for (const diagram of diagrams) {
      try {
        rendered[diagram.key] = await page.evaluate(
          ({ id, source }) => window.renderMermaidSource(source, id),
          diagram
        );
      } catch (error) {
        throw new Error(
          `Failed to render Mermaid block ${diagram.index + 1} in ` +
            `${diagram.sourceRelative}: ${error.message}`
        );
      }
    }
  } finally {
    if (browser) await browser.close();
    await close(server);
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify({
      version: CACHE_VERSION,
      generatedAt: new Date().toISOString(),
      diagrams: rendered
    })
  );
  console.log(`Pre-rendered Mermaid diagrams: ${diagrams.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
