# E2E for "Post a video" (v1.2). webapp-testing skill: Playwright, Pixel-size mobile viewport, screenshots.
# Usage: python3 test/e2e_video.py [base_url]   env REAL=1 also writes captions with a real model through the box proxy (harness only, never in the app).
import sys, json, os, re
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8791/'
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.environ.get('SHOTS', os.path.join(HERE, '..', 'qa', 'video'))
REAL = os.environ.get('REAL', '0') == '1'
MP4 = os.path.join(HERE, 'fixtures', 'test_vertical.mp4')
WEBM = os.path.join(HERE, 'fixtures', 'test_vertical.webm')
os.makedirs(SHOTS, exist_ok=True)
passed, failed = [], []
def check(name, cond, extra=''):
    (passed if cond else failed).append(name)
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond or not extra else ' :: ' + str(extra)[:400]), flush=True)
def sse_openai(text):
    return ''.join('data: ' + json.dumps({'choices': [{'delta': {'content': text[i:i + 300]}}]}) + '\n\n' for i in range(0, len(text), 300)) + 'data: [DONE]\n\n'
HDR = {'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}
XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'
META = {
  'youtube': {'title': 'Cafe Website kaise banaye HTML CSS se 🔥 sirf 10 minute mein bilkul beginners ke liye ' + XSS,
              'description': 'Cafe website HTML CSS se banana seekho.\nStep by step.\n' + XSS,
              'tags': ['cafe website', 'html css', 'website kaise banaye', '<b>bad</b>'],
              'hashtags': ['#html', '#css', '#webdev', '#coding', '#hindi']},
  'instagram': {'caption': 'Ye cafe website 10 min mein bani 😳\nSave karo! ' + XSS, 'hashtags': ['#html', 'css', '#webdesign', '#coding', '#reels', '#hindi', '#x1', '#x2', '#x3', '#x4', '#x5', '#x6']}
}
INIT = """
window.__shared = []; window.__clip = [];
window.__canShare = true;
navigator.canShare = (d) => window.__canShare && !!(d && d.files && d.files.length);
navigator.share = async (d) => { window.__shared.push({ files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size, isFile: f instanceof File })), text: d.text || '', title: d.title || '' }); };
const _w = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
if (navigator.clipboard) navigator.clipboard.writeText = async (t) => { window.__clip.push(t); };
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-dev-shm-usage'])
    ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    ctx.add_init_script(INIT)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append('Uncaught ' + str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    reqs = []
    def or_mock(route):
        body = json.loads(route.request.post_data)
        reqs.append(body)
        um = body['messages'][-1]['content']
        plats = re.search(r'Platforms \(use these exact ids as JSON keys\): (.*)', um).group(1).split(', ')
        out = {k: META.get(k, {'caption': 'Caption for ' + k, 'hashtags': ['#a', '#b', '#c']}) for k in plats}
        route.fulfill(status=200, headers=HDR, body=sse_openai('Here you go:\n```json\n' + json.dumps(out, ensure_ascii=False) + '\n```'))
    page.route('https://openrouter.ai/api/v1/chat/completions', or_mock)

    page.goto(BASE)
    page.evaluate("() => { localStorage.setItem('sc.onboarded','true'); localStorage.setItem('sc.slots', JSON.stringify([{id:'or1',provider:'openrouter',key:'test-key-harness-only',model:'',base:''}])); localStorage.removeItem('sc.post'); }")
    page.reload(); page.wait_for_selector('#cmd')
    check('home shows Post a video entry', page.locator('#post-cta').count() == 1)
    check('tab bar has Post', page.locator('.tabbar a[data-nav=post]').count() == 1)
    page.screenshot(path=f'{SHOTS}/v01_home.png')

    # Auto-mode routing
    page.fill('#cmd', 'is video ko YouTube aur Instagram pe dalo'); page.click('.cmdbox button[type=submit]')
    page.wait_for_selector('h1:text("Post a video")', timeout=5000)
    on = page.locator('.plat-chips .chip.on').evaluate_all('els => els.map(e => e.dataset.p)')
    check('Auto mode routes "is video ko YouTube aur Instagram pe dalo" to Post', on == ['youtube', 'instagram'], on)
    check('no AI call for the routing', len(reqs) == 0, len(reqs))
    check('url is #/post', page.url.endswith('#/post'), page.url)
    page.screenshot(path=f'{SHOTS}/v02_post_empty.png', full_page=True)

    # Pick video (webm previews in test Chromium; mp4 is what phones mostly have)
    page.set_input_files('#video-in', WEBM)
    page.wait_for_selector('video.vid')
    page.wait_for_function("() => /0:05/.test(document.querySelector('.vid-info').textContent)", timeout=8000)
    info = page.locator('.vid-info').inner_text()
    check('video preview shows duration, size, size+orientation', '0:05' in info and 'KB' in info and '360×640 vertical' in info, info)
    page.screenshot(path=f'{SHOTS}/v03_video_picked.png', full_page=True)
    page.set_input_files('#video-in', MP4)
    page.wait_for_function("() => document.querySelector('.vid-name').textContent.endsWith('.mp4')")
    page.wait_for_timeout(800)
    check('mp4 accepted', 'test_vertical.mp4' in page.locator('.vid-name').inner_text())

    # Platform chips toggle
    page.click('.plat-chips .chip[data-p=whatsapp]')
    check('chip toggles on', page.locator('.plat-chips .chip[data-p=whatsapp]').get_attribute('aria-pressed') == 'true')
    page.click('.plat-chips .chip[data-p=whatsapp]')
    check('chip toggles off', page.locator('.plat-chips .chip[data-p=whatsapp]').get_attribute('aria-pressed') == 'false')
    check('11 platform chips', page.locator('.plat-chips .chip').count() == 11)

    # AI metadata (mocked)
    page.click('#write-ai')
    check('asks to describe the video first', 'Write a few words' in page.locator('.ai-msg').inner_text())
    page.fill('#post-about', 'Cafe website banana HTML CSS se, beginners ke liye')
    page.click('.seg button:text("English")'); page.click('.seg button:text("Hinglish")')
    page.click('#write-ai')
    page.wait_for_selector('.plat-card[data-p=instagram]', timeout=10000)
    r0 = reqs[-1]
    check('metadata prompt carries the skills rules', 'EXACTLY 3' in r0['messages'][0]['content'] and '5-10' in r0['messages'][0]['content'], r0['messages'][0]['content'][:200])
    check('prompt asks Hinglish + both platforms', 'Hinglish' in r0['messages'][-1]['content'] and 'youtube, instagram' in r0['messages'][-1]['content'])
    yt_title = page.input_value('#f-youtube-title')
    check('YouTube title cut to <= 60 chars, no < >', len(yt_title) <= 60 and '<' not in yt_title, f'{len(yt_title)} {yt_title}')
    check('YouTube exactly 3 hashtags', page.input_value('#f-youtube-hashtags') == '#html #css #webdev', page.input_value('#f-youtube-hashtags'))
    check('Instagram max 10 hashtags', len(page.input_value('#f-instagram-hashtags').split()) == 10, page.input_value('#f-instagram-hashtags'))
    check('YouTube tags without html', '<' not in page.input_value('#f-youtube-tags') and 'cafe website' in page.input_value('#f-youtube-tags'))
    cap = page.input_value('#f-instagram-caption')
    check('AI text shown as plain text (XSS payload inert)', 'onerror' in cap and page.evaluate('window.__xss') is None and page.locator('.plat-card img').count() == 0, cap)
    page.screenshot(path=f'{SHOTS}/v04_meta.png', full_page=True)

    # Edit + warning
    page.fill('#f-youtube-hashtags', '#one #two')
    check('rule warning when hashtags wrong', 'exactly 3' in page.locator('#card-youtube .warns').inner_text())
    page.fill('#f-youtube-hashtags', '#html #css #webdev')
    check('warning clears', page.locator('#card-youtube .warns li').count() == 0)

    # Copy buttons
    page.click('#card-youtube .fld:has(#f-youtube-title) .copy')
    check('Copy title -> clipboard', page.evaluate('window.__clip.at(-1)') == yt_title)

    # Post to YouTube (Web Share API L2, mocked)
    check('queue shows 0 of 2', '0 of 2 posted' in page.locator('.queue').inner_text())
    page.click('#post-all')
    page.wait_for_function('() => window.__shared.length === 1')
    sh = page.evaluate('window.__shared[0]')
    check('navigator.share got the video file', sh['files'] and sh['files'][0]['isFile'] and sh['files'][0]['type'] == 'video/mp4' and sh['files'][0]['name'] == 'test_vertical.mp4', sh)
    check('navigator.share got the caption text', sh['text'].startswith(yt_title) and '#html #css #webdev' in sh['text'], sh['text'][:200])
    check('caption auto-copied to clipboard', page.evaluate('window.__clip.at(-1)') == sh['text'])
    check('toast says Caption copied — paste it', 'Caption copied — paste it' in page.locator('#toast').inner_text())
    page.wait_for_timeout(300)
    check('queue tick 1 of 2', '1 of 2 posted' in page.locator('.queue').inner_text() and page.locator('.q-list li.q-done').count() == 1)
    check('next button names Instagram', page.locator('#post-all').inner_text() == 'Next: Instagram Reels', page.locator('#post-all').inner_text())
    page.screenshot(path=f'{SHOTS}/v05_queue_1.png', full_page=True)
    page.click('#post-all')
    page.wait_for_function('() => window.__shared.length === 2')
    sh2 = page.evaluate('window.__shared[1]')
    check('Instagram share text = caption + hashtags', sh2['text'].startswith('Ye cafe website') and '#webdesign' in sh2['text'], sh2['text'][:120])
    page.wait_for_timeout(300)
    check('queue all done', '2 of 2 posted' in page.locator('.queue').inner_text() and 'All done' in page.locator('.queue').inner_text())
    page.locator('.queue').scroll_into_view_if_needed()
    page.screenshot(path=f'{SHOTS}/v06_queue_done.png')

    # Draft survives a reload (video must be picked again)
    page.reload(); page.wait_for_selector('.plat-card[data-p=youtube]')
    check('draft kept after reload', page.input_value('#f-youtube-hashtags') == '#html #css #webdev' and '2 of 2' in page.locator('.queue').inner_text())
    page.click('.queue .btn.link'); page.wait_for_timeout(200)
    check('reset ticks', '0 of 2' in page.locator('.queue').inner_text())
    page.click('#card-youtube .post-btn')
    check('post without video asks for a video', 'Choose a video first' in page.locator('#toast').inner_text())

    # Browser without file sharing -> honest fallback
    page.set_input_files('#video-in', MP4); page.wait_for_timeout(300)
    page.evaluate('window.__canShare = false')
    page.click('#card-instagram .post-btn')
    page.wait_for_selector('.sheet h2:text("This browser cannot share videos")')
    check('fallback sheet when share of files unsupported', page.locator('.sheet').count() == 1)
    page.screenshot(path=f'{SHOTS}/v07_fallback.png')
    page.click('.sheet .icon-btn')
    page.evaluate('window.__canShare = true')

    # Hindi + "Write it myself" path, and dark theme look
    page.click('.plat-chips .chip[data-p=x]')
    page.click('.ai-row .btn.ghost')
    check('manual card for X', page.locator('#card-x').count() == 1)
    page.emulate_media(color_scheme='dark'); page.wait_for_timeout(200)
    page.screenshot(path=f'{SHOTS}/v08_dark.png', full_page=True)
    page.emulate_media(color_scheme='light')

    if REAL:
        import requests
        mc = json.load(open('/home/user/tab/.model-capability.json'))
        def to_openai(route):
            r = requests.post(mc['base_url'] + '/openai/v1/chat/completions', data=route.request.post_data.encode(),
                headers={'Authorization': 'Bearer ' + mc['token'], 'Content-Type': 'application/json'}, timeout=170)
            route.fulfill(status=r.status_code, headers={'content-type': r.headers.get('content-type', 'text/event-stream'), 'access-control-allow-origin': '*'}, body=r.content)
        page.route('https://api.openai.com/**', to_openai)
        page.evaluate("() => { localStorage.setItem('sc.slots', JSON.stringify([{id:'o1',provider:'openai',key:'test-key-harness-only',model:'gpt-4o-mini',base:''}])); const d = JSON.parse(localStorage.getItem('sc.post')); d.meta = {}; d.done = {}; d.platforms = ['youtube','shorts','instagram','whatsapp']; localStorage.setItem('sc.post', JSON.stringify(d)); }")
        page.reload(); page.wait_for_selector('#write-ai')
        page.fill('#post-about', 'Python list comprehension trick explained in Hindi in 60 seconds for beginners')
        page.click('#write-ai')
        try:
            page.wait_for_selector('.plat-card[data-p=whatsapp]', timeout=150000)
        except Exception: pass
        msg = page.locator('.ai-msg').inner_text()
        t = page.input_value('#f-youtube-title') if page.locator('#f-youtube-title').count() else ''
        hs = page.input_value('#f-youtube-hashtags') if page.locator('#f-youtube-hashtags').count() else ''
        ig = page.input_value('#f-instagram-hashtags') if page.locator('#f-instagram-hashtags').count() else ''
        st = page.input_value('#f-shorts-title') if page.locator('#f-shorts-title').count() else ''
        print('REAL:', msg, '|', t, '|', hs, '|', st, '|', ig, flush=True)
        check('REAL captions written', 'Done with' in msg and 5 < len(t) <= 60, msg + ' ' + t)
        check('REAL YouTube 3 hashtags, IG 5-10, Shorts #shorts', len(hs.split()) == 3 and 5 <= len(ig.split()) <= 10 and '#shorts' in st.lower(), f'{hs} | {ig} | {st}')
        page.screenshot(path=f'{SHOTS}/v09_real_meta.png', full_page=True)

    real_errors = [e for e in errors if 'test-key' not in e]
    check('no page errors', not real_errors, real_errors)
    b.close()
print(f'\n{len(passed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
