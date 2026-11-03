import { parseGitHubUrl, makeGitHub, findSkills, filesInDir, dirname, blobUrl, GhError } from './lib/github.js';
import { splitFrontMatter } from './lib/frontmatter.js';
import { PROVIDERS, chatWithFallback, listModels } from './lib/providers.js';
import { store, ghCache } from './lib/store.js';
import { renderMarkdown, copyText, addCopyButtons } from './lib/md.js';

export const VERSION = '1.0.0';
const PAGE = 40;
const CONTEXT_CAP = 150000; // characters of skill text sent to the AI
const EXAMPLES = [
  { url: 'https://github.com/anthropics/skills', label: 'anthropics/skills' },
  { url: 'https://github.com/alirezarezvani/claude-skills', label: 'alirezarezvani/claude-skills' }
];
const DEFAULT_ORDER = ['openrouter', 'gemini', 'groq', 'openai', 'anthropic', 'custom'];
const KEY_HELP = {
  openrouter: ['Open openrouter.ai and sign in with Google.', 'Go to Keys and tap Create Key.', 'Copy the key (starts with sk-or-) and paste it here. Models marked Free cost nothing.'],
  gemini: ['Open aistudio.google.com/apikey and sign in with Google.', 'Tap Create API key.', 'Copy the key (starts with AIza) and paste it here. The free tier is enough for chatting.'],
  groq: ['Open console.groq.com and sign in.', 'Go to API Keys and tap Create API Key.', 'Copy the key (starts with gsk_) and paste it here. Groq has a free tier.'],
  openai: ['Open platform.openai.com/api-keys.', 'Create a new secret key (needs a paid account).', 'Paste it here.'],
  anthropic: ['Open console.anthropic.com, Settings, API Keys.', 'Create a key (needs credits).', 'Paste it here.'],
  custom: ['Enter the base URL of any OpenAI-compatible API (it must end before /chat/completions).', 'Paste its key and type the model name.']
};

// ---------- tiny DOM helper (never uses innerHTML with outside data) ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const $ = s => document.querySelector(s);
const view = () => $('#view');
function fmtSize(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
function fmtWhen(t) {
  const d = new Date(t), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
function skillId(o, r, ref, p) { return `${o}/${r}@${ref}:${p}`; }
function skillHash(s, page = 'skill', extra = '') {
  const q = new URLSearchParams({ o: s.owner, r: s.repo, ref: s.ref, p: s.path });
  return `#/${page}?${q}${extra}`;
}
function prettyName(path) { const d = dirname(path); return (d.split('/').pop() || path.replace(/\.md$/i, '')).replace(/[-_]+/g, ' '); }
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- state ----------
const gh = makeGitHub({ getToken: () => store.ghToken(), cache: ghCache });
const S = { resolved: null, url: '', skills: [], meta: new Map(), shown: PAGE, q: '', loading: false, error: null, metaRun: 0 };
let chatAbort = null;

// ---------- theme ----------
function applyTheme() {
  const t = store.settings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- settings helpers ----------
const MAX_SLOTS = 10;
function settings() { return store.settings(); }
function slotModel(sl) { return (sl.model || '').trim() || PROVIDERS[sl.provider].model; }
function slotBase(sl) { return (sl.base || '').trim() || PROVIDERS[sl.provider].base; }
function slotLabel(sl, all) {
  const P = PROVIDERS[sl.provider];
  const same = (all || store.slots()).filter(x => x.provider === sl.provider && x.key).length > 1;
  return same ? `${P.label} (${slotModel(sl)})` : P.label;
}
function chain() {
  const all = store.slots();
  return all.filter(sl => sl.key && PROVIDERS[sl.provider]).map(sl => ({ provider: sl.provider, key: sl.key, model: slotModel(sl), base: slotBase(sl), label: slotLabel(sl, all) }));
}
function hasAnyKey() { return chain().length > 0; }
function updateSlot(id, patch) { const s = store.slots().map(x => x.id === id ? { ...x, ...patch } : x); store.setSlots(s); }
function newSlotId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// ---------- sheets ----------
function openSheet(title, body, { wide = false, onClose } = {}) {
  closeSheet();
  const root = $('#sheet-root');
  const close = () => { closeSheet(); onClose && onClose(); };
  const panel = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close, text: '✕' })),
    h('div', { class: 'sheet-body' }, body));
  const scrim = h('div', { class: 'scrim', onclick: close });
  root.append(scrim, panel);
  document.body.classList.add('sheet-open');
  root._esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', root._esc);
  setTimeout(() => { const f = panel.querySelector('input, button:not(.icon-btn), a'); f && f.focus(); }, 30);
  return panel;
}
function closeSheet() {
  const root = $('#sheet-root');
  if (root._esc) document.removeEventListener('keydown', root._esc);
  root.textContent = '';
  document.body.classList.remove('sheet-open');
}

// ---------- key setup (first launch + when chatting without a key) ----------
function keySetupForm(onDone, compact = false) {
  const input = h('input', { type: 'password', id: 'onb-key', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-or-...', 'aria-label': 'OpenRouter API key' });
  const err = h('p', { class: 'field-err', role: 'alert' });
  const save = () => {
    const v = input.value.trim();
    if (v.length < 10) { err.textContent = 'That key looks too short. Copy the whole key from OpenRouter.'; return; }
    const s = store.slots();
    const slot = s.find(x => x.provider === 'openrouter' && !x.key) || s.find(x => x.provider === 'openrouter');
    if (slot) slot.key = v; else s.unshift({ id: newSlotId('openrouter'), provider: 'openrouter', key: v, model: '', base: '' });
    store.setSlots(s);
    toast('Key saved on this device');
    onDone && onDone();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  return h('div', { class: 'keysetup' + (compact ? ' compact' : '') },
    h('label', { for: 'onb-key', class: 'lbl', text: 'Your OpenRouter API key' }),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'button', onclick: save, text: 'Save key' })),
    err,
    h('ol', { class: 'steps' }, KEY_HELP.openrouter.map(t => h('li', { text: t }))),
    h('p', { class: 'small' }, h('a', { href: 'https://openrouter.ai/keys', target: '_blank', rel: 'noopener noreferrer', text: 'Get a free OpenRouter key' }),
      '. You can add Gemini or Groq keys too in ', h('a', { href: '#/settings', onclick: closeSheet, text: 'Settings' }), ' as backups.'),
    h('p', { class: 'privacy' }, 'Your key is saved only on this device and never leaves it except to the AI provider. You will not be asked again.'));
}
function maybeOnboard() {
  if (store.get('onboarded', false) || hasAnyKey()) return;
  openSheet('Welcome to Skill Chat', h('div', null,
    h('p', { class: 'lead', text: 'Paste a GitHub link, pick a skill, and chat with an AI that follows it. To chat, add your AI key once.' }),
    keySetupForm(() => { store.set('onboarded', true); closeSheet(); }),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { store.set('onboarded', true); closeSheet(); }, text: 'Skip for now' })
  ), { onClose: () => store.set('onboarded', true) });
}

