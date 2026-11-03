// Everything is stored on this device only (localStorage).
const P = 'sc.';
function get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function set(k, v) {
  try { localStorage.setItem(P + k, JSON.stringify(v)); return true; }
  catch { return false; }
}
function del(k) { try { localStorage.removeItem(P + k); } catch {} }

export const store = {
  get, set, del,
  settings() {
    return Object.assign({ provider: 'openrouter', models: {}, bases: {}, theme: 'system' }, get('settings', {}));
  },
  saveSettings(s) { set('settings', s); },
  // Key slots: an ordered list of { id, provider, key, model, base }. Max 10.
  slots() {
    let s = get('slots', null);
    if (!Array.isArray(s)) {
      const old = get('keys', {});
      s = ['openrouter', 'gemini', 'groq'].map(p => ({ id: p + '1', provider: p, key: old[p] || '', model: '', base: '' }));
      for (const p of Object.keys(old)) if (!s.some(x => x.provider === p)) s.push({ id: p + '1', provider: p, key: old[p], model: '', base: '' });
    }
    return s.filter(x => x && x.provider).slice(0, 10);
  },
  setSlots(arr) { set('slots', arr.slice(0, 10)); del('keys'); },
  ghToken() { return get('ghtoken', ''); },
  setGhToken(t) { if (t) set('ghtoken', t); else del('ghtoken'); },
  favs() { return get('favs', []); },
  isFav(id) { return get('favs', []).some(f => f.id === id); },
  toggleFav(skill) {
    let f = get('favs', []);
    if (f.some(x => x.id === skill.id)) f = f.filter(x => x.id !== skill.id);
    else f.unshift({ id: skill.id, owner: skill.owner, repo: skill.repo, ref: skill.ref, path: skill.path, name: skill.name, description: skill.description, added: Date.now() });
    set('favs', f); return f.some(x => x.id === skill.id);
  },
  recents() { return get('recents', []); },
  addRecent(url, label) {
    let r = get('recents', []).filter(x => x.url !== url);
    r.unshift({ url, label, at: Date.now() });
    set('recents', r.slice(0, 8));
  },
  clearRecents() { del('recents'); },
  chats(skillId) { return get('chats:' + skillId, []); },
  saveChat(skillId, chat) {
    let list = get('chats:' + skillId, []).filter(c => c.id !== chat.id);
    list.unshift(chat);
    list = list.slice(0, 30);
    while (!set('chats:' + skillId, list) && list.length > 1) list.pop();
    const idx = get('chatindex', {});
    idx[skillId] = { n: list.length, at: Date.now() };
    set('chatindex', idx);
  },
  deleteChat(skillId, chatId) {
    const list = get('chats:' + skillId, []).filter(c => c.id !== chatId);
    set('chats:' + skillId, list);
  },
  ticks(skillId) { return get('ticks:' + skillId, []); },
  setTicks(skillId, arr) { set('ticks:' + skillId, arr); },
  wipeAll() {
    const ks = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(P)) ks.push(k); }
    ks.forEach(k => localStorage.removeItem(k));
    try { sessionStorage.clear(); } catch {}
  }
};

// Session cache for GitHub answers (saves the 60/hour limit).
export const ghCache = {
  get(k) { try { const v = sessionStorage.getItem('gh:' + k); if (!v) return null; const o = JSON.parse(v); if (Date.now() - o.t > 30 * 60 * 1000) return null; return o.v; } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem('gh:' + k, JSON.stringify({ t: Date.now(), v })); } catch { /* full: ignore */ } }
};
