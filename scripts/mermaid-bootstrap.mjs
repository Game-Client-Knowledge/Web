const commonDiagramPattern =
  /^(?:graph\b|flowchart(?!-elk)\b|classDiagram(?:-v2)?\b|sequenceDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b)/i;

function getDiagramSource(node) {
  return (node.textContent || "")
    .replace(/^\s*(?:%%(?!\{)[^\n]*\n\s*)+/, "")
    .trimStart();
}

function getUnrenderedNodes(root) {
  return Array.from(root.querySelectorAll(".mermaid")).filter(function (node) {
    return (
      !node.hasAttribute("data-mermaid-rendered") &&
      !node.hasAttribute("data-processed")
    );
  });
}

async function render(root = document) {
  const nodes = getUnrenderedNodes(root);
  if (!nodes.length) return;

  const started = performance.now();
  const useCommonRuntime = nodes.every(function (node) {
    return commonDiagramPattern.test(getDiagramSource(node));
  });
  const runtimeUrl = new URL(
    useCommonRuntime
      ? "./mermaid-common.js"
      : "./fallback/mermaid-full.js",
    import.meta.url
  );
  runtimeUrl.search = new URL(import.meta.url).search;

  document.body.dataset.mermaidState = "rendering";
  document.body.dataset.mermaidRuntime = useCommonRuntime ? "common" : "full";

  try {
    const runtime = await import(runtimeUrl.href);
    await runtime.renderMermaid(nodes);
    document.body.dataset.mermaidState = "ready";
  } catch (error) {
    document.body.dataset.mermaidState = "error";
    console.error("Mermaid rendering failed", error);
  } finally {
    document.body.dataset.mermaidRenderMs = String(
      Math.round(performance.now() - started)
    );
    document.body.dataset.mermaidReadyMs = String(
      Math.round(performance.now())
    );
    document.documentElement.classList.remove("mermaid-loading");
  }
}

window.GCKMermaid = { render };

const diagramNodes = Array.from(document.querySelectorAll(".mermaid"));
if (getUnrenderedNodes(document).length) {
  render();
} else if (diagramNodes.length) {
  document.body.dataset.mermaidState = "ready";
  document.body.dataset.mermaidRuntime = "prerendered";
  document.body.dataset.mermaidRenderMs = "0";
  document.body.dataset.mermaidReadyMs = String(Math.round(performance.now()));
  document.documentElement.classList.remove("mermaid-loading");
}
