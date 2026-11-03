// GitHub URL parsing + public API access (no server of ours involved).
export class GhError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export function parseGitHubUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new GhError('bad_url', 'Paste a GitHub link first.');
  s = s.replace(/[?#].*$/, '');
  // owner/repo shorthand
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !/\.(com|io|org)$/i.test(s.split('/')[0])) s = 'https://github.com/' + s;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new GhError('bad_url', 'That does not look like a link. Paste a github.com URL.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new GhError('bad_url', 'Only https GitHub links are supported.');
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  if (host === 'raw.githubusercontent.com') {
    if (segs.length < 4) throw new GhError('bad_url', 'This raw link is incomplete.');
    const [owner, repo, ...rest] = segs;
    check(owner, repo);
    return { owner, repo, kind: 'blob', refPath: rest };
  }
  if (host !== 'github.com') throw new GhError('bad_url', 'Only github.com links work here (for example https://github.com/anthropics/skills).');
  if (segs.length < 2) throw new GhError('bad_url', 'Add the repository to the link: github.com/owner/repo');
  let [owner, repo, mode, ...rest] = segs;
  repo = repo.replace(/\.git$/i, '');
  check(owner, repo);
  if (!mode) return { owner, repo, kind: 'repo', refPath: [] };
  if (mode === 'tree' || mode === 'blob') {
    if (!rest.length) return { owner, repo, kind: 'repo', refPath: [] };
    return { owner, repo, kind: mode, refPath: rest };
  }
  // other pages (issues, pulls, ...) -> just the repo
  return { owner, repo, kind: 'repo', refPath: [] };
}

function check(owner, repo) {
  if (!NAME.test(owner) || !NAME.test(repo) || owner.startsWith('.') ) {
    throw new GhError('bad_url', 'The owner or repository name in this link is not valid.');
  }
}

export function rawUrl(owner, repo, ref, path) {
  const p = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref).replace(/%2F/g, '/')}/${p}`;
}
export function blobUrl(owner, repo, ref, path, kind = 'blob') {
  const p = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${kind}/${encodeURIComponent(ref).replace(/%2F/g, '/')}/${p}`;
}

export function makeGitHub({ fetchImpl, getToken, cache }) {
  const f = (...a) => (fetchImpl || globalThis.fetch)(...a);

  async function api(path) {
    const key = 'api:' + path;
    const hit = cache && cache.get(key);
    if (hit) return hit;
    const headers = { Accept: 'application/vnd.github+json' };
    const tok = getToken && getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    let res;
    try { res = await f('https://api.github.com' + path, { headers }); }
    catch (e) { throw new GhError('network', 'Could not reach GitHub. Check your internet connection and try again.'); }
    if (res.ok) {
      const j = await res.json();
      cache && cache.set(key, j);
      return j;
    }
    let body = {};
    try { body = await res.json(); } catch {}
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0);
    const msg = String(body.message || '');
    if ((res.status === 403 || res.status === 429) && (remaining === '0' || /rate limit/i.test(msg))) {
      throw new GhError('rate_limit', 'GitHub limits free lookups to 60 per hour per network, and that limit is used up.', { reset, hasToken: !!tok });
    }
    if (res.status === 401) throw new GhError('bad_token', 'GitHub rejected your token. Fix or remove it in Settings.');
    if (res.status === 404) throw new GhError('not_found', 'Not found on GitHub.', { status: 404 });
    if (res.status === 422 || res.status === 409) throw new GhError('not_found', msg || 'GitHub could not read this.', { status: res.status });
    throw new GhError('http', `GitHub answered ${res.status}${msg ? ': ' + msg : ''}.`, { status: res.status });
  }

  async function raw(owner, repo, ref, path, { maxBytes = 600000 } = {}) {
    const key = `raw:${owner}/${repo}@${ref}:${path}`;
    const hit = cache && cache.get(key);
    if (hit != null) return hit;
    let res;
    try { res = await f(rawUrl(owner, repo, ref, path)); }
    catch { throw new GhError('network', 'Could not download the file from GitHub.'); }
    if (res.status === 404) throw new GhError('not_found', 'File not found: ' + path, { status: 404 });
    if (!res.ok) throw new GhError('http', `Downloading ${path} failed (${res.status}).`);
    let text = await res.text();
    if (text.length > maxBytes) text = text.slice(0, maxBytes) + '\n\n[... file cut at ' + maxBytes + ' characters ...]';
    cache && cache.set(key, text);
    return text;
  }

  async function repoInfo(owner, repo) {
    try { return await api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`); }
    catch (e) {
      if (e.kind === 'not_found') throw new GhError('repo_missing', `Repository ${owner}/${repo} was not found. It may be private, renamed, or the link has a typo.`);
      throw e;
    }
  }

  async function tree(owner, repo, ref) {
    return api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  }

  // Resolve a parsed URL to { owner, repo, ref, path, kind, info, tree }
  async function resolve(parsed) {
    const { owner, repo } = parsed;
    const info = await repoInfo(owner, repo);
    let ref = info.default_branch || 'main', path = '', t = null;
    if (parsed.kind === 'repo') {
      t = await tree(owner, repo, ref);
    } else {
      const segs = parsed.refPath;
      let lastErr = null;
      for (let n = 1; n <= Math.min(segs.length, 4); n++) {
        const tryRef = segs.slice(0, n).join('/');
        try { t = await tree(owner, repo, tryRef); ref = tryRef; path = segs.slice(n).join('/'); break; }
        catch (e) { if (e.kind !== 'not_found') throw e; lastErr = e; }
      }
      if (!t) throw new GhError('ref_missing', `Branch or folder "${segs.join('/')}" was not found in ${owner}/${repo}.`);
    }
    return { owner, repo, ref, path, kind: parsed.kind, info, tree: t };
  }

  return { api, raw, repoInfo, tree, resolve };
}

// Find skills (folders holding SKILL.md) inside a resolved tree.
export function findSkills(resolved) {
  const items = (resolved.tree && resolved.tree.tree) || [];
  const base = resolved.path.replace(/\/+$/, '');
  if (resolved.kind === 'blob') {
    const hit = items.find(x => x.type === 'blob' && x.path === base);
    if (!hit) return [];
    return [{ path: base, dir: dirname(base), size: hit.size || 0 }];
  }
  return items
    .filter(x => x.type === 'blob' && /(^|\/)SKILL\.md$/i.test(x.path))
    .filter(x => !base || x.path === base + '/' + x.path.split('/').pop() || x.path.startsWith(base + '/'))
    .map(x => ({ path: x.path, dir: dirname(x.path), size: x.size || 0 }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function filesInDir(resolved, dir) {
  const items = (resolved.tree && resolved.tree.tree) || [];
  const pre = dir ? dir + '/' : '';
  return items.filter(x => x.type === 'blob' && x.path.startsWith(pre)).map(x => ({ path: x.path, rel: x.path.slice(pre.length), size: x.size || 0 }));
}

export function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }

export function resolveRelative(dir, href) {
  const parts = (dir ? dir.split('/') : []);
  for (const seg of href.replace(/^\.\//, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}
