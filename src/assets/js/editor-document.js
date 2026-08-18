(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.GCKEditorDocument = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function splitMarkdownDocument(content) {
    const source = String(content || "");
    const match = source.match(/^#\s+(.+?)\s*$/m);
    if (!match || match.index === undefined) {
      return {
        prefix: "",
        title: "",
        body: source
      };
    }
    const lineEnd = source.indexOf(
      "\n",
      match.index + match[0].length
    );
    return {
      prefix: source.slice(0, match.index),
      title: match[1].replace(/[*_`]/g, "").trim(),
      body:
        lineEnd < 0
          ? ""
          : source.slice(lineEnd + 1).replace(/^\r?\n/, "")
    };
  }

  function assembleMarkdownDocument(parts, title, body) {
    const prefix = parts?.prefix || "";
    const heading = title ? "# " + title.trim() + "\n" : "";
    const normalizedBody = String(body || "").replace(/^\n+/, "");
    return (
      prefix +
      heading +
      (heading && normalizedBody ? "\n" : "") +
      normalizedBody
    );
  }

  function topLevelHeadingCount(content) {
    let count = 0;
    let fence = "";
    for (const line of String(content || "").split("\n")) {
      const trimmed = line.trimStart();
      if (fence) {
        if (trimmed.startsWith(fence)) fence = "";
        continue;
      }
      const opening = trimmed.match(/^(`{3,}|~{3,})/);
      if (opening) {
        fence = opening[1];
        continue;
      }
      if (/^#\s+\S/.test(line)) count += 1;
    }
    return count;
  }

  function validateCompleteSnapshot(path, content) {
    if (!String(path || "").toLowerCase().endsWith(".md")) {
      return { valid: true, message: "" };
    }
    const headingCount = topLevelHeadingCount(content);
    return {
      valid: headingCount === 1,
      message:
        headingCount === 1
          ? ""
          : (
              "当前编辑结果不是完整 Markdown 文档：" +
              "需要且只能有一个一级标题，已阻止覆盖 Current Tree。"
            )
    };
  }

  function exactOccurrenceCount(source, fragment) {
    if (!fragment) return 0;
    let count = 0;
    let offset = 0;
    while (offset <= source.length) {
      const index = source.indexOf(fragment, offset);
      if (index < 0) break;
      count += 1;
      offset = index + fragment.length;
    }
    return count;
  }

  function repairLegacyPartialSnapshot(
    path,
    completeBase,
    staleBase,
    localContent
  ) {
    const base = String(completeBase || "");
    const stale = String(staleBase || "");
    const local = String(localContent || "");
    const currentValidation = validateCompleteSnapshot(path, local);
    if (currentValidation.valid) {
      return { content: local, repaired: false };
    }
    if (
      !base ||
      !stale ||
      stale === base ||
      stale.length >= base.length * 0.8 ||
      exactOccurrenceCount(base, stale) !== 1
    ) {
      return { content: local, repaired: false };
    }
    const candidate = base.replace(stale, local);
    if (!validateCompleteSnapshot(path, candidate).valid) {
      return { content: local, repaired: false };
    }
    return {
      content: candidate,
      repaired: true
    };
  }

  return {
    assembleMarkdownDocument,
    repairLegacyPartialSnapshot,
    splitMarkdownDocument,
    topLevelHeadingCount,
    validateCompleteSnapshot
  };
});
