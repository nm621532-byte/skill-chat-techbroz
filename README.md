# Skill Chat 🧠💬

**GitHub ka link daalo → skill chuno → AI se chat karo.**
Paste a GitHub link, pick an AI skill (`SKILL.md`), and chat with an AI that follows it, using **your own** API key.

🌐 **Live app:** https://skill-chat.sites.tab.bot/
📱 **Android APK:** [Releases](https://github.com/nm621532-byte/skill-chat-techbroz/releases) (or https://skill-chat.sites.tab.bot/downloads/SkillChat-v1.0.apk)
🔗 **GitHub Pages:** https://nm621532-byte.github.io/skill-chat-techbroz/

Made by **Tech Bro Z**. YouTube [@techbrozdeveloper](https://www.youtube.com/@techbrozdeveloper), Instagram [@tech_bro_z_1](https://www.instagram.com/tech_bro_z_1/)

---

## Ye kya hai? (What is it?)

AI "skills" (jaise [anthropics/skills](https://github.com/anthropics/skills)) GitHub pe folders hote hain jinke andar ek `SKILL.md` file hoti hai. Usme AI ke liye instructions likhe hote hain: PDF kaise banana hai, design kaise karna hai, code review kaise karna hai, waghera.

Skill Chat:
1. Kisi bhi GitHub HTTPS link se (repo, folder ya single `SKILL.md`) saari skills dhoondh leta hai.
2. Har skill ka naam + description card mein dikhata hai (search ke saath).
3. Skill kholo: `SKILL.md` padho, aur uske saath ki files (references, scripts) tick karke AI ko de do.
4. **Use this skill** dabao: skill AI ka system prompt ban jaati hai aur aap usse chat karte ho. Streaming replies, code blocks with Copy, Stop button, chat history (phone pe hi save).

English: Skill Chat reads any public GitHub repo, folder or `SKILL.md` link, lists every skill it finds, renders the skill safely, and turns it into the system prompt of a chat with the AI provider you choose.

## Kaise use karein (How to use)

1. App kholo → GitHub link paste karo (jaise `https://github.com/anthropics/skills`) → **Find skills**.
2. Koi skill chuno → **Use this skill**.
3. Pehli baar app aapki **OpenRouter key** maangega. Ek baar daalo, phone pe save ho jaayegi, dobara nahi poochega.
4. Chat karo! ✨

## Free API key kaise lein (Get a free key)

### OpenRouter (default, recommended)
1. https://openrouter.ai pe jao, Google se sign in karo.
2. **Keys** → **Create Key** dabao.
3. Key copy karo (`sk-or-...` se shuru hoti hai) aur app mein paste karo.
4. Default model `openrouter/free` hai, matlab free models. Settings → **Browse models** mein "Free" wale models upar dikhte hain.

### Google Gemini (free backup)
1. https://aistudio.google.com/apikey pe jao, Google se sign in karo.
2. **Create API key** dabao, copy karo (`AIza...`).
3. App → Settings → Google Gemini → paste → **Save key**.

### Groq (free, bahut fast)
1. https://console.groq.com/keys → **Create API Key** → copy (`gsk_...`).
2. App → Settings → Groq → paste.

OpenAI, Anthropic (Claude) aur koi bhi OpenAI-compatible API (apna base URL) bhi chalti hai.

## Limit khatam? Auto switch! (Multi-key auto-fallback)

Har free plan ki daily limit hoti hai. Isliye Settings mein **10 tak keys** save kar sakte ho (ek hi provider ki alag models ke saath bhi).
Default order: **OpenRouter → Gemini → Groq**. Agar pehli key ki limit khatam ho jaaye, key expire ho jaaye ya credits na ho, app **khud agli key pe shift** ho jaata hai aur chhota sa note dikhata hai: *"Switched to Google Gemini: Free model is busy..."*. Order arrows se badal sakte ho.

English: save up to 10 keys (several per provider, with different models). On a rate limit, quota, invalid key or no-credit error, Skill Chat retries the same message on the next saved key automatically.

## Privacy 🔒

- **Koi server nahi.** Ye pure static app hai. Aapki API keys, chats, saved skills sab sirf aapke phone/browser ke `localStorage` mein rehte hain.
- Key sirf usi AI provider ko jaati hai jise aap use karte ho (OpenRouter / Google / Groq ...). Hum kuch nahi dekhte.
- Settings → **Delete key** ya **Delete all data on this device** se sab mita sakte ho.
- ⚠️ Apni API key kabhi code ya GitHub mein mat daalna. Public repo mein daali key chori ho jaati hai aur OpenRouter use auto-disable kar deta hai.

## Security

- `SKILL.md` kisi ka bhi likha ho sakta hai, isliye markdown ko **DOMPurify** se sanitize kiya jaata hai: no `<script>`, no event handlers, no `javascript:` links, no iframes/forms/styles.
- Strict **Content-Security-Policy** (`script-src 'self'`, no `eval`, no inline scripts).
- Front matter (name/description) hamesha plain text ki tarah dikhaya jaata hai.
- Koi per-user server data nahi hai, isliye IDOR jaisi problem possible hi nahi. URL mein chat id badalne se sirf naya khaali chat khulta hai.
- GitHub ka free limit 60 requests/hour hai. Limit khatam ho to app saaf message deta hai aur optional GitHub token (sirf device pe save) maangta hai.

## Install

- **Android APK:** Releases se `SkillChat-v1.0.apk` download karo → install (unknown sources allow karna padega).
- **PWA:** Chrome mein live app kholo → menu → **Install app**. Offline bhi khulta hai (skills/chat ke liye internet chahiye).

## Developers

```
index.html, app.css, app.js        app shell + UI
lib/github.js                       GitHub URL parsing, API + raw access, skill discovery
lib/frontmatter.js                  SKILL.md YAML front matter reader
lib/providers.js                    OpenRouter / Gemini / OpenAI / Groq / Anthropic streaming + fallback
lib/md.js                           sanitized markdown rendering + copy buttons
lib/store.js                        localStorage (device only)
sw.js, manifest.webmanifest         PWA
vendor/                             marked 18.1.3, DOMPurify 3.4.17 (MIT / Apache-2.0)
test/unit.mjs                       unit tests (node test/unit.mjs)
test/e2e.py                         Playwright smoke test (python3 test/e2e.py http://127.0.0.1:8080/)
android/                            Capacitor config used to build the APK
```

Run locally: `python3 -m http.server 8080` → http://127.0.0.1:8080/
Smoke test before every publish: `node test/unit.mjs && python3 test/e2e.py http://127.0.0.1:8080/`

## License

MIT © 2026 Tech Bro Z
