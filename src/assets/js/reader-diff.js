(function (root) {
  "use strict";

  const diff =
    root.JsDiff ||
    (typeof module !== "undefined" && module.exports
      ? require("diff")
      : null);

  function lines(value) {
    if (!value) {
      return [];
    }
    const result = value.split("\n");
    if (result[result.length - 1] === "") {
      result.pop();
    }
    return result;
  }

  function buildLineDiff(baseContent, nextContent) {
    if (!diff) {
      return [];
    }
    const parts = diff.diffLines(baseContent || "", nextContent || "");
    const rows = [];
    let oldLine = 1;
    let newLine = 1;

    function append(value, type) {
      lines(value).forEach(function (text) {
        const row = {
          type,
          marker:
            type === "deleted"
              ? "-"
              : type === "added"
                ? "+"
                : type === "modified"
                  ? "~"
                  : " ",
          oldNumber: null,
          newNumber: null,
          text: text || " "
        };
        if (type === "deleted") {
          row.oldNumber = oldLine;
          oldLine += 1;
        } else if (type === "added" || type === "modified") {
          row.newNumber = newLine;
          newLine += 1;
        } else {
          row.oldNumber = oldLine;
          row.newNumber = newLine;
          oldLine += 1;
          newLine += 1;
        }
        rows.push(row);
      });
    }

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const next = parts[index + 1];
      if (part.removed && next && next.added) {
        append(part.value, "deleted");
        append(next.value, "modified");
        index += 1;
      } else if (part.added) {
        append(part.value, "added");
      } else if (part.removed) {
        append(part.value, "deleted");
      } else {
        append(part.value, "context");
      }
    }
    return rows;
  }

  const api = { buildLineDiff };
  root.GCKReaderDiff = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
