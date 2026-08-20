function validateMarkdownStructure(markdown) {
  const headings = [];
  const errors = [];
  let inFence = false;
  let fenceCount = 0;

  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      fenceCount += 1;
      continue;
    }
    if (inFence) {
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+\S/);
    if (heading) {
      headings.push(heading[1].length);
    }
  }

  if (fenceCount % 2 !== 0) {
    errors.push("代码围栏未闭合");
  }

  const h1Count = headings.filter((level) => level === 1).length;
  if (h1Count !== 1) {
    errors.push(`需要且只能有一个一级标题，当前为 ${h1Count} 个`);
  }

  return errors;
}

module.exports = { validateMarkdownStructure };
