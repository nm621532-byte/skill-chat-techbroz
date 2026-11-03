// Auto mode ("agent"): pure helpers for routing a command to skills, the
// multi-step text protocol, and pulling files out of the AI's answer.
// No DOM here, so everything is unit-testable in Node.

export const MAX_PICK = 3;
export const ROUTE_CANDIDATES = 60;

const STOP = new Set('a an the and or for to of in on with me my i you your it is are be make made create write build do please can could would want need some one this that from into as by at about using use mujhe karo kar ek ka ki ke ko hai banao bana do de'.split(' '));
export function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w));
}
const SYN = { website: ['web', 'html', 'frontend', 'page', 'site', 'landing', 'design'], site: ['web', 'html', 'frontend', 'page'], page: ['web', 'html', 'frontend'],
  pdf: ['pdf', 'document'], doc: ['docx', 'document', 'word'], word: ['docx', 'document'], excel: ['xlsx', 'spreadsheet'], sheet: ['xlsx', 'spreadsheet'],
  slides: ['pptx', 'presentation'], ppt: ['pptx', 'presentation'], presentation: ['pptx', 'slides'], poster: ['canvas', 'design', 'art'],
  script: ['youtube', 'video', 'content', 'writing'], youtube: ['video', 'content', 'script'], blog: ['writing', 'content', 'article'], email: ['writing', 'communication'],
  app: ['web', 'frontend', 'react', 'artifact'], game: ['web', 'canvas', 'javascript'], logo: ['design', 'brand', 'svg'], gif: ['gif', 'animation', 'slack'] };
function expand(ws) { const out = new Set(ws); for (const w of ws) (SYN[w] || []).forEach(x => out.add(x)); return [...out]; }

