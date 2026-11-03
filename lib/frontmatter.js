// Minimal, safe YAML front-matter reader for SKILL.md files.
// Reads top-level scalar keys (plain, quoted, folded ">" and literal "|").
export function splitFrontMatter(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = src.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
  if (!m) return { data: {}, body: src, raw: '' };
  return { data: parseYamlTop(m[1]), body: src.slice(m[0].length), raw: m[1] };
}

function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, '');
}

export function parseYamlTop(yaml) {
  const out = {};
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const km = line.match(/^([A-Za-z0-9_][\w.-]*)\s*:(.*)$/);
    if (!km) continue;
    const key = km[1];
    let rest = km[2].trim();
    const block = rest.match(/^([>|])([+-]?)\s*(#.*)?$/);
    const collect = () => {
      const buf = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        buf.push(lines[++i]);
      }
      while (buf.length && buf[buf.length - 1].trim() === '') buf.pop();
      const ind = Math.min(...buf.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length), 99);
      return buf.map(l => l.slice(Math.min(ind, l.length)));
    };
    if (block) {
      const body = collect();
      out[key] = block[1] === '|' ? body.join('\n') : body.map(l => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
    } else if (rest === '') {
      const body = collect();
      // nested map / list: keep as raw text, but plain multi-line scalars are joined
      if (body.length && !body.some(l => /^\s*(-\s|[\w.-]+\s*:)/.test(l))) out[key] = body.map(l => l.trim()).join(' ');
      else out[key] = '';
    } else {
      let val = rest;
      // plain or quoted scalar continued on indented lines
      const startsQuote = val[0] === '"' || val[0] === "'";
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s+-\s/.test(lines[i + 1])) {
        if (startsQuote && val.length > 1 && val.trim().endsWith(val[0])) break;
        val += ' ' + lines[++i].trim();
      }
      out[key] = unquote(val);
    }
  }
  return out;
}
