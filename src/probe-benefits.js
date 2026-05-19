import { chromium } from 'playwright';

const url = 'https://kream.co.kr/content/11368';

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 1600 },
});
const page = await ctx.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(5000);

console.log('=== 페이지 제목 ===');
console.log(await page.title());

console.log('\n=== 슬라이드/혜택 카드 컨테이너 후보 ===');
const sliders = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('[class*="slide"], [class*="swiper"], [class*="carousel"], [class*="banner"], [class*="benefit"], [class*="event"]'));
  return candidates.slice(0, 20).map((c) => ({
    cls: typeof c.className === 'string' ? c.className.slice(0, 100) : '',
    count: c.children.length,
    text: c.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100),
  })).filter((c) => c.text);
});
console.log(JSON.stringify(sliders.slice(0, 15), null, 2));

console.log('\n=== 본문 텍스트 (혜택 정보 패턴) ===');
const bodyText = await page.evaluate(() => document.body.innerText);
// "X% 즉시 할인" 또는 "X% 할인" 패턴 + 주변 컨텍스트
const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
const benefits = [];
for (let i = 0; i < lines.length; i++) {
  if (/\d+\s*%/.test(lines[i])) {
    const ctx = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5)).join(' | ');
    benefits.push(ctx);
  }
}
console.log('할인% 포함 라인 수:', benefits.length);
console.log('샘플 30개:');
for (const b of benefits.slice(0, 30)) console.log('  ', b);

console.log('\n=== 페이지 HTML 길이 ===');
const html = await page.content();
console.log('HTML 길이:', html.length);

console.log('\n=== Nuxt/Vue 데이터 객체에서 혜택 정보 찾기 ===');
const nuxtData = await page.evaluate(() => {
  const w = window;
  const keys = Object.keys(w).filter((k) => /nuxt|__INITIAL|data/i.test(k));
  return keys.map((k) => ({ key: k, type: typeof w[k] }));
});
console.log(nuxtData);

// 모든 이미지의 alt + 주변 텍스트
console.log('\n=== 이미지 alt 텍스트 (배너 정보) ===');
const imgs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('img'))
    .filter((img) => /pay|card|할인|결제|페이|카드/i.test(img.alt || ''))
    .map((img) => ({ alt: img.alt, src: img.src.slice(0, 80) }));
});
console.log(JSON.stringify(imgs.slice(0, 20), null, 2));

await browser.close();
