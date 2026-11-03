// Unit tests for the pure parts of Skill Chat. Run: node test/unit.mjs
import assert from 'node:assert/strict';
import { parseGitHubUrl, findSkills, resolveRelative, makeGitHub } from '../lib/github.js';
import { splitFrontMatter } from '../lib/frontmatter.js';
import { buildRequest, sseParser, readEvent, classifyError, chatWithFallback, streamChat } from '../lib/providers.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await t('parse repo url', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/anthropics/skills'), { owner: 'anthropics', repo: 'skills', kind: 'repo', refPath: [] });
  assert.equal(parseGitHubUrl('github.com/anthropics/skills.git/').repo, 'skills');
  assert.equal(parseGitHubUrl('anthropics/skills').owner, 'anthropics');
  const tr = parseGitHubUrl('https://github.com/anthropics/skills/tree/main/skills/pdf');
  assert.equal(tr.kind, 'tree'); assert.deepEqual(tr.refPath, ['main', 'skills', 'pdf']);
  const bl = parseGitHubUrl('https://github.com/a/b/blob/main/x/SKILL.md?plain=1#L3');
  assert.equal(bl.kind, 'blob'); assert.deepEqual(bl.refPath, ['main', 'x', 'SKILL.md']);
  assert.equal(parseGitHubUrl('https://raw.githubusercontent.com/a/b/main/x/SKILL.md').kind, 'blob');
  assert.equal(parseGitHubUrl('https://github.com/a/b/issues/3').kind, 'repo');
});
await t('bad urls rejected', () => {
  for (const bad of ['', 'hello world', 'https://gitlab.com/a/b', 'https://github.com/onlyowner', 'javascript:alert(1)', 'https://github.com/../b', 'ftp://github.com/a/b'])
    assert.throws(() => parseGitHubUrl(bad), e => e.kind === 'bad_url', bad);
});
await t('front matter', () => {
  const a = splitFrontMatter('---\nname: pdf\ndescription: "Read, fill: and merge PDFs"\nlicense: MIT\n---\n# Body');
  assert.equal(a.data.name, 'pdf'); assert.equal(a.data.description, 'Read, fill: and merge PDFs'); assert.equal(a.body.trim(), '# Body');
  const b = splitFrontMatter('---\nname: x\ndescription: >\n  folded line one\n  line two\nmetadata:\n  version: 1\n---\nhi');
  assert.equal(b.data.description, 'folded line one line two');
  const c = splitFrontMatter('---\nname: y\ndescription: plain start\n  continued here\n---\n');
  assert.equal(c.data.description, 'plain start continued here');
  const d = splitFrontMatter('# no front matter');
  assert.deepEqual(d.data, {}); assert.equal(d.body, '# no front matter');
  const e = splitFrontMatter('\uFEFF---\r\nname: crlf\r\n---\r\nbody');
  assert.equal(e.data.name, 'crlf');
});
await t('find skills in tree', () => {
  const tree = { tree: [
    { type: 'blob', path: 'README.md' }, { type: 'blob', path: 'skills/pdf/SKILL.md', size: 10 }, { type: 'blob', path: 'skills/pdf/ref.md' },
    { type: 'blob', path: 'skills/docx/SKILL.md' }, { type: 'blob', path: 'other/SKILL.md' }, { type: 'tree', path: 'skills' } ] };
  assert.equal(findSkills({ tree, path: '', kind: 'repo' }).length, 3);
  assert.deepEqual(findSkills({ tree, path: 'skills', kind: 'tree' }).map(s => s.dir), ['skills/docx', 'skills/pdf']);
  assert.equal(findSkills({ tree, path: 'skills/pdf', kind: 'tree' }).length, 1);
  assert.equal(findSkills({ tree, path: 'skills/pdf/SKILL.md', kind: 'blob' })[0].dir, 'skills/pdf');
  assert.equal(findSkills({ tree: { tree: [{ type: 'blob', path: 'a.js' }] }, path: '', kind: 'repo' }).length, 0);
});
await t('relative paths', () => {
  assert.equal(resolveRelative('skills/pdf', 'reference/forms.md'), 'skills/pdf/reference/forms.md');
  assert.equal(resolveRelative('skills/pdf', './a/../b.md'), 'skills/pdf/b.md');
  assert.equal(resolveRelative('skills/pdf', '../docx/SKILL.md'), 'skills/docx/SKILL.md');
});
function res(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
}
await t('github errors: rate limit, 404, branch fallback', async () => {
  const rl = makeGitHub({ fetchImpl: async () => res(403, { message: 'API rate limit exceeded for 1.2.3.4' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1999999999' }) });
  await assert.rejects(rl.resolve(parseGitHubUrl('a/b')), e => e.kind === 'rate_limit' && e.reset === 1999999999);
  const nf = makeGitHub({ fetchImpl: async () => res(404, { message: 'Not Found' }) });
  await assert.rejects(nf.resolve(parseGitHubUrl('a/b')), e => e.kind === 'repo_missing');
  const calls = [];
  const br = makeGitHub({ fetchImpl: async u => { calls.push(u);
    if (u.endsWith('/repos/a/b')) return res(200, { default_branch: 'main' });
    if (u.includes('/git/trees/feature%2Fx')) return res(200, { tree: [{ type: 'blob', path: 'sk/SKILL.md' }] });
    return res(404, { message: 'Not Found' }); } });
  const r = await br.resolve(parseGitHubUrl('https://github.com/a/b/tree/feature/x/sk'));
  assert.equal(r.ref, 'feature/x'); assert.equal(r.path, 'sk');
});
await t('build requests per provider', () => {
  const base = { key: 'K', system: 'SYS', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'q' }] };
  const or = buildRequest({ ...base, provider: 'openrouter', model: 'openrouter/free', origin: 'https://skill-chat.sites.tab.bot' });
  assert.equal(or.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(or.init.headers.Authorization, 'Bearer K'); assert.equal(or.init.headers['HTTP-Referer'], 'https://skill-chat.sites.tab.bot'); assert.equal(or.init.headers['X-Title'], 'Skill Chat');
  const ob = JSON.parse(or.init.body); assert.equal(ob.stream, true); assert.equal(ob.messages[0].role, 'system'); assert.equal(ob.messages.length, 4);
  const gm = buildRequest({ ...base, provider: 'gemini', model: 'gemini-2.5-flash' });
  assert.match(gm.url, /models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/); assert.equal(gm.init.headers['x-goog-api-key'], 'K');
  const gb = JSON.parse(gm.init.body); assert.equal(gb.systemInstruction.parts[0].text, 'SYS'); assert.equal(gb.contents[1].role, 'model');
  const an = buildRequest({ ...base, provider: 'anthropic', model: 'claude-x' });
  assert.equal(an.init.headers['anthropic-dangerous-direct-browser-access'], 'true'); assert.equal(JSON.parse(an.init.body).system, 'SYS');
  assert.throws(() => buildRequest({ ...base, provider: 'custom', base: 'http://evil.com/v1', model: 'm' }), /https/);
  assert.throws(() => buildRequest({ ...base, key: '', provider: 'openrouter' }), /API key/);
  assert.ok(!JSON.stringify(buildRequest({ ...base, provider: 'groq' })).includes('HTTP-Referer'));
});
await t('sse parser + events', () => {
  const got = []; const p = sseParser(d => got.push(d));
  p.push('data: {"a":1}\n\n: comment\ndata: {"b"'); p.push(':2}\r\n\r\ndata: [DONE]\n\n'); p.end();
  assert.deepEqual(got, ['{"a":1}', '{"b":2}', '[DONE]']);
  assert.equal(readEvent('openai', { choices: [{ delta: { content: 'x' } }] }).text, 'x');
  assert.equal(readEvent('gemini', { candidates: [{ content: { parts: [{ text: 'g' }] } }] }).text, 'g');
  assert.equal(readEvent('anthropic', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'c' } }).text, 'c');
});
await t('friendly errors', () => {
  assert.equal(classifyError(401, '{"error":{"message":"No auth credentials found"}}', 'OpenRouter').code, 'auth');
  assert.match(classifyError(401, '', 'OpenRouter').message, /key is not working\. Update it in Settings/);
  assert.equal(classifyError(400, '[{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}]', 'Google Gemini').code, 'auth');
  assert.equal(classifyError(402, '{"error":{"message":"Insufficient credits"}}', 'OpenRouter').code, 'credits');
  const r = classifyError(429, '{"error":{"message":"Rate limit exceeded: free-models-per-min"}}', 'OpenRouter', 'openrouter/free');
  assert.equal(r.code, 'rate'); assert.equal(r.message, 'Free model is busy. Try again in a minute or pick another model.');
  assert.equal(classifyError(0, { error: { code: 429, message: 'Provider returned error' } }, 'OpenRouter').code, 'rate');
});
function sseRes(chunks) {
  const enc = new TextEncoder(); let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { done: true } }) } };
}
await t('stream + fallback with mocked fetch', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    if (url.includes('openrouter')) return res(429, { error: { message: 'Rate limit exceeded: free-models-per-day' } });
    if (url.includes('generativelanguage')) return sseRes(['data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n', 'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n']);
    throw new Error('unexpected ' + url);
  };
  const notes = []; let streamed = '';
  const out = await chatWithFallback([
    { provider: 'openrouter', key: 'a', model: 'openrouter/free', label: 'OpenRouter' },
    { provider: 'gemini', key: 'b', model: 'gemini-2.5-flash', label: 'Google Gemini' }],
    { system: 'S', messages: [{ role: 'user', content: 'hi' }] },
    { fetchImpl, onText: (d, full) => { streamed = full; }, onSwitch: (next, cur, err) => notes.push(`${next.label} ${err.code}`) });
  assert.equal(out.text, 'Hello'); assert.equal(out.used.provider, 'gemini'); assert.equal(streamed, 'Hello');
  assert.deepEqual(notes, ['Google Gemini rate']); assert.equal(seen.length, 2);
  // single provider, error surfaces with friendly message
  await assert.rejects(chatWithFallback([{ provider: 'openrouter', key: 'bad', model: 'openrouter/free', label: 'OpenRouter' }], { system: 'S', messages: [{ role: 'user', content: 'x' }] },
    { fetchImpl: async () => res(401, { error: { message: 'User not found.' } }) }), e => e.code === 'auth' && /Update it in Settings/.test(e.message));
  // mid-stream error from OpenRouter
  await assert.rejects(streamChat({ provider: 'openrouter', key: 'k', model: 'm:free', system: 's', messages: [{ role: 'user', content: 'x' }] },
    { fetchImpl: async () => sseRes(['data: {"error":{"code":429,"message":"Rate limit"}}\n\n']) }), e => e.code === 'rate');
  await assert.rejects(chatWithFallback([], { system: 's', messages: [] }), e => e.code === 'nokey');
});
await t('fallback across many slots, same provider twice', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { const b = JSON.parse(init.body); seen.push(b.model);
    if (b.model === 'm3:free') return sseRes(['data: {"choices":[{"delta":{"content":"ok3"}}]}\n\n']);
    return res(b.model === 'm1:free' ? 429 : 402, { error: { message: 'nope' } }); };
  const out = await chatWithFallback(['m1:free', 'm2', 'm3:free'].map(m => ({ provider: 'openrouter', key: 'k', model: m, label: 'OpenRouter ' + m })),
    { system: 's', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl });
  assert.equal(out.text, 'ok3'); assert.deepEqual(seen, ['m1:free', 'm2', 'm3:free']);
});
console.log(`\n${n} unit tests passed`);