// Cheap local relevance score (used to shortlist a big library and as a fallback).
export function scoreSkill(cmdWords, sk) {
  const name = String(sk.name || '').toLowerCase(), desc = String(sk.description || '').toLowerCase();
  let s = 0;
  for (const w of cmdWords) {
    if (name.includes(w)) s += 3;
    if (desc.includes(w)) s += 1;
  }
  return s;
}
export function shortlist(command, skills, max = ROUTE_CANDIDATES) {
  if (skills.length <= max) return skills.slice();
  const ws = expand(words(command));
  return skills.map((sk, i) => ({ sk, i, s: scoreSkill(ws, sk) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map(x => x.sk);
}
export function localPick(command, skills) {
  const ws = expand(words(command));
  const best = skills.map(sk => ({ sk, s: scoreSkill(ws, sk) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 3 ? [best.sk] : [];
}

export const ROUTER_SYSTEM = 'You choose skills for an AI assistant app. You get a user command and a numbered list of skills (name: description). ' +
  'Pick the 1 to 3 skills that would most help complete the command, best first. If no skill clearly fits, pick none and the assistant will work without a skill. ' +
  'Reply with ONLY one JSON object and nothing else, in this exact shape: {"skills":[2,7],"plan":["short step","short step"],"title":"short title"}. ' +
  '"plan" has 2 to 5 very short steps. "title" is 2 to 6 words. Use [] for no skills.';

export function routerMessages(command, candidates) {
  const lines = candidates.map((sk, i) => `${i + 1}. ${clean(sk.name, 60)}: ${clean(sk.description, 200) || '(no description)'}`);
  return [{ role: 'user', content: `Command: ${clean(command, 2000)}\n\nSkills:\n${lines.join('\n') || '(none)'}\n\nReply with the JSON object only.` }];
}
function clean(s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); }

// Parse the router's reply. Tolerates code fences, chatter, thinking text.
export function parseRoute(text, candidates) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  let obj = null;
  const starts = [];
  for (let i = t.indexOf('{'); i >= 0; i = t.indexOf('{', i + 1)) starts.push(i);
  outer: for (const st of starts) {
    for (let en = t.lastIndexOf('}'); en > st; en = t.lastIndexOf('}', en - 1)) {
      try { const o = JSON.parse(t.slice(st, en + 1)); if (o && typeof o === 'object' && 'skills' in o) { obj = o; break outer; } } catch {}
    }
  }
  let nums = [];
  if (obj) nums = Array.isArray(obj.skills) ? obj.skills : [obj.skills];
  else { const m = t.match(/"?skills"?\s*:\s*\[([^\]]*)\]/i); if (m) nums = m[1].split(','); }
  const picked = [];
  for (const n of nums) {
    let idx = parseInt(typeof n === 'object' && n ? (n.id ?? n.number) : n, 10);
    let sk = Number.isFinite(idx) ? candidates[idx - 1] : null;
    if (!sk && typeof n === 'string') sk = candidates.find(c => c.name.toLowerCase() === n.trim().toLowerCase());
    if (sk && !picked.includes(sk)) picked.push(sk);
    if (picked.length >= MAX_PICK) break;
  }
  const plan = obj && Array.isArray(obj.plan) ? obj.plan.map(x => clean(x, 140)).filter(Boolean).slice(0, 6) : [];
  const title = obj && obj.title ? clean(obj.title, 60) : '';
  return { ok: !!obj || nums.length > 0, skills: picked, plan, title };
}

// ---- the multi-step protocol ----
export function agentSystem(skills, maxSteps) {
  let s = 'You are the AUTO mode of the app "Skill Chat". The user gives one command and you complete it on your own, in steps, without asking questions. ' +
    'If something is unclear, make a sensible choice and say which in one line.\n\n' +
    'HOW TO WORK\n' +
    `- You have at most ${maxSteps} replies (steps). Each reply does one solid chunk of the job. Small jobs must be finished in ONE reply.\n` +
    '- In your first reply start with "## Plan" and a short numbered plan, then do step 1 right away.\n' +
    '- In later replies continue from where you stopped. Do not repeat earlier work.\n' +
    '- Give real, finished results (full text, full code), never placeholders like "add your content here" or "rest stays the same".\n' +
    '- Write every file as a fenced code block whose first line is the language and the file name, for example:\n```html index.html\n<!doctype html>...\n```\n' +
    '- If you change a file that you already wrote, write the whole file again with the same name.\n' +
    '- For a website, prefer one self-contained index.html (CSS in <style>, JS in <script>) unless the user asks for separate files. No external build tools.\n' +
    '- You cannot open other apps, send messages, browse the web, or run code. You create text, code, websites and files that the user can download, copy or preview.\n' +
    '- Reply in the language of the command (Hindi or Hinglish command: reply in simple Hinglish; files and code comments may be English).\n' +
    '- END EVERY REPLY with exactly one last line: "STATUS: CONTINUE" if more steps are needed, or "STATUS: DONE" when the whole job is complete.';
  if (skills.length) {
    s += '\n\nSKILLS: follow the instructions of these skills wherever they apply. They may mention scripts or tools you cannot run here; in that case do the work yourself in text/code, or give the exact code for the user.';
    for (const sk of skills) {
      s += `\n\n<skill name="${String(sk.name).replace(/["<>]/g, '')}" source="${sk.owner}/${sk.repo}/${sk.path}">\n${String(sk.text || '').trim()}\n</skill>`;
      for (const f of sk.extra || []) s += `\n\n<skill_file skill="${String(sk.name).replace(/["<>]/g, '')}" path="${String(f.rel).replace(/["<>]/g, '')}">\n${f.text}\n</skill_file>`;
    }
  } else s += '\n\nNo special skill was chosen for this command: act as a skilled general assistant.';
  return s;
}

export function continueMessage(step, maxSteps, cutOff) {
  if (cutOff) return `Your last reply was cut off in the middle (inside a code block). Continue EXACTLY where it stopped: first re-open the same code block with the same language and file name and write the WHOLE file again from the start. This is step ${step} of at most ${maxSteps}. End with STATUS: CONTINUE or STATUS: DONE.`;
  const last = step >= maxSteps ? ' This is the LAST step: finish everything now and end with STATUS: DONE.' : '';
  return `Continue with the next step of your plan. This is step ${step} of at most ${maxSteps}.${last} End with STATUS: CONTINUE or STATUS: DONE.`;
}

// Read the status marker at the end of a reply.
export function readStatus(text) {
  const t = String(text || '').trimEnd();
  const tail = t.slice(-160);
  const m = tail.match(/(?:\*\*|`)?\s*STATUS\s*:?\s*\**\s*(CONTINUE|DONE)\b[^\n]*$/i) || tail.match(/(?:^|\n)\s*[`*]*(CONTINUE|DONE)[`*.!]*\s*$/i);
  if (m) return m[1].toUpperCase();
  if (openFence(t)) return 'CUT';
  return 'NONE';
}
export function stripStatus(text) {
  return String(text || '').replace(/\n?[ \t]*(?:\*\*|`)?\s*STATUS\s*:?\s*\**\s*(CONTINUE|DONE)\b[^\n]*\s*$/i, '').replace(/\n\s*[`*]*(CONTINUE|DONE)[`*.!]*\s*$/i, '').trimEnd();
}
function openFence(t) { const n = (t.match(/^\s*```/gm) || []).length; return n % 2 === 1; }

// Decide the next move after one step.
export function nextMove(status, step, maxSteps) {
  if (status === 'DONE' || status === 'NONE') return 'done';
  if (step >= maxSteps) return 'max';
  return status === 'CUT' ? 'cut' : 'continue';
}

// Keep the conversation small enough for free models: older step outputs are shortened.
export function compactHistory(messages, cap = 60000) {
  const out = messages.map(m => ({ ...m }));
  let total = out.reduce((a, m) => a + m.content.length, 0);
  for (let i = 1; i < out.length - 1 && total > cap; i++) {
    const m = out[i];
    if (m.role !== 'assistant' || m.content.length < 1500) continue;
    const short = m.content.slice(0, 900) + '\n\n[... earlier output shortened to save space; the files from it are kept by the app ...]\n' + m.content.slice(-300);
    total -= m.content.length - short.length; m.content = short;
  }
  return out;
}

// ---- files in the answer ----
const EXT = { html: 'html', htm: 'html', css: 'css', js: 'js', javascript: 'js', jsx: 'jsx', ts: 'ts', typescript: 'ts', tsx: 'tsx', json: 'json', py: 'py', python: 'py',
  md: 'md', markdown: 'md', txt: 'txt', text: 'txt', svg: 'svg', xml: 'xml', yaml: 'yml', yml: 'yml', csv: 'csv', sql: 'sql', sh: 'sh', bash: 'sh', java: 'java', c: 'c', cpp: 'cpp',
  'c++': 'cpp', php: 'php', go: 'go', rust: 'rs', rs: 'rs', kotlin: 'kt', kt: 'kt', dart: 'dart', ruby: 'rb', rb: 'rb', swift: 'swift', csharp: 'cs', cs: 'cs', toml: 'toml', ini: 'ini' };
const FILE_RE = /^[\w\u0900-\u097f][\w\u0900-\u097f .()+-]*\.[A-Za-z0-9]{1,8}$/;

export function safeName(name) {
  let p = String(name || '').replace(/\\/g, '/').replace(/^[`'"*]+|[`'"*:,]+$/g, '').trim();
  const parts = p.split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..');
  if (!parts.length) return '';
  const base = parts[parts.length - 1];
  if (!FILE_RE.test(base)) return '';
  return parts.slice(-3).map(s => s.replace(/[^\w\u0900-\u097f .()+-]/g, '_').slice(0, 80)).join('/');
}

// Find ```lang name``` blocks (also "**index.html**" / "### style.css" / "File: x" on the line before).
export function extractFiles(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/);
    if (!open) { i++; continue; }
    const fence = open[1];
    let lang = open[2] || '', rest = (open[3] || '').trim();
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) { if (lines[j].trim().startsWith(fence[0].repeat(fence.length)) && lines[j].trim().replace(/[`~]/g, '') === '') break; body.push(lines[j]); }
    const closed = j < lines.length;
    let name = '';
    // ```html index.html | ```index.html | ```html title="index.html" | ```html:index.html
    const attr = rest.match(/(?:title|file|filename|name)\s*=\s*["']?([^"'\s]+)/i);
    if (attr) name = attr[1];
    else if (rest) name = rest.split(/\s+/)[0];
    if (!name && lang.includes(':')) { const [a, b] = lang.split(':'); lang = a; name = b; }
    if (!name && /\.[A-Za-z0-9]+$/.test(lang) && !EXT[lang.toLowerCase()]) { name = lang; lang = name.split('.').pop(); }
    if (!name) { // look at the line(s) just before the fence
      for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
        const l = lines[k].trim(); if (!l) continue;
        const m = l.match(/([\w\u0900-\u097f./-]+\.[A-Za-z0-9]{1,8})\s*[`*:)]*\s*$/);
        if (m && /^(#{1,6}\s|\*\*|`|file|filename|📄|\d+\.\s|-\s|create|save)/i.test(l)) name = m[1].replace(/^`|`$/g, '');
        break;
      }
    }
    name = safeName(name);
    const content = body.join('\n');
    const lk = lang.toLowerCase();
    if (!name && closed && (lk === 'html' || lk === 'htm') && /<html|<!doctype|<body/i.test(content)) name = 'index.html';
    if (name) out.push({ name, lang: lk || (name.split('.').pop() || '').toLowerCase(), content: content + (content.endsWith('\n') ? '' : '\n'), complete: closed });
    i = closed ? j + 1 : j;
  }
  return out;
}

// Merge files from all steps: the last complete version of each name wins.
export function collectFiles(outputs) {
  const map = new Map();
  for (const o of outputs) for (const f of extractFiles(o)) {
    let key = f.name, n = 2;
    if (map.has(key) && !f.complete && map.get(key).complete) continue;
    // two different unnamed index.html in the SAME step: keep both
    map.set(key, f);
  }
  return [...map.values()];
}

// Build one HTML document for the sandboxed preview: inline local CSS/JS files it links.
export function previewDoc(htmlFile, files) {
  const byName = new Map(files.map(f => [f.name.toLowerCase(), f]));
  const find = href => { const k = String(href || '').replace(/^\.\//, '').split(/[?#]/)[0].toLowerCase(); return byName.get(k) || byName.get(k.split('/').pop()); };
  let html = htmlFile.content;
  html = html.replace(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, (tag, href) => {
    if (!/stylesheet/i.test(tag)) return tag;
    const f = find(href); return f ? `<style>\n${f.content.replace(/<\/style/gi, '<\\/style')}\n</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
    const f = find(src); if (!f) return tag;
    const type = (a + b).match(/type\s*=\s*["']module["']/i) ? ' type="module"' : '';
    return `<script${type}>\n${f.content.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });
  return html;
}
