// Skill library for Auto mode: an index (name + description + file list) of every
// SKILL.md in the user's library repos, cached on this device.
import { parseGitHubUrl, findSkills, filesInDir } from './github.js';
import { splitFrontMatter } from './frontmatter.js';

export const DEFAULT_REPOS = ['https://github.com/anthropics/skills'];
export const MAX_SKILLS_PER_REPO = 300;
const TEXT = /\.(md|markdown|txt|py|js|mjs|ts|json|ya?ml|html?|css|xml|csv|sql|sh)$/i;

export function prettyName(path) {
  const d = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return (d.split('/').pop() || path.replace(/\.md$/i, '')).replace(/[-_]+/g, ' ');
}

export async function indexRepo(gh, url, { onProgress, signal } = {}) {
  const parsed = parseGitHubUrl(url);
  const res = await gh.resolve(parsed);
  const found = findSkills(res).slice(0, MAX_SKILLS_PER_REPO);
  const skills = new Array(found.length);
  let i = 0, done = 0;
  const work = async () => {
    while (i < found.length) {
      if (signal && signal.aborted) return;
      const k = i++, f = found[k];
      let name = prettyName(f.path), description = '';
      try {
        const txt = await gh.raw(res.owner, res.repo, res.ref, f.path, { maxBytes: 40000 });
        const { data } = splitFrontMatter(txt);
        name = String(data.name || '').slice(0, 80) || name;
        description = String(data.description || '').replace(/\s+/g, ' ').slice(0, 320);
      } catch {}
      const files = filesInDir(res, f.dir).filter(x => x.path !== f.path && TEXT.test(x.path) && !/^LICEN[CS]E/i.test(x.rel.split('/').pop()))
        .slice(0, 40).map(x => [x.rel, x.size]);
      skills[k] = { id: `${res.owner}/${res.repo}@${res.ref}:${f.path}`, owner: res.owner, repo: res.repo, ref: res.ref, path: f.path, dir: f.dir, name, description, files };
      done++; onProgress && onProgress(done, found.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, work));
  return { url, label: `${res.owner}/${res.repo}${res.path ? '/' + res.path : ''}`, owner: res.owner, repo: res.repo, ref: res.ref, at: Date.now(), skills: skills.filter(Boolean) };
}

// Files a skill mentions in its SKILL.md (relative names), smallest first.
export function referencedFiles(skillText, files) {
  return (files || []).filter(([rel]) => skillText.includes(rel) || skillText.includes(rel.split('/').pop()))
    .sort((a, b) => a[1] - b[1]);
}
