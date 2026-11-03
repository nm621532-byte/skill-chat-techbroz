// Unit tests for "Post a video" (v1.2). Run: node test/unit_video.mjs
import assert from 'node:assert/strict';
import { isPostVideoCommand, detectPlatforms, topicFromCommand, parseMeta, normalizeMeta, shareText, checkMeta, cleanHashtags, cleanTags, clip, nextInQueue, fmtDuration, videoHints, metaMessages, META_SYSTEM, PLATFORMS, fileKey } from '../site/lib/video.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await t('detects posting commands (Hinglish + English)', () => {
  for (const c of ['is video ko YouTube aur Instagram pe dalo', 'Aur ismein kisi bhi platform per video dalvaye to video dal sake', 'post my cafe reel on instagram',
    'upload this video to YouTube Shorts', 'video ko WhatsApp status pe lagao', 'share this clip on X and LinkedIn', 'isko YouTube aur Facebook pe daal do'])
    assert.equal(isPostVideoCommand(c), true, c);
  for (const c of ['make a one-page cafe website', 'write a YouTube script about Python', 'make a video script for instagram reel', 'Create a professional email asking a client for payment', 'Write a 60-second YouTube Shorts script about 3 Python tips'])
    assert.equal(isPostVideoCommand(c), false, c);
});
await t('platforms from a command', () => {
  assert.deepEqual(detectPlatforms('is video ko YouTube aur Instagram pe dalo'), ['youtube', 'instagram']);
  assert.deepEqual(detectPlatforms('upload to YouTube Shorts'), ['shorts']);
  assert.deepEqual(detectPlatforms('YouTube and YouTube Shorts'), ['shorts', 'youtube']);
  assert.deepEqual(detectPlatforms('kisi bhi platform per'), ['youtube', 'instagram', 'facebook', 'whatsapp']);
  assert.deepEqual(detectPlatforms('fb, telegram, moj, snapchat'), ['facebook', 'telegram', 'snapchat', 'moj']);
  assert.deepEqual(detectPlatforms('post it on X'), ['x']);
});
await t('topic from command', () => {
  assert.equal(topicFromCommand('post my cafe reel on instagram'), 'cafe');
  assert.equal(topicFromCommand('Aur ismein kisi bhi platform per video dalvaye'), '');
});
await t('parseMeta: fenced JSON, chatter, think, odd keys', () => {
  const txt = '<think>{"x":1}</think>Sure ```json\n{"YouTube":{"title":"T","description":"D","tags":["a","b"],"hashtags":["#a","b","#c","#d"]},"Instagram Reels":{"caption":"Hook","hashtags":"#x #y"}}\n```';
  const r = parseMeta(txt, ['youtube', 'instagram', 'x']);
  assert.equal(r.ok, true); assert.deepEqual(r.missing, ['x']);
  assert.deepEqual(r.meta.youtube.hashtags, ['#a', '#b', '#c']);
  assert.deepEqual(r.meta.instagram.hashtags, ['#x', '#y']);
  assert.equal(parseMeta('no json here', ['youtube']).ok, false);
  assert.equal(parseMeta('{"platforms":{"facebook":{"caption":"hi"}}}', ['facebook']).meta.facebook.caption, 'hi');
});
await t('rules: YouTube title <= 60 at a word boundary, no < >, Shorts gets #shorts, X fits 280', () => {
  const m = normalizeMeta({ youtube: { title: 'Python list comprehension in Hindi one line magic that saves your time <b>', hashtags: [] }, shorts: { title: 'Python trick' }, x: { caption: 'a '.repeat(200), hashtags: ['#py', '#code', '#more'] } }, ['youtube', 'shorts', 'x']);
  assert.ok(m.youtube.title.length <= 60); assert.ok(!/[<>]/.test(m.youtube.title)); assert.ok(!m.youtube.title.endsWith(' '));
  assert.equal(m.shorts.title, 'Python trick #shorts');
  assert.deepEqual(m.x.hashtags, ['#py', '#code']);
  assert.ok(shareText('x', m.x).length <= 280);
  assert.equal(clip('hello world foo', 11), 'hello world');
});
await t('hashtags + tags cleaning', () => {
  assert.deepEqual(cleanHashtags(['#Hello World', '##coding', 'coding', '#<b>x</b>'], 'instagram'), ['#HelloWorld', '#coding', '#bxb']);
  assert.equal(cleanHashtags(Array.from({ length: 15 }, (_, i) => '#t' + i), 'instagram').length, 10);
  assert.deepEqual(cleanTags(['a', 'A', '#b', '<c>']), ['a', 'b', 'c']);
});
await t('checkMeta warnings', () => {
  assert.deepEqual(checkMeta('youtube', { title: 'x'.repeat(61), hashtags: ['#a', '#b'] }), ['Title is 61 characters; keep it under 60.', 'Use exactly 3 hashtags (now 2).']);
  assert.deepEqual(checkMeta('instagram', { caption: 'c', hashtags: ['#a', '#b', '#c', '#d', '#e'] }), []);
});
await t('share text', () => {
  assert.equal(shareText('youtube', { title: 'T', description: 'D', hashtags: ['#a', '#b', '#c'] }), 'T\n\nD\n\n#a #b #c');
  assert.equal(shareText('instagram', { caption: 'Hook', hashtags: ['#a'] }), 'Hook\n\n#a');
});
await t('queue + helpers', () => {
  assert.equal(nextInQueue(['youtube', 'instagram'], { youtube: true }), 'instagram');
  assert.equal(nextInQueue(['youtube'], { youtube: true }), null);
  assert.equal(fmtDuration(65), '1:05'); assert.equal(fmtDuration(3725), '1:02:05'); assert.equal(fmtDuration(NaN), '');
  assert.equal(videoHints(200, 1080, 1920).length, 1); assert.equal(videoHints(30, 1920, 1080).length, 1); assert.equal(videoHints(30, 1080, 1920).length, 0);
  assert.equal(fileKey({ name: 'a.mp4', size: 3, lastModified: 9 }), 'a.mp4|3|9');
});
await t('prompt + platform table', () => {
  const m = metaMessages({ about: 'cafe site', platforms: ['youtube', 'bogus', 'instagram'], lang: 'english' });
  assert.match(m[0].content, /Platforms \(use these exact ids as JSON keys\): youtube, instagram$/m);
  assert.match(m[0].content, /simple English/);
  assert.match(META_SYSTEM, /EXACTLY 3/); assert.match(META_SYSTEM, /5-10/); assert.match(META_SYSTEM, /under 60 characters/);
  assert.equal(PLATFORMS.length, 11);
  const pk = PLATFORMS.map(p => p.pkg).filter(Boolean);
  for (const want of ['com.google.android.youtube', 'com.instagram.android', 'com.facebook.katana', 'com.whatsapp', 'org.telegram.messenger', 'com.twitter.android', 'com.snapchat.android', 'com.linkedin.android']) assert.ok(pk.includes(want), want);
});
console.log(`\n${n} video unit tests passed`);
