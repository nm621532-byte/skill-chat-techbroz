// AI providers called straight from the browser with the user's own key.
export const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'openrouter/free',
    keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-...', modelsPublic: true,
    note: 'One key, hundreds of models. Models marked Free cost nothing.'
  },
  gemini: {
    label: 'Google Gemini', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza...', note: 'Free key from Google AI Studio.'
  },
  openai: {
    label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-...', note: 'Paid key from platform.openai.com.'
  },
  groq: {
    label: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_...', note: 'Very fast, has a free tier.'
  },
  anthropic: {
    label: 'Anthropic (Claude)', kind: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5',
    keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-...', note: 'Paid key. Called directly from your browser.'
  },
  custom: {
    label: 'Other (OpenAI-compatible)', kind: 'openai', base: '', model: '',
    keyUrl: '', keyHint: 'your key', note: 'Any endpoint that speaks the OpenAI chat/completions format.', customBase: true
  }
};

export function trimBase(b) { return String(b || '').trim().replace(/\/+$/, ''); }

// Build the HTTP request for one chat turn. Pure: easy to test.
export function buildRequest({ provider, base, model, key, system, messages, origin = '', title = 'Skill Chat', maxTokens = 8192 }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Unknown provider');
  base = trimBase(base || p.base);
  if (!base) throw new Error('Set the API base URL in Settings.');
  if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(base)) throw new Error('The API base URL must start with https://');
  model = String(model || p.model || '').trim();
  if (!model) throw new Error('Pick a model in Settings.');
  if (!key) throw new Error('Add your API key in Settings.');
  const msgs = messages.filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'));
  if (p.kind === 'gemini') {
    return {
      url: `${base}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
        })
      }
    };
  }
  if (p.kind === 'anthropic') {
    return {
      url: `${base}/messages`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, stream: true, messages: msgs.map(m => ({ role: m.role, content: m.content })) })
      }
    };
  }
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
  if (provider === 'openrouter' || /openrouter\.ai/i.test(base)) {
    if (origin) headers['HTTP-Referer'] = origin;
    headers['X-Title'] = title;
  }
  return {
    url: `${base}/chat/completions`,
    init: {
      method: 'POST', headers,
      body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: m.content }))] })
    }
  };
}

// Pull text out of one parsed SSE JSON event. Returns { text, error, done }.
export function readEvent(kind, obj) {
  if (!obj || typeof obj !== 'object') return {};
  if (obj.error) return { error: typeof obj.error === 'string' ? obj.error : (obj.error.message || JSON.stringify(obj.error)) };
  if (kind === 'gemini') {
    const c = obj.candidates && obj.candidates[0];
    const parts = (c && c.content && c.content.parts) || [];
    const text = parts.filter(x => !x.thought).map(x => x.text || '').join('');
    let error;
    if (!text && obj.promptFeedback && obj.promptFeedback.blockReason) error = 'Gemini blocked this prompt (' + obj.promptFeedback.blockReason + ').';
    return { text, error };
  }
  if (kind === 'anthropic') {
    if (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'text_delta') return { text: obj.delta.text };
    if (obj.type === 'message_stop') return { done: true };
    return {};
  }
  const ch = obj.choices && obj.choices[0];
  if (!ch) return {};
  const d = ch.delta || ch.message || {};
  return { text: typeof d.content === 'string' ? d.content : '' };
}

// Incremental Server-Sent-Events parser.
export function sseParser(onData) {
  let buf = '';
  let dataLines = [];
  const flush = () => {
    if (dataLines.length) { const d = dataLines.join('\n'); dataLines = []; onData(d); }
  };
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(buf[i] === '\r' ? i + 2 : i + 1);
        if (line === '') { flush(); continue; }
        if (line[0] === ':') continue;
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    },
    end() { if (buf.startsWith('data:')) dataLines.push(buf.slice(5).replace(/^ /, '')); buf = ''; flush(); }
  };
}

export class ChatError extends Error {
  constructor(message, code, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// Turn a provider error into a plain message + a code used for auto-fallback.
export function classifyError(status, bodyText, providerLabel, model = '') {
  let msg = '', errCode = '';
  try {
    const j = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText;
    const e = Array.isArray(j) ? j[0] && j[0].error : (j.error || j);
    msg = (e && (e.message || e.status)) || j.message || '';
    errCode = String((e && (e.code || e.status || e.type)) || '');
    if (!status && e && Number(e.code)) status = Number(e.code);
  } catch { msg = String(bodyText || '').slice(0, 300); }
  const free = /:free$|^openrouter\/free$/.test(model);
  const lower = (msg + ' ' + errCode).toLowerCase();
  let code = 'other', text;
  if (status === 401 || status === 403 || /api key not valid|invalid api key|invalid x-api-key|incorrect api key|authentication|unauthori[sz]ed|no auth credentials|user not found/.test(lower)) {
    code = 'auth'; text = `${providerLabel} key is not working. Update it in Settings.`;
  } else if (status === 402 || /insufficient|credit|billing|payment/.test(lower)) {
    code = 'credits'; text = `${providerLabel} has no credits for this model. Pick a free model in Settings, or add credits.`;
  } else if (status === 429 || /rate limit|rate_limit|resource_exhausted|quota|too many requests|overloaded/.test(lower)) {
    code = 'rate'; text = free ? 'Free model is busy. Try again in a minute or pick another model.' : `${providerLabel} limit reached. Try again in a minute or pick another model.`;
  } else if (status === 404 || /model.*(not found|does not exist|not a valid model)|no endpoints found/.test(lower)) {
    code = 'model'; text = `${providerLabel} does not know the model "${model}". Pick another model in Settings.`;
  } else if (status >= 500) {
    code = 'server'; text = `${providerLabel} is having trouble right now (${status}). Try again shortly.`;
  } else {
    text = `${providerLabel} answered ${status || 'with an error'}${msg ? ': ' + String(msg).slice(0, 240) : ''}.`;
  }
  return { message: text, code, detail: String(msg).slice(0, 400), status };
}

// Stream one reply. onText(delta) is called as text arrives. Returns full text.
export async function streamChat(opts, { onText, signal, fetchImpl } = {}) {
  const p = PROVIDERS[opts.provider];
  const { url, init } = buildRequest(opts);
  const f = fetchImpl || globalThis.fetch;
  let res;
  try { res = await f(url, { ...init, signal }); }
  catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ChatError(`Could not reach ${p.label}. Check your internet, or the API base URL in Settings.`, 'network');
  }
  if (!res.ok) {
    let t = ''; try { t = await res.text(); } catch {}
    const c = classifyError(res.status, t, p.label, opts.model);
    throw new ChatError(c.message, c.code, { status: res.status, detail: c.detail });
  }
  let full = '', streamErr = null;
  const parser = sseParser(data => {
    if (data === '[DONE]') return;
    let obj; try { obj = JSON.parse(data); } catch { return; }
    const ev = readEvent(p.kind, obj);
    if (ev.error) streamErr = obj.error ? obj : ev.error;
    if (ev.text) { full += ev.text; onText && onText(ev.text, full); }
  });
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(dec.decode(value, { stream: true }));
    }
  } else {
    parser.push(await res.text());
  }
  parser.end();
  if (streamErr) {
    const c = classifyError(0, typeof streamErr === 'string' ? { message: streamErr } : streamErr, p.label, opts.model);
    if (!full) throw new ChatError(c.message, c.code, { detail: c.detail });
    throw new ChatError(c.message, c.code, { detail: c.detail, partial: full });
  }
  if (!full) throw new ChatError(`${p.label} sent an empty reply. Try again or pick another model.`, 'empty');
  return full;
}

// List models for the model picker.
export async function listModels({ provider, base, key, fetchImpl }) {
  const p = PROVIDERS[provider];
  const f = fetchImpl || globalThis.fetch;
  base = trimBase(base || p.base);
  if (p.kind === 'gemini') {
    if (!key) throw new Error('Add your Gemini key first, then load models.');
    const r = await f(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new Error(classifyError(r.status, await r.text(), p.label).message);
    const j = await r.json();
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name, ctx: m.inputTokenLimit || 0, free: false }));
  }
  if (p.kind === 'anthropic') {
    if (!key) throw new Error('Add your Anthropic key first, then load models.');
    const r = await f(`${base}/models?limit=100`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!r.ok) throw new Error(classifyError(r.status, await r.text(), p.label).message);
    const j = await r.json();
    return (j.data || []).map(m => ({ id: m.id, name: m.display_name || m.id, ctx: 0, free: false }));
  }
  const headers = {};
  if (key) headers.Authorization = 'Bearer ' + key;
  if (!key && !p.modelsPublic) throw new Error('Add your API key first, then load models.');
  const r = await f(`${base}/models`, { headers });
  if (!r.ok) throw new Error(classifyError(r.status, await r.text(), p.label).message);
  const j = await r.json();
  const list = (j.data || []).filter(m => {
    const out = m.architecture && m.architecture.output_modalities;
    if (/lyria|content-safety|guard|embed|whisper|tts|dall-e|image-gen/i.test(m.id)) return false;
    return !out || out.includes('text');
  }).map(m => {
    const pr = m.pricing || {};
    const free = /:free$/.test(m.id) || m.id === 'openrouter/free' || (pr.prompt === '0' && pr.completion === '0');
    return { id: m.id, name: m.name || m.id, ctx: m.context_length || 0, free };
  });
  list.sort((a, b) => (b.free - a.free) || (a.id === 'openrouter/free' ? -1 : b.id === 'openrouter/free' ? 1 : 0) || a.name.localeCompare(b.name));
  return list;
}

// Try each provider that has a key, in the user's order. Falls back to the
// next one when the current one fails before any text was shown.
export async function chatWithFallback(chain, base, { onText, onSwitch, signal, fetchImpl } = {}) {
  if (!chain.length) throw new ChatError('Add an API key in Settings to start chatting.', 'nokey');
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i];
    try {
      const text = await streamChat({ ...base, ...c }, { onText: (d, full) => onText && onText(d, full, c), signal, fetchImpl });
      return { text, used: c, index: i };
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (e && e.partial) { e.used = c; throw e; }
      lastErr = e; e.used = c;
      if (i < chain.length - 1) { onSwitch && onSwitch(chain[i + 1], c, e); continue; }
      throw e;
    }
  }
  throw lastErr;
}
