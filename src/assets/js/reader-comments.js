(function () {
  "use strict";

  const config = window.GCK_CONFIG || {};
  const context = config.editorContext || {};
  const article = document.querySelector("[data-editor-host]");
  const panel = document.querySelector("[data-comments-panel]");
  const track = document.querySelector("[data-comments-track]");
  const composer = document.querySelector("[data-comment-composer]");
  const content =
    article &&
    (article.querySelector(".prose") ||
      article.querySelector("[data-source-code]"));

  if (!article || !panel || !track || !content || !context.sourcePath) {
    return;
  }

  const state = {
    bootstrap: null,
    source: "",
    payload: null,
    blocks: [],
    members: [],
    target: null,
    focusedId: null,
    expandedReplies: new Set(),
    mentionIds: new Set(),
    selectionButton: null,
    pressTimer: 0
  };

  function refreshIcons(root) {
    if (window.lucide) {
      window.lucide.createIcons({
        attrs: { "stroke-width": 1.8 },
        root: root || document
      });
    }
  }

  async function api(path, options) {
    const settings = options || {};
    const headers = { ...(settings.headers || {}) };
    if (state.bootstrap && state.bootstrap.session.authenticated) {
      headers["X-CSRF-Token"] = state.bootstrap.session.csrf_token;
    }
    if (settings.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(config.editorApi + path, {
      ...settings,
      headers: headers,
      credentials: "same-origin"
    });
    if (!response.ok) {
      const payload = await response.json().catch(function () {
        return {};
      });
      throw new Error(payload.detail || "请求失败");
    }
    return response.json();
  }

  function sourceRanges(markdown) {
    const lines = markdown.split(/\r?\n/);
    const ranges = [];
    let index = 0;
    if (lines[0] === "---") {
      index = 1;
      while (index < lines.length && lines[index] !== "---") index += 1;
      index += 1;
    }
    while (index < lines.length) {
      if (!lines[index].trim()) {
        index += 1;
        continue;
      }
      const start = index;
      const trimmed = lines[index].trim();
      if (/^#\s+/.test(trimmed)) {
        index += 1;
        continue;
      }
      if (/^```|^~~~/.test(trimmed)) {
        const fence = trimmed.slice(0, 3);
        index += 1;
        while (index < lines.length && !lines[index].trim().startsWith(fence)) {
          index += 1;
        }
        index = Math.min(lines.length, index + 1);
      } else if (/^#{2,6}\s+|^---+$|^\*\*\*+$/.test(trimmed)) {
        index += 1;
      } else {
        index += 1;
        while (index < lines.length && lines[index].trim()) {
          const next = lines[index].trim();
          if (/^#{2,6}\s+|^```|^~~~/.test(next)) break;
          index += 1;
        }
      }
      ranges.push({ start: start + 1, end: Math.max(start + 1, index) });
    }
    return ranges;
  }

  function mapSourceBlocks() {
    if (content.matches("[data-source-code]")) {
      content.dataset.sourceStart = "1";
      content.dataset.sourceEnd = String(
        Math.max(1, state.source.split(/\r?\n/).length)
      );
      state.blocks = [content];
      return;
    }
    const elements = Array.from(content.children).filter(function (element) {
      return !element.matches(".reader-author-label");
    });
    const ranges = sourceRanges(state.source);
    elements.forEach(function (element, index) {
      const range = ranges[index] || ranges[ranges.length - 1] || {
        start: 1,
        end: 1
      };
      element.dataset.sourceStart = String(range.start);
      element.dataset.sourceEnd = String(range.end);
    });
    state.blocks = elements;
  }

  function authorsForLines(start, end) {
    const authors = [];
    (state.payload.authors || []).forEach(function (range) {
      if (range.end_line < start || range.start_line > end) return;
      const name =
        range.author.github_login || range.author.name || "Unknown";
      if (!authors.includes(name)) authors.push(name);
    });
    return authors;
  }

  function showAuthors() {
    document.querySelectorAll(".reader-author-label").forEach(function (label) {
      label.remove();
    });
    let previous = "";
    state.blocks.forEach(function (block) {
      const names = authorsForLines(
        Number(block.dataset.sourceStart),
        Number(block.dataset.sourceEnd)
      );
      if (!names.length) return;
      const signature = names.join("\u0000");
      if (signature === previous) return;
      previous = signature;
      const label = document.createElement("span");
      label.className = "reader-author-label";
      label.textContent =
        "最近修改 · " +
        (names.length > 2
          ? names.slice(0, 2).join("、") + " +" + (names.length - 2)
          : names.join("、"));
      label.title = names.join("、");
      if (block.matches("pre, code")) {
        const bar = article.querySelector(".source-viewer-bar");
        if (bar) bar.appendChild(label);
      } else {
        block.before(label);
      }
    });
  }

  function textOffset(root, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
      range.setEnd(node, offset);
    } catch {
      return 0;
    }
    return range.toString().length;
  }

  function textPoint(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let node = walker.nextNode();
    while (node) {
      if (remaining <= node.data.length) {
        return { node: node, offset: remaining };
      }
      remaining -= node.data.length;
      node = walker.nextNode();
    }
    return { node: root, offset: root.childNodes.length };
  }

  function blockForNode(node) {
    const element =
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element && element.closest("[data-source-start]");
  }

  function lineAtOffset(value, offset) {
    const before = value.slice(0, offset);
    const pieces = before.split(/\r?\n/);
    return {
      line: pieces.length,
      column: pieces[pieces.length - 1].length
    };
  }

  function targetFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) return null;
    const startBlock = blockForNode(range.startContainer);
    const endBlock = blockForNode(range.endContainer);
    const startIndex = state.blocks.indexOf(startBlock);
    const endIndex = state.blocks.indexOf(endBlock);
    if (startIndex < 0 || endIndex < 0) return null;
    const first = Math.min(startIndex, endIndex);
    const last = Math.max(startIndex, endIndex);
    const quote = selection.toString().trim();
    if (!quote) return null;
    const segments = state.blocks.slice(first, last + 1).map(function (block) {
      const blockText = block.textContent || "";
      const isFirst = block === startBlock;
      const isLast = block === endBlock;
      const startOffset = isFirst
        ? textOffset(block, range.startContainer, range.startOffset)
        : 0;
      const endOffset = isLast
        ? textOffset(block, range.endContainer, range.endOffset)
        : blockText.length;
      return {
        block_start_line: Number(block.dataset.sourceStart),
        block_end_line: Number(block.dataset.sourceEnd),
        start_offset: Math.min(startOffset, endOffset),
        end_offset: Math.max(startOffset, endOffset),
        quote: blockText.slice(
          Math.min(startOffset, endOffset),
          Math.max(startOffset, endOffset)
        )
      };
    });
    let startLine = segments[0].block_start_line;
    let endLine = segments[segments.length - 1].block_end_line;
    let startColumn = 0;
    let endColumn = 0;
    const rawIndex = state.source.indexOf(quote);
    if (rawIndex >= 0) {
      const start = lineAtOffset(state.source, rawIndex);
      const end = lineAtOffset(state.source, rawIndex + quote.length);
      startLine = start.line;
      endLine = end.line;
      startColumn = start.column;
      endColumn = end.column;
    }
    return {
      path: context.sourcePath,
      revision_sha:
        (state.payload.revision && state.payload.revision.commit_sha) ||
        config.contentVersion,
      start_line: startLine,
      end_line: endLine,
      start_column: startColumn,
      end_column: endColumn,
      quote: quote,
      render_segments: segments
    };
  }

  function rangeForSegment(segment) {
    const block = state.blocks.find(function (candidate) {
      return (
        Number(candidate.dataset.sourceStart) === segment.block_start_line &&
        Number(candidate.dataset.sourceEnd) === segment.block_end_line
      );
    });
    if (!block) return null;
    const start = textPoint(block, segment.start_offset);
    const end = textPoint(block, segment.end_offset);
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    } catch {
      return null;
    }
  }

  function applyHighlights() {
    state.blocks.forEach(function (block) {
      block.classList.remove("reader-commented-fallback");
    });
    const ranges = [];
    rootComments().forEach(function (comment) {
      (comment.render_segments || []).forEach(function (segment) {
        const range = rangeForSegment(segment);
        if (range && !range.collapsed) ranges.push(range);
      });
      if (!comment.render_segments.length) {
        state.blocks.forEach(function (block) {
          const start = Number(block.dataset.sourceStart);
          const end = Number(block.dataset.sourceEnd);
          if (end >= comment.start_line && start <= comment.end_line) {
            block.classList.add("reader-commented-fallback");
          }
        });
      }
    });
    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete("reader-comments");
      if (ranges.length) {
        CSS.highlights.set("reader-comments", new Highlight(...ranges));
      }
    }
  }

  function openPanel() {
    panel.hidden = false;
    document.body.classList.add("has-comments-open");
    const toggle = document.querySelector("[data-comments-toggle]");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    positionGroups();
    window.requestAnimationFrame(positionGroups);
  }

  function closePanel() {
    document.body.classList.remove("has-comments-open");
    panel.hidden = true;
    const toggle = document.querySelector("[data-comments-toggle]");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function rootComments() {
    return (state.payload.comments || []).filter(function (comment) {
      return !comment.parent_id;
    });
  }

  function repliesFor(rootId) {
    return (state.payload.comments || []).filter(function (comment) {
      return comment.parent_id === rootId;
    });
  }

  function anchorKey(comment) {
    return [
      comment.start_line,
      comment.end_line,
      comment.start_column,
      comment.end_column,
      comment.quote
    ].join(":");
  }

  function anchorBlock(comment) {
    return (
      state.blocks.find(function (block) {
        const start = Number(block.dataset.sourceStart);
        const end = Number(block.dataset.sourceEnd);
        return end >= comment.start_line && start <= comment.end_line;
      }) || state.blocks[0]
    );
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function button(label, className) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className || "";
    element.textContent = label;
    return element;
  }

  function focusComment(id) {
    state.focusedId = id;
    renderComments();
    const target = track.querySelector('[data-comment-id="' + id + '"]');
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function commentBody(comment, root) {
    const wrapper = document.createElement(root ? "article" : "div");
    wrapper.className = root ? "comment-card" : "comment-reply";
    wrapper.dataset.commentId = String(comment.id);
    if (state.focusedId === comment.id) wrapper.classList.add("is-focused");

    const header = document.createElement("header");
    const author = document.createElement("strong");
    author.textContent =
      "@" + (comment.author.github_login || comment.author.username);
    const time = document.createElement("time");
    time.dateTime = comment.created_at;
    time.textContent = formatDate(comment.created_at);
    header.append(author, time);
    wrapper.appendChild(header);

    if (root) {
      const quote = document.createElement("p");
      quote.className = "comment-quote";
      quote.textContent = comment.quote;
      wrapper.appendChild(quote);
    } else if (comment.reply_to_id && comment.reply_to_id !== comment.parent_id) {
      const reference = button("回复对应评论", "comment-reference");
      reference.addEventListener("click", function () {
        focusComment(comment.reply_to_id);
      });
      wrapper.appendChild(reference);
    }

    const body = document.createElement("p");
    body.className = "comment-body";
    body.textContent = comment.body;
    if (state.focusedId === comment.id) {
      body.style.setProperty("--comment-lines", "8");
    }
    wrapper.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "comment-actions";
    const reply = button("回复");
    reply.addEventListener("click", function () {
      const rootComment = root
        ? comment
        : state.payload.comments.find(function (item) {
            return item.id === comment.parent_id;
          });
      openComposer(
        {
          path: rootComment.path,
          revision_sha: rootComment.revision_sha,
          start_line: rootComment.start_line,
          end_line: rootComment.end_line,
          start_column: rootComment.start_column,
          end_column: rootComment.end_column,
          quote: rootComment.quote,
          render_segments: rootComment.render_segments
        },
        rootComment.id,
        comment.id,
        comment.author.username
      );
    });
    actions.appendChild(reply);

    if (comment.body.length > 220) {
      const more = button("继续展开", "comment-more");
      more.addEventListener("click", function () {
        const lines =
          Number(body.style.getPropertyValue("--comment-lines") || 8) + 8;
        body.style.setProperty("--comment-lines", String(lines));
        wrapper.classList.add("is-focused");
        state.focusedId = comment.id;
        window.requestAnimationFrame(positionGroups);
      });
      actions.appendChild(more);
    }
    wrapper.appendChild(actions);
    return wrapper;
  }

  function renderGroup(comments) {
    const group = document.createElement("section");
    group.className = "comment-group";
    group.dataset.anchorKey = anchorKey(comments[0]);
    comments.forEach(function (root) {
      const card = commentBody(root, true);
      const replies = repliesFor(root.id);
      if (replies.length) {
        const actions = card.querySelector(".comment-actions");
        const toggle = button(
          state.expandedReplies.has(root.id)
            ? "收起回复"
            : replies.length + " 条回复"
        );
        toggle.addEventListener("click", function () {
          if (state.expandedReplies.has(root.id)) {
            state.expandedReplies.delete(root.id);
          } else {
            state.expandedReplies.add(root.id);
          }
          renderComments();
        });
        actions.appendChild(toggle);
        if (state.expandedReplies.has(root.id)) {
          const replyList = document.createElement("div");
          replyList.className = "comment-replies";
          replies.forEach(function (reply) {
            replyList.appendChild(commentBody(reply, false));
          });
          card.appendChild(replyList);
        }
      }
      card.addEventListener("click", function (event) {
        if (event.target.closest("button")) return;
        state.focusedId = root.id;
        renderComments();
      });
      group.appendChild(card);
    });
    return group;
  }

  function positionGroups() {
    if (panel.hidden || window.innerWidth <= 900) return;
    const panelTop = panel.getBoundingClientRect().top;
    let nextTop = 76;
    Array.from(track.children).forEach(function (group) {
      const comment = rootComments().find(function (item) {
        return anchorKey(item) === group.dataset.anchorKey;
      });
      const anchor = comment && anchorBlock(comment);
      const desired = anchor
        ? anchor.getBoundingClientRect().top - panelTop
        : nextTop;
      const top = Math.max(nextTop, desired);
      group.style.top = Math.round(top) + "px";
      nextTop = top + group.getBoundingClientRect().height + 10;
    });
    track.style.minHeight = Math.max(
      article.getBoundingClientRect().height,
      nextTop + 30
    ) + "px";
  }

  function renderComments() {
    track.replaceChildren();
    const grouped = new Map();
    rootComments().forEach(function (comment) {
      const key = anchorKey(comment);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(comment);
    });
    grouped.forEach(function (comments) {
      track.appendChild(renderGroup(comments));
    });
    const empty = document.querySelector("[data-comments-empty]");
    if (empty) empty.hidden = grouped.size !== 0;
    document.querySelector("[data-comments-title]").textContent =
      rootComments().length + " 条评论";
    refreshIcons(track);
    if (!panel.hidden) positionGroups();
    window.requestAnimationFrame(positionGroups);
  }

  async function loadMembers() {
    if (state.members.length) return;
    const payload = await api("/comment-members");
    state.members = payload.items;
  }

  async function refreshSession() {
    const session = await api("/session");
    if (!state.bootstrap) state.bootstrap = { session: session };
    else state.bootstrap.session = session;
    return session;
  }

  function mentionMenu(textarea, menu) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const match = before.match(/@([\w-]*)$/);
    if (!match) {
      menu.hidden = true;
      return;
    }
    const keyword = match[1].toLowerCase();
    const matches = state.members.filter(function (member) {
      return (
        member.username.toLowerCase().includes(keyword) ||
        (member.github_login || "").toLowerCase().includes(keyword)
      );
    }).slice(0, 8);
    menu.replaceChildren();
    matches.forEach(function (member) {
      const option = button(
        "@" + (member.github_login || member.username) + " · " + member.username
      );
      option.addEventListener("click", function () {
        const insertion = "@" + (member.github_login || member.username) + " ";
        const start = textarea.selectionStart - match[0].length;
        textarea.setRangeText(
          insertion,
          start,
          textarea.selectionStart,
          "end"
        );
        state.mentionIds.add(member.id);
        menu.hidden = true;
        textarea.focus();
      });
      menu.appendChild(option);
    });
    menu.hidden = !matches.length;
  }

  async function openComposer(target, parentId, replyToId, replyName) {
    let session = state.bootstrap && state.bootstrap.session;
    if (!session || !session.authenticated) {
      session = await refreshSession();
    }
    if (!session.authenticated) {
      document.querySelector("[data-account-dialog]").showModal();
      return;
    }
    openPanel();
    state.target = target;
    state.mentionIds.clear();
    await loadMembers();
    composer.hidden = false;
    composer.replaceChildren();
    const quote = document.createElement("blockquote");
    quote.textContent = replyName ? "回复 @" + replyName : target.quote;
    const textarea = document.createElement("textarea");
    textarea.maxLength = 8000;
    textarea.placeholder = parentId ? "写下回复，可使用 @ 提及成员" : "写下评论或问题，可使用 @ 提及成员";
    const menu = document.createElement("div");
    menu.className = "mention-menu";
    menu.hidden = true;
    textarea.addEventListener("input", function () {
      mentionMenu(textarea, menu);
    });
    const footer = document.createElement("footer");
    const cancel = button("取消", "secondary-button");
    const submit = button("发送", "primary-button");
    cancel.addEventListener("click", function () {
      composer.hidden = true;
    });
    submit.addEventListener("click", async function () {
      const body = textarea.value.trim();
      if (!body) {
        textarea.focus();
        return;
      }
      state.members.forEach(function (member) {
        const handle = member.github_login || member.username;
        if (body.includes("@" + handle)) state.mentionIds.add(member.id);
      });
      submit.disabled = true;
      try {
        const created = await api("/comments", {
          method: "POST",
          body: JSON.stringify({
            ...target,
            body: body,
            parent_id: parentId || null,
            reply_to_id: replyToId || null,
            mention_user_ids: Array.from(state.mentionIds)
          })
        });
        state.payload.comments.push(created);
        composer.hidden = true;
        state.focusedId = created.id;
        renderComments();
        applyHighlights();
      } catch (error) {
        submit.disabled = false;
        submit.textContent = error.message;
      }
    });
    footer.append(cancel, submit);
    composer.append(quote, textarea, menu, footer);
    textarea.focus();
  }

  function showSelectionAction() {
    const target = targetFromSelection();
    if (!target) {
      removeSelectionAction();
      return;
    }
    state.target = target;
    const range = window.getSelection().getRangeAt(0);
    const rectangle = range.getBoundingClientRect();
    let action = state.selectionButton;
    if (!action) {
      action = document.createElement("button");
      action.type = "button";
      action.className = "comment-selection-action";
      action.title = "评论选中内容";
      action.setAttribute("aria-label", "评论选中内容");
      action.innerHTML =
        '<i data-lucide="message-square-plus" aria-hidden="true"></i>';
      action.addEventListener("click", function () {
        removeSelectionAction();
        openComposer(state.target);
      });
      document.body.appendChild(action);
      state.selectionButton = action;
      refreshIcons(action);
    }
    action.style.display = "grid";
    action.style.left =
      Math.max(8, Math.min(window.innerWidth - 42, rectangle.right + 7)) + "px";
    action.style.top =
      Math.max(8, Math.min(window.innerHeight - 42, rectangle.bottom + 7)) + "px";
  }

  function removeSelectionAction() {
    if (state.selectionButton) state.selectionButton.style.display = "none";
  }

  function bindSelection() {
    content.addEventListener("pointerup", function () {
      window.setTimeout(showSelectionAction, 20);
    });
    content.addEventListener("pointerdown", function (event) {
      const block = blockForNode(event.target);
      if (!block || event.target.closest("a, button")) return;
      window.clearTimeout(state.pressTimer);
      state.pressTimer = window.setTimeout(function () {
        const selection = window.getSelection();
        if (selection && selection.isCollapsed) {
          const range = document.createRange();
          range.selectNodeContents(block);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        showSelectionAction();
      }, 550);
    });
    content.addEventListener("pointermove", function () {
      window.clearTimeout(state.pressTimer);
    });
    content.addEventListener("pointercancel", function () {
      window.clearTimeout(state.pressTimer);
    });
    content.addEventListener("click", function (event) {
      const block = blockForNode(event.target);
      if (!block || window.getSelection().toString()) return;
      const start = Number(block.dataset.sourceStart);
      const end = Number(block.dataset.sourceEnd);
      const comment = rootComments().find(function (item) {
        return item.end_line >= start && item.start_line <= end;
      });
      if (comment) {
        openPanel();
        focusComment(comment.id);
      }
    });
  }

  function bindPanel() {
    const toggle = document.querySelector("[data-comments-toggle]");
    toggle.addEventListener("click", function () {
      if (panel.hidden) openPanel();
      else closePanel();
    });
    document.querySelector("[data-comments-close]").addEventListener(
      "click",
      closePanel
    );
    const handle = document.querySelector("[data-comments-resize]");
    handle.addEventListener("pointerdown", function (event) {
      handle.setPointerCapture(event.pointerId);
      function move(moveEvent) {
        const width = Math.max(
          320,
          Math.min(720, window.innerWidth - moveEvent.clientX)
        );
        document.body.style.setProperty("--comments-width", width + "px");
        positionGroups();
      }
      function stop() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
    });
    window.addEventListener("resize", positionGroups);
  }

  function bindNotificationPreference() {
    const session = state.bootstrap && state.bootstrap.session;
    if (!session) return;
    if (!session.authenticated) return;
    const actions = document.querySelector(".account-actions");
    if (!actions || actions.querySelector("[data-email-notifications]")) return;
    const label = document.createElement("label");
    label.className = "notification-preference";
    label.innerHTML =
      '<span>评论与回复邮件</span>' +
      '<input type="checkbox" data-email-notifications>';
    const input = label.querySelector("input");
    input.checked = session.user.email_notifications_enabled;
    input.addEventListener("change", async function () {
      input.disabled = true;
      try {
        await api("/account/notification-preferences", {
          method: "PUT",
          body: JSON.stringify({
            email_notifications_enabled: input.checked
          })
        });
        session.user.email_notifications_enabled = input.checked;
      } catch {
        input.checked = !input.checked;
      } finally {
        input.disabled = false;
      }
    });
    actions.prepend(label);
  }

  function bindAccountRefresh() {
    const trigger = document.querySelector("[data-account-trigger]");
    if (!trigger) return;
    trigger.addEventListener("click", function () {
      window.setTimeout(async function () {
        try {
          await refreshSession();
          bindNotificationPreference();
        } catch {
          // The account panel remains usable when the editor API is unavailable.
        }
      }, 250);
    });
  }

  async function sourceText() {
    const prefetched = window.GCK_SOURCE_PREFETCH;
    if (prefetched && prefetched.path === context.sourcePath) {
      const result = await prefetched.promise;
      if (result) return result.content;
    }
    if (window.GCKSource) {
      const result = await window.GCKSource.load(context.sourcePath, {
        version: config.contentVersion,
        rawBase: config.rawBase
      });
      return result.content;
    }
    return "";
  }

  async function initialize() {
    bindPanel();
    bindAccountRefresh();
    try {
      const bootstrap =
        window.GCK_EDITOR_BOOTSTRAP ||
        api(
          "/bootstrap?path=" +
            encodeURIComponent(context.sourcePath)
        );
      const values = await Promise.all([
        bootstrap,
        sourceText(),
        api("/comments?path=" + encodeURIComponent(context.sourcePath))
      ]);
      state.bootstrap = values[0];
      state.source = values[1];
      state.payload = values[2];
      mapSourceBlocks();
      showAuthors();
      applyHighlights();
      renderComments();
      bindSelection();
      bindNotificationPreference();
      const requested = Number(
        new URLSearchParams(window.location.search).get("comment")
      );
      if (requested && state.payload.comments.some(function (item) {
        return item.id === requested;
      })) {
        openPanel();
        focusComment(requested);
      }
    } catch (error) {
      console.error("Reader comments failed to initialize", error);
    }
  }

  initialize();
})();
