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
await page.waitForTimeout(4500);

// 각 슬라이드 컨테이너의 outerHTML + 클릭 대상 a 태그
console.log('=== 슬라이드 안의 a 태그 / 클릭 가능한 요소 ===');
const slides = await page.evaluate(() => {
  const containers = Array.from(document.querySelectorAll('.layout_list_vertical[class*="pos-abso"]'));
  return containers.map((c, idx) => {
    const text = c.textContent?.replace(/\s+/g, ' ').trim().slice(0, 150);
    const links = Array.from(c.querySelectorAll('a')).map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent?.trim().slice(0, 60),
    }));
    // 슬라이드를 감싸는 부모 a 또는 onclick 핸들러 가진 요소
    let p = c.parentElement;
    let parentLinks = [];
    for (let i = 0; i < 5 && p; i++) {
      if (p.tagName === 'A' && p.href) parentLinks.push(p.href);
      p = p.parentElement;
    }
    const images = Array.from(c.querySelectorAll('img')).map((img) => ({
      src: img.src?.slice(0, 100),
      alt: img.alt,
    }));
    return { idx, text, links, parentLinks, images };
  });
});
console.log(JSON.stringify(slides, null, 2));

console.log('\n=== 페이지 전체 a 태그 중 /content/ 또는 /exhibitions/ 링크 ===');
const allLinks = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('a'))
    .map((a) => ({ href: a.getAttribute('href'), text: a.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) }))
    .filter((l) => l.href && (/\/content\/|\/exhibitions\//.test(l.href)) && l.text)
    .slice(0, 30);
});
console.log(JSON.stringify(allLinks, null, 2));

// 캐러셀 next 버튼 클릭으로 슬라이드 더 가져오기
console.log('\n=== 캐러셀 next 버튼 클릭하면서 슬라이드 모으기 ===');
const nextBtns = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button, [class*="next"], [class*="arrow"]'))
    .filter((el) => {
      const aria = el.getAttribute('aria-label') || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      return /next|다음/i.test(aria) || /next|arrow-right|chevron-right/i.test(cls);
    })
    .slice(0, 5)
    .map((el) => ({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '', aria: el.getAttribute('aria-label') }));
});
console.log('next 버튼 후보:', JSON.stringify(nextBtns, null, 2));

// 클릭 시도
const allTexts = new Set();
const initialSlides = await page.evaluate(() => Array.from(document.querySelectorAll('.layout_list_vertical[class*="pos-abso"]')).map((s) => s.textContent?.replace(/\s+/g, ' ').trim()));
initialSlides.forEach((t) => allTexts.add(t));
console.log(`초기 슬라이드: ${allTexts.size}개`);

try {
  for (let i = 0; i < 50; i++) {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [class*="next"], [class*="arrow-right"]'));
      const btn = btns.find((el) => {
        const aria = el.getAttribute('aria-label') || '';
        const cls = typeof el.className === 'string' ? el.className : '';
        return /next|다음/i.test(aria) || /next|arrow-right|chevron-right/i.test(cls);
      });
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) break;
    await page.waitForTimeout(400);
    const cur = await page.evaluate(() => Array.from(document.querySelectorAll('.layout_list_vertical[class*="pos-abso"]')).map((s) => s.textContent?.replace(/\s+/g, ' ').trim()));
    cur.forEach((t) => allTexts.add(t));
  }
} catch (e) {
  console.log('클릭 실패:', e.message);
}
console.log(`최종 모은 고유 슬라이드: ${allTexts.size}개`);

await browser.close();