// ---------- router ----------
function route() {
  if (chatAbort && !location.hash.startsWith('#/chat')) { chatAbort.abort(); chatAbort = null; }
  closeSheet();
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const q = new URLSearchParams(qs || '');
  document.body.classList.toggle('in-chat', path === '/chat');
  const navKey = path === '/library' ? 'library' : path === '/settings' ? 'settings' : 'explore';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  if (path === '/library') return renderLibrary();
  if (path === '/settings') return renderSettings();
  if (path === '/skill') return renderSkill(q);
  if (path === '/chat') return renderChat(q);
  return renderExplore(q);
}

// ---------- explore ----------
function renderExplore(q) {
  const url = q.get('u') || '';
  const v = view(); v.textContent = '';
  const input = h('input', { type: 'url', id: 'gh-url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://github.com/owner/repo', value: url || '', 'aria-label': 'GitHub link' });
  const form = h('form', { class: 'finder', onsubmit: e => { e.preventDefault(); go(input.value); } },
    input, h('button', { class: 'btn primary', type: 'submit', text: 'Find skills' }));
  const go = val => {
    const t = String(val || '').trim();
    if (!t) { input.focus(); return; }
    const nh = '#/?u=' + encodeURIComponent(t);
    if (location.hash === nh) loadRepo(t, true); else location.hash = nh;
  };
  const intro = h('section', { class: 'hero' + (url ? ' slim' : '') },
    h('h1', { text: 'Use any AI skill from GitHub' }),
    url ? null : h('p', { class: 'lead', text: 'Paste a link to a skills repository, a skill folder, or a single SKILL.md file. Pick a skill and chat with an AI that follows it.' }),
    form,
    h('div', { class: 'chips', role: 'list', 'aria-label': 'Example repositories' },
      h('span', { class: 'chips-lbl', text: 'Try' }),
      EXAMPLES.map(ex => h('button', { class: 'chip', type: 'button', role: 'listitem', onclick: () => { input.value = ex.url; go(ex.url); }, text: ex.label }))));
  v.append(intro);
  const results = h('section', { id: 'results', 'aria-live': 'polite' });
  v.append(results);
  if (url) loadRepo(url);
  else {
    const rec = store.recents();
    if (rec.length) {
      v.append(h('section', { class: 'block' }, h('h2', { text: 'Recent repositories' }),
        h('ul', { class: 'plain-list' }, rec.map(r => h('li', null, h('a', { class: 'rec', href: '#/?u=' + encodeURIComponent(r.url) }, h('span', { class: 'rec-name', text: r.label }), h('span', { class: 'rec-when', text: fmtWhen(r.at) })))))));
    }
    v.append(h('section', { class: 'block how' }, h('h2', { text: 'How it works' }),
      h('ol', { class: 'how-steps' },
        h('li', null, h('strong', { text: 'Paste a GitHub link. ' }), 'Skill Chat finds every SKILL.md in it.'),
        h('li', null, h('strong', { text: 'Pick a skill. ' }), 'Read it, and tick extra files you want the AI to see.'),
        h('li', null, h('strong', { text: 'Chat. ' }), 'The skill becomes the AI\u2019s instructions. Your key stays on this device.')),
      window.Capacitor ? null : h('p', { class: 'small' }, h('a', { href: 'downloads/SkillChat-v1.0.apk', download: 'SkillChat-v1.0.apk', text: 'Download the Android app (APK, 3 MB)' }), ' or tap your browser menu and choose Install app.')));
  }
}

