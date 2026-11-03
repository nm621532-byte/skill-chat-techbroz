// Markdown -> sanitized DOM. Untrusted SKILL.md content never runs code.
import { resolveRelative, rawUrl, blobUrl } from './github.js';

const PURIFY = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math', 'video', 'audio', 'source', 'picture'],
  FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'action', 'formaction', 'xlink:href', 'ping'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|[^a-z]|[a-z0-9+.-]+(?:[^a-z0-9+.\-:]|$))/i
};

let hooked = false;
function ensureHook() {
  if (hooked) return; hooked = true;
  window.DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^\s*(javascript|data|vbscript):/i.test(href)) node.removeAttribute('href');
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (/^\s*(javascript|data|vbscript):/i.test(src)) node.removeAttribute('src');
      node.setAttribute('loading', 'lazy');
      node.setAttribute('referrerpolicy', 'no-referrer');
    }
  });
}

// ctx: { owner, repo, ref, dir, fileSet:Set, onFile(path) }
export function renderMarkdown(md, ctx = {}) {
  ensureHook();
  const html = window.marked.parse(String(md || ''), { gfm: true, breaks: false, async: false });
  const clean = window.DOMPurify.sanitize(html, { ...PURIFY, RETURN_DOM_FRAGMENT: true });
  const wrap = document.createElement('div');
  wrap.className = 'md';
  wrap.appendChild(clean);
  wrap.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (/^https?:|^mailto:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; return; }
    if (href.startsWith('#')) { a.removeAttribute('href'); return; }
    if (ctx.owner) {
      const clean = href.split('#')[0].split('?')[0];
      const path = resolveRelative(ctx.dir || '', decodeURIComponentSafe(clean));
      if (ctx.fileSet && ctx.fileSet.has(path) && ctx.onFile) {
        a.setAttribute('href', '#');
        a.classList.add('file-link');
        a.addEventListener('click', e => { e.preventDefault(); ctx.onFile(path); });
      } else {
        a.href = blobUrl(ctx.owner, ctx.repo, ctx.ref, path);
        a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
      }
    } else { a.removeAttribute('href'); }
  });
  wrap.querySelectorAll('img[src]').forEach(img => {
    const src = img.getAttribute('src');
    if (!/^https:/i.test(src)) {
      if (ctx.owner && !/^[a-z]+:/i.test(src)) img.src = rawUrl(ctx.owner, ctx.repo, ctx.ref, resolveRelative(ctx.dir || '', decodeURIComponentSafe(src)));
      else img.remove();
    }
  });
  addCopyButtons(wrap);
  return wrap;
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

export function addCopyButtons(root) {
  root.querySelectorAll('pre').forEach(pre => {
    if (pre.parentElement && pre.parentElement.classList.contains('codebox')) return;
    const box = document.createElement('div');
    box.className = 'codebox';
    const code = pre.querySelector('code');
    const lang = code && (code.className.match(/language-([\w+-]+)/) || [])[1];
    const bar = document.createElement('div');
    bar.className = 'codebar';
    const l = document.createElement('span'); l.textContent = lang || 'code';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
    b.addEventListener('click', () => copyText((code || pre).textContent, b));
    bar.append(l, b);
    pre.replaceWith(box);
    box.append(bar, pre);
  });
}

export async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = o; }, 1400); }
  return ok;
}
