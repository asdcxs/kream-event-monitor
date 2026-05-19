import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();
await page.goto('https://kream.co.kr/exhibitions/feepromo', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('a[href*="/products/"]', { timeout: 15000 });
await page.waitForTimeout(3000);

const html = await page.evaluate(() => {
  const a = document.querySelector('a[href*="/products/"]');
  return a ? a.outerHTML : null;
});
console.log(html?.slice(0, 4000));

await browser.close();
