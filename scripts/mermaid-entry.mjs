import mermaid from "mermaid";

const mermaidConfig = {
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
};

export async function renderMermaid(nodes) {
  mermaid.initialize(mermaidConfig);
  await mermaid.run({ nodes });
}

export async function renderMermaidSource(source, id) {
  mermaid.initialize({
    ...mermaidConfig,
    deterministicIds: true,
    deterministicIDSeed: id
  });
  const result = await mermaid.render(id, source);
  return result.svg;
}
