(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GCKMarkdownLivePreview = api;
  }
})(typeof globalThis === "object" ? globalThis : window, function () {
  "use strict";

  const BLOCK_SELECTOR = "[data-md-block]";
  const IGNORED_SELECTOR =
    "a, button, input, textarea, select, option, [contenteditable]";

  function lineStarts(source) {
    const starts = [0];
    const pattern = /\r\n|\n|\r/g;
    let match = pattern.exec(source);
    while (match) {
      starts.push(match.index + match[0].length);
      match = pattern.exec(source);
    }
    return starts;
  }

  function sourceRange(source, startLine, endLine) {
    const value = String(source || "");
    const starts = lineStarts(value);
    const startIndex = Number(startLine);
    const endIndex = Number(endLine);
    if (
      !Number.isInteger(startIndex) ||
      !Number.isInteger(endIndex) ||
      startIndex < 0 ||
      endIndex <= startIndex ||
      startIndex >= starts.length
    ) {
      return null;
    }
    const start = starts[startIndex];
    const end =
      endIndex < starts.length
        ? starts[endIndex]
        : value.length;
    const segment = value.slice(start, end);
    const trailingMatch = segment.match(/(?:(?:\r\n|\n|\r))+$/);
    return {
      before: value.slice(0, start),
      editable: trailingMatch
        ? segment.slice(0, -trailingMatch[0].length)
        : segment,
      after: value.slice(end),
      trailing: trailingMatch ? trailingMatch[0] : "",
      lineEnding:
        value.match(/\r\n|\n|\r/)?.[0] || "\n"
    };
  }

  function replaceSourceRange(range, nextValue) {
    if (!range) {
      return null;
    }
    let replacement = String(nextValue || "").replace(
      /\r\n|\n|\r/g,
      range.lineEnding
    );
    if (range.trailing) {
      replacement =
        replacement.replace(/(?:(?:\r\n|\n|\r))+$/, "") +
        range.trailing;
    }
    return range.before + replacement + range.after;
  }

  function markerFor(target, container) {
    if (!target || target.closest(IGNORED_SELECTOR)) {
      return null;
    }
    const marker = target.closest(BLOCK_SELECTOR);
    if (!marker || !container.contains(marker)) {
      return null;
    }
    return marker;
  }

  function normalizeFenceMarkers(container) {
    container
      .querySelectorAll("pre > code[data-md-block]")
      .forEach(function (code) {
        const pre = code.parentElement;
        for (const name of [
          "data-md-block",
          "data-source-start",
          "data-source-end",
          "data-source-kind"
        ]) {
          if (code.hasAttribute(name)) {
            pre.setAttribute(name, code.getAttribute(name) || "");
            code.removeAttribute(name);
          }
        }
      });
  }

  function create(container, options) {
    if (!container || typeof options?.getSource !== "function") {
      throw new Error("Markdown Live Preview 缺少源码读取器");
    }

    let active = null;
    let destroyed = false;

    function refresh() {
      if (destroyed) return;
      container.dataset.mdLivePreview = "";
      normalizeFenceMarkers(container);
    }

    function reportError(error, editor) {
      editor?.classList.add("is-invalid");
      if (typeof options.onError === "function") {
        options.onError(error);
      }
    }

    async function finish(record, rerender) {
      if (!record || record !== active) {
        return;
      }
      active = null;
      record.target.hidden = false;
      record.editor.remove();
      if (
        !destroyed &&
        rerender !== false &&
        typeof options.render === "function"
      ) {
        try {
          await options.render();
          refresh();
        } catch (error) {
          reportError(error);
        }
      }
    }

    function resize(textarea, minimumHeight) {
      textarea.style.height = "auto";
      textarea.style.height =
        Math.max(minimumHeight, textarea.scrollHeight + 2) + "px";
    }

    function open(marker) {
      if (destroyed || active) {
        return;
      }
      const startLine = Number(marker.dataset.sourceStart);
      const endLine = Number(marker.dataset.sourceEnd);
      const range = sourceRange(
        options.getSource(),
        startLine,
        endLine
      );
      if (!range) {
        return;
      }

      const target = marker;
      const targetStyle = getComputedStyle(target);
      const editor = document.createElement("div");
      editor.className = "md-live-preview-editor";
      editor.dataset.sourceStart = String(startLine);
      editor.dataset.sourceEnd = String(endLine);
      editor.style.marginTop = targetStyle.marginTop;
      editor.style.marginBottom = targetStyle.marginBottom;

      const textarea = document.createElement("textarea");
      textarea.value = range.editable;
      textarea.spellcheck = false;
      textarea.setAttribute(
        "aria-label",
        "编辑 Markdown 第 " +
          (startLine + 1) +
          " 至 " +
          endLine +
          " 行"
      );
      editor.append(textarea);
      target.before(editor);
      target.hidden = true;

      const minimumHeight = Math.max(
        72,
        Math.ceil(target.getBoundingClientRect().height) + 28
      );
      active = { editor, range, target, textarea };
      resize(textarea, minimumHeight);

      textarea.addEventListener("input", function () {
        editor.classList.remove("is-invalid");
        const nextSource = replaceSourceRange(range, textarea.value);
        try {
          options.setSource?.(nextSource, {
            startLine,
            endLine,
            kind: marker.dataset.sourceKind || ""
          });
        } catch (error) {
          reportError(error, editor);
        }
        resize(textarea, minimumHeight);
      });
      textarea.addEventListener("keydown", function (event) {
        if (event.key === "Tab") {
          event.preventDefault();
          textarea.setRangeText(
            "  ",
            textarea.selectionStart,
            textarea.selectionEnd,
            "end"
          );
          textarea.dispatchEvent(
            new Event("input", { bubbles: true })
          );
          return;
        }
        if (
          event.key === "Escape" ||
          (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey)
          )
        ) {
          event.preventDefault();
          textarea.blur();
        }
      });
      textarea.addEventListener(
        "blur",
        function () {
          window.setTimeout(function () {
            finish(active, true);
          }, 0);
        },
        { once: true }
      );
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
    }

    function handleDoubleClick(event) {
      const marker = markerFor(event.target, container);
      if (!marker) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      open(marker);
    }

    container.addEventListener("dblclick", handleDoubleClick);
    refresh();

    return {
      close: function (rerender) {
        return finish(active, rerender !== false);
      },
      destroy: function () {
        destroyed = true;
        container.removeEventListener("dblclick", handleDoubleClick);
        if (active) {
          active.target.hidden = false;
          active.editor.remove();
          active = null;
        }
        container.removeAttribute("data-md-live-preview");
      },
      refresh,
      sourceRange
    };
  }

  return {
    create,
    replaceSourceRange,
    sourceRange
  };
});