async function loadRepo(url, force = false) {
  const box = $('#results'); if (!box) return;
  if (!force && S.url === url && S.resolved && !S.error) return renderResults();
  S.url = url; S.resolved = null; S.skills = []; S.error = null; S.shown = PAGE; S.q = '';
  box.textContent = '';
  box.append(h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Reading the repository…'));
  let parsed;
  try {
    parsed = parseGitHubUrl(url);
    const res = await gh.resolve(parsed);
    if (S.url !== url) return;
    S.resolved = res;
    S.skills = findSkills(res).map(x => ({ ...x, owner: res.owner, repo: res.repo, ref: res.ref, id: skillId(res.owner, res.repo, res.ref, x.path) }));
    store.addRecent(url, `${res.owner}/${res.repo}${res.path ? '/' + res.path : ''}`);
    if (parsed.kind === 'blob' && S.skills.length === 1) {
      location.replace(skillHash(S.skills[0]));
      return;
    }
  } catch (e) {
    if (S.url !== url) return;
    S.error = e;
  }
  renderResults();
}

function renderResults() {
  const box = $('#results'); if (!box) return;
  box.textContent = '';
  if (S.error) return box.append(errorBlock(S.error, () => loadRepo(S.url, true)));
  const r = S.resolved; if (!r) return;
  const head = h('div', { class: 'repo-head' },
    h('div', { class: 'repo-line' },
      h('a', { class: 'repo-name', href: blobUrl(r.owner, r.repo, r.ref, r.path || '', 'tree').replace(/\/$/, ''), target: '_blank', rel: 'noopener noreferrer', text: `${r.owner}/${r.repo}` }),
      h('span', { class: 'badge', text: r.ref }),
      r.path ? h('span', { class: 'badge soft', text: r.path }) : null),
    r.info && r.info.description ? h('p', { class: 'repo-desc', text: r.info.description }) : null);
  box.append(head);
  if (r.tree && r.tree.truncated) box.append(h('p', { class: 'note warn', text: 'This repository is very large, so GitHub sent only part of its file list. Some skills may be missing. Paste a link to a sub-folder to see all skills inside it.' }));
  if (!S.skills.length) {
    box.append(h('div', { class: 'empty' }, h('h2', { text: 'No SKILL.md found here' }),
      h('p', { text: 'A skill is a folder with a SKILL.md file inside. This ' + (r.path ? 'folder' : 'repository') + ' has none. Try another link, or one of the examples above.' })));
    return;
  }
  const search = h('input', { type: 'search', class: 'search', placeholder: `Search ${S.skills.length} skills`, value: S.q, 'aria-label': 'Search skills' });
  const count = h('p', { class: 'count' });
  const list = h('ul', { class: 'skill-list' });
  const more = h('div', { class: 'more' });
  box.append(h('div', { class: 'list-head' }, h('h2', { text: S.skills.length === 1 ? '1 skill found' : `${S.skills.length} skills found` }), search), count, list, more);
  const draw = () => {
    const q = S.q.trim().toLowerCase();
    const all = S.skills.filter(s => {
      if (!q) return true;
      const m = S.meta.get(s.id) || {};
      return (s.path + ' ' + (m.name || '') + ' ' + (m.description || '')).toLowerCase().includes(q);
    });
    const vis = all.slice(0, S.shown);
    list.textContent = '';
    vis.forEach(s => list.append(skillRow(s)));
    count.textContent = q ? `${all.length} match${all.length === 1 ? '' : 'es'}` : '';
    more.textContent = '';
    if (all.length > vis.length) more.append(h('button', { class: 'btn ghost wide', type: 'button', onclick: () => { S.shown += PAGE; draw(); }, text: `Show more (${all.length - vis.length} left)` }));
    if (!all.length) list.append(h('li', { class: 'empty small', text: 'No skill matches that search.' }));
    loadMeta(q ? all.slice(0, 400) : vis, draw);
  };
  let tmr;
  search.addEventListener('input', () => { S.q = search.value; S.shown = PAGE; clearTimeout(tmr); tmr = setTimeout(draw, 120); });
  draw();
}

function skillRow(s) {
  const m = S.meta.get(s.id);
  const name = (m && m.name) || prettyName(s.path);
  const desc = m ? (m.description || 'No description') : 'Loading description…';
  const fav = store.isFav(s.id);
  const star = h('button', { class: 'star' + (fav ? ' on' : ''), type: 'button', 'aria-pressed': String(fav), 'aria-label': (fav ? 'Remove ' : 'Save ') + name, text: fav ? '★' : '☆',
    onclick: e => { e.preventDefault(); const on = store.toggleFav({ ...s, name, description: m && m.description }); star.classList.toggle('on', on); star.textContent = on ? '★' : '☆'; star.setAttribute('aria-pressed', String(on)); toast(on ? 'Saved to your library' : 'Removed from your library'); } });
  return h('li', { class: 'skill' },
    h('a', { class: 'skill-link', href: skillHash(s) },
      h('span', { class: 'mono', 'aria-hidden': 'true', text: (name.trim()[0] || '?').toUpperCase() }),
      h('span', { class: 'skill-text' },
        h('span', { class: 'skill-name', text: name }),
        h('span', { class: 'skill-desc' + (m ? '' : ' muted'), text: desc }),
        h('span', { class: 'skill-path', text: s.dir || '(repository root)' }))),
    star);
}

async function loadMeta(items, redraw) {
  const todo = items.filter(s => !S.meta.has(s.id));
  if (!todo.length) return;
  const run = ++S.metaRun;
  let i = 0, changed = 0, tmr = null;
  const bump = () => { changed++; if (!tmr) tmr = setTimeout(() => { tmr = null; if (run === S.metaRun || changed) redraw(); }, 250); };
  const worker = async () => {
    while (i < todo.length) {
      const s = todo[i++];
      if (S.meta.has(s.id)) continue;
      try {
        const txt = await gh.raw(s.owner, s.repo, s.ref, s.path, { maxBytes: 200000 });
        const { data } = splitFrontMatter(txt);
        S.meta.set(s.id, { name: String(data.name || '').slice(0, 120) || prettyName(s.path), description: String(data.description || '').slice(0, 600) });
      } catch (e) {
        S.meta.set(s.id, { name: prettyName(s.path), description: '' });
      }
      bump();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

function errorBlock(e, retry) {
  const box = h('div', { class: 'errbox', role: 'alert' });
  if (e && e.kind === 'rate_limit') {
    const when = e.reset ? new Date(e.reset * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'in up to an hour';
    const tok = h('input', { type: 'password', autocomplete: 'off', placeholder: 'ghp_... or github_pat_...', 'aria-label': 'GitHub token' });
    box.append(h('h2', { text: 'GitHub limit reached' }),
      h('p', { text: `${e.message} It resets at ${when}.` }),
      h('p', { text: e.hasToken ? 'Your token also hit its limit. Wait for the reset.' : 'To keep going now, add a free GitHub token (it raises the limit to 5,000 per hour). It is stored only on this device.' }),
      e.hasToken ? null : h('div', { class: 'row' }, tok, h('button', { class: 'btn primary', type: 'button', text: 'Save and retry', onclick: () => { if (tok.value.trim()) { store.setGhToken(tok.value.trim()); retry(); } } })),
      h('p', { class: 'small' }, h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer', text: 'Create a token on GitHub' }), ' (no permissions needed for public repos).'));
    return box;
  }
  const title = e && (e.kind === 'bad_url' ? 'Check the link' : e.kind === 'repo_missing' || e.kind === 'ref_missing' || e.kind === 'not_found' ? 'Not found' : e.kind === 'network' ? 'No connection' : 'Something went wrong');
  box.append(h('h2', { text: title }), h('p', { text: (e && e.message) || 'Unknown error.' }));
  if (e && e.kind !== 'bad_url') box.append(h('button', { class: 'btn ghost', type: 'button', onclick: retry, text: 'Try again' }));
  return box;
}

// ---------- skill loading ----------
async function loadSkill(q) {
  const owner = q.get('o'), repo = q.get('r'), ref = q.get('ref'), path = q.get('p');
  if (!owner || !repo || !ref || !path) throw new GhError('bad_url', 'This skill link is incomplete.');
  const text = await gh.raw(owner, repo, ref, path);
  const fm = splitFrontMatter(text);
  const sk = { owner, repo, ref, path, dir: dirname(path), id: skillId(owner, repo, ref, path), text, fm,
    name: String(fm.data.name || '').slice(0, 120) || prettyName(path), description: String(fm.data.description || '').slice(0, 1000) };
  return sk;
}
async function loadFiles(sk) {
  let res = S.resolved && S.resolved.owner === sk.owner && S.resolved.repo === sk.repo && S.resolved.ref === sk.ref ? S.resolved : null;
  if (!res) res = { owner: sk.owner, repo: sk.repo, ref: sk.ref, path: '', tree: await gh.tree(sk.owner, sk.repo, sk.ref) };
  return filesInDir(res, sk.dir).filter(f => f.path !== sk.path);
}
function mentioned(sk, files) {
  const body = sk.fm.body;
  return new Set(files.filter(f => isText(f.path) && !/^LICEN[CS]E/i.test(f.rel.split('/').pop()) && (body.includes(f.rel) || body.includes(f.rel.split('/').pop()))).map(f => f.path));
}
const TEXT_EXT = /\.(md|markdown|txt|py|js|mjs|cjs|ts|tsx|jsx|json|ya?ml|toml|ini|cfg|sh|bash|zsh|ps1|html?|css|scss|xml|csv|tsv|sql|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|r|lua|pl|env|example|gitignore|dockerfile|tex|rst|svg)$/i;
function isText(path) { return TEXT_EXT.test(path) || !/\.[a-z0-9]+$/i.test(path.split('/').pop()); }
function isImage(path) { return /\.(png|jpe?g|gif|webp)$/i.test(path); }

// ---------- skill view ----------
async function renderSkill(q) {
  const v = view(); v.textContent = '';
  v.append(h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading skill…'));
  let sk;
  try { sk = await loadSkill(q); }
  catch (e) { v.textContent = ''; v.append(backLink(), errorBlock(e, () => renderSkill(q))); return; }
  v.textContent = '';
  const fav = store.isFav(sk.id);
  const starBtn = h('button', { class: 'btn ghost', type: 'button', 'aria-pressed': String(fav), text: fav ? '★ Saved' : '☆ Save',
    onclick: () => { const on = store.toggleFav(sk); starBtn.textContent = on ? '★ Saved' : '☆ Save'; starBtn.setAttribute('aria-pressed', String(on)); toast(on ? 'Saved to your library' : 'Removed from your library'); } });
  const ctx = { owner: sk.owner, repo: sk.repo, ref: sk.ref, dir: sk.dir, fileSet: new Set(), onFile: p => viewFile(sk, p) };
  const ticks = new Set(store.ticks(sk.id));
  const meter = h('div', { class: 'meter' }, h('div', { class: 'meter-bar' }, h('span')), h('p', { class: 'meter-txt' }));
  let files = [];
  const updateMeter = () => {
    const total = sk.text.length + files.filter(f => ticks.has(f.path)).reduce((a, f) => a + (f.size || 0), 0);
    const pct = Math.min(100, Math.round(total / CONTEXT_CAP * 100));
    meter.querySelector('span').style.width = pct + '%';
    meter.classList.toggle('over', total > CONTEXT_CAP);
    meter.querySelector('.meter-txt').textContent = `AI will read ${fmtSize(total)} of ${fmtSize(CONTEXT_CAP)}` + (total > CONTEXT_CAP ? '. Too much: untick some files.' : '');
  };
  const filesBox = h('div', { class: 'files' }, h('p', { class: 'small muted', text: 'Loading the files in this skill…' }));
  const useBtn = h('a', { class: 'btn primary big', href: skillHash(sk, 'chat'), text: 'Use this skill' });
  v.append(backLink(),
    h('section', { class: 'skill-head' },
      h('h1', { text: sk.name }),
      sk.description ? h('p', { class: 'lead', text: sk.description }) : null,
      h('p', { class: 'src' }, 'From ', h('a', { href: blobUrl(sk.owner, sk.repo, sk.ref, sk.path), target: '_blank', rel: 'noopener noreferrer', text: `${sk.owner}/${sk.repo}/${sk.path}` })),
      h('div', { class: 'actions' }, useBtn, starBtn,
        h('button', { class: 'btn ghost', type: 'button', text: 'Copy as prompt', onclick: async e => {
          const extra = await gatherFiles(sk, files.filter(f => ticks.has(f.path)));
          copyText(systemPrompt(sk, extra), e.currentTarget);
        } }))),
    h('section', { class: 'block' }, h('h2', { text: 'Extra files for the AI' }),
      h('p', { class: 'small muted', text: 'SKILL.md is always included. Tick other files from this skill to include them too.' }), meter, filesBox),
    h('section', { class: 'block' }, h('h2', { text: 'SKILL.md' }), metaTable(sk.fm.data), h('div', { class: 'md-wrap', id: 'skill-md' })));
  const mdBox = $('#skill-md');
  const paint = () => { mdBox.textContent = ''; mdBox.append(renderMarkdown(sk.fm.body, ctx)); };
  paint(); updateMeter();
  try {
    files = await loadFiles(sk);
    ctx.fileSet = new Set(files.map(f => f.path));
    paint();
    const ment = mentioned(sk, files);
    filesBox.textContent = '';
    if (!files.length) filesBox.append(h('p', { class: 'small muted', text: 'This skill has only its SKILL.md file.' }));
    else {
      const textFiles = files.filter(f => isText(f.path));
      if (ment.size) filesBox.append(h('button', { class: 'btn ghost small', type: 'button', text: `Tick the ${ment.size} file${ment.size === 1 ? '' : 's'} SKILL.md mentions`, onclick: () => {
        files.forEach(f => { if (ment.has(f.path) && isText(f.path)) ticks.add(f.path); });
        store.setTicks(sk.id, [...ticks]); drawFiles(); updateMeter();
      } }));
      const ul = h('ul', { class: 'file-list' });
      const drawFiles = () => {
        ul.textContent = '';
        files.slice(0, 300).forEach(f => {
          const txt = isText(f.path);
          const cb = h('input', { type: 'checkbox', id: 'f-' + f.path, disabled: !txt, 'aria-label': 'Include ' + f.rel });
          cb.checked = ticks.has(f.path);
          cb.addEventListener('change', () => { cb.checked ? ticks.add(f.path) : ticks.delete(f.path); store.setTicks(sk.id, [...ticks]); updateMeter(); });
          ul.append(h('li', null,
            h('label', { class: 'file' }, cb, h('span', { class: 'file-name', text: f.rel }), ment.has(f.path) ? h('span', { class: 'tag', text: 'mentioned' }) : null, h('span', { class: 'file-size', text: fmtSize(f.size) })),
            h('button', { class: 'btn link', type: 'button', text: 'View', onclick: () => viewFile(sk, f.path) })));
        });
        if (files.length > 300) ul.append(h('li', { class: 'small muted', text: `${files.length - 300} more files not shown.` }));
      };
      drawFiles();
      filesBox.append(ul);
      if (!textFiles.length) filesBox.append(h('p', { class: 'small muted', text: 'These files are not text, so they cannot be sent to the AI.' }));
    }
    updateMeter();
  } catch (e) {
    filesBox.textContent = '';
    filesBox.append(h('p', { class: 'small muted', text: e.kind === 'rate_limit' ? 'GitHub limit reached, so the file list is unavailable right now. SKILL.md still works.' : 'Could not list the other files: ' + e.message }));
  }
}

function backLink() {
  return h('a', { class: 'back', href: S.url ? '#/?u=' + encodeURIComponent(S.url) : '#/', onclick: e => { if (history.length > 1 && document.referrer !== '' ) { /* keep default */ } }, text: '‹ Back to skills' });
}

function metaTable(data) {
  const keys = Object.keys(data).filter(k => !['name', 'description'].includes(k) && data[k]);
  if (!keys.length) return null;
  return h('dl', { class: 'meta' }, keys.slice(0, 12).map(k => [h('dt', { text: k }), h('dd', { text: String(data[k]).slice(0, 300) })]));
}

async function viewFile(sk, path) {
  const rel = sk.dir ? path.slice(sk.dir.length + 1) : path;
  const body = h('div', { class: 'file-view' }, h('p', { class: 'small muted', text: 'Loading…' }));
  openSheet(rel, body, { wide: true });
  body.textContent = '';
  body.append(h('p', { class: 'small' }, h('a', { href: blobUrl(sk.owner, sk.repo, sk.ref, path), target: '_blank', rel: 'noopener noreferrer', text: 'Open on GitHub' })));
  if (isImage(path)) {
    body.append(h('img', { class: 'file-img', alt: rel, src: `https://raw.githubusercontent.com/${sk.owner}/${sk.repo}/${sk.ref}/${path.split('/').map(encodeURIComponent).join('/')}` }));
    return;
  }
  if (!isText(path)) { body.append(h('p', { text: 'This file is not text, so it cannot be shown here.' })); return; }
  try {
    const txt = await gh.raw(sk.owner, sk.repo, sk.ref, path, { maxBytes: 300000 });
    if (/\.(md|markdown)$/i.test(path)) body.append(renderMarkdown(splitFrontMatter(txt).body, { owner: sk.owner, repo: sk.repo, ref: sk.ref, dir: dirname(path) }));
    else { const box = h('div', null, h('pre', null, h('code', { text: txt }))); addCopyButtons(box); body.append(box); }
  } catch (e) { body.append(h('p', { class: 'field-err', text: e.message })); }
}

async function gatherFiles(sk, list) {
  const out = []; let total = sk.text.length;
  for (const f of list) {
    if (!isText(f.path)) continue;
    try {
      const t = await gh.raw(sk.owner, sk.repo, sk.ref, f.path, { maxBytes: 120000 });
      if (total + t.length > CONTEXT_CAP) { out.push({ rel: f.rel, text: '[skipped: too large for the context limit]' }); continue; }
      total += t.length; out.push({ rel: f.rel, text: t });
    } catch (e) { out.push({ rel: f.rel, text: '[could not load: ' + e.message + ']' }); }
  }
  return out;
}

export function systemPrompt(sk, extra = []) {
  let s = `You are a helpful AI assistant inside the app "Skill Chat". The user loaded an Agent Skill named "${sk.name}" from GitHub (${sk.owner}/${sk.repo}, file ${sk.path}). ` +
    'Follow the skill instructions below whenever they apply to the user\u2019s request. The skill may mention scripts, tools or files you cannot run here: in that case, explain the steps or give the user the exact code or commands to run themselves. Reply in the same language the user writes in. Use Markdown for formatting.\n\n' +
    `<skill name="${sk.name.replace(/"/g, "'")}">\n${sk.text.trim()}\n</skill>`;
  for (const f of extra) s += `\n\n<skill_file path="${f.rel.replace(/"/g, "'")}">\n${f.text}\n</skill_file>`;
  return s;
}

// ---------- chat ----------
function newChat(sk) { return { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), updated: Date.now(), skillName: sk.name, messages: [] }; }

async function renderChat(q) {
  const v = view(); v.textContent = '';
  v.append(h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading skill…'));
  let sk;
  try { sk = await loadSkill(q); }
  catch (e) { v.textContent = ''; v.append(errorBlock(e, () => renderChat(q))); return; }
  const tickList = store.ticks(sk.id);
  let extra = [];
  if (tickList.length) {
    try { const files = await loadFiles(sk); extra = await gatherFiles(sk, files.filter(f => tickList.includes(f.path))); } catch {}
  }
  const sys = systemPrompt(sk, extra);
  const chats = store.chats(sk.id);
  let chat = (q.get('c') && chats.find(c => c.id === q.get('c'))) || newChat(sk);
  let busy = false;

  v.textContent = '';
  const modelChip = h('a', { class: 'model-chip', href: '#/settings' });
  const paintModel = () => { const c = chain()[0]; modelChip.textContent = c ? `${c.label}: ${c.model}` : 'Add API key'; };
  paintModel();
  const head = h('div', { class: 'chat-head' },
    h('a', { class: 'icon-btn', href: skillHash(sk), 'aria-label': 'Back to skill', text: '‹' }),
    h('div', { class: 'cassette' }, h('span', { class: 'cassette-lbl', text: 'Skill loaded' }), h('span', { class: 'cassette-name', text: sk.name }), modelChip),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chat history', title: 'History', text: '☰', onclick: () => showHistory() }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'New chat', title: 'New chat', text: '+', onclick: () => { if (busy) return; chat = newChat(sk); history.replaceState(null, '', skillHash(sk, 'chat')); drawAll(); ta.focus(); } }));
  const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const ta = h('textarea', { rows: '1', id: 'composer', placeholder: 'Message the AI…', 'aria-label': 'Message', enterkeyhint: 'send' });
  const sendBtn = h('button', { class: 'btn primary send', type: 'submit', text: 'Send' });
  const stopBtn = h('button', { class: 'btn stop', type: 'button', text: 'Stop', hidden: true, onclick: () => chatAbort && chatAbort.abort() });
  const form = h('form', { class: 'composer', onsubmit: e => { e.preventDefault(); send(ta.value); } }, ta, sendBtn, stopBtn);
  v.append(h('div', { class: 'chat' }, head, log, form));
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); send(ta.value); } });

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  function bubble(m) {
    if (m.role === 'user') return h('div', { class: 'msg user' }, h('div', { class: 'bubble', text: m.content }));
    const body = h('div', { class: 'bubble' });
    body.append(renderMarkdown(m.content || ''));
    const foot = h('div', { class: 'msg-foot' },
      m.via ? h('span', { class: 'via', text: 'via ' + m.via }) : null,
      m.content ? h('button', { class: 'btn link', type: 'button', text: 'Copy', onclick: e => copyText(m.content, e.currentTarget) }) : null);
    return h('div', { class: 'msg ai' }, m.note ? h('p', { class: 'switch-note', text: m.note }) : null, body, foot);
  }
  function drawAll() {
    log.textContent = '';
    if (!hasAnyKey()) {
      log.append(h('div', { class: 'chat-empty' }, h('h2', { text: 'Add your AI key to start' }),
        keySetupForm(() => { paintModel(); drawAll(); }, true)));
      return;
    }
    if (!chat.messages.length) {
      const starters = ['What can you help me with using this skill?', 'Show me a short example of this skill in action.'];
      log.append(h('div', { class: 'chat-empty' },
        h('h2', { text: sk.name }),
        sk.description ? h('p', { class: 'muted', text: sk.description }) : null,
        extra.length ? h('p', { class: 'small muted', text: `Also reading ${extra.length} extra file${extra.length === 1 ? '' : 's'}.` }) : null,
        h('div', { class: 'starters' }, starters.map(s => h('button', { class: 'chip', type: 'button', text: s, onclick: () => send(s) })))));
    }
    chat.messages.forEach(m => log.append(bubble(m)));
    scroll();
  }
  function save() { chat.updated = Date.now(); store.saveChat(sk.id, chat); const idx = store.get('chatindex', {}); idx[sk.id] = { ...(idx[sk.id] || {}), name: sk.name, owner: sk.owner, repo: sk.repo, ref: sk.ref, path: sk.path, at: Date.now() }; store.set('chatindex', idx); }
  function setBusy(b) { busy = b; sendBtn.hidden = b; stopBtn.hidden = !b; ta.disabled = false; }

  async function send(text, isRetry = false) {
    text = String(text || '').trim();
    if (busy) return;
    if (!hasAnyKey()) { drawAll(); return; }
    if (!isRetry) {
      if (!text) return;
      chat.messages.push({ role: 'user', content: text });
      if (!chat.title) chat.title = text.slice(0, 60);
      ta.value = ''; ta.style.height = 'auto';
    }
    // drop a previous error bubble
    chat.messages = chat.messages.filter(m => !m.error);
    drawAll();
    const ai = { role: 'assistant', content: '' };
    const holder = h('div', { class: 'msg ai' }, h('div', { class: 'bubble typing' }, h('span', { class: 'dots', 'aria-label': 'AI is typing' }, h('i'), h('i'), h('i'))));
    log.append(holder); scroll();
    setBusy(true);
    chatAbort = new AbortController();
    let raf = 0, notes = [];
    const paint = () => {
      raf = 0;
      const body = h('div', { class: 'bubble' }); body.append(renderMarkdown(ai.content));
      holder.textContent = '';
      if (notes.length) holder.append(h('p', { class: 'switch-note', text: notes.join(' ') }));
      holder.append(body);
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
      if (nearBottom) scroll();
    };
    try {
      const history = chat.messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
      const res = await chatWithFallback(chain(), { system: sys, messages: history, origin: location.origin }, {
        signal: chatAbort.signal,
        onText: (d, full) => { ai.content = full; if (!raf) raf = requestAnimationFrame(paint); },
        onSwitch: (next, cur, err) => { notes.push(`Switched to ${next.label}: ${err.message}`); toast(`Switched to ${next.label}`); paint(); }
      });
      ai.content = res.text; ai.via = `${res.used.label} (${res.used.model})`;
      if (notes.length) ai.note = notes.join(' ');
      chat.messages.push(ai);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (ai.content) { ai.content += '\n\n_(stopped)_'; chat.messages.push(ai); }
      } else {
        if (e.partial) { ai.content = e.partial; chat.messages.push(ai); }
        const tried = chain().length > 1 ? ' All your saved providers were tried.' : '';
        chat.messages.push({ role: 'assistant', error: true, content: (e.message || 'Something went wrong.') + (e.code && e.code !== 'other' && !e.partial ? tried : '') });
      }
    } finally {
      cancelAnimationFrame(raf);
      chatAbort = null; setBusy(false);
      if (chat.messages.some(m => m.role === 'assistant' && !m.error)) save();
      drawAll();
      const last = chat.messages[chat.messages.length - 1];
      if (last && last.error) {
        log.lastChild && log.lastChild.remove();
        log.append(h('div', { class: 'msg ai err', role: 'alert' }, h('p', { text: last.content }),
          h('div', { class: 'row' }, h('button', { class: 'btn ghost small', type: 'button', text: 'Try again', onclick: () => send('', true) }), h('a', { class: 'btn ghost small', href: '#/settings', text: 'Open Settings' }))));
        scroll();
      }
    }
  }

  function showHistory() {
    const list = store.chats(sk.id);
    const body = h('div', null);
    if (!list.length) body.append(h('p', { class: 'muted', text: 'No saved chats for this skill yet.' }));
    else body.append(h('ul', { class: 'plain-list' }, list.map(c => h('li', { class: 'hist' },
      h('a', { href: skillHash(sk, 'chat', '&c=' + encodeURIComponent(c.id)), onclick: () => closeSheet() }, h('span', { class: 'rec-name', text: c.title || 'Untitled chat' }), h('span', { class: 'rec-when', text: `${fmtWhen(c.updated)}, ${c.messages.length} messages` })),
      h('button', { class: 'btn link danger', type: 'button', text: 'Delete', onclick: e => { store.deleteChat(sk.id, c.id); e.currentTarget.closest('li').remove(); if (c.id === chat.id) { chat = newChat(sk); drawAll(); } } })))));
    openSheet('Chats with this skill', body);
  }
  drawAll();
  if (window.matchMedia('(pointer:fine)').matches) ta.focus();
}

// ---------- library ----------
function renderLibrary() {
  const v = view(); v.textContent = '';
  v.append(h('h1', { text: 'Saved' }));
  const favs = store.favs();
  const sec = h('section', { class: 'block' }, h('h2', { text: 'Saved skills' }));
  if (!favs.length) sec.append(h('p', { class: 'muted', text: 'Tap the star on any skill to keep it here.' }));
  else sec.append(h('ul', { class: 'skill-list' }, favs.map(f => {
    S.meta.set(f.id, { name: f.name || prettyName(f.path), description: f.description || '' });
    return skillRow(f);
  })));
  v.append(sec);
  const idx = store.get('chatindex', {});
  const chats = Object.entries(idx).filter(([, x]) => x && x.owner).sort((a, b) => b[1].at - a[1].at).slice(0, 12);
  if (chats.length) v.append(h('section', { class: 'block' }, h('h2', { text: 'Recent chats' }),
    h('ul', { class: 'plain-list' }, chats.map(([id, x]) => h('li', null, h('a', { class: 'rec', href: skillHash(x, 'chat') }, h('span', { class: 'rec-name', text: x.name }), h('span', { class: 'rec-when', text: fmtWhen(x.at) })))))));
  const rec = store.recents();
  if (rec.length) v.append(h('section', { class: 'block' }, h('h2', { text: 'Recent repositories' }),
    h('ul', { class: 'plain-list' }, rec.map(r => h('li', null, h('a', { class: 'rec', href: '#/?u=' + encodeURIComponent(r.url) }, h('span', { class: 'rec-name', text: r.label }), h('span', { class: 'rec-when', text: fmtWhen(r.at) }))))),
    h('button', { class: 'btn link', type: 'button', text: 'Clear recent repositories', onclick: () => { store.clearRecents(); renderLibrary(); } })));
}

// ---------- settings ----------
function renderSettings() {
  const v = view(); v.textContent = '';
  const s = settings();
  v.append(h('h1', { text: 'Settings' }));
  const provSec = h('section', { class: 'block' },
    h('h2', { text: 'AI keys' }),
    h('p', { class: 'privacy' }, 'Your keys never leave this device except to the AI provider you use. Skill Chat has no server: nobody else can see them.'),
    h('p', { class: 'small muted', text: `Skill Chat uses the first key below. If it fails (limit reached, key expired, no credits), it moves to the next key automatically. You can save up to ${MAX_SLOTS} keys, even several from the same provider with different models.` }));
  const ul = h('ol', { class: 'prov-list' });
  const addBox = h('div', { class: 'add-slot' });
  const draw = () => {
    ul.textContent = '';
    const all = store.slots();
    all.forEach((sl, i) => ul.append(slotCard(sl, i, all, draw)));
    addBox.textContent = '';
    if (all.length < MAX_SLOTS) {
      const sel = h('select', { 'aria-label': 'Provider for the new key' }, Object.entries(PROVIDERS).map(([k, P]) => h('option', { value: k, text: P.label })));
      addBox.append(h('label', { class: 'lbl', text: `Add another key (${all.length} of ${MAX_SLOTS})` }),
        h('div', { class: 'row' }, sel, h('button', { class: 'btn ghost', type: 'button', text: 'Add key slot', onclick: () => {
          const s = store.slots(); const id = newSlotId(sel.value);
          const twin = s.find(x => x.provider === sel.value && x.key);
          s.push({ id, provider: sel.value, key: twin ? twin.key : '', model: '', base: '' }); store.setSlots(s); draw();
          if (twin) toast('Same key copied. Pick a different model for this slot.');
          const d = ul.querySelector(`[data-slot="${id}"]`); if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); }
        } })));
    } else addBox.append(h('p', { class: 'small muted', text: `All ${MAX_SLOTS} key slots are in use.` }));
  };
  draw();
  provSec.append(ul, addBox);
  v.append(provSec);

  const tok = h('input', { type: 'password', id: 'gh-token', autocomplete: 'off', placeholder: store.ghToken() ? 'Token saved' : 'ghp_... (optional)', 'aria-label': 'GitHub token' });
  v.append(h('section', { class: 'block' }, h('h2', { text: 'GitHub token (optional)' }),
    h('p', { class: 'small muted', text: 'Without a token GitHub allows 60 lookups per hour. A token raises that to 5,000. Public repos need no permissions.' }),
    h('div', { class: 'row' }, tok,
      h('button', { class: 'btn ghost', type: 'button', text: 'Save', onclick: () => { if (tok.value.trim()) { store.setGhToken(tok.value.trim()); tok.value = ''; tok.placeholder = 'Token saved'; toast('GitHub token saved on this device'); } } }),
      h('button', { class: 'btn link danger', type: 'button', text: 'Delete', onclick: () => { store.setGhToken(''); tok.placeholder = 'ghp_... (optional)'; toast('GitHub token deleted'); } }))));

  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' });
  ['system', 'light', 'dark'].forEach(t => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.theme === t), text: t[0].toUpperCase() + t.slice(1),
      onclick: () => { const ns = settings(); ns.theme = t; store.saveSettings(ns); applyTheme(); seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b))); } });
    seg.append(b);
  });
  v.append(h('section', { class: 'block' }, h('h2', { text: 'Theme' }), seg));
  v.append(h('section', { class: 'block' }, h('h2', { text: 'Your data' }),
    h('p', { class: 'small muted', text: 'Saved skills, chats, keys and settings live only in this browser. Deleting them cannot be undone.' }),
    h('button', { class: 'btn danger', type: 'button', text: 'Delete all data on this device', onclick: () => {
      if (confirm('Delete all keys, chats, saved skills and settings from this device?')) { store.wipeAll(); applyTheme(); toast('All data deleted'); renderSettings(); }
    } })));
  v.append(h('section', { class: 'block about' }, h('h2', { text: 'About' }),
    window.Capacitor ? null : h('p', null, h('a', { href: 'downloads/SkillChat-v1.0.apk', download: 'SkillChat-v1.0.apk', text: 'Download the Android app (APK)' })),
    h('p', null, `Skill Chat ${VERSION}. Free and open source: `, h('a', { href: 'https://github.com/nm621532-byte/skill-chat-techbroz', target: '_blank', rel: 'noopener noreferrer', text: 'source code on GitHub' }), '.'),
    h('p', null, 'Made by Tech Bro Z. YouTube ', h('a', { href: 'https://www.youtube.com/@techbrozdeveloper', target: '_blank', rel: 'noopener noreferrer', text: '@techbrozdeveloper' }))));
}

