import mermaid from "mermaid";

export async function renderMermaid(nodes) {
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
  await mermaid.run({ nodes });
}
