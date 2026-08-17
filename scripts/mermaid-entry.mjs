import mermaid from "mermaid";

const nodes = Array.from(document.querySelectorAll(".mermaid"));

if (nodes.length) {
  const started = performance.now();
  document.body.dataset.mermaidState = "rendering";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      primaryColor: "#e6f3ef",
      primaryTextColor: "#1f2926",
      primaryBorderColor: "#178071",
      lineColor: "#66736e",
      secondaryColor: "#fff3e8",
      tertiaryColor: "#f3f1e8",
      fontFamily: "Inter, system-ui, sans-serif"
    }
  });
  mermaid
    .run({ nodes })
    .then(function () {
      document.body.dataset.mermaidState = "ready";
    })
    .catch(function () {
      document.body.dataset.mermaidState = "error";
    })
    .finally(function () {
      document.body.dataset.mermaidRenderMs = String(
        Math.round(performance.now() - started)
      );
      document.documentElement.classList.remove("mermaid-loading");
    });
}
