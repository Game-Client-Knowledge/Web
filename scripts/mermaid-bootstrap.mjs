const nodes = Array.from(document.querySelectorAll(".mermaid"));
const commonDiagramPattern =
  /^(?:graph\b|flowchart(?!-elk)\b|classDiagram(?:-v2)?\b|sequenceDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b)/i;

function getDiagramSource(node) {
  return (node.textContent || "")
    .replace(/^\s*(?:%%(?!\{)[^\n]*\n\s*)+/, "")
    .trimStart();
}

if (nodes.length) {
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

  import(runtimeUrl.href)
    .then(function (runtime) {
      return runtime.renderMermaid(nodes);
    })
    .then(function () {
      document.body.dataset.mermaidState = "ready";
    })
    .catch(function (error) {
      document.body.dataset.mermaidState = "error";
      console.error("Mermaid rendering failed", error);
    })
    .finally(function () {
      document.body.dataset.mermaidRenderMs = String(
        Math.round(performance.now() - started)
      );
      document.body.dataset.mermaidReadyMs = String(
        Math.round(performance.now())
      );
      document.documentElement.classList.remove("mermaid-loading");
    });
}
