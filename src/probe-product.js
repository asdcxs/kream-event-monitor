import { chromium } from 'playwright';

const productId = process.argv[2] || '38367';
const url = `https://kream.co.kr/products/${productId}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4500);

const result = await page.evaluate(() => {
  const pickText = (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || null;

  // 페이지 본문에서 라벨 키워드 옆 값 뽑기 (한국어 라벨 기반)
  const bodyText = document.body.innerText;

  const grabAfterLabel = (label) => {
    const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
    const idx = lines.findIndex((l) => l === label);
    if (idx >= 0 && idx + 1 < lines.length) return lines[idx + 1];
    const re = new RegExp(`${label}\\s*[:：]?\\s*([^\\n]+)`);
    const m = bodyText.match(re);
    return m ? m[1].trim() : null;
  };

  const brand = pickText('h1 a, .brand_title, .product-brand');
  const enName = pickText('.product_info_title_en, .product-en-name');
  const koName = pickText('.product_info_title_kr, .product-kr-name');

  const recentSale = grabAfterLabel('최근 거래가');
  const buyNow = grabAfterLabel('즉시 구매가');
  const sellNow = grabAfterLabel('즉시 판매가');
  const tradeCount = grabAfterLabel('거래 체결');

  // 라벨 매칭이 실패하면 본문 일부 반환해 디버깅
  return {
    title: document.title,
    pickedHeadings: {
      brand,
      enName,
      koName,
    },
    labeled: {
      '최근 거래가': recentSale,
      '즉시 구매가': buyNow,
      '즉시 판매가': sellNow,
      '거래 체결': tradeCount,
    },
    bodyTextSample: bodyText.slice(0, 2000),
  };
});

console.log('=== Product probe ===');
console.log('URL:', url);
console.log('Title:', result.title);
console.log('\nHeadings:', result.pickedHeadings);
console.log('\nLabeled values:', result.labeled);
console.log('\nBody sample (first 2000 chars):');
console.log(result.bodyTextSample);

await browser.close();
