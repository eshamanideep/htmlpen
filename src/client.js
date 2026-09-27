// htmlpen browser overlay: comment on and edit the page. The htmlpen server injects it.
(() => {
  const me = document.currentScript;
  const FILE = me.dataset.file; // URL path of the HTML file being reviewed
  const DISPLAY = me.dataset.display; // how agents should refer to the file
  const SIDECAR = `${FILE}.comments.json`;
  const MODE_KEY = `htmlpen:mode:${FILE}`;
  me.remove(); // the live DOM must mirror the file so edits can be matched back to source

  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  async function api(route, body) {
    const res = await fetch(
      `/__htmlpen/${route}?file=${encodeURIComponent(FILE)}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-htmlpen': '1' },
            body: JSON.stringify(body),
          },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }

  // ---------- UI (shadow DOM, so the page's CSS and ours never mix) ----------
  const host = document.createElement('htmlpen-ui');
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
    button { border: 0; border-radius: 8px; padding: 7px 10px; cursor: pointer; background: #f4f4f5; color: #18181b; }
    button:hover { background: #e4e4e7; }
    button.primary { background: #18181b; color: #fff; }
    .box { position: fixed; display: none; pointer-events: none; z-index: 2147483646;
      border: 2px solid var(--c); border-radius: 4px; background: color-mix(in srgb, var(--c) 10%, transparent); }
    .box span { position: absolute; top: -20px; left: -2px; padding: 1px 5px; border-radius: 4px;
      background: var(--c); color: #fff; font-size: 11px; white-space: nowrap; }
    #hl, #active { --c: #f59e0b; }
    :host([mode=edit]) #hl, :host([mode=edit]) #active { --c: #3b82f6; }
    #active { border-style: solid; background: none; }
    .pin { position: fixed; top: 0; left: 0; z-index: 2147483646; width: 22px; height: 22px; padding: 0;
      border-radius: 11px 11px 11px 2px; background: #f59e0b; color: #18181b; font-weight: 600; font-size: 12px;
      box-shadow: 0 1px 4px #0005; }
    .pin:hover { background: #fbbf24; }
    #bar { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      display: flex; gap: 2px; padding: 4px; border-radius: 12px; background: #18181b; box-shadow: 0 4px 20px #0004; }
    #bar button { background: transparent; color: #e4e4e7; }
    #bar button:hover { background: #3f3f46; }
    #bar button.on[data-mode=comment] { background: #f59e0b; color: #18181b; }
    #bar button.on[data-mode=edit] { background: #3b82f6; color: #fff; }
    #bar kbd { opacity: .55; margin-left: 4px; font-size: 11px; }
    #bar .sep { width: 1px; margin: 6px 2px; background: #3f3f46; }
    #pop { position: fixed; z-index: 2147483647; width: 320px; padding: 10px; border-radius: 10px;
      background: #fff; color: #18181b; box-shadow: 0 8px 30px #0003; }
    #pop-target { color: #71717a; margin-bottom: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    textarea { width: 100%; min-height: 80px; resize: vertical; padding: 8px; border: 1px solid #d4d4d8;
      border-radius: 6px; color: #18181b; background: #fff; }
    textarea:focus { outline: 2px solid #f59e0b; border-color: transparent; }
    .row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    #panel { position: fixed; top: 12px; right: 12px; bottom: 72px; width: 340px; z-index: 2147483647;
      display: flex; flex-direction: column; border-radius: 12px; background: #fff; color: #18181b; box-shadow: 0 8px 30px #0003; }
    #panel header, #panel footer { display: flex; align-items: center; gap: 6px; padding: 10px 12px; }
    #panel header { justify-content: space-between; border-bottom: 1px solid #f4f4f5; font-weight: 600; }
    #panel footer { border-top: 1px solid #f4f4f5; }
    #list { flex: 1; overflow: auto; margin: 0; padding: 0; list-style: none; }
    #list li { padding: 10px 12px; border-bottom: 1px solid #f4f4f5; cursor: pointer; }
    #list li:hover, #list li.flash { background: #fffbeb; }
    #list li.resolved { opacity: .5; }
    #list .where { color: #71717a; font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    #list q { display: block; color: #52525b; font-style: italic; margin-top: 4px; }
    #list p { margin: 4px 0 6px; white-space: pre-wrap; }
    #list .actions button { padding: 3px 8px; font-size: 12px; }
    #list .empty { color: #71717a; cursor: default; }
    #toast { position: fixed; bottom: 70px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      padding: 8px 12px; border-radius: 8px; background: #18181b; color: #fff; max-width: 90vw; }
    [hidden] { display: none !important; }
  </style>
  <div id="hl" class="box"><span></span></div>
  <div id="active" class="box"></div>
  <div id="pins"></div>
  <form id="pop" hidden>
    <div id="pop-target"></div>
    <textarea aria-label="Comment" placeholder="What should change?  (⌘/Ctrl+Enter to save)"></textarea>
    <div class="row"><button type="button" id="pop-cancel">Cancel</button><button class="primary">Comment</button></div>
  </form>
  <aside id="panel" hidden aria-label="Comments">
    <header>Comments <button id="panel-close" aria-label="Close">×</button></header>
    <ol id="list"></ol>
    <footer><button id="page-comment">+ Page comment</button><button id="clear">Clear resolved</button></footer>
  </aside>
  <div id="bar" role="toolbar" aria-label="htmlpen">
    <button data-mode="comment" title="Comment on an element (C)">Comment<kbd>C</kbd></button>
    <button data-mode="edit" title="Edit text in place (E)">Edit<kbd>E</kbd></button>
    <div class="sep"></div>
    <button id="count" title="Show comments"></button>
    <button id="copy" title="Copy open comments as a prompt for your coding agent">Copy for agent</button>
  </div>
  <div id="toast" role="status" hidden></div>`;
  document.documentElement.append(host);
  const $ = (sel) => ui.querySelector(sel);
  const [hl, active, pins, pop, panel, list, toastEl] = [
    '#hl', '#active', '#pins', '#pop', '#panel', '#list', '#toast',
  ].map($);
  const textarea = $('textarea');
  // Keep keystrokes typed into our UI away from the page's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());

  const cursorStyle = document.createElement('style');
  cursorStyle.textContent = `html.htmlpen-comment * { cursor: crosshair !important; }
    html.htmlpen-edit * { cursor: text !important; }`;
  document.head.append(cursorStyle);

  // ---------- state ----------
  let mode = 'browse'; // 'browse' | 'comment' | 'edit'
  let comments = [];
  let hovered = null; // element under the pointer in comment/edit mode
  let draft = null; // { el, quote } while the comment popover is open
  let editing = null; // { el, before } while an element is contenteditable
  let flashEl = null;
  let pendingReload = false;
  let pinEls = [];

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (toastEl.hidden = true), 3500);
  }

  function setMode(next) {
    if (next !== 'edit') commitEdit();
    if (next !== 'comment') closePopover();
    mode = next;
    hovered = null;
    host.setAttribute('mode', mode);
    document.documentElement.classList.toggle('htmlpen-comment', mode === 'comment');
    document.documentElement.classList.toggle('htmlpen-edit', mode === 'edit');
    for (const b of ui.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    sessionStorage.setItem(MODE_KEY, mode);
    layout();
  }

  const HINTS = {
    comment: 'Comment: click anything, or select text to quote it. Esc to stop.',
    edit: 'Edit: click text to change it. Enter saves to the file, Esc cancels.',
  };
  function toggleMode(next) {
    setMode(mode === next ? 'browse' : next);
    if (HINTS[mode]) toast(HINTS[mode]);
  }

  // ---------- element helpers ----------
  const ours = (e) => e.composedPath().includes(host);
  const isTyping = (el) => el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName);

  // Edit the nearest block-level element with text, so clicking a <b> edits its whole paragraph.
  function editTarget(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (getComputedStyle(el).display !== 'inline' && el.textContent.trim()) return el;
    }
    return null;
  }

  // Child-element indices from <body>; the server uses it to tell identical elements apart.
  function pathOf(el) {
    const path = [];
    for (; el.parentElement && el !== document.body; el = el.parentElement) {
      path.unshift([...el.parentElement.children].indexOf(el));
    }
    return path;
  }

  function selectorOf(el) {
    const parts = [];
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
        return [`#${CSS.escape(el.id)}`, ...parts].join(' > ');
      }
      const same = [...el.parentElement.children].filter((s) => s.localName === el.localName);
      parts.unshift(same.length > 1 ? `${el.localName}:nth-of-type(${same.indexOf(el) + 1})` : el.localName);
    }
    return ['body', ...parts].join(' > ');
  }

  const openTag = (el) => short(squash(el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1)), 160);
  const describe = (el) => `<${el.localName}> ${short(squash(el.textContent), 60)}`;
  const find = (c) => {
    try {
      return c.selector ? document.querySelector(c.selector) : null;
    } catch {
      return null;
    }
  };

  // ---------- layout of boxes, pins and popover ----------
  function box(node, el, label) {
    if (!el?.isConnected) return (node.style.display = 'none');
    const r = el.getBoundingClientRect();
    Object.assign(node.style, {
      display: 'block',
      left: `${r.left - 3}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
    });
    if (label) node.firstElementChild.textContent = label;
  }

  function layout() {
    box(hl, hovered, hovered && hovered.localName);
    box(active, editing?.el ?? draft?.el ?? flashEl);
    const perElement = new Map();
    for (const { el, node } of pinEls) {
      const r = el.getBoundingClientRect();
      const k = perElement.get(el) ?? 0;
      perElement.set(el, k + 1);
      node.hidden = !el.isConnected || (r.width === 0 && r.height === 0);
      node.style.transform = `translate(${r.right - 10 - k * 24}px, ${Math.max(r.top - 12, 0)}px)`;
    }
    if (!pop.hidden) {
      const r = draft?.el?.getBoundingClientRect() ?? { left: innerWidth / 2 - 160, top: innerHeight, bottom: innerHeight - 300 };
      const below = r.bottom + 8;
      const top = below + 180 < innerHeight ? below : r.top - 188;
      pop.style.left = `${clamp(r.left, 8, innerWidth - 328)}px`;
      pop.style.top = `${clamp(top, 8, innerHeight - 250)}px`;
    }
  }
  let frame = 0;
  const schedule = () => frame || (frame = requestAnimationFrame(() => ((frame = 0), layout())));
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);
  // ponytail: polls for layout shifts (images, animations); a ResizeObserver per pin if this ever costs.
  setInterval(layout, 400);

  // ---------- comments ----------
  function render() {
    const open = comments.filter((c) => !c.resolved).length;
    $('#count').textContent = `${open} comment${open === 1 ? '' : 's'}`;
    pinEls = [];
    pins.replaceChildren();
    comments.forEach((c, i) => {
      const el = !c.resolved && find(c);
      if (!el) return;
      const node = document.createElement('button');
      node.className = 'pin';
      node.textContent = i + 1;
      node.title = c.comment;
      node.onclick = () => showPanel(c.id);
      pins.append(node);
      pinEls.push({ el, node });
    });
    list.innerHTML = comments.length
      ? comments
          .map((c, i) => {
            const where = c.selector
              ? `${esc(c.element ?? '')} ${esc(short(c.text ?? '', 60))}${find(c) ? '' : ' · ⚠ not found on page'}`
              : 'Whole page';
            return `<li data-id="${esc(c.id)}" class="${c.resolved ? 'resolved' : ''}">
              <div class="where"><b>#${i + 1}</b> ${where}</div>
              ${c.quote ? `<q>${esc(c.quote)}</q>` : ''}
              <p>${esc(c.comment)}</p>
              <div class="actions"><button data-act="resolve">${c.resolved ? 'Reopen' : 'Resolve'}</button>
              <button data-act="delete">Delete</button></div></li>`;
          })
          .join('')
      : '<li class="empty">No comments yet. Press C, then click anything on the page (or select text to quote it).</li>';
    layout();
  }

  async function save() {
    render();
    try {
      await api('comments', comments);
    } catch (err) {
      toast(`Couldn't save comments: ${err.message}`);
    }
  }

  async function load() {
    try {
      comments = await api('comments');
      render();
    } catch (err) {
      toast(`Couldn't load comments: ${err.message}`);
    }
  }

  function addComment(el, comment, quote) {
    comments.push({
      id: crypto.randomUUID().slice(0, 8),
      comment,
      ...(quote && { quote }),
      ...(el && { text: short(squash(el.textContent), 120), element: openTag(el), selector: selectorOf(el) }),
      resolved: false,
      created: new Date().toISOString(),
    });
    return save();
  }

  function agentPrompt() {
    const open = comments.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => !c.resolved);
    if (!open.length) return null;
    const items = open.map(({ c, n }) => {
      const where = c.selector
        ? `On \`${c.element}\`${c.text ? ` "${short(c.text, 80)}"` : ''} (selector: \`${c.selector}\`)`
        : 'Whole page';
      const quote = c.quote ? `\n   Quoting: "${c.quote}"` : '';
      return `${n}. ${where}${quote}\n   ${c.comment.replace(/\n/g, '\n   ')}`;
    });
    return [
      `Please update \`${DISPLAY}\` to address my review comments below.`,
      `They are also saved in \`${DISPLAY}.comments.json\`; set "resolved": true on each one you address.`,
      '',
      ...items,
    ].join('\n');
  }

  function showPanel(id) {
    panel.hidden = false;
    const li = id && list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.scrollIntoView({ block: 'nearest' });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1200);
  }

  function openPopover(el, quote) {
    draft = { el, quote };
    $('#pop-target').textContent = quote ? `“${short(quote, 80)}”` : el ? describe(el) : 'Comment on the whole page';
    pop.hidden = false;
    layout();
    textarea.focus();
  }

  function closePopover() {
    if (pop.hidden) return;
    pop.hidden = true;
    draft = null;
    layout();
    if (pendingReload && !editing) location.reload();
  }

  pop.onsubmit = async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return textarea.focus();
    const { el, quote } = draft;
    textarea.value = '';
    getSelection().removeAllRanges();
    closePopover();
    await addComment(el, text, quote);
  };
  textarea.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) pop.requestSubmit();
    if (e.key === 'Escape') closePopover();
  };
  $('#pop-cancel').onclick = closePopover;
  $('#panel-close').onclick = () => (panel.hidden = true);
  $('#count').onclick = () => (panel.hidden = !panel.hidden);
  $('#page-comment').onclick = () => openPopover(null);
  $('#clear').onclick = () => {
    comments = comments.filter((c) => !c.resolved);
    save();
  };
  $('#copy').onclick = async () => {
    const prompt = agentPrompt();
    if (!prompt) return toast('No open comments to copy.');
    await navigator.clipboard.writeText(prompt);
    toast('Copied. Paste it into your coding agent.');
  };
  for (const b of ui.querySelectorAll('[data-mode]')) {
    b.onclick = () => toggleMode(b.dataset.mode);
  }
  list.onclick = (e) => {
    const li = e.target.closest('li[data-id]');
    const c = li && comments.find((x) => x.id === li.dataset.id);
    if (!c) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resolve') c.resolved = !c.resolved;
    if (act === 'delete') comments = comments.filter((x) => x !== c);
    if (act) return save();
    const el = find(c);
    if (!el) return toast('That element is no longer on the page.');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flashEl = el;
    setTimeout(() => ((flashEl = null), layout()), 1500);
  };

  // ---------- in-place editing ----------
  function placeCaret(x, y) {
    let range = document.caretRangeFromPoint?.(x, y);
    const pos = !range && document.caretPositionFromPoint?.(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
    if (range) getSelection().removeAllRanges(), getSelection().addRange(range);
  }

  function startEdit(el, e) {
    if (!el) return;
    editing = { el, before: el.innerHTML };
    el.contentEditable = 'true';
    el.focus();
    placeCaret(e.clientX, e.clientY);
    layout();
  }

  function cancelEdit() {
    if (!editing) return;
    const { el, before } = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    if (el.innerHTML !== before) el.innerHTML = before;
    layout();
    if (pendingReload) location.reload();
  }

  async function commitEdit() {
    if (!editing) return;
    const { el, before } = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    layout();
    const after = el.innerHTML;
    if (after !== before) {
      try {
        await api('edit', { tag: el.localName, path: pathOf(el), before, after });
        toast(`Saved to ${DISPLAY}`);
      } catch (err) {
        // Never lose the user's words: turn the edit into a comment for the agent instead.
        const wanted = squash(el.textContent);
        el.innerHTML = before;
        await addComment(el, `Change this text to: "${wanted}"`);
        toast(`Couldn't write that edit directly (${err.message}) Saved it as a comment instead.`);
      }
    }
    if (pendingReload && !editing) location.reload();
  }

  // ---------- page event interception ----------
  addEventListener(
    'mousemove',
    (e) => {
      if (mode === 'browse') return;
      const next = ours(e) ? null : mode === 'edit' ? editTarget(e.target) : e.target;
      if (next !== hovered) (hovered = next), layout();
    },
    true,
  );

  addEventListener(
    'click',
    (e) => {
      if (mode === 'browse' || ours(e) || editing?.el.contains(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (mode === 'edit') return commitEdit(), startEdit(editTarget(e.target), e);
      const sel = getSelection();
      const quote = !sel.isCollapsed && squash(sel.toString());
      let el = e.target;
      if (quote) {
        const common = sel.getRangeAt(0).commonAncestorContainer;
        el = common.nodeType === 1 ? common : common.parentElement;
      }
      openPopover(el, quote || undefined);
    },
    true,
  );

  addEventListener('focusout', (e) => e.target === editing?.el && commitEdit(), true);

  addEventListener(
    'paste',
    (e) => {
      if (!editing?.el.contains(e.target)) return;
      e.preventDefault(); // paste plain text, not the styled HTML of wherever it came from
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    },
    true,
  );

  addEventListener(
    'keydown',
    (e) => {
      if (ours(e)) return;
      if (editing?.el.contains(e.target)) {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(), commitEdit();
        if (e.key === 'Escape') e.preventDefault(), cancelEdit();
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const next = { c: 'comment', e: 'edit' }[e.key?.toLowerCase()];
      if (next) {
        e.preventDefault();
        e.stopPropagation();
        toggleMode(next);
      } else if (e.key === 'Escape' && mode !== 'browse') {
        setMode('browse');
      }
    },
    true,
  );

  // ---------- live reload when the agent changes the file ----------
  new EventSource('/__htmlpen/events').onmessage = ({ data }) => {
    const { path } = JSON.parse(data);
    if (path === SIDECAR) return load();
    if (/\.html?$/i.test(path) && path !== FILE) return;
    if (editing || !pop.hidden) {
      pendingReload = true;
      return toast('The file changed on disk. Reloading when you finish.');
    }
    location.reload();
  };

  setMode(sessionStorage.getItem(MODE_KEY) ?? 'browse');
  load();
})();
