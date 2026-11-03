# E2E for Auto mode (v1.1). webapp-testing skill: Playwright, Pixel-size mobile viewport, screenshots.
# Usage: python3 test/e2e_auto.py [base_url]   env REAL=1 also runs real-model routing/run through the box proxy (harness only).
import sys, json, os, re, time, subprocess, tempfile
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8791/'
SHOTS = os.environ.get('SHOTS', os.path.join(os.path.dirname(__file__), '..', 'qa', 'auto'))
REAL = os.environ.get('REAL', '0') == '1'
os.makedirs(SHOTS, exist_ok=True)
passed, failed = [], []
def check(name, cond, extra=''):
    (passed if cond else failed).append(name)
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond or not extra else ' :: ' + str(extra)[:400]), flush=True)
def sse_openai(text):
    return ''.join('data: ' + json.dumps({'choices': [{'delta': {'content': text[i:i + 400]}}]}) + '\n\n' for i in range(0, len(text), 400)) + 'data: [DONE]\n\n'
HDR = {'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}
OR = 'https://openrouter.ai/api/v1/chat/completions'

SITE_HTML = """```html index.html
<!doctype html><html><head><title>Chai Point</title><link rel="stylesheet" href="style.css"></head>
<body><h1 id="t">Chai Point</h1><p id="js">waiting</p>
<script src="app.js"></script>
<script>
var leak = 'none';
try { leak = String(window.parent.document.body.innerHTML.length); window.parent.document.body.innerHTML = 'PWNED'; } catch (e) { leak = 'blocked'; }
try { localStorage.setItem('cart', '2'); document.getElementById('js').setAttribute('data-ls', localStorage.getItem('cart')); } catch (e) { document.getElementById('js').setAttribute('data-ls', 'err'); }
document.getElementById('js').setAttribute('data-leak', leak);
try { window.top.location = 'https://example.com/'; } catch (e) {}
</script></body></html>
```
**style.css**
```css
h1 { color: rgb(200, 30, 30); }
```
```js app.js
document.getElementById('js').textContent = 'JS ran';
```
"""
XSS_TEXT = 'Here you go <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> [click](javascript:window.__xss=3)\n\n'

def pick_from(user_msg, words):
    for line in user_msg.split('\n'):
        m = re.match(r'(\d+)\. ([^:]+):', line)
        if m and any(w in m.group(2).lower() for w in words): return int(m.group(1))
    return None

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-dev-shm-usage'])
    ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True,
                        user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append('Uncaught ' + str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('dialog', lambda d: d.accept())
    reqs = []
    state = {'mode': 'normal', 'pending': []}
    def or_mock(route):
        body = json.loads(route.request.post_data)
        msgs = body['messages']; sysm = msgs[0]['content']
        reqs.append({'sys': sysm, 'msgs': msgs})
        if sysm.startswith('You choose skills'):
            um = msgs[-1]['content']; cmd = um.split('\n')[0].lower()
            words = ['frontend'] if 'website' in cmd else ['pdf'] if 'pdf' in cmd else ['pptx'] if 'slides' in cmd else []
            n = pick_from(um, words) if words else None
            return route.fulfill(status=200, headers=HDR, body=sse_openai(json.dumps({'skills': [n] if n else [], 'plan': ['Plan the page', 'Write the code'], 'title': 'Test job'})))
        steps = sum(1 for m in msgs if m['role'] == 'assistant')
        if state['mode'] == 'loop':
            return route.fulfill(status=200, headers=HDR, body=sse_openai(f'Working on part {steps + 1}.\n\nSTATUS: CONTINUE'))
        if state['mode'] == 'hang' and steps == 1:
            state['pending'].append(route); return  # never answered: the Stop button must end it
        if steps == 0:
            return route.fulfill(status=200, headers=HDR, body=sse_openai('## Plan\n1. Design\n2. Build\n\nI picked warm colours. ' + XSS_TEXT + 'STATUS: CONTINUE'))
        return route.fulfill(status=200, headers=HDR, body=sse_openai('Here is the site.\n\n' + SITE_HTML + '\nSTATUS: DONE'))

    # 0. Do screen = home, library auto-loads anthropics/skills (real GitHub)
    page.goto(BASE)
    page.evaluate("() => { localStorage.setItem('sc.onboarded','true'); localStorage.setItem('sc.slots', JSON.stringify([{id:'or1',provider:'openrouter',key:'test-key-harness-only',model:'',base:''}])); }")
    page.reload(); page.wait_for_selector('#cmd')
    check('home is the command box', page.locator('h1').first.inner_text() == 'What do you want done?')
    check('honest note about other apps', 'cannot control other apps' in page.locator('.honest').inner_text())
    page.wait_for_function("() => /\\d+ skills ready/.test(document.querySelector('.lib-count')?.textContent || '')", timeout=60000)
    nlib = int(re.search(r'(\d+) skills', page.locator('.lib-count').inner_text()).group(1))
    check('library indexed anthropics/skills', nlib >= 10, nlib)
    cached = page.evaluate("() => JSON.parse(localStorage.getItem('sc.lib')).repos[0].skills.length")
    check('index cached on device', cached == nlib)
    page.screenshot(path=f'{SHOTS}/a01_home.png')
    page.screenshot(path=f'{SHOTS}/a01b_home_full.png', full_page=True)

    # 1. full mocked run: routing -> chips -> 2 steps -> DONE -> files
    page.route(OR, or_mock)
    page.fill('#cmd', 'make a one-page cafe website'); page.click('.cmdbox button[type=submit]')
    page.wait_for_selector('.run-bar .ok-txt', timeout=30000)
    chips = page.locator('.skill-chip .chip-v').all_inner_texts()
    check('routing picked frontend-design chip', chips == ['frontend-design'], chips)
    check('routing request had compact index only', reqs[0]['sys'].startswith('You choose skills') and 'frontend-design:' in reqs[0]['msgs'][-1]['content'] and len(reqs[0]['msgs'][-1]['content']) < 30000)
    step_sys = reqs[1]['sys']
    check('SKILL.md loaded into agent system prompt', '<skill name="frontend-design"' in step_sys and 'STATUS: DONE' in step_sys, step_sys[:300])
    check('step 2 got step 1 output + continue', reqs[2]['msgs'][-1]['content'].startswith('Continue with the next step') and any(m['role'] == 'assistant' and 'Plan' in m['content'] for m in reqs[2]['msgs']))
    check('stops at DONE after 2 steps', page.locator('details.step').count() == 2 and 'Done in 2 steps' in page.locator('.run-bar').inner_text())
    check('model output XSS did not run', page.evaluate('() => window.__xss') is None and page.locator('.step-body img[onerror]').count() == 0)
    names = page.locator('.fc-name').all_inner_texts()
    check('file cards', names == ['index.html', 'style.css', 'app.js'], names)
    check('status line stripped from view', 'STATUS:' not in page.locator('.steps-list').inner_text())
    page.screenshot(path=f'{SHOTS}/a02_run_done.png')
    page.screenshot(path=f'{SHOTS}/a02b_run_full.png', full_page=True)

    # 2. downloads: zip + single file
    with page.expect_download() as dl: page.click('text=Download all (.zip)')
    zp = os.path.join(tempfile.mkdtemp(), 'out.zip'); dl.value.save_as(zp)
    zt = subprocess.run(['unzip', '-l', zp], capture_output=True, text=True).stdout
    check('zip download valid with 3 files', 'index.html' in zt and 'style.css' in zt and 'app.js' in zt and subprocess.run(['unzip', '-t', zp], capture_output=True).returncode == 0, zt)
    with page.expect_download() as dl2: page.locator('.file-card').nth(1).locator('text=Download').click()
    check('single file download', dl2.value.suggested_filename == 'style.css')

    # 3. sandboxed preview
    page.locator('.file-card').first.locator('text=Preview').click()
    page.wait_for_selector('iframe.preview-frame')
    fr = page.frame_locator('iframe.preview-frame')
    fr.locator('#js[data-leak]').wait_for(timeout=10000)
    check('preview runs JS + inlined css/js', fr.locator('#js').inner_text() == 'JS ran' and fr.locator('h1').evaluate('e => getComputedStyle(e).color') == 'rgb(200, 30, 30)')
    leak = fr.locator('#js').get_attribute('data-leak')
    check('preview cannot touch app page', leak == 'blocked' and page.locator('.tabbar').count() == 1 and page.locator('.run-bar').count() == 1, leak)
    check('preview localStorage shim works (opaque origin)', fr.locator('#js').get_attribute('data-ls') == '2')
    check('preview iframe sandbox has no allow-same-origin', 'allow-same-origin' not in page.get_attribute('iframe.preview-frame', 'sandbox'))
    check('app keys untouched', 'test-key-harness-only' in page.evaluate("() => localStorage.getItem('sc.slots')"))
    check('top not navigated by preview', page.url.startswith(BASE))
    page.wait_for_timeout(500)
    page.screenshot(path=f'{SHOTS}/a03_preview.png')
    page.keyboard.press('Escape')

    # 4. Stop button + continue
    state['mode'] = 'hang'; reqs.clear()
    page.goto(BASE + '#/'); page.wait_for_selector('#cmd')
    page.fill('#cmd', 'make a website for my gym'); page.click('.cmdbox button[type=submit]')
    page.wait_for_function("() => document.querySelectorAll('details.step').length === 2", timeout=20000)
    page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/a04_running.png')
    page.click('.run-bar .btn.stop')
    page.wait_for_selector('.run-bar :text("Stopped.")', timeout=5000)
    check('Stop ends the run', 'Stopped.' in page.locator('.run-bar').inner_text())
    state['mode'] = 'normal'
    page.click('.run-bar :text("Continue")')
    page.wait_for_selector('.run-bar .ok-txt', timeout=20000)
    check('Continue after Stop finishes', page.locator('.fc-name').count() == 3)
    for r in state['pending']:
        try: r.abort()
        except Exception: pass

    # 5. max steps cap (set to 3 in Settings)
    page.goto(BASE + '#/settings'); page.wait_for_selector('#max-steps')
    page.fill('#max-steps', '3'); page.locator('#max-steps').dispatch_event('change')
    page.screenshot(path=f'{SHOTS}/a05_settings_auto.png')
    page.locator('#max-steps').scroll_into_view_if_needed(); page.screenshot(path=f'{SHOTS}/a05b_settings_auto.png')
    state['mode'] = 'loop'; reqs.clear()
    page.goto(BASE + '#/'); page.wait_for_selector('#cmd')
    page.fill('#cmd', 'write a long story'); page.click('.cmdbox button[type=submit]')
    page.wait_for_selector('.run-bar :text("step limit")', timeout=30000)
    steps_calls = [r for r in reqs if not r['sys'].startswith('You choose')]
    check('max-steps cap stops at 3', page.locator('details.step').count() == 3 and len(steps_calls) == 3, len(steps_calls))
    check('last step told it is the last', 'LAST step' in steps_calls[-1]['msgs'][-1]['content'])
    check('no skill chip -> general assistant', page.locator('.skill-chip.none').count() == 1)
    page.screenshot(path=f'{SHOTS}/a06_maxsteps.png')
    state['mode'] = 'normal'

    # 6. chip tap -> picker -> change skill -> rerun
    page.click('.skill-chip')
    page.wait_for_selector('.pick-list li')
    page.fill('.sheet input.search', 'pdf'); page.wait_for_timeout(200)
    page.locator('.pick-list li:has(strong:text-is("pdf")) input').check()
    page.screenshot(path=f'{SHOTS}/a07_picker.png')
    reqs.clear()
    page.click('text=Run with these')
    page.wait_for_selector('.run-bar .ok-txt', timeout=20000)
    check('changed skill used in rerun', page.locator('.skill-chip .chip-v').all_inner_texts() == ['pdf'] and '<skill name="pdf"' in reqs[0]['sys'] and not any(r['sys'].startswith('You choose') for r in reqs))

    # 7. follow-up message continues the same job
    reqs.clear()
    page.fill('#followup', 'make the heading green'); page.click('.run-composer button')
    page.wait_for_selector('.followup-msg', timeout=10000)
    page.wait_for_selector('.run-bar .ok-txt', timeout=20000)
    check('follow-up sent with history', reqs and reqs[0]['msgs'][-1]['content'] == 'make the heading green' and len(reqs[0]['msgs']) > 2)

    # 8. key fallback on routing + steps (OpenRouter 429 -> Gemini)
    page.unroute(OR)
    page.route(OR, lambda r: r.fulfill(status=429, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({'error': {'message': 'Rate limit exceeded: free-models-per-day', 'code': 429}})))
    gem = []
    def gem_mock(route):
        bd = json.loads(route.request.post_data); gem.append(bd)
        st = bd['systemInstruction']['parts'][0]['text']
        txt = '{"skills":[],"plan":["x"],"title":"Fallback"}' if st.startswith('You choose') else 'Done via backup.\n\nSTATUS: DONE'
        route.fulfill(status=200, headers=HDR, body='data: ' + json.dumps({'candidates': [{'content': {'parts': [{'text': txt}]}}]}) + '\n\n')
    page.route('https://generativelanguage.googleapis.com/**', gem_mock)
    page.evaluate("() => localStorage.setItem('sc.slots', JSON.stringify([{id:'or1',provider:'openrouter',key:'test-key-a',model:'',base:''},{id:'g1',provider:'gemini',key:'test-key-b',model:'',base:''}]))")
    page.goto(BASE + '#/'); page.wait_for_selector('#cmd')
    page.fill('#cmd', 'say hi'); page.click('.cmdbox button[type=submit]')
    page.wait_for_selector('.run-bar .ok-txt', timeout=20000)
    check('fallback key used for routing and step', len(gem) == 2 and 'Switched to Google Gemini' in page.locator('.steps-list').inner_text() and 'Gemini' in page.locator('.via').last.inner_text(), len(gem))
    page.screenshot(path=f'{SHOTS}/a08_fallback.png')
    page.unroute(OR); page.unroute('https://generativelanguage.googleapis.com/**')

    # 9. malicious SKILL.md / index entry in the library cannot run code
    page.route(OR, or_mock)
    page.evaluate("""() => { const l = JSON.parse(localStorage.getItem('sc.lib')); l.repos.push({url:'https://github.com/evil/skill', label:'evil/skill', at: Date.now(), skills:[{id:'evil/skill@main:SKILL.md', owner:'evil', repo:'skill', ref:'main', path:'SKILL.md', dir:'', name:'evil <img src=x onerror=window.__xss=9>', description:'<script>window.__xss=8</script> website maker', files:[['ref.md', 10]]}]}); localStorage.setItem('sc.lib', JSON.stringify(l)); localStorage.setItem('sc.slots', JSON.stringify([{id:'or1',provider:'openrouter',key:'test-key-harness-only',model:'',base:''}])); }""")
    page.route('https://raw.githubusercontent.com/evil/**', lambda r: r.fulfill(status=200, headers={'content-type': 'text/plain', 'access-control-allow-origin': '*'},
        body='---\nname: evil\ndescription: x\n---\n<script>window.__xss=7</script><img src=x onerror="window.__xss=6"> see ref.md' if r.request.url.endswith('SKILL.md') else '<svg onload=window.__xss=5>'))
    page.goto(BASE + '#/'); page.wait_for_selector('#cmd')
    page.fill('#cmd', 'make a website for evil test'); page.click('.cmdbox button[type=submit]')
    page.wait_for_selector('.run-bar .ok-txt', timeout=20000)
    page.click('.skill-chip'); page.wait_for_selector('.pick-list li')
    page.fill('.sheet input.search', 'evil'); page.wait_for_timeout(200)
    page.locator('.pick-list input[type=checkbox]').first.check()
    for cb in page.locator('.pick-list input:checked').all()[1:]: pass
    page.click('text=Run with these'); page.wait_for_selector('.run-bar .ok-txt', timeout=20000)
    page.screenshot(path=f'{SHOTS}/a09_evil_skill.png')
    check('evil SKILL.md + index text never execute', page.evaluate('() => window.__xss') is None and any('window.__xss=7' in r['sys'] for r in reqs))
    page.unroute(OR)

    # 10. history persists across reload; IDOR-ish bogus id
    page.goto(BASE + '#/'); page.reload(); page.wait_for_selector('#cmd')
    n_hist = page.locator('.hist').count()
    check('recent jobs saved', n_hist >= 5, n_hist)
    page.locator('.hist a').last.click(); page.wait_for_selector('.run')
    check('saved job reopens with files', page.locator('.fc-name').count() >= 1)
    page.goto(BASE + '#/run?id=someone-elses'); page.wait_for_selector('.errbox')
    check('unknown job id -> not found', 'Job not found' in page.locator('.errbox').inner_text())

    # 11. old routes still work
    page.goto(BASE + '#/?u=https://github.com/anthropics/skills'); page.wait_for_selector('.skill', timeout=30000)
    check('v1.0 explore links still work', page.locator('.skill').count() >= 5)
    check('add-to-library button on repo', page.locator('.add-lib').count() == 1)

    # 12. real model (harness only: request forwarded through the box proxy; no key in the app)
    if REAL:
        import requests
        mc = json.load(open('/home/user/tab/.model-capability.json'))
        real_calls = []
        def to_openai(route):
            real_calls.append(1)
            r = requests.post(mc['base_url'] + '/openai/v1/chat/completions', data=route.request.post_data.encode(),
                headers={'Authorization': 'Bearer ' + mc['token'], 'Content-Type': 'application/json'}, timeout=170)
            route.fulfill(status=r.status_code, headers={'content-type': r.headers.get('content-type', 'text/event-stream'), 'access-control-allow-origin': '*'}, body=r.content)
        page.route('https://api.openai.com/**', to_openai)
        page.evaluate("""() => { localStorage.setItem('sc.slots', JSON.stringify([{id:'o1',provider:'openai',key:'test-key-harness-only',model:'gpt-4o-mini',base:''}]));
          const l = JSON.parse(localStorage.getItem('sc.lib')); l.repos = l.repos.filter(r => !/evil/.test(r.url)); localStorage.setItem('sc.lib', JSON.stringify(l));
          localStorage.setItem('sc.auto', JSON.stringify({maxSteps: 4})); }""")
        samples = [('Make a one-page website for a chai cafe called Chai Point', ['frontend-design', 'web-artifacts-builder', 'theme-factory']),
                   ('Write a PDF summary of the benefits of yoga', ['pdf']),
                   ('Make a 5 slide PowerPoint presentation about climate change', ['pptx'])]
        for i, (cmd, ok) in enumerate(samples):
            page.goto(BASE + '#/'); page.wait_for_selector('#cmd')
            page.fill('#cmd', cmd); page.click('.cmdbox button[type=submit]')
            try:
                page.wait_for_selector('.skill-chip', timeout=120000)
                got = page.locator('.skill-chip .chip-v').all_inner_texts()
            except Exception as e:
                got = ['ERR ' + page.locator('.run').inner_text()[:200]]
            check(f'REAL routing: "{cmd[:40]}" -> {got}', bool(set(got) & set(ok)), got)
            page.wait_for_timeout(500)
            page.screenshot(path=f'{SHOTS}/r0{i + 1}_route.png')
            if i == 0:
                try:
                    page.wait_for_selector('.run-bar .ok-txt, .run-bar :text("step limit"), .run-bar .err-txt', timeout=600000)
                except Exception: pass
                bar = page.locator('.run-bar').inner_text()
                files = page.locator('.fc-name').all_inner_texts()
                nst = page.locator('details.step').count()
                check('REAL multi-step run finished with files', ('Done in' in bar or 'step limit' in bar) and any(f.endswith('.html') for f in files), f'{bar} {files}')
                print('REAL RUN:', bar, nst, 'steps', files, flush=True)
                page.screenshot(path=f'{SHOTS}/r10_real_run.png')
                page.screenshot(path=f'{SHOTS}/r10b_real_run_full.png', full_page=True)
                html = page.locator('.file-card:has(.fc-name:text-matches("html$")) >> text=Preview')
                if html.count():
                    html.first.click(); page.wait_for_selector('iframe.preview-frame'); page.wait_for_timeout(2500)
                    page.screenshot(path=f'{SHOTS}/r11_real_preview.png')
                    check('REAL preview rendered', len(page.frame_locator('iframe.preview-frame').locator('body').inner_text()) > 20)
                    page.keyboard.press('Escape')
            else:
                stop = page.locator('.run-bar .btn.stop')
                if stop.count(): stop.click()
        # a bigger job that needs several steps
        page.goto(BASE + '#/'); page.wait_for_selector('#cmd')
        page.fill('#cmd', 'Write a 3-part beginner Python mini course in Hinglish. Write ONLY part 1 in this step as part1.md, then part 2 as part2.md in the next step, then part 3 as part3.md in the step after. One file per step.')
        page.click('.cmdbox button[type=submit]')
        try: page.wait_for_selector('.run-bar .ok-txt, .run-bar :text("step limit"), .run-bar .err-txt', timeout=600000)
        except Exception: pass
        bar = page.locator('.run-bar').inner_text(); nst = page.locator('details.step').count(); files = page.locator('.fc-name').all_inner_texts()
        print('REAL MULTI:', bar, nst, files, flush=True)
        check('REAL multi-step: several steps, then DONE', nst >= 2 and 'Done in' in bar, f'{bar} {nst} {files}')
        page.screenshot(path=f'{SHOTS}/r12_real_multistep.png')
        page.unroute('https://api.openai.com/**')

    # 13. dark theme look
    page.evaluate("() => { const s = JSON.parse(localStorage.getItem('sc.settings') || '{}'); s.theme = 'dark'; localStorage.setItem('sc.settings', JSON.stringify(s)); }")
    page.goto(BASE + '#/'); page.reload(); page.wait_for_selector('#cmd'); page.wait_for_timeout(400)
    page.screenshot(path=f'{SHOTS}/a10_home_dark.png')
    page.locator('.hist a').first.click(); page.wait_for_selector('.run'); page.wait_for_timeout(400)
    page.screenshot(path=f'{SHOTS}/a11_run_dark.png')
    check('no secrets in app shell', 'sk-or-v1' not in page.content())
    real_errors = [e for e in errors if 'Content Security Policy' not in e and 'allow-top-navigation' not in e]  # the test's own top-navigation attack, blocked
    csp = [e for e in errors if 'Content Security Policy' in e]
    print('INFO CSP notes:', len(csp), csp[:3])
    check('no JS errors', not real_errors, real_errors[:5])
    b.close()
print(f'\n{len(passed)} passed, {len(failed)} failed')
if failed: print('FAILED:', failed); sys.exit(1)
