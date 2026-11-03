// "Post a video" (v1.2): platform list, command detection, the metadata prompt, parsing + rules, share text.
// Pure functions only (unit-tested in test/unit_video.mjs). No keys, no network here.

// pkg = Android app package the APK targets directly (when installed). upload = web page to post from a computer.
export const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', pkg: 'com.google.android.youtube', upload: 'https://www.youtube.com/upload', kind: 'yt' },
  { id: 'shorts', label: 'YouTube Shorts', pkg: 'com.google.android.youtube', upload: 'https://www.youtube.com/upload', kind: 'shorts' },
  { id: 'instagram', label: 'Instagram Reels', pkg: 'com.instagram.android', upload: 'https://www.instagram.com/', kind: 'reel' },
  { id: 'facebook', label: 'Facebook', pkg: 'com.facebook.katana', upload: 'https://www.facebook.com/', kind: 'social' },
  { id: 'whatsapp', label: 'WhatsApp Status', pkg: 'com.whatsapp', upload: '', kind: 'short-text', note: 'WhatsApp opens its chat list: tap My status at the top.' },
  { id: 'telegram', label: 'Telegram', pkg: 'org.telegram.messenger', upload: 'https://web.telegram.org/', kind: 'short-text' },
  { id: 'x', label: 'X', pkg: 'com.twitter.android', upload: 'https://x.com/compose/post', kind: 'x' },
  { id: 'snapchat', label: 'Snapchat', pkg: 'com.snapchat.android', upload: '', kind: 'short-text' },
  { id: 'moj', label: 'Moj / Josh', pkg: 'in.mohalla.video', alt: ['com.eterno.shortvideos'], upload: '', kind: 'reel' },
  { id: 'linkedin', label: 'LinkedIn', pkg: 'com.linkedin.android', upload: 'https://www.linkedin.com/feed/', kind: 'pro' },
  { id: 'other', label: 'Other', pkg: '', upload: '', kind: 'social', note: 'The share sheet opens: pick any app.' }
];
export const PLATFORM_IDS = PLATFORMS.map(p => p.id);
export const platform = id => PLATFORMS.find(p => p.id === id);

// Hashtag limits per platform (YouTube: exactly 3, Instagram: 5-10).
export const TAG_RULES = { youtube: [3, 3], shorts: [3, 3], instagram: [5, 10], facebook: [2, 5], x: [1, 2], linkedin: [3, 5], moj: [3, 8], other: [3, 6], whatsapp: [0, 3], telegram: [0, 5], snapchat: [0, 3] };
export const YT_TITLE_MAX = 60;

