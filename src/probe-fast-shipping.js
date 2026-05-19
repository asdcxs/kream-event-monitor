import { chromium } from 'playwright';

const productId = process.argv[2] || '38367';
const url = `https://kream.co.kr/products/${productId}`;

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 1600 },
});
const page = await ctx.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(5000);

console.log('=== "빠른배송" 텍스트 주변 가격 ===');
const fastShippingInfo = await page.evaluate(() => {
  const allElements = Array.from(document.querySelectorAll('*'));
  const fastEls = allElements.filter((el) => {
    const text = el.textContent || '';
    return text.includes('빠른배송') && text.length < 500;
  });

  return fastEls.slice(0, 20).map((el) => ({
    tag: el.tagName,
    cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
    text: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200),
  }));
});
console.log(JSON.stringify(fastShippingInfo, null, 2));

console.log('\n=== price-info-container 자세히 ===');
const priceInfo = await page.evaluate(() => {
  const containers = Array.from(document.querySelectorAll('[class*="price-info"]'));
  return containers.map((c) => ({
    cls: typeof c.className === 'string' ? c.className.slice(0, 100) : '',
    html: c.innerHTML.slice(0, 1500),
    text: c.textContent?.replace(/\s+/g, ' ').trim(),
  }));
});
console.log(JSON.stringify(priceInfo, null, 2));

console.log('\n=== 모든 "원"으로 끝나는 텍스트와 부모 클래스 ===');
const priceTexts = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const results = [];
  let n;
  while ((n = walker.nextNode())) {
    const text = n.nodeValue?.trim() || '';
    if (/^[0-9,]+원$/.test(text)) {
      const parent = n.parentElement;
      const grand = parent?.parentElement;
      results.push({
        text,
        parentCls: parent?.className?.toString().slice(0, 80),
        grandCls: grand?.className?.toString().slice(0, 80),
        nearbyText: grand?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 150),
      });
    }
  }
  return results.slice(0, 25);
});
console.log(JSON.stringify(priceTexts, null, 2));

await browser.close();
