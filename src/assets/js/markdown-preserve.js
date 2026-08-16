(function (root) {
  "use strict";

  const diff =
    root.JsDiff ||
    (typeof module !== "undefined" && module.exports
      ? require("diff")
      : null);

  function changedGroups(parts) {
    const groups = [];
    let baseIndex = 0;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part.added && !part.removed) {
        baseIndex += part.value.length;
        continue;
      }
      const group = {
        baseStart: baseIndex,
        deleteCount: 0,
        inserted: []
      };
      while (
        index < parts.length &&
        (parts[index].added || parts[index].removed)
      ) {
        const changed = parts[index];
        if (changed.removed) {
          group.deleteCount += changed.value.length;
          baseIndex += changed.value.length;
        } else {
          group.inserted.push(...changed.value);
        }
        index += 1;
      }
      groups.push(group);
      index -= 1;
    }
    return groups;
  }

  function normalizeEditorHeadingEscapes(source) {
    let fence = "";
    return source
      .split("\n")
      .map(function (line) {
        const trimmed = line.trimStart();
        if (fence) {
          if (trimmed.startsWith(fence)) {
            fence = "";
          }
          return line;
        }
        const opening = trimmed.match(/^(`{3,}|~{3,})/);
        if (opening) {
          fence = opening[1];
          return line;
        }
        return line.replace(
          /^(#{1,6}[ \t]+\d+)\\\.(?=\S|[ \t]|$)/,
          "$1."
        );
      })
      .join("\n");
  }

  function canonicalBoundaries(originalLines, canonicalLines) {
    const boundaries = new Array(canonicalLines.length + 1);
    const parts = diff.diffArrays(originalLines, canonicalLines);
    let originalIndex = 0;
    let canonicalIndex = 0;
    boundaries[0] = 0;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part.added && !part.removed) {
        for (let offset = 0; offset <= part.value.length; offset += 1) {
          boundaries[canonicalIndex + offset] = originalIndex + offset;
        }
        originalIndex += part.value.length;
        canonicalIndex += part.value.length;
        continue;
      }

      const originalStart = originalIndex;
      const canonicalStart = canonicalIndex;
      let removedCount = 0;
      let addedCount = 0;
      while (
        index < parts.length &&
        (parts[index].added || parts[index].removed)
      ) {
        const changed = parts[index];
        if (changed.removed) {
          removedCount += changed.value.length;
          originalIndex += changed.value.length;
        } else {
          addedCount += changed.value.length;
          canonicalIndex += changed.value.length;
        }
        index += 1;
      }

      if (addedCount === 0) {
        boundaries[canonicalStart] = originalStart + removedCount;
      } else {
        for (let offset = 0; offset <= addedCount; offset += 1) {
          boundaries[canonicalStart + offset] =
            originalStart +
            Math.round((offset * removedCount) / addedCount);
        }
      }
      index -= 1;
    }

    boundaries[canonicalLines.length] = originalLines.length;
    let last = 0;
    for (let index = 0; index < boundaries.length; index += 1) {
      if (boundaries[index] === undefined) {
        boundaries[index] = last;
      } else {
        last = boundaries[index];
      }
    }
    return boundaries;
  }

  function preserveSourceFormatting(original, canonical, edited) {
    if (!diff || canonical === edited) {
      return canonical === edited ? original : edited;
    }

    const normalizedCanonical = normalizeEditorHeadingEscapes(canonical);
    const normalizedEdited = normalizeEditorHeadingEscapes(edited);
    if (normalizedCanonical === normalizedEdited) {
      return original;
    }
    const originalLines = original.split("\n");
    const canonicalLines = normalizedCanonical.split("\n");
    const editedLines = normalizedEdited.split("\n");
    const boundaries = canonicalBoundaries(originalLines, canonicalLines);
    const groups = changedGroups(
      diff.diffArrays(canonicalLines, editedLines)
    );
    const result = originalLines.slice();

    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      const start = boundaries[group.baseStart];
      const end = boundaries[group.baseStart + group.deleteCount];
      result.splice(start, Math.max(0, end - start), ...group.inserted);
    }
    return result.join("\n");
  }

  const api = {
    normalizeEditorHeadingEscapes,
    preserveSourceFormatting
  };
  root.GCKMarkdown = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
