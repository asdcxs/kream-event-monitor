import { openKreamBrowser } from './browser.js';

export function parseVolume(s) {
  if (!s) return 0;
  const m = s.match(/거래\s*([0-9,.]+)\s*(만|억|천)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ''));
  const unit = m[2];
  if (unit === '만') n *= 10000;
  else if (unit === '억') n *= 100000000;
  else if (unit === '천') n *= 1000;
  return Math.round(n);
}

export function parsePrice(s) {
  if (!s) return 0;
  const m = s.match(/([0-9,]+)\s*원/);
  if (!m) return 0;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

export function isSizedProduct(brand, enName, koName) {
  const noSizeBrands = ['Apple', 'Beats', 'Samsung', 'LG', 'Sony', 'Bose', 'Sennheiser', 'JBL'];
  if (noSizeBrands.some((b) => brand?.toLowerCase().includes(b.toLowerCase()))) return false;
  const noSizeKeywords = ['AirPods', 'iPhone', 'iPad', 'MacBook', 'Galaxy', 'AirTag', 'Watch', 'TV', '키보드', '마우스', '헤드폰', '이어폰', '스피커', 'PlayStation', 'Xbox', 'Switch'];
  const text = `${enName || ''} ${koName || ''}`.toLowerCase();
  if (noSizeKeywords.some((kw) => text.includes(kw.toLowerCase()))) return false;
  return true;
}

export function computeProfit(price, { cardRate = 0.04, cardCap = 30000, buyFeeRate = 0.023, sellFeeRate = 0, minAmount = 0 } = {}) {
  if (!price) return null;
  if (minAmount && price < minAmount) return null;
  const cardDiscount = Math.min(Math.floor(price * cardRate), cardCap);
  const buyFee = Math.ceil(price * buyFeeRate);
  const sellFee = Math.round(price * sellFeeRate);
  return cardDiscount - buyFee - sellFee;
}

export async function scrapeExhibitionProducts(idOrUrl) {
  const url = String(idOrUrl).startsWith('http') ? idOrUrl : `https://kream.co.kr/exhibitions/${idOrUrl}`;
  const { ctx } = await openKreamBrowser();
  const page = await ctx.newPage();

  try {
    try {
      await page.goto('https://kream.co.kr/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    } catch {}
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try {
      await page.waitForSelector('a.item_inner[href*="/products/"]', { timeout: 15000 });
    } catch {
      return [];
    }

    let prev = 0;
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(900);
      const h = await page.evaluate(() => document.body.scrollHeight);
      if (h === prev) break;
      prev = h;
    }

    const items = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('a.item_inner[href*="/products/"]'));
      const seen = new Map();
      for (const c of cards) {
        const href = c.getAttribute('href') || '';
        const m = href.match(/\/products\/([^/?#]+)/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        seen.set(id, {
          id,
          url: `https://kream.co.kr/products/${id}`,
          volumeText: c.querySelector('.status_value')?.textContent?.trim() || '',
          brand: c.querySelector('.brand-name')?.textContent?.trim() || '',
          enName: c.querySelector('.product_info_product_name .name')?.textContent?.trim() || '',
          koName: c.querySelector('.product_info_product_name .translated_name')?.textContent?.trim() || '',
          priceText: c.querySelector('.price .amount')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        });
      }
      return Array.from(seen.values());
    });

    return items.map((it) => ({
      ...it,
      volume: parseVolume(it.volumeText),
      price: parsePrice(it.priceText),
      sized: isSizedProduct(it.brand, it.enName, it.koName),
    }));
  } finally {
    await ctx.close();
  }
}
