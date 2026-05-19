import { chromium } from 'playwright';

const productId = process.argv[2] || '38367';
const url = `https://kream.co.kr/products/${productId}`;

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 1400 },
});
const page = await ctx.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);

console.log('=== 상단 가격 영역 ===');
const topPrices = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('[class*="price"], [class*="amount"], [class*="buy"], [class*="sell"], [class*="bid"]'));
  return candidates.map((el) => ({
    cls: el.className,
    text: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100),
  })).filter((x) => x.text && /[0-9],?[0-9]+원|구매|판매|입찰/.test(x.text));
});
console.log(topPrices.slice(0, 30));

console.log('\n=== 탭 버튼 찾기 ===');
const tabs = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="tab"], a'));
  return all
    .filter((el) => /체결|판매 입찰|구매 입찰|시세/.test(el.textContent || ''))
    .map((el) => ({
      tag: el.tagName,
      cls: el.className,
      text: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60),
    }));
});
console.log(tabs);

// "판매 입찰" 탭 클릭 시도
console.log('\n=== 판매 입찰 탭 클릭 시도 ===');
try {
  await page.getByText('판매 입찰', { exact: false }).first().click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const sellBidsText = await page.evaluate(() => {
    const t = document.body.innerText;
    const idx = t.indexOf('판매 입찰');
    return t.slice(idx, idx + 1500);
  });
  console.log(sellBidsText);
} catch (e) {
  console.log('판매 입찰 클릭 실패:', e.message);
}

console.log('\n=== 구매 입찰 탭 클릭 시도 ===');
try {
  await page.getByText('구매 입찰', { exact: false }).first().click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const buyBidsText = await page.evaluate(() => {
    const t = document.body.innerText;
    const idx = t.indexOf('구매 입찰');
    return t.slice(idx, idx + 1500);
  });
  console.log(buyBidsText);
} catch (e) {
  console.log('구매 입찰 클릭 실패:', e.message);
}

await browser.close();
