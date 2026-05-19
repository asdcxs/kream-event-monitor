import { chromium } from 'playwright';

const url = process.argv[2] || 'https://kream.co.kr/exhibitions/feepromo';

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
await page.waitForTimeout(4000);

// 페이지 안에서 상품 카드를 추출. 크림 상품 URL 패턴: /products/{id} 또는 /products/{slug}
const result = await page.evaluate(() => {
  const title = document.title;
  const h1 = document.querySelector('h1, h2')?.textContent?.trim() || null;

  const productAnchors = Array.from(document.querySelectorAll('a[href*="/products/"]'));
  const products = [];
  const seen = new Set();

  for (const a of productAnchors) {
    const href = a.getAttribute('href') || '';
    const match = href.match(/\/products\/([^/?#]+)/);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const brand = a.querySelector('.product_info_brand, .brand-name')?.textContent?.trim();
    const name =
      a.querySelector('.product_info_title, .product-title, p')?.textContent?.trim() ||
      a.querySelector('img')?.getAttribute('alt') ||
      null;
    const price = a.querySelector('.amount, .price')?.textContent?.trim() || null;
    const img = a.querySelector('img')?.getAttribute('src') || null;

    products.push({
      id,
      url: `https://kream.co.kr/products/${id}`,
      brand,
      name,
      price,
      img,
      rawText: a.textContent?.replace(/\s+/g, ' ').trim().slice(0, 150),
    });
  }

  return {
    title,
    h1,
    productCount: products.length,
    sample: products.slice(0, 8),
    allProductIds: products.map((p) => p.id),
  };
});

console.log('=== Exhibition probe ===');
console.log('URL:', url);
console.log('Page title:', result.title);
console.log('H1/H2:', result.h1);
console.log('상품 카드 개수:', result.productCount);
console.log('\n샘플 8개:');
for (const p of result.sample) {
  console.log(`  - [${p.id}]`);
  console.log(`    URL: ${p.url}`);
  console.log(`    raw: ${p.rawText}`);
}
console.log('\n전체 상품 ID 목록:');
console.log(result.allProductIds);

await browser.close();