function slotCard(sl, i, all, redraw) {
  const P = PROVIDERS[sl.provider];
  const has = !!sl.key;
  const keyIn = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: has ? 'Key saved. Paste a new one to replace it' : P.keyHint, 'aria-label': P.label + ' API key' });
  const modelIn = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', value: slotModel(sl), 'aria-label': P.label + ' model' });
  const baseIn = P.customBase ? h('input', { type: 'url', autocomplete: 'off', placeholder: 'https://example.com/v1', value: sl.base || '', 'aria-label': 'API base URL' }) : null;
  const msg = h('p', { class: 'small', role: 'status' });
  modelIn.addEventListener('change', () => { updateSlot(sl.id, { model: modelIn.value.trim() }); toast('Model saved'); redraw(); });
  baseIn && baseIn.addEventListener('change', () => { updateSlot(sl.id, { base: baseIn.value.trim() }); toast('Base URL saved'); });
  const move = d => { const s = store.slots(); const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; store.setSlots(s); redraw(); };
  const details = h('details', { class: 'prov' + (has ? ' has' : ''), dataset: { slot: sl.id } },
    h('summary', null,
      h('span', { class: 'pos', text: String(i + 1) }),
      h('span', { class: 'prov-title' }, h('span', { class: 'prov-name', text: P.label }), h('span', { class: 'prov-model', text: slotModel(sl) || 'no model set' })),
      h('span', { class: 'status ' + (has ? 'on' : 'off'), text: has ? 'Key saved' : 'No key' })),
    h('div', { class: 'prov-body' },
      h('p', { class: 'small muted', text: P.note }),
      baseIn ? h('label', { class: 'lbl', text: 'API base URL' }) : null, baseIn,
      h('label', { class: 'lbl', text: 'API key' }),
      h('div', { class: 'row' }, keyIn,
        h('button', { class: 'btn primary', type: 'button', text: 'Save key', onclick: () => {
          const k = keyIn.value.trim(); if (k.length < 8) { msg.textContent = 'Paste the whole key first.'; return; }
          updateSlot(sl.id, { key: k }); keyIn.value = ''; toast(P.label + ' key saved on this device'); redraw();
        } })),
      has ? h('button', { class: 'btn link danger', type: 'button', text: 'Delete key', onclick: () => { updateSlot(sl.id, { key: '' }); toast(P.label + ' key deleted'); redraw(); } }) : null,
      h('label', { class: 'lbl', text: 'Model' }),
      h('div', { class: 'row' }, modelIn, h('button', { class: 'btn ghost', type: 'button', text: 'Browse models', onclick: () => browseModels(sl, modelIn, msg) })),
      msg,
      h('details', { class: 'help' }, h('summary', { text: has ? 'How to get a key' : 'How to get a free key' }),
        h('ol', { class: 'steps' }, KEY_HELP[sl.provider].map(t => h('li', { text: t }))),
        P.keyUrl ? h('a', { href: P.keyUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Open ' + P.label }) : null),
      h('div', { class: 'row move' },
        h('button', { class: 'btn link', type: 'button', disabled: i === 0, text: 'Move up', onclick: () => move(-1) }),
        h('button', { class: 'btn link', type: 'button', disabled: i === all.length - 1, text: 'Move down', onclick: () => move(1) }),
        h('button', { class: 'btn link danger', type: 'button', text: 'Remove slot', onclick: () => { store.setSlots(store.slots().filter(x => x.id !== sl.id)); toast('Key slot removed'); redraw(); } }))));
  if (i === 0 && !has) details.open = true;
  return h('li', null, details);
}

async function browseModels(sl, modelIn, msg) {
  const p = sl.provider;
  const cur = store.slots().find(x => x.id === sl.id) || sl;
  msg.textContent = 'Loading models…';
  let list;
  try { list = await listModels({ provider: p, base: slotBase(cur), key: cur.key }); }
  catch (e) { msg.textContent = e.message; return; }
  msg.textContent = '';
  const search = h('input', { type: 'search', class: 'search', placeholder: `Search ${list.length} models`, 'aria-label': 'Search models' });
  const freeOnly = h('input', { type: 'checkbox', id: 'free-only' });
  const ul = h('ul', { class: 'model-list' });
  const anyFree = list.some(m => m.free);
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    ul.textContent = '';
    list.filter(m => (!freeOnly.checked || m.free) && (!q || (m.id + ' ' + m.name).toLowerCase().includes(q))).slice(0, 250).forEach(m => ul.append(h('li', null,
      h('button', { type: 'button', class: 'model' + (m.id === modelIn.value ? ' on' : ''), onclick: () => { modelIn.value = m.id; modelIn.dispatchEvent(new Event('change')); closeSheet(); } },
        h('span', { class: 'model-name', text: m.name }), m.free ? h('span', { class: 'tag free', text: 'Free' }) : null,
        h('span', { class: 'model-id', text: m.id + (m.ctx ? `, ${Math.round(m.ctx / 1000)}k context` : '') })))));
  };
  search.addEventListener('input', draw); freeOnly.addEventListener('change', draw);
  openSheet(PROVIDERS[p].label + ' models', h('div', null, search,
    anyFree ? h('label', { class: 'check' }, freeOnly, ' Free models only') : null, ul), { wide: true });
  draw();
}

// ---------- boot ----------
function boot() {
  if (!window.marked || !window.DOMPurify) { setTimeout(boot, 30); return; }
  applyTheme();
  window.addEventListener('hashchange', route);
  route();
  setTimeout(maybeOnboard, 400);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
