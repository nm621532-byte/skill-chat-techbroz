// Unit tests for Auto mode (v1.1). Run: node test/unit_auto.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRoute, routerMessages, shortlist, localPick, readStatus, stripStatus, nextMove, extractFiles, collectFiles, previewDoc, safeName, compactHistory, agentSystem, continueMessage } from '../site/lib/agent.js';
import { makeZip, crc32 } from '../site/lib/zip.js';
import { referencedFiles } from '../site/lib/library.js';
import { chatWithFallback } from '../site/lib/providers.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const C = [{ name: 'frontend-design', description: 'Create distinctive production-grade web pages and UI' }, { name: 'pdf', description: 'Read, create and merge PDF documents' },
  { name: 'docx', description: 'Word documents' }, { name: 'canvas-design', description: 'Posters and visual art as png/pdf' }];

await t('parseRoute: clean json', () => {
  const r = parseRoute('{"skills":[1],"plan":["Design","Build"],"title":"Cafe site"}', C);
  assert.equal(r.ok, true); assert.deepEqual(r.skills.map(s => s.name), ['frontend-design']); assert.equal(r.plan.length, 2); assert.equal(r.title, 'Cafe site');
});
await t('parseRoute: fenced, chatter, thinking, names, bad ids, cap 3', () => {
  assert.deepEqual(parseRoute('<think>maybe {"skills":[4]}</think>Sure!\n```json\n{"skills":[2, 9, "docx"], "plan":[]}\n```', C).skills.map(s => s.name), ['pdf', 'docx']);
  assert.equal(parseRoute('{"skills":[1,2,3,4]}', C).skills.length, 3);
  assert.equal(parseRoute('{"skills":[]}', C).skills.length, 0);
  assert.equal(parseRoute('{"skills":[]}', C).ok, true);
  assert.equal(parseRoute('I think frontend', C).ok, false);
  assert.deepEqual(parseRoute('"skills": [2]', C).skills.map(s => s.name), ['pdf']);
});
await t('router messages + local fallback', () => {
  const m = routerMessages('make a cafe website', C);
  assert.match(m[0].content, /1\. frontend-design: Create/); assert.match(m[0].content, /Command: make a cafe website/);
  assert.equal(localPick('make a one-page cafe website', C)[0].name, 'frontend-design');
  assert.equal(localPick('tell me a joke', C).length, 0);
  const many = Array.from({ length: 200 }, (_, i) => ({ name: 'skill' + i, description: 'misc' })).concat([{ name: 'pdf', description: 'pdf tools' }]);
  const sl = shortlist('summarise this pdf', many, 60); assert.equal(sl.length, 60); assert.equal(sl[0].name, 'pdf');
});
await t('status protocol', () => {
  assert.equal(readStatus('hi\n\nSTATUS: DONE'), 'DONE');
  assert.equal(readStatus('hi\n**STATUS: CONTINUE**'), 'CONTINUE');
  assert.equal(readStatus('work\nSTATUS: continue\n'), 'CONTINUE');
  assert.equal(readStatus('work\n\nDONE'), 'DONE');
  assert.equal(readStatus('```html index.html\n<p>half'), 'CUT');
  assert.equal(readStatus('just text'), 'NONE');
  assert.equal(stripStatus('a\nb\nSTATUS: DONE'), 'a\nb');
  assert.equal(nextMove('DONE', 1, 8), 'done'); assert.equal(nextMove('NONE', 1, 8), 'done');
  assert.equal(nextMove('CONTINUE', 3, 8), 'continue'); assert.equal(nextMove('CONTINUE', 8, 8), 'max'); assert.equal(nextMove('CUT', 2, 8), 'cut'); assert.equal(nextMove('CUT', 8, 8), 'max');
  assert.match(continueMessage(8, 8), /LAST step/); assert.match(continueMessage(3, 8, true), /cut off/);
  assert.match(agentSystem([{ name: 'x"<y', owner: 'o', repo: 'r', path: 'p/SKILL.md', text: 'BODY', extra: [{ rel: 'ref.md', text: 'REF' }] }], 8), /<skill name="xy" source="o\/r\/p\/SKILL.md">\nBODY[\s\S]*REF/);
  assert.match(agentSystem([], 5), /at most 5 replies/);
});
await t('compact history keeps it under the cap', () => {
  const big = 'x'.repeat(30000);
  const m = [{ role: 'user', content: 'cmd' }, { role: 'assistant', content: big }, { role: 'user', content: 'go' }, { role: 'assistant', content: big }, { role: 'user', content: 'go' }];
  const c = compactHistory(m, 40000);
  assert.ok(c.reduce((a, x) => a + x.content.length, 0) <= 40000); assert.equal(m[1].content.length, 30000);
});
await t('extract files from many shapes', () => {
  const txt = 'Plan\n```html index.html\n<!doctype html><link rel="stylesheet" href="style.css"><script src="./app.js"></script>\n```\n**style.css**\n```css\nbody{color:red}\n```\n```javascript title="app.js"\nconsole.log(1)\n```\n```bash\nnpm i\n```\n```python:tools/run.py\nprint(1)\n```\n```html\n<html><body>unnamed</body></html>\n```';
  const f = extractFiles(txt);
  assert.deepEqual(f.map(x => x.name), ['index.html', 'style.css', 'app.js', 'tools/run.py', 'index.html']);
  assert.equal(f[1].content, 'body{color:red}\n');
  assert.deepEqual(extractFiles('```js ../../etc/passwd.js\nx\n```').map(x => x.name), ['etc/passwd.js']);
  assert.equal(safeName('<img src=x onerror=alert(1)>.html'), '');
  assert.equal(safeName('/abs/ok.txt'), 'abs/ok.txt');
  assert.deepEqual(extractFiles('```html index.html\n<p>cut'), [{ name: 'index.html', lang: 'html', content: '<p>cut\n', complete: false }]);
});
await t('collect files: last complete version wins', () => {
  const f = collectFiles(['```css style.css\na{}\n```', '```css style.css\nb{}\n```\n```js app.js\n1\n```', '```css style.css\nhalf']);
  assert.equal(f.find(x => x.name === 'style.css').content, 'b{}\n'); assert.equal(f.length, 2);
});
await t('preview inlines local css/js and escapes closers', () => {
  const files = [{ name: 'index.html', content: '<html><head><link rel="stylesheet" href="style.css"><link rel="icon" href="x.png"></head><body><script src="app.js"></script><script src="https://cdn.x/y.js"></script></body></html>' },
    { name: 'style.css', content: 'p{}</style><b>' }, { name: 'app.js', content: 'let a="</script><img>"' }];
  const d = previewDoc(files[0], files);
  assert.match(d, /<style>\np\{\}<\\\/style><b>\n<\/style>/); assert.match(d, /<script>\nlet a="<\\\/script><img>"\n<\/script>/);
  assert.match(d, /x\.png/); assert.match(d, /cdn\.x\/y\.js/);
});
await t('zip opens with unzip and has right bytes', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const z = makeZip([{ name: 'index.html', content: '<h1>Namaste ☕</h1>\n' }, { name: 'css/style.css', content: 'body{}' }]);
  const dir = mkdtempSync(join(tmpdir(), 'sczip')); writeFileSync(join(dir, 'a.zip'), z);
  const out = execFileSync('unzip', ['-t', join(dir, 'a.zip')]).toString(); assert.match(out, /No errors/);
  execFileSync('unzip', ['-o', '-q', join(dir, 'a.zip'), '-d', join(dir, 'x')]);
  assert.equal(readFileSync(join(dir, 'x', 'index.html'), 'utf8'), '<h1>Namaste ☕</h1>\n');
  assert.equal(readFileSync(join(dir, 'x', 'css', 'style.css'), 'utf8'), 'body{}');
});
await t('referenced files', () => {
  assert.deepEqual(referencedFiles('see reference/forms.md and scripts/x.py', [['reference/forms.md', 900], ['scripts/x.py', 100], ['other.md', 5]]).map(x => x[0]), ['scripts/x.py', 'reference/forms.md']);
});
await t('routing call falls back to the next key', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.includes('openrouter')) return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } }), { status: 429 });
    const body = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"skills":[1],"plan":["a"]}' }] } }] }) + '\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const chain = [{ provider: 'openrouter', key: 'k1', model: 'openrouter/free', label: 'OpenRouter' }, { provider: 'gemini', key: 'k2', model: 'gemini-2.5-flash', label: 'Gemini' }];
  let switched = null;
  const res = await chatWithFallback(chain, { system: 'r', messages: routerMessages('cafe website', C) }, { fetchImpl, onSwitch: n => { switched = n.label; } });
  assert.equal(switched, 'Gemini'); assert.equal(res.used.provider, 'gemini'); assert.equal(parseRoute(res.text, C).skills[0].name, 'frontend-design'); assert.equal(calls.length, 2);
});
console.log(`\n${n} auto-mode unit tests passed`);
