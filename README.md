# Skill Chat 🧠💬

**Command do → app khud sahi skill chunega → step-by-step kaam karke files dega.**
Type a job, Skill Chat picks the right AI skill (`SKILL.md`) from GitHub and does it step by step: websites, code, scripts and files. Or pick a skill yourself and chat with it. Always with **your own** API key.

🌐 **Live app:** https://skill-chat.sites.tab.bot/
📱 **Android APK:** [Releases](https://github.com/nm621532-byte/skill-chat-techbroz/releases) (or https://skill-chat.sites.tab.bot/downloads/SkillChat-v1.1.apk)
🔗 **GitHub Pages:** https://nm621532-byte.github.io/skill-chat-techbroz/

Made by **Tech Bro Z**. YouTube [@techbrozdeveloper](https://www.youtube.com/@techbrozdeveloper), Instagram [@tech_bro_z_1](https://www.instagram.com/tech_bro_z_1/)

---

## 🤖 Auto mode (v1.1): bas command do, kaam ho jaayega

App kholte hi pehli screen: **"What do you want done?"**. Jo kaam chahiye woh likho, jaise:
- `Make a one-page website for my chai cafe`
- `Write a 60-second YouTube Shorts script about 3 Python tips`
- `Write a PDF summary of the benefits of yoga`

Phir **Do it** dabao. App khud:
1. **Skill chunta hai:** aapki skill library (default: [anthropics/skills](https://github.com/anthropics/skills), aur jo repos aap add karo) ke har `SKILL.md` ka naam + description ek baar padh ke phone pe save karta hai. Command aane par ek chhoti AI call best 1-3 skills chunti hai. Upar **"Using skill: frontend-design"** chips dikhti hain. Chip tap karke skill badal sakte ho.
2. **Step-by-step kaam karta hai:** plan → step 1 → step 2 … jab tak AI `STATUS: DONE` na bole (ya step limit, default 8, Settings mein 1-15). Har step ka output agle step ko milta hai. **Stop** button kabhi bhi. Baad mein **Continue** bhi.
3. **Asli files deta hai:** jawab mein jo files hain (```` ```html index.html ````) unke **file cards** banti hain: **Preview** (website app ke andar hi chalti hai, ek locked sandbox mein), **Code**, **Download**, aur **Download all (.zip)**. Poora text **Copy** ya **.md** download.
4. **Changes maango:** kaam ke neeche "Ask for changes…" mein likho (jaise "heading green karo"), wahi job aage badhega.
5. Saare jobs **Recent jobs** mein phone pe save rehte hain.

⚠️ Sach baat: Skill Chat phone ke doosre apps (WhatsApp, Gallery, YouTube…) control nahi kar sakta. Ye text, code, websites aur files banata hai jo aap preview/copy/download kar sakte ho.

English: Auto mode is the home screen. Type a job; a first cheap AI call reads a compact index (name + description) of every skill in your library and picks the best 1-3 (or none = general assistant). Those `SKILL.md` files (+ small referenced files, size-capped) become the system prompt and the AI works in steps with a plain-text protocol (`STATUS: CONTINUE` / `STATUS: DONE`) that works on free models without tool calling. Files in the answer become cards with Preview (sandboxed iframe: `sandbox="allow-scripts"` without `allow-same-origin`, so the preview cannot read your keys or chats), Download and Download-all-as-zip (bundled zip writer, no CDN). Every AI call, including the skill-picking call, uses your key slots with auto-fallback.

**Skill library:** Settings → Auto mode → add any skills repo (or "Add to Auto library" on any repo in Explore), **Refresh library** to re-read.

## Explore + chat mode (v1.0)

AI "skills" (jaise [anthropics/skills](https://github.com/anthropics/skills)) GitHub pe folders hote hain jinke andar ek `SKILL.md` file hoti hai. Usme AI ke liye instructions likhe hote hain: PDF kaise banana hai, design kaise karna hai, code review kaise karna hai, waghera.

Skill Chat:
1. Kisi bhi GitHub HTTPS link se (repo, folder ya single `SKILL.md`) saari skills dhoondh leta hai.
2. Har skill ka naam + description card mein dikhata hai (search ke saath).
3. Skill kholo: `SKILL.md` padho, aur uske saath ki files (references, scripts) tick karke AI ko de do.
4. **Use this skill** dabao: skill AI ka system prompt ban jaati hai aur aap usse chat karte ho. Streaming replies, code blocks with Copy, Stop button, chat history (phone pe hi save).

English: Skill Chat reads any public GitHub repo, folder or `SKILL.md` link, lists every skill it finds, renders the skill safely, and turns it into the system prompt of a chat with the AI provider you choose.

## Kaise use karein (How to use)

**Auto:** App kholo → kaam likho → **Do it**.

**Ek skill ke saath chat:** **Explore** tab → GitHub link paste karo (jaise `https://github.com/anthropics/skills`) → **Find skills**.
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
- Auto mode ki website preview ek alag `preview.html` frame mein chalti hai (`sandbox` bina `allow-same-origin`): woh aapki keys, chats ya app page ko chhoo nahi sakti, top page ko navigate nahi kar sakti.
- AI ke jawab ka text bhi sanitize hota hai; file names safe banaye jaate hain (`../` hata ke).
- Koi per-user server data nahi hai, isliye IDOR jaisi problem possible hi nahi. URL mein chat id badalne se sirf naya khaali chat khulta hai.
- GitHub ka free limit 60 requests/hour hai. Limit khatam ho to app saaf message deta hai aur optional GitHub token (sirf device pe save) maangta hai.

## Install

- **Android APK:** Releases se `SkillChat-v1.1.apk` download karo (v1.0 ke upar seedha install ho jaata hai, data safe). App mein Download dabane par file phone ke **Documents/SkillChat/** folder mein save hoti hai → install (unknown sources allow karna padega).
- **PWA:** Chrome mein live app kholo → menu → **Install app**. Offline bhi khulta hai (skills/chat ke liye internet chahiye).

## Developers

```
index.html, app.css, app.js        app shell + UI
lib/github.js                       GitHub URL parsing, API + raw access, skill discovery
lib/frontmatter.js                  SKILL.md YAML front matter reader
lib/providers.js                    OpenRouter / Gemini / OpenAI / Groq / Anthropic streaming + fallback
lib/md.js                           sanitized markdown rendering + copy buttons
lib/store.js                        localStorage (device only)
lib/agent.js                        Auto mode: skill routing, step protocol, file extraction, preview builder
lib/library.js                      skill library index (name + description of every SKILL.md)
lib/zip.js                          tiny zip writer (store), no CDN
preview.html                        sandboxed preview frame (opaque origin)
sw.js, manifest.webmanifest         PWA
vendor/                             marked 18.1.3, DOMPurify 3.4.17 (MIT / Apache-2.0)
test/unit.mjs                       unit tests (node test/unit.mjs)
test/e2e.py                         Playwright smoke test (python3 test/e2e.py http://127.0.0.1:8080/)
test/unit_auto.mjs                  Auto mode unit tests
test/e2e_auto.py                    Auto mode Playwright test (REAL=0 for mocked AI only)
android/                            Capacitor config used to build the APK
```

Run locally: `python3 -m http.server 8080` → http://127.0.0.1:8080/
Smoke test before every publish: `node test/unit.mjs && node test/unit_auto.mjs && python3 test/e2e.py http://127.0.0.1:8080/ && REAL=0 python3 test/e2e_auto.py http://127.0.0.1:8080/`

## License

MIT © 2026 Tech Bro Z
