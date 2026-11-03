# E2E + security smoke test for Skill Chat (webapp-testing skill: Playwright on a local server).
# Usage: python3 test/e2e.py [base_url]   (default http://127.0.0.1:8791/)
import sys, json, os, re, time
from playwright.sync_api import sync_playwright, expect
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8791/'
SHOTS = os.environ.get('SHOTS', os.path.join(os.path.dirname(__file__), '..', 'qa'))
REAL_CHAT = os.environ.get('REAL_CHAT', '1') == '1'
os.makedirs(SHOTS, exist_ok=True)
passed = []; failed = []
def check(name, cond, extra=''):
    (passed if cond else failed).append(name)
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + str(extra) if extra and not cond else ''), flush=True)

def sse(chunks):
    return ''.join('data: ' + json.dumps(c) + '\n\n' for c in chunks) + 'data: [DONE]\n\n'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-dev-shm-usage'])
    ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(('Uncaught ' + str(e), page.url)))
    page.on('console', lambda m: errors.append((m.text, page.url)) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('dialog', lambda d: d.accept())

    # 1. first launch: onboarding sheet
    page.goto(BASE); page.wait_for_selector('.sheet', timeout=8000)
    check('onboarding sheet on first launch', page.locator('.sheet h2').inner_text() == 'Welcome to Skill Chat')
    page.screenshot(path=f'{SHOTS}/01_onboarding.png')
    page.click('text=Skip for now')
    page.wait_for_timeout(300)
    check('onboarding closes and stays closed', page.locator('.sheet').count() == 0)
    page.screenshot(path=f'{SHOTS}/02_home.png', full_page=True)
    page.goto(BASE + '#/explore'); page.wait_for_selector('#gh-url')

    # 2. bad URL
    page.fill('#gh-url', 'https://gitlab.com/foo/bar'); page.click('text=Find skills')
    page.wait_for_selector('.errbox')
    check('bad url message', 'Only github.com links' in page.locator('.errbox').inner_text())

    # 3. real repo via example chip
    page.click('button.chip:has-text("anthropics/skills")')
    page.wait_for_selector('.skill', timeout=30000)
    n = page.locator('.skill').count()
    check('real repo lists skills', n >= 5, n)
    page.wait_for_function("() => !document.querySelector('.skill-desc.muted')", timeout=30000)
    check('front matter descriptions loaded', page.locator('.skill-desc').first.inner_text() not in ('', 'Loading description…'))
    page.screenshot(path=f'{SHOTS}/03_repo_list.png')
    page.fill('input.search', 'pdf'); page.wait_for_timeout(500)
    check('search filters', 1 <= page.locator('.skill').count() < n)
    # star it
    page.locator('.skill .star').first.click()
    check('save to library', page.locator('.skill .star.on').count() == 1)

    # 4. open skill
    page.locator('.skill-link').first.click()
    page.wait_for_selector('#skill-md .md', timeout=20000)
    check('skill renders markdown', page.locator('#skill-md h1, #skill-md h2').count() > 0)
    page.wait_for_selector('.file-list li, .files p', timeout=20000)
    nfiles = page.locator('.file-list li').count()
    check('skill files listed', nfiles > 0, nfiles)
    if page.locator('text=/Tick the \\d+ file/').count():
        page.locator('text=/Tick the \\d+ file/').click()
    else:
        page.locator('.file-list input:not([disabled])').first.check()
    check('meter counts ticked files', 'AI will read' in page.locator('.meter-txt').inner_text())
    page.screenshot(path=f'{SHOTS}/04_skill.png')
    page.screenshot(path=f'{SHOTS}/04b_skill_full.png', full_page=True)
    page.locator('.file-list .btn.link').first.click()
    page.wait_for_selector('.sheet .file-view :is(.md, pre, img, p)', timeout=15000)
    page.wait_for_timeout(800)
    page.screenshot(path=f'{SHOTS}/05_file_view.png')
    page.keyboard.press('Escape')
    skill_url = page.url

    # 5. chat without key -> key form in chat
    page.click('a.btn.big:has-text("Use this skill")')
    page.wait_for_selector('.chat-empty')
    check('chat asks for key when none saved', page.locator('.chat-empty #onb-key').count() == 1)
    page.screenshot(path=f'{SHOTS}/06_chat_nokey.png')

    # 6. invalid OpenRouter key against the REAL OpenRouter API (CORS + friendly error)
    page.fill('#onb-key', 'sk-or-v1-invalid-test-key-000000000000')
    page.click('.chat-empty >> text=Save key')
    page.wait_for_selector('#composer')
    page.fill('#composer', 'hello'); page.click('button.send')
    page.wait_for_selector('.msg.err', timeout=30000)
    t = page.locator('.msg.err').inner_text()
    check('real OpenRouter call reaches API, bad key -> friendly error', 'key is not working. Update it in Settings' in t, t)
    page.screenshot(path=f'{SHOTS}/07_chat_badkey.png')

    # 7. mocked streaming reply with a code block, then fallback
    chunks = [{'choices': [{'delta': {'content': w}}]} for w in ['Here is ', 'a **bold** tip.\n\n', '```python\nprint("hi")\n', '```\n\nDone.']]
    def or_mock(route):
        body = json.loads(route.request.post_data)
        ok = body['messages'][0]['role'] == 'system' and '<skill name=' in body['messages'][0]['content'] and body['stream'] is True
        h = route.request.headers
        ok = ok and h.get('authorization', '').startswith('Bearer ') and h.get('x-title') == 'Skill Chat' and h.get('http-referer', '').startswith('http')
        page.evaluate('ok => window.__reqok = ok', ok)
        route.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}, body=sse(chunks))
    page.route('https://openrouter.ai/api/v1/chat/completions', or_mock)
    page.click('.msg.err >> text=Try again')
    page.wait_for_selector('.msg.ai .codebox', timeout=15000)
    page.wait_for_timeout(400)
    check('request built right (system prompt, stream, headers)', page.evaluate('window.__reqok') is True)
    check('streamed markdown rendered', page.locator('.msg.ai strong').last.inner_text() == 'bold')
    check('code block copy button', page.locator('.msg.ai .codebox .copy').count() >= 1)
    page.locator('.msg.ai .codebox .copy').last.click()
    page.screenshot(path=f'{SHOTS}/08_chat_reply.png')

    # fallback: openrouter 429 -> gemini
    page.unroute('https://openrouter.ai/api/v1/chat/completions')
    page.route('https://openrouter.ai/api/v1/chat/completions', lambda r: r.fulfill(status=429, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({'error': {'message': 'Rate limit exceeded: free-models-per-day', 'code': 429}})))
    page.route('https://generativelanguage.googleapis.com/**', lambda r: r.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'},
        body=sse([{'candidates': [{'content': {'parts': [{'text': 'Answer from the backup provider.'}]}}]}])))
    page.evaluate("""() => { const s = JSON.parse(localStorage.getItem('sc.slots')); s.find(x => x.provider==='gemini').key='AIza-test'; localStorage.setItem('sc.slots', JSON.stringify(s)); }""")
    page.fill('#composer', 'second question'); page.click('button.send')
    page.wait_for_selector('text=Answer from the backup provider.', timeout=15000)
    note = page.locator('.switch-note').last.inner_text()
    check('auto-fallback to next provider with note', 'Switched to Google Gemini' in note and 'Free model is busy' in note, note)
    page.screenshot(path=f'{SHOTS}/09_chat_fallback.png')
    page.unroute('https://openrouter.ai/api/v1/chat/completions'); page.unroute('https://generativelanguage.googleapis.com/**')

    # stop button
    def slow(route):
        time.sleep(0.1)
        route.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}, body=sse([{'choices': [{'delta': {'content': 'partial'}}]}]))
    # history saved
    saved = page.evaluate("() => Object.keys(localStorage).filter(k => k.startsWith('sc.chats:')).length")
    check('chat history saved locally per skill', saved == 1, saved)
    page.reload(); page.wait_for_selector('#composer')
    page.click('[aria-label="Chat history"]'); page.wait_for_selector('.sheet .hist')
    check('history sheet lists chat', page.locator('.sheet .hist').count() == 1)
    page.screenshot(path=f'{SHOTS}/10_history.png')
    page.locator('.sheet .hist a').first.click(); page.wait_for_selector('.msg.user')
    check('old chat reopens', page.locator('.msg.user').count() == 2)

    # IDOR-style tampering: bogus chat id just opens a fresh chat
    page.goto(page.url.split('&c=')[0] + '&c=someone-elses-chat'); page.wait_for_selector('#composer')
    check('unknown chat id -> fresh chat, no data leak', page.locator('.msg.user').count() == 0)

    # 8. real chat turn: app builds a Groq request; the TEST HARNESS forwards it to the real model through the box proxy.
    if REAL_CHAT:
        mc = json.load(open('/home/user/tab/.model-capability.json'))
        import requests
        def to_openai(route):
            # harness only: the app's real request body is forwarded with the box's own credential; nothing is embedded in the app
            r = requests.post(mc['base_url'] + '/openai/v1/chat/completions', data=route.request.post_data.encode(),
                headers={'Authorization': 'Bearer ' + mc['token'], 'Content-Type': 'application/json'}, timeout=90)
            route.fulfill(status=r.status_code, headers={'content-type': r.headers.get('content-type', 'text/event-stream'), 'access-control-allow-origin': '*'}, body=r.content)
        page.route('https://api.openai.com/**', to_openai)
        page.evaluate("""() => { localStorage.setItem('sc.slots', JSON.stringify([{id:'o1',provider:'openai',key:'test-key-harness-only',model:'gpt-4o-mini',base:''}])); }""")
        page.reload(); page.wait_for_selector('#composer')
        page.fill('#composer', 'In two short sentences: what does this skill help me do?'); page.click('button.send')
        try:
            page.wait_for_selector('.msg-foot .via', timeout=60000)
            reply = page.locator('.msg.ai .bubble').last.inner_text()
            check('REAL model reply streamed + rendered', len(reply) > 20, reply[:200])
            print('REAL REPLY:', reply[:400])
        except Exception as e:
            check('REAL model reply streamed + rendered', False, page.locator('.chat-log').inner_text()[-300:])
        page.screenshot(path=f'{SHOTS}/11_real_chat.png')
        page.unroute('https://api.openai.com/**')

    # 9. 404 repo + repo without skills (mocked GitHub so the test is stable)
    def gh_mock(route):
        u = route.request.url
        if '/repos/nobody/missing' in u: return route.fulfill(status=404, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body='{"message":"Not Found"}')
        if u.endswith('/repos/demo/plain'): return route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body='{"default_branch":"main","description":"no skills here"}')
        if '/repos/demo/plain/git/trees' in u: return route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body='{"tree":[{"type":"blob","path":"index.js","size":10}],"truncated":false}')
        if '/repos/limit/me' in u: return route.fulfill(status=403, headers={'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': str(int(time.time()) + 1800)}, body='{"message":"API rate limit exceeded for 1.2.3.4."}')
        if u.endswith('/repos/evil/skill'): return route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body='{"default_branch":"main"}')
        if '/repos/evil/skill/git/trees' in u: return route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body='{"tree":[{"type":"blob","path":"x/SKILL.md","size":500},{"type":"blob","path":"x/ref.md","size":40}]}')
        return route.continue_()
    XSS = ('---\nname: "<img src=x onerror=window.__xss=1>Evil"\ndescription: "<script>window.__xss=2</script> desc"\n---\n'
           '# Evil skill\n<script>window.__xss=3</script>\n<img src=x onerror="window.__xss=4">\n<svg onload="window.__xss=5"></svg>\n'
           '<iframe src="javascript:window.__xss=6"></iframe>\n[click me](javascript:window.__xss=7)\n<a href="javascript:window.__xss=8" id="jslink">raw link</a>\n'
           '<form action="https://evil.example"><input name=q><button>go</button></form>\n<div style="position:fixed;inset:0;background:red" onclick="window.__xss=9">overlay</div>\n\n'
           'See [ref](ref.md) for more.\n')
    page.route('https://api.github.com/**', gh_mock)
    page.route('https://raw.githubusercontent.com/evil/**', lambda r: r.fulfill(status=200, headers={'content-type': 'text/plain', 'access-control-allow-origin': '*'}, body=XSS if r.request.url.endswith('SKILL.md') else '# ref file'))
    page.goto(BASE + '#/?u=' + 'https://github.com/nobody/missing'); page.wait_for_selector('.errbox')
    check('404 repo message', 'was not found' in page.locator('.errbox').inner_text())
    page.goto(BASE + '#/?u=' + 'https://github.com/demo/plain'); page.wait_for_selector('.empty')
    check('repo without skills message', 'No SKILL.md found' in page.locator('.empty').inner_text())
    page.screenshot(path=f'{SHOTS}/12_no_skills.png')
    page.goto(BASE + '#/?u=' + 'https://github.com/limit/me'); page.wait_for_selector('.errbox')
    rl = page.locator('.errbox').inner_text()
    check('rate-limit message + token field', 'GitHub limit reached' in rl and page.locator('.errbox input[type=password]').count() == 1, rl)
    page.screenshot(path=f'{SHOTS}/13_rate_limit.png')

    page.goto(BASE + '#/?u=' + 'https://github.com/evil/skill'); page.wait_for_selector('.skill')
    page.wait_for_timeout(800)
    page.locator('.skill-link').first.click(); page.wait_for_selector('#skill-md .md')
    page.wait_for_timeout(1000)
    xss = page.evaluate('window.__xss')
    check('XSS payloads do not execute', xss is None, xss)
    bad = page.evaluate("""() => {
      const md = document.querySelector('#skill-md');
      return { script: md.querySelectorAll('script,iframe,svg,form,input,button').length,
               handlers: [...md.querySelectorAll('*')].filter(e => [...e.attributes].some(a => a.name.startsWith('on'))).length,
               style: md.querySelectorAll('[style]').length,
               js: [...document.querySelectorAll('a')].filter(a => /^javascript:/i.test(a.getAttribute('href')||'')).length,
               title: document.querySelector('.skill-head h1').textContent };
    }""")
    check('sanitized DOM (no script/iframe/form/handlers/style/js links)', bad['script'] == 0 and bad['handlers'] == 0 and bad['style'] == 0 and bad['js'] == 0, bad)
    check('front matter shown as text', '<img' in bad['title'])
    page.screenshot(path=f'{SHOTS}/14_xss_safe.png', full_page=True)
    page.locator('a.file-link').first.click(); page.wait_for_selector('.sheet .md')
    check('relative link opens skill file in-app', 'ref file' in page.locator('.sheet').inner_text())
    page.keyboard.press('Escape')
    page.unroute('https://api.github.com/**')

    # 10. settings, model browser (live OpenRouter list), key delete, theme
    page.evaluate("() => localStorage.removeItem('sc.slots')")
    page.goto(BASE + '#/settings'); page.reload(); page.wait_for_selector('.prov-list')
    order = page.locator('.prov-name').all_inner_texts()
    check('default provider order OpenRouter, Gemini, Groq', order[:3] == ['OpenRouter', 'Google Gemini', 'Groq'], order)
    page.screenshot(path=f'{SHOTS}/15_settings.png', full_page=True)
    page.locator('details.prov').first.evaluate('d => d.open = true')
    page.locator('details.prov').first.locator('text=Browse models').click()
    page.wait_for_selector('.sheet .model', timeout=20000); page.wait_for_timeout(600)
    first = page.locator('.sheet .model').first.inner_text()
    check('OpenRouter models listed, free first', 'Free' in first, first)
    page.screenshot(path=f'{SHOTS}/16_models.png')
    page.keyboard.press('Escape')
    page.evaluate("() => localStorage.removeItem('sc.slots')")
    page.reload(); page.wait_for_selector('.prov-list')
    # save a key through the UI, add a second OpenRouter slot with another model
    page.locator('details.prov').first.locator('input[type=password]').fill('sk-or-v1-ui-test-key')
    page.locator('details.prov').first.locator('text=Save key').click()
    page.select_option('.add-slot select', 'openrouter'); page.click('text=Add key slot')
    page.locator('details.prov').nth(3).locator('input[type=password]').fill('sk-or-v1-second-key')
    page.locator('details.prov').nth(3).locator('text=Save key').click()
    mi = page.locator('details.prov').nth(3); mi.evaluate('d => d.open = true')
    mi.locator('input[type=text]').fill('google/gemma-4-31b-it:free'); mi.locator('input[type=text]').dispatch_event('change')
    slots = page.evaluate("() => JSON.parse(localStorage.getItem('sc.slots'))")
    check('multi-key slots: 4 slots, 2 OpenRouter keys with different models', len(slots) == 4 and [s['provider'] for s in slots].count('openrouter') == 2 and slots[3]['model'] == 'google/gemma-4-31b-it:free', slots)
    for _ in range(10):
        if page.locator('text=Add key slot').count() == 0: break
        page.click('text=Add key slot')
    check('max 10 key slots', page.locator('details.prov').count() == 10 and page.locator('text=All 10 key slots are in use.').count() == 1)
    page.screenshot(path=f'{SHOTS}/15b_settings_slots.png', full_page=True)
    page.locator('details.prov').nth(4).evaluate('d => d.open = true')
    page.locator('details.prov').nth(4).locator('text=Remove slot').click()
    check('remove slot', page.locator('details.prov').count() == 9)
    page.locator('details.prov').first.evaluate('d => d.open = true')
    page.locator('details.prov').first.locator('text=Delete key').click()
    check('delete key removes it from device', page.evaluate("() => JSON.parse(localStorage.getItem('sc.slots'))[0].key") == '')
    page.click('.seg button:has-text("Dark")'); page.wait_for_timeout(200)
    check('dark theme applies', page.evaluate('document.documentElement.dataset.theme') == 'dark')
    page.screenshot(path=f'{SHOTS}/17_settings_dark.png')
    page.goto(BASE + '#/library'); page.wait_for_selector('h1')
    check('library shows saved skill', page.locator('.skill').count() >= 1)
    page.screenshot(path=f'{SHOTS}/18_library_dark.png')
    page.goto(BASE + '#/settings'); page.wait_for_selector('.prov-list')
    page.click('text=Delete all data on this device'); page.wait_for_timeout(300)
    check('delete all data wipes keys, chats, saved skills', 'sk-or' not in page.evaluate("() => JSON.stringify(localStorage)") and page.evaluate("() => Object.keys(localStorage).filter(k => k.startsWith('sc.chats') || k === 'sc.favs').length") == 0)
    page.evaluate("() => { const s = JSON.parse(localStorage.getItem('sc.settings')||'{}'); s.theme='dark'; localStorage.setItem('sc.settings', JSON.stringify(s)); localStorage.setItem('sc.favs', JSON.stringify([{id:'anthropics/skills@main:skills/pdf/SKILL.md',owner:'anthropics',repo:'skills',ref:'main',path:'skills/pdf/SKILL.md',name:'pdf',description:'PDF skill'}])); }")
    page.goto(BASE + '#/library'); page.reload(); page.wait_for_selector('h1')
    check('library shows saved skill', page.locator('.skill').count() >= 1)
    page.screenshot(path=f'{SHOTS}/18_library_dark.png')
    page.goto(skill_url); page.wait_for_selector('#skill-md .md', timeout=20000); page.wait_for_timeout(600)
    page.screenshot(path=f'{SHOTS}/19_skill_dark.png')
    page.goto(BASE + '#/explore'); page.wait_for_selector('.hero')
    page.screenshot(path=f'{SHOTS}/20_home_dark.png')
    # keys never in the page source / app files
    check('no secrets in app shell', 'sk-or-v1' not in page.content().replace('sk-or-...', ''))
    csp_blocked = [e for e, u in errors if 'Content Security Policy' in e and 'o=evil' in u]
    print('INFO: CSP also blocked', len(csp_blocked), 'inline handler/style attempts while sanitizing the XSS skill (defense in depth)')
    real_errors = [e for e, u in errors if not ('Content Security Policy' in e and 'o=evil' in u)]
    check('no JS / CSP errors', not real_errors, real_errors[:5])
    b.close()
print(f'\n{len(passed)} passed, {len(failed)} failed')
if failed: print('FAILED:', failed); sys.exit(1)