// ---------- command detection (Auto mode routing) ----------
const POST_VERB = /\b(post|posts|posting|upload|uploads|uploading|publish|share|dalo|daalo|dalna|daalna|dal\s*do|daal\s*do|dalwa\w*|dalva\w*|daal\w*|dal\s*de|lagao|lagado|laga\s*do|bhejo|bhej\s*do|chadhao|chadha\s*do|put)\b/i;
const VIDEO_WORD = /\b(video|videos|vid|reel|reels|short|shorts|clip|status)\b/i;
const PLATFORM_WORDS = [
  ['shorts', /\b(yt|youtube)\s*shorts?\b|\bshorts?\b/i],
  ['youtube', /\b(youtube|yt|you\s*tube)\b/i],
  ['instagram', /\b(instagram|insta|ig|reels?)\b/i],
  ['facebook', /\b(facebook|fb)\b/i],
  ['whatsapp', /\b(whatsapp|whats\s*app|wa)\b/i],
  ['telegram', /\b(telegram|tg)\b/i],
  ['x', /\b(twitter|x\.com)\b|\bx\s+(pe|par|per|on)\b|\b(on|to)\s+x\b/i],
  ['snapchat', /\b(snapchat|snap)\b/i],
  ['moj', /\b(moj|josh)\b/i],
  ['linkedin', /\b(linkedin|linked\s*in)\b/i]
];
export function detectPlatforms(text) {
  const t = String(text || '');
  const out = [];
  for (const [id, re] of PLATFORM_WORDS) if (re.test(t) && !out.includes(id)) out.push(id);
  // "YouTube Shorts" alone means Shorts, not long YouTube too.
  if (out.includes('shorts') && out.includes('youtube') && !/\byoutube\b(?!\s*shorts?)/i.test(t.replace(/\b(yt|youtube)\s*shorts?\b/gi, ''))) out.splice(out.indexOf('youtube'), 1);
  if (/\b(all|every|sab|saare|sabhi|har|kisi bhi|any)\b.{0,20}\b(platform|platforms|jagah|apps?)\b/i.test(t)) for (const id of ['youtube', 'instagram', 'facebook', 'whatsapp']) if (!out.includes(id)) out.push(id);
  return out;
}
// True when a command asks to post/upload a video somewhere (English or Hinglish).
export function isPostVideoCommand(text) {
  const t = String(text || '');
  if (!POST_VERB.test(t)) return false;
  const plats = detectPlatforms(t);
  if (VIDEO_WORD.test(t) && (plats.length || /\bplatform|jagah\b/i.test(t))) return true;
  // "isko YouTube aur Instagram pe dalo" with 2+ platforms but no word "video"
  return plats.filter(p => p !== 'whatsapp').length >= 2 && /\b(is|isko|ise|ye|yeh|this|it)\b/i.test(t);
}
// What the video is about, from a command like "is cafe video ko YouTube pe dalo" -> "cafe". Very rough; the user can edit it.
export function topicFromCommand(text) {
  let t = ' ' + String(text || '') + ' ';
  t = t.replace(/\b(yt|youtube)\s*shorts?\b/gi, ' ');
  for (const [, re] of PLATFORM_WORDS) t = t.replace(new RegExp(re.source, 'gi'), ' ');
  t = t.replace(new RegExp(POST_VERB.source, 'gi'), ' ').replace(new RegExp(VIDEO_WORD.source, 'gi'), ' ');
  t = t.replace(/\b(is|isko|ise|ismein|isme|ismen|ko|ye|yeh|this|my|mera|meri|mere|pe|par|per|aur|and|on|to|in|me|mein|a|an|the|please|plz|kar|karo|do|de|sab|all|every|platforms?|jagah|kisi|bhi|any|wala|wali|wale|ka|ki|ke|apps?)\b/gi, ' ');
  return t.replace(/[^\p{L}\p{N}\s'-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- the AI prompt (distilled from the youtube metadata + shorts sub-skills, social-content and copywriting skills) ----------
export const META_SYSTEM = [
  'You write upload text (titles, captions, hashtags) for a creator posting ONE video to several platforms. You cannot see the video; use only what the user tells you about it and never invent facts, prices, names or links.',
  'Rules per platform:',
  '- youtube: "title" under 60 characters, the exact search phrase people type comes FIRST, then a curiosity hook; no clickbait lies, no ALL CAPS. "description": first 2 lines (125 characters) repeat the main keyword and say what the viewer gets; then 3-6 short lines of detail; a call to subscribe/comment at the end. "tags": 10-15 search phrases (lowercase, no #). "hashtags": EXACTLY 3, the most relevant first.',
  '- shorts: "title" 20-50 characters, keyword first, ends with #shorts. "description": 1-2 lines, the first 125 characters matter. "hashtags": EXACTLY 3.',
  '- instagram (Reels): "caption" starts with a scroll-stopping HOOK line (under 10 words), then 2-4 short lines of value, then a call to action (save / share / comment a word). "hashtags": 5-10, mix broad and niche.',
  '- facebook: "caption" friendly, 2-4 short lines with a question to start comments. "hashtags": 2-5.',
  '- whatsapp (Status), telegram, snapchat: "caption" one or two short lines; hashtags optional (0-3).',
  '- x: "caption" under 240 characters INCLUDING hashtags, punchy first line. "hashtags": 1-2.',
  '- moj (Moj/Josh short video): "caption" hook line + 1 line, casual; "hashtags": 3-8.',
  '- linkedin: "caption" professional, starts with a one-line insight, 3-6 short lines, a question at the end; "hashtags": 3-5.',
  '- other: "caption" general 2-3 lines; "hashtags": 3-6.',
  'Write like a real person, short sentences, simple words, emojis only where natural (max 3 per caption). Hashtags are single words without spaces, each starting with #.',
  'Reply with ONLY a JSON object, no other text: {"<platform id>": {"title": "...", "description": "...", "caption": "...", "tags": ["..."], "hashtags": ["#..."]}, ...}. Include only the platforms asked for and only the fields that platform uses (youtube: title, description, tags, hashtags; shorts: title, description, hashtags; others: caption, hashtags).'
].join('\n');

export const LANGS = { hinglish: 'Hinglish (Hindi written in English letters, mixed with simple English, like Indian creators write)', english: 'simple English', hindi: 'Hindi in Devanagari script (keep tech words in English)' };

export function metaMessages({ about, platforms, lang = 'hinglish', channel = '' }) {
  const ids = platforms.filter(id => PLATFORM_IDS.includes(id));
  const lines = [
    'Video is about: ' + String(about || '').slice(0, 1500),
    channel ? 'Channel / account name: ' + String(channel).slice(0, 80) : '',
    'Language: ' + (LANGS[lang] || LANGS.hinglish),
    'Platforms (use these exact ids as JSON keys): ' + ids.join(', ')
  ].filter(Boolean);
  return [{ role: 'user', content: lines.join('\n') }];
}

// ---------- parsing + enforcing the rules ----------
function firstJsonObject(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].includes('{')) s = fence[1];
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\r/g, '').trim();
export function cleanHashtags(list, id) {
  let arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(/[\s,]+/) : [];
  arr = arr.map(x => str(x).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).map(x => '#' + x);
  const seen = new Set(); arr = arr.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const [, max] = TAG_RULES[id] || [0, 10];
  return arr.slice(0, max);
}
export function cleanTags(list) {
  const arr = (Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : []).map(x => str(x).replace(/^#/, '').replace(/[<>]/g, '')).filter(Boolean);
  const out = []; let total = 0;
  for (const t of arr) { if (out.some(o => o.toLowerCase() === t.toLowerCase())) continue; if (total + t.length > 480) break; out.push(t); total += t.length + 1; }
  return out.slice(0, 20);
}
// Shorten at a word boundary, never mid-word.
export function clip(s, max) {
  s = str(s); if (s.length <= max) return s;
  const cut = s.slice(0, max + 1); const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : s.slice(0, max)).replace(/[\s,;:|–-]+$/, '');
}
export function normalizeMeta(raw, platforms) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const keyOf = id => Object.keys(src).find(k => k.toLowerCase().replace(/[^a-z]/g, '') === id || (id === 'shorts' && /short/i.test(k)) || (id === 'instagram' && /insta|reel/i.test(k)) || (id === 'x' && /twitter/i.test(k)) || (id === 'moj' && /moj|josh/i.test(k)) || (id === 'whatsapp' && /whatsapp/i.test(k)));
  for (const id of platforms) {
    const k = keyOf(id); const m = k ? src[k] || {} : {};
    const o = { title: '', description: '', caption: '', tags: [], hashtags: cleanHashtags(m.hashtags, id) };
    if (id === 'youtube' || id === 'shorts') {
      o.title = str(m.title).replace(/[<>]/g, '');
      if (id === 'shorts' && o.title && !/#shorts\b/i.test(o.title)) o.title = clip(o.title, YT_TITLE_MAX - 8) + ' #shorts';
      o.title = clip(o.title, id === 'shorts' ? 100 : YT_TITLE_MAX);
      o.description = str(m.description || m.caption).replace(/[<>]/g, '');
      if (id === 'youtube') o.tags = cleanTags(m.tags);
    } else {
      o.caption = str(m.caption || m.description || m.text);
      if (id === 'x') o.caption = clip(o.caption, 270 - o.hashtags.join(' ').length);
    }
    out[id] = o;
  }
  return out;
}
export function parseMeta(text, platforms) {
  const obj = firstJsonObject(text);
  if (!obj) return { ok: false, meta: null };
  const src = obj.platforms && typeof obj.platforms === 'object' ? obj.platforms : obj;
  const meta = normalizeMeta(src, platforms);
  const filled = platforms.filter(id => { const m = meta[id]; return m && (m.title || m.caption || m.description); });
  return { ok: filled.length > 0, meta, missing: platforms.filter(id => !filled.includes(id)) };
}
// Problems shown under the fields (the user can still post).
export function checkMeta(id, m) {
  const w = [];
  if (!m) return w;
  if (id === 'youtube' && m.title.length > YT_TITLE_MAX) w.push(`Title is ${m.title.length} characters; keep it under ${YT_TITLE_MAX}.`);
  const [min, max] = TAG_RULES[id] || [0, 30];
  const n = (m.hashtags || []).length;
  if (n < min || n > max) w.push(min === max ? `Use exactly ${min} hashtags (now ${n}).` : `Use ${min}-${max} hashtags (now ${n}).`);
  if (id === 'x' && shareText(id, m).length > 280) w.push('Too long for X (280 characters).');
  return w;
}

// The text that goes with the video into the platform app (and the clipboard).
export function shareText(id, m) {
  if (!m) return '';
  const tags = (m.hashtags || []).join(' ');
  if (id === 'youtube' || id === 'shorts') return [m.title, m.description, tags].filter(Boolean).join('\n\n');
  return [m.caption, tags].filter(Boolean).join('\n\n');
}

// Queue for "Post to all": the next platform not ticked yet.
export function nextInQueue(order, done) { return order.find(id => !done[id]) || null; }

// A stable id for a picked file, to keep its draft (the video itself is never stored).
export function fileKey(f) { return f ? [f.name, f.size, f.lastModified || 0].join('|') : ''; }
export function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  sec = Math.round(sec); const m = Math.floor(sec / 60), s = sec % 60, hh = Math.floor(m / 60);
  return hh ? `${hh}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
// Advice from duration/orientation: Shorts must be <= 3 min and vertical; Reels up to 3 min (more becomes a normal video).
export function videoHints(sec, w, hgt) {
  const out = [];
  const vertical = hgt > w;
  if (sec > 180) out.push('Longer than 3 minutes: YouTube Shorts and Instagram Reels will not take it as a short. Use YouTube (long video) or Facebook.');
  if (w && hgt && !vertical) out.push('This video is horizontal. Shorts, Reels, Status and Moj look best vertical (9:16).');
  return out;
}
