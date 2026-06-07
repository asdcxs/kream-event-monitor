import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKreamBrowser } from './browser.js';
import { scrapeBenefits, loadCachedBenefits } from './scrape-benefits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXHIBITION_SLUG = process.argv[2] || 'feepromo';
const URL_ = `https://kream.co.kr/exhibitions/${EXHIBITION_SLUG}`;
const OUT_PATH = path.join(__dirname, '..', 'data', `${EXHIBITION_SLUG}-ranked.html`);
const CACHE_PATH = path.join(__dirname, '..', 'data', `${EXHIBITION_SLUG}-cache.json`);

function parseVolume(s) {
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

function parsePrice(s) {
  if (!s) return 0;
  const m = s.match(/([0-9,]+)\s*원/);
  if (!m) return 0;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

// 브랜드/상품명 휴리스틱으로 "사이즈 매물" 여부 추정
// true = 사이즈 선택 필요 상품 (신발/의류), false = 사이즈 없는 상품 (전자/액세서리)
function isSizedProduct(brand, enName, koName) {
  const noSizeBrands = ['Apple', 'Beats', 'Samsung', 'LG', 'Sony', 'Bose', 'Sennheiser', 'JBL', 'Marshall', 'Bang & Olufsen', 'Dyson', 'Logitech', 'Razer'];
  if (noSizeBrands.some((b) => brand?.toLowerCase().includes(b.toLowerCase()))) return false;

  const noSizeKeywords = [
    'AirPods', 'iPhone', 'iPad', 'MacBook', 'iMac', 'Mac Mini', 'Mac Studio', 'Apple TV', 'AirTag', 'HomePod', 'Apple Watch',
    'Galaxy Buds', 'Galaxy Watch', 'Galaxy Tab', 'Galaxy Book', 'Galaxy S', 'Galaxy Z',
    'Solo 4', 'Studio 3', 'Studio Pro', 'Powerbeats', 'Beats Fit', 'Beats Pill',
    'TV', '키보드', '마우스', '헤드폰', '이어폰', '스피커', '충전기', '카메라', '냉장고', '세탁기', '청소기', '에어컨', '쿨링패드',
    'Headphone', 'Earphone', 'Speaker', 'Camera', 'Console', 'PlayStation', 'PS5', 'Xbox', 'Switch',
  ];
  const text = `${enName} ${koName}`.toLowerCase();
  if (noSizeKeywords.some((kw) => text.includes(kw.toLowerCase()))) return false;

  return true;
}

const { ctx, isAuthenticated, wasInitialized } = await openKreamBrowser();
if (isAuthenticated) console.log('✓ 로그인 세션 사용 중');
else if (wasInitialized) console.log('(프로필은 있지만 로그인 쿠키 없음 — 비로그인 모드)');
const page = await ctx.newPage();

console.log(`Fetching ${URL_} ...`);

// 차단 회피용: 메인 → 이벤트 페이지 순으로 자연스럽게
let scrapeAttempts = 0;
let scraped = false;
while (scrapeAttempts < 3 && !scraped) {
  scrapeAttempts++;
  try {
    if (scrapeAttempts === 1) {
      await page.goto('https://kream.co.kr/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
    }
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    await page.waitForSelector('a.item_inner[href*="/products/"]', { timeout: 25000 });
    scraped = true;
  } catch (e) {
    console.warn(`시도 ${scrapeAttempts}/3 실패: ${e.message.split('\n')[0]}`);
    if (scrapeAttempts < 3) {
      const wait = scrapeAttempts * 15000;
      console.log(`${wait / 1000}초 대기 후 재시도...`);
      await page.waitForTimeout(wait);
    }
  }
}

let prevHeight = 0;
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
  const h = await page.evaluate(() => document.body.scrollHeight);
  if (h === prevHeight) break;
  prevHeight = h;
}

const pageTitle = await page.title();

const items = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('a.item_inner[href*="/products/"]'));
  const seen = new Map();
  for (const c of cards) {
    const href = c.getAttribute('href') || '';
    const m = href.match(/\/products\/([^/?#]+)/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;

    const volumeText = c.querySelector('.status_value')?.textContent?.trim() || '';
    const brand = c.querySelector('.brand-name')?.textContent?.trim() || '';
    const enName = c.querySelector('.product_info_product_name .name')?.textContent?.trim() || '';
    const koName = c.querySelector('.product_info_product_name .translated_name')?.textContent?.trim() || '';
    const priceText = c.querySelector('.price .amount')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const tags = Array.from(c.querySelectorAll('.display_tag_item .tag_text')).map((t) => t.textContent.trim());
    const img = c.querySelector('img')?.getAttribute('src') || '';

    seen.set(id, { id, url: `https://kream.co.kr/products/${id}`, volumeText, brand, enName, koName, priceText, tags, img });
  }
  return Array.from(seen.values());
});

await ctx.close();

let products = items.map((it) => ({
  ...it,
  volume: parseVolume(it.volumeText),
  price: parsePrice(it.priceText),
  sized: isSizedProduct(it.brand, it.enName, it.koName),
}));

if (products.length > 0) {
  await fs.writeFile(CACHE_PATH, JSON.stringify(products), 'utf8');
  console.log(`총 ${products.length}개 상품 수집 완료 → 캐시 저장`);
} else {
  console.warn('스크래핑 결과 0개. 캐시에서 로드 시도...');
  try {
    products = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
    console.log(`캐시에서 ${products.length}개 복구`);
  } catch {
    console.warn('캐시 없음 — 빈 페이지로 진행');
  }
}
console.log(`(사이즈 매물 ${products.filter((p) => p.sized).length} / 사이즈 없음 ${products.filter((p) => !p.sized).length})`);

console.log('결제 혜택 페이지도 가져오는 중...');
let benefits = [];
try {
  benefits = await scrapeBenefits();
} catch (e) {
  console.warn(`혜택 스크래핑 실패: ${e.message.split('\n')[0]}`);
}
if (benefits.length === 0) {
  benefits = await loadCachedBenefits();
  console.log(`혜택 캐시에서 ${benefits.length}개 복구`);
} else {
  console.log(`결제 혜택 ${benefits.length}개 수집 완료`);
}

const dataJson = JSON.stringify(products);
const benefitsJson = JSON.stringify(benefits);

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${pageTitle} — 수수료 계산기</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<style>
  :root {
    --bg: #0a0a0a;
    --panel: #111;
    --card: #161616;
    --card-hover: #1f1f1f;
    --border: #262626;
    --text: #fafafa;
    --muted: #999;
    --dim: #666;
    --accent: #00d066;
    --neg: #ef4444;
    --warn: #f59e0b;
    --blue: #3b82f6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  header {
    padding: 28px 32px 16px;
    border-bottom: 1px solid var(--border);
    max-width: 1400px;
    margin: 0 auto;
  }
  header h1 { margin: 0 0 6px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
  header .meta { color: var(--muted); font-size: 12.5px; }
  header .meta a { color: var(--accent); text-decoration: none; }

  /* 결제 혜택 노티스 */
  .benefits {
    max-width: 1400px;
    margin: 0 auto;
    padding: 18px 32px 22px;
    background: linear-gradient(180deg, rgba(0,208,102,0.04), transparent);
    border-bottom: 1px solid var(--border);
  }
  .benefits-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .benefits-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .benefits-title .count {
    background: var(--card);
    color: var(--accent);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    border: 1px solid var(--border);
    font-weight: 700;
  }
  .benefits-tabs {
    display: flex;
    gap: 4px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
  }
  .benefits-tabs button {
    background: transparent;
    color: var(--muted);
    border: none;
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, color 0.12s;
  }
  .benefits-tabs button.active {
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--border);
  }
  .benefits-tabs button:hover:not(.active) { color: var(--text); }

  .benefits-scroll {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-bottom: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
    cursor: grab;
    user-select: none;
  }
  .benefits-scroll.dragging { cursor: grabbing; scroll-snap-type: none; }
  .benefits-scroll.dragging a { pointer-events: none; }
  .benefits-scroll::-webkit-scrollbar { height: 6px; }
  .benefits-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .benefits-scroll::-webkit-scrollbar-track { background: transparent; }

  .benefit {
    flex: 0 0 240px;
    min-height: 108px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 12.5px;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    gap: 5px;
    text-decoration: none;
    color: inherit;
    scroll-snap-align: start;
    cursor: pointer;
    transition: background 0.12s, transform 0.12s, border-color 0.12s;
    position: relative;
  }
  .benefit:hover {
    background: var(--card-hover);
    transform: translateY(-2px);
  }
  .benefit.instant { border-left: 3px solid var(--accent); }
  .benefit.billed { border-left: 3px solid var(--blue); }

  .benefit .b-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .benefit .b-method {
    font-weight: 700;
    color: var(--text);
    font-size: 13px;
    line-height: 1.25;
  }
  .benefit .b-rate {
    color: var(--accent);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
    flex-shrink: 0;
  }
  .benefit .b-rate.billed { color: var(--blue); }
  .benefit .b-cond { color: var(--muted); font-size: 11.5px; }
  /* 구간별 미니 테이블 */
  .benefit .b-tiers {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0;
  }
  .benefit .b-tier {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    padding: 2px 6px;
    background: rgba(255,255,255,0.03);
    border-radius: 4px;
  }
  .benefit .b-tier span { color: var(--muted); }
  .benefit .b-tier b { color: var(--accent); font-variant-numeric: tabular-nums; }
  .benefit.bt-tiered { border-left: 3px solid var(--warn); }
  .benefit.bt-percent { border-left: 3px solid var(--blue); }
  .benefit.bt-flat { border-left: 3px solid var(--accent); }
  .benefit.bt-external { border-left: 3px solid var(--dim); }
  .benefit .b-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--dim);
    font-size: 11px;
    margin-top: auto;
    padding-top: 6px;
  }
  .benefit .b-type {
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 700;
    background: rgba(255,255,255,0.04);
  }
  .benefit .b-type.instant { color: var(--accent); }
  .benefit .b-type.billed { color: var(--blue); }
  .benefit .b-arrow {
    opacity: 0.4;
    transition: opacity 0.12s, transform 0.12s;
  }
  .benefit:hover .b-arrow {
    opacity: 1;
    transform: translateX(2px);
  }

  .controls {
    max-width: 1400px;
    margin: 0 auto;
    padding: 16px 32px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ctrl-pick select { font-size: 15px; padding: 10px 12px; font-weight: 600; }
  .adv-panel {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
    overflow: hidden;
  }
  .adv-summary {
    list-style: none;
    cursor: pointer;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    user-select: none;
  }
  .adv-summary::-webkit-details-marker { display: none; }
  .adv-sub { color: var(--dim); font-weight: 400; font-size: 11.5px; margin-left: 4px; }
  .adv-chevron { color: var(--muted); transition: transform 0.15s; }
  .adv-panel[open] .adv-chevron { transform: rotate(180deg); }
  .adv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    padding: 4px 14px 16px;
    align-items: start;
  }
  /* 라벨 높이 통일 → 입력칸이 같은 높이에서 시작, small 은 아래로 흘림 */
  .adv-grid .ctrl:not(.toggle) { display: flex; flex-direction: column; }
  .adv-grid .ctrl:not(.toggle) label { min-height: 16px; line-height: 1.3; }
  .adv-grid .ctrl.toggle { align-self: start; padding-top: 24px; }
  .ctrl label {
    display: block;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }
  .ctrl input, .ctrl select {
    width: 100%;
    background: var(--card);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 14px;
    font-family: inherit;
  }
  .ctrl input:focus, .ctrl select:focus { outline: none; border-color: var(--accent); }
  .ctrl small { display: block; color: var(--dim); font-size: 11px; margin-top: 4px; }
  .ctrl-wide { grid-column: span 2; }
  @media (max-width: 800px) { .ctrl-wide { grid-column: span 1; } }

  /* 고정 수수료 표시 */
  .lock-badge {
    font-size: 9px;
    color: var(--dim);
    background: rgba(255,255,255,0.05);
    padding: 1px 5px;
    border-radius: 4px;
    letter-spacing: 0;
    margin-left: 4px;
  }
  .fees-fixed {
    display: flex;
    gap: 12px;
    background: var(--card);
    border: 1px dashed var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .fees-fixed b { color: var(--text); font-variant-numeric: tabular-nums; }
  /* 편집 가능한 카드 필드 강조 */
  .ctrl.edit input { border-color: rgba(0,208,102,0.35); }
  .ctrl.edit label { color: var(--accent); }
  .ctrl.toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
  }
  .switch {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 1px;
    left: 1px;
    width: 16px;
    height: 16px;
    background: var(--muted);
    border-radius: 50%;
    transition: transform 0.15s, background 0.15s;
  }
  .switch.on { background: rgba(0,208,102,0.2); border-color: var(--accent); }
  .switch.on::after { transform: translateX(16px); background: var(--accent); }
  .switch-label { font-size: 13px; color: var(--text); cursor: pointer; user-select: none; }

  .summary {
    max-width: 1400px;
    margin: 0 auto;
    padding: 14px 32px;
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    color: var(--muted);
    font-size: 13px;
    border-bottom: 1px solid var(--border);
  }
  .summary strong { color: var(--text); font-size: 15px; margin-right: 4px; font-weight: 700; }
  .summary .pos { color: var(--accent); }
  .summary .neg { color: var(--neg); }

  main { max-width: 1400px; margin: 0 auto; padding: 20px 32px 80px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }

  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    display: flex;
    flex-direction: column;
    transition: background 0.15s, transform 0.15s, border-color 0.15s;
    position: relative;
  }
  .card:hover { background: var(--card-hover); transform: translateY(-2px); }
  .card.profit { border-color: rgba(0, 208, 102, 0.5); }
  .card.loss { border-color: rgba(239, 68, 68, 0.3); }

  .rank {
    position: absolute; top: 8px; left: 8px;
    background: rgba(0,0,0,0.75); color: var(--text);
    font-size: 11px; font-weight: 700;
    padding: 4px 8px; border-radius: 6px; z-index: 1;
  }
  .rank.top-profit { background: var(--accent); color: #000; }
  .badge-sized {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0,0,0,0.75);
    color: var(--warn);
    font-size: 10px;
    font-weight: 700;
    padding: 3px 6px;
    border-radius: 6px;
    z-index: 1;
  }
  .badge-express {
    position: absolute;
    top: 8px;
    left: 8px;
    background: var(--accent);
    color: #000;
    font-size: 10px;
    font-weight: 800;
    padding: 3px 7px;
    border-radius: 6px;
    z-index: 2;
  }
  /* 빠른배송 배지가 있으면 랭크는 그 아래로 */
  .card.has-express .rank { top: 34px; }

  .img-wrap {
    aspect-ratio: 1;
    background: #f5f5f5;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .img-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .head-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .brand { font-size: 12px; font-weight: 700; color: var(--text); }
  .volume { font-size: 11px; color: var(--muted); font-weight: 600; }
  .name-ko {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 31px;
  }
  .price-main {
    font-size: 18px;
    font-weight: 800;
    color: var(--text);
    margin-top: 6px;
    letter-spacing: -0.02em;
  }
  .calc {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 8px;
    font-size: 11.5px;
  }
  .calc .lbl { color: var(--dim); }
  .calc .val { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .calc .val.pos { color: var(--accent); }
  .calc .val.neg { color: var(--neg); }
  .profit-row {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 13px;
  }
  .profit-row .lbl { color: var(--text); font-weight: 600; }
  .profit-row .val { font-weight: 800; font-variant-numeric: tabular-nums; }
  .profit-row .val.pos { color: var(--accent); }
  .profit-row .val.neg { color: var(--neg); }

  @media (max-width: 640px) {
    header { padding: 18px 14px 12px; }
    header h1 { font-size: 18px; }
    header .meta { font-size: 11px; }
    .benefits, .summary { padding: 12px 14px; }
    main { padding: 12px 14px 100px; }

    /* 컨트롤: 모바일에선 설정 접기 + 2열 그리드, 입력 큼직하게 */
    .controls { padding: 12px 14px; }
    .adv-grid {
      grid-template-columns: 1fr 1fr;
      gap: 12px 10px;
    }
    .ctrl-fees { grid-column: 1 / -1; }
    .ctrl.toggle { grid-column: span 1; }
    .ctrl input, .ctrl select {
      font-size: 16px;  /* iOS 자동 줌 방지 */
      padding: 12px;
      border-radius: 8px;
    }
    .ctrl-pick select { font-size: 16px; padding: 13px 12px; }
    .ctrl label { font-size: 11px; margin-bottom: 5px; }
    .fees-fixed { font-size: 14px; padding: 11px 12px; }

    /* 상품 그리드: 2열 */
    .grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .body { padding: 11px; gap: 3px; }
    .name-ko { font-size: 11.5px; min-height: 28px; }
    .price-main { font-size: 15px; }
    .calc { font-size: 11px; gap: 1px 6px; }
    .profit-row { font-size: 13px; }

    /* 혜택 카드 살짝 작게 */
    .benefit { flex: 0 0 200px; min-height: 100px; }
    .benefits-tabs button { padding: 6px 10px; }

    /* 요약을 하단 고정 바로 */
    .summary {
      position: sticky;
      bottom: 0;
      z-index: 5;
      background: rgba(10,10,10,0.96);
      backdrop-filter: blur(8px);
      border-top: 1px solid var(--border);
      gap: 12px;
      font-size: 12px;
      flex-wrap: wrap;
    }
    .summary strong { font-size: 14px; }
  }
  @media (max-width: 380px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <h1>${pageTitle.replace(/\s*\|\s*KREAM/, '')}</h1>
  <div class="meta">
    수수료 100% 할인 + 결제 혜택 결합 손익 계산기 ·
    <a href="${URL_}" target="_blank" rel="noopener">원본 이벤트 →</a>
    <a href="https://kream.co.kr/content/11368" target="_blank" rel="noopener" style="margin-left:8px">결제 혜택 페이지 →</a>
    · 생성 ${new Date().toLocaleString('ko-KR')}
  </div>
</header>

<section class="benefits">
  <div class="benefits-header">
    <div class="benefits-title">
      현재 진행 중인 결제 혜택 <span class="count" id="benefitCount">${benefits.length}</span>
    </div>
    <div class="benefits-tabs" id="benefitsTabs">
      <button class="active" data-filter="all">전체</button>
      <button data-filter="instant">즉시할인</button>
      <button data-filter="billed">청구할인</button>
    </div>
  </div>
  <div class="benefits-scroll" id="benefitsScroll"></div>
</section>

<div class="controls">
  <div class="ctrl ctrl-pick">
    <label>결제 혜택 선택</label>
    <select id="benefitSelect"></select>
    <small id="benefitHint">드롭다운 변경 시 아래 값이 자동 적용됩니다</small>
  </div>
  <details class="adv-panel" id="ctrlPanel">
    <summary class="adv-summary">
      <span>⚙️ 계산 설정 <span class="adv-sub">수수료 · 카드 · 정렬 · 필터</span></span>
      <span class="adv-chevron">▾</span>
    </summary>
    <div class="adv-grid">
      <div class="ctrl ctrl-fees">
        <label>수수료 <span class="lock-badge">🔒 고정</span></label>
        <div class="fees-fixed">
          <span>매수 <b>2.3%</b></span>
          <span>매도 <b>0.55%</b></span>
        </div>
        <input type="hidden" id="buyFeeRate" value="2.3" />
        <input type="hidden" id="sellFeeRate" value="0.55" />
      </div>
      <div class="ctrl edit">
        <label>카드 할인율 (%)</label>
        <input type="number" id="cardRate" value="4" step="0.1" min="0" inputmode="decimal" />
        <small>0이면 정액 할인</small>
      </div>
      <div class="ctrl edit">
        <label>할인 한도/금액 (원)</label>
        <input type="number" id="cardCap" value="30000" step="1000" min="0" inputmode="numeric" />
      </div>
      <div class="ctrl edit">
        <label>최소 결제 (원)</label>
        <input type="number" id="minAmount" value="0" step="10000" min="0" inputmode="numeric" />
        <small>미달 시 혜택 없음</small>
      </div>
      <div class="ctrl">
        <label>정렬</label>
        <select id="sortBy">
          <option value="profit">순이익 큰 순</option>
          <option value="volume">거래량 큰 순</option>
          <option value="price-desc">가격 높은 순</option>
          <option value="price-asc">가격 낮은 순</option>
        </select>
      </div>
      <div class="ctrl toggle">
        <div class="switch on" id="hideSizedSwitch" role="checkbox" aria-checked="true"></div>
        <label class="switch-label" for="hideSizedSwitch" onclick="document.getElementById('hideSizedSwitch').click()">사이즈 매물 숨기기</label>
      </div>
      <div class="ctrl toggle">
        <div class="switch on" id="hideLossSwitch" role="checkbox" aria-checked="true"></div>
        <label class="switch-label" for="hideLossSwitch" onclick="document.getElementById('hideLossSwitch').click()">손실 상품 숨기기</label>
      </div>
      <div class="ctrl toggle">
        <div class="switch" id="expressOnlySwitch" role="checkbox" aria-checked="false"></div>
        <label class="switch-label" for="expressOnlySwitch" onclick="document.getElementById('expressOnlySwitch').click()">⚡ 빠른배송만</label>
      </div>
    </div>
  </details>
</div>

<div class="summary" id="summary"></div>

<main><div class="grid" id="grid"></div></main>

<script>
const DATA = ${dataJson};
const BENEFITS = ${benefitsJson};

const $ = (id) => document.getElementById(id);

function fmt(n) { return n.toLocaleString('ko-KR') + '원'; }

let selectedBenefit = null;

// 선택된 혜택의 타입에 따라 가격별 카드 할인액 계산
function discountForBenefit(price, b, inp) {
  if (!price) return 0;
  if (b.benefitType === 'percent') {
    if (b.minAmount && price < b.minAmount) return 0;
    const cap = b.cap || inp.cardCap || Infinity; // 혜택 자체 캡 우선 (예: 현대 3% 최대 25,000)
    return Math.min(Math.floor(price * (b.percent / 100)), cap);
  }
  if (b.benefitType === 'tiered') {
    let amt = 0;
    for (const t of (b.tiers || [])) if (price >= t.threshold) amt = t.amount;
    return amt; // 최저 구간 미달이면 0
  }
  if (b.benefitType === 'flat') {
    const min = b.minAmount || 0;
    return price >= min ? (b.flatAmount || 0) : 0;
  }
  return 0; // external
}

function compute(p, inp) {
  if (!p) return null;
  const buyFee = Math.ceil(p * inp.buyFeeRate);
  const sellFee = Math.round(p * inp.sellFeeRate);

  let cardDiscount;
  if (selectedBenefit) {
    cardDiscount = discountForBenefit(p, selectedBenefit, inp);
  } else if (inp.minAmount && p < inp.minAmount) {
    cardDiscount = 0;
  } else if (inp.cardRate > 0) {
    cardDiscount = Math.min(Math.floor(p * inp.cardRate), inp.cardCap || Infinity);
  } else {
    cardDiscount = inp.cardCap; // 정액 할인
  }
  const profit = cardDiscount - buyFee - sellFee;
  return { cardDiscount, buyFee, sellFee, profit, ineligible: cardDiscount === 0 };
}

function readInputs() {
  return {
    buyFeeRate: (parseFloat($('buyFeeRate').value) || 0) / 100,
    sellFeeRate: (parseFloat($('sellFeeRate').value) || 0) / 100,
    cardRate: (parseFloat($('cardRate').value) || 0) / 100,
    cardCap: parseFloat($('cardCap').value) || 0,
    minAmount: parseFloat($('minAmount').value) || 0,
    sortBy: $('sortBy').value,
    hideSized: $('hideSizedSwitch').classList.contains('on'),
    hideLoss: $('hideLossSwitch').classList.contains('on'),
    expressOnly: $('expressOnlySwitch').classList.contains('on'),
  };
}

// 혜택의 대표 카드 파라미터 (직접입력 필드 채우기용)
function benefitToParams(b) {
  if (b.benefitType === 'percent') {
    return { cardRate: b.percent || 0, cardCap: b.cap || 30000, minAmount: b.minAmount || 0 };
  }
  if (b.benefitType === 'tiered') {
    const maxAmt = (b.tiers || []).reduce((m, t) => Math.max(m, t.amount), 0);
    return { cardRate: 0, cardCap: maxAmt, minAmount: b.minAmount || 0 };
  }
  // flat
  return { cardRate: 0, cardCap: b.flatAmount || 0, minAmount: b.minAmount || 0 };
}

const TYPE_LABEL = { percent: '정률', tiered: '구간별', flat: '정액', external: '외부' };

function benefitMethodName(b) {
  const method = b.payMethods.length ? b.payMethods.join(' × ') : (b.cards[0] || '카드');
  const cardSuffix = b.payMethods.length && b.cards.length ? \` (\${b.cards[0]})\` : '';
  return method + cardSuffix;
}

function benefitLabel(b) {
  const name = benefitMethodName(b);
  let amt = '';
  if (b.benefitType === 'percent') amt = (b.percent || 0) + '%' + (b.cap ? \` 최대\${(b.cap/10000>=1?(b.cap/10000)+'만':(b.cap/1000)+'천')}\` : '');
  else if (b.benefitType === 'tiered') {
    const maxAmt = (b.tiers || []).reduce((m, t) => Math.max(m, t.amount), 0);
    amt = '최대 ' + maxAmt.toLocaleString() + '원';
  } else if (b.benefitType === 'flat') amt = (b.flatAmount || 0).toLocaleString() + '원';
  else return name + ' · 외부 이벤트';
  const cond = b.minAmount ? \` · \${(b.minAmount / 10000).toFixed(0)}만+\` : '';
  const rep = b.totalCount ? \` · 총\${b.totalCount}회\` : (b.participation ? \` · \${b.participation}회\` : '');
  return \`[\${TYPE_LABEL[b.benefitType]}] \${name} \${amt}\${cond}\${rep}\`;
}

function initBenefitSelect() {
  const sel = $('benefitSelect');
  // 계산 가능한 혜택만 (외부 링크 제외)
  const selectable = BENEFITS
    .map((b, originalIdx) => ({ b, originalIdx }))
    .filter((s) => s.b.benefitType !== 'external');

  sel.innerHTML = '<option value="-1">— 직접 입력 —</option>' +
    selectable.map((s, i) => \`<option value="\${s.originalIdx}" \${i === 0 ? 'selected' : ''}>\${benefitLabel(s.b)}</option>\`).join('');

  sel.addEventListener('change', () => {
    const idx = parseInt(sel.value);
    if (idx < 0) { selectedBenefit = null; updateBenefitHint(); render(); return; }
    const b = BENEFITS[idx];
    selectedBenefit = b;
    const p = benefitToParams(b);
    $('cardRate').value = p.cardRate || 0;
    $('cardCap').value = p.cardCap || 0;
    $('minAmount').value = p.minAmount || 0;
    updateBenefitHint();
    render();
  });

  // 직접 입력 외 input 수정 시 드롭다운을 "직접 입력"으로
  ['cardRate', 'cardCap', 'minAmount'].forEach((id) => {
    $(id).addEventListener('input', () => {
      sel.value = '-1';
      selectedBenefit = null;
      updateBenefitHint();
    });
  });

  // 초기 자동 적용
  if (selectable.length > 0 && sel.value !== '-1') {
    sel.dispatchEvent(new Event('change'));
  }
}

function updateBenefitHint() {
  const hint = $('benefitHint');
  if (!hint) return;
  if (!selectedBenefit) { hint.textContent = '직접 입력 모드 — 카드 할인율/한도/최소결제 적용'; return; }
  const b = selectedBenefit;
  if (b.benefitType === 'tiered') {
    hint.innerHTML = '구간별: ' + (b.tiers || []).map((t) => \`\${(t.threshold/10000).toFixed(0)}만→\${(t.amount/10000)>=1?(t.amount/10000)+'만':(t.amount/1000)+'천'}\`).join(' / ') + (b.totalCount ? \` (총 \${b.totalCount}회)\` : '');
  } else if (b.benefitType === 'percent') {
    hint.textContent = \`정률 \${b.percent}%\${b.cap ? ' · 최대 '+b.cap.toLocaleString()+'원' : ''}\${b.minAmount ? ' · '+(b.minAmount/10000).toFixed(0)+'만원 이상' : ''} — 상품별 자동 계산\`;
  } else {
    hint.textContent = \`정액 \${(b.flatAmount||0).toLocaleString()}원\${b.minAmount? ' · '+(b.minAmount/10000).toFixed(0)+'만원 이상':''}\`;
  }
}

// 가로 스크롤 드래그
function initDragScroll() {
  const scroll = $('benefitsScroll');
  let isDown = false;
  let startX = 0;
  let scrollStart = 0;
  let dragged = false;

  scroll.addEventListener('mousedown', (e) => {
    isDown = true;
    dragged = false;
    startX = e.pageX;
    scrollStart = scroll.scrollLeft;
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const dx = e.pageX - startX;
    if (Math.abs(dx) > 5) {
      dragged = true;
      scroll.classList.add('dragging');
    }
    scroll.scrollLeft = scrollStart - dx;
  });
  window.addEventListener('mouseup', () => {
    if (!isDown) return;
    isDown = false;
    scroll.classList.remove('dragging');
    if (dragged) {
      setTimeout(() => { dragged = false; }, 50);
    }
  });
  scroll.addEventListener('click', (e) => {
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // 터치 (모바일)
  scroll.addEventListener('touchstart', (e) => {
    isDown = true;
    dragged = false;
    startX = e.touches[0].pageX;
    scrollStart = scroll.scrollLeft;
  }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (!isDown) return;
    const dx = e.touches[0].pageX - startX;
    if (Math.abs(dx) > 5) dragged = true;
    scroll.scrollLeft = scrollStart - dx;
  }, { passive: true });
  scroll.addEventListener('touchend', () => {
    isDown = false;
    if (dragged) setTimeout(() => { dragged = false; }, 50);
  });
}

let benefitFilter = 'all';

function renderBenefits() {
  const filtered = BENEFITS.filter((b) => {
    if (benefitFilter === 'instant') return b.discountType === '즉시할인';
    if (benefitFilter === 'billed') return b.discountType === '청구할인';
    return true;
  });

  $('benefitsScroll').innerHTML = filtered.map((b) => {
    const method = benefitMethodName(b);
    const typeKey = b.discountType === '청구할인' ? 'billed' : 'instant';
    const url = b.url || 'https://kream.co.kr/content/11368';
    const bt = b.benefitType;

    // 상단 우측 요약 값
    let rateText = '';
    if (bt === 'percent') rateText = \`\${b.percent}%\`;  // 캡은 본문에 표시
    else if (bt === 'flat') rateText = \`\${(b.flatAmount || 0).toLocaleString()}원\`;
    else if (bt === 'tiered') rateText = \`최대 \${((b.tiers||[]).reduce((m,t)=>Math.max(m,t.amount),0)).toLocaleString()}\`;
    else rateText = '이벤트';

    // 본문: 타입별
    let bodyHtml = '';
    if (bt === 'tiered') {
      bodyHtml = '<div class="b-tiers">' + (b.tiers || []).map((t) => {
        const amtTxt = t.amount >= 10000 ? (t.amount/10000)+'만' : (t.amount/1000)+'천';
        return \`<div class="b-tier"><span>\${(t.threshold/10000).toFixed(0)}만↑</span><b>\${amtTxt}원</b></div>\`;
      }).join('') + '</div>';
    } else if (bt === 'percent') {
      const capTxt = b.cap ? \` · 최대 \${b.cap.toLocaleString()}원\` : '';
      bodyHtml = \`<div class="b-cond">\${b.minAmount ? (b.minAmount/10000).toFixed(0)+'만원 이상' : '금액 무관'}\${capTxt}</div>\`;
    } else if (bt === 'flat') {
      bodyHtml = \`<div class="b-cond">\${b.minAmount ? (b.minAmount/10000).toFixed(0)+'만원 이상' : ''} 정액 할인</div>\`;
    } else {
      bodyHtml = \`<div class="b-cond">\${b.title || '외부 이벤트'}</div>\`;
    }

    const rep = b.totalCount ? \`총 \${b.totalCount}회\` : (b.participation ? \`\${b.participation}회\` : '');

    return \`
      <a class="benefit \${typeKey} bt-\${bt}" href="\${url}" target="_blank" rel="noopener">
        <div class="b-head">
          <span class="b-method">\${method}</span>
          <span class="b-rate \${typeKey}">\${rateText}</span>
        </div>
        \${bodyHtml}
        <div class="b-foot">
          <span class="b-type \${typeKey}">\${TYPE_LABEL[bt] || ''}\${b.discountType ? ' · '+b.discountType : ''}</span>
          <span>\${rep}\${rep && b.startDate ? ' · ' : ''}\${b.startDate || ''} <span class="b-arrow">→</span></span>
        </div>
      </a>\`;
  }).join('');
}

document.querySelectorAll('#benefitsTabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#benefitsTabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    benefitFilter = btn.dataset.filter;
    renderBenefits();
  });
});

function render() {
  const inp = readInputs();
  let filtered = inp.hideSized ? DATA.filter((d) => !d.sized) : DATA;
  if (inp.expressOnly) filtered = filtered.filter((d) => (d.tags || []).includes('빠른배송'));
  const enriched = filtered.map((d) => ({ ...d, calc: compute(d.price, inp) }));
  const visible = inp.hideLoss ? enriched.filter((e) => !e.calc || e.calc.profit > 0) : enriched;

  const sorted = [...visible].sort((a, b) => {
    if (inp.sortBy === 'profit') return (b.calc?.profit ?? -Infinity) - (a.calc?.profit ?? -Infinity);
    if (inp.sortBy === 'price-desc') return (b.price || 0) - (a.price || 0);
    if (inp.sortBy === 'price-asc') return (a.price || Infinity) - (b.price || Infinity);
    return b.volume - a.volume;
  });

  const profitable = enriched.filter((e) => e.calc && e.calc.profit > 0);
  const losing = enriched.filter((e) => e.calc && e.calc.profit < 0);
  const sumProfit = profitable.reduce((s, e) => s + e.calc.profit, 0);
  const maxProfit = profitable.length ? Math.max(...profitable.map((e) => e.calc.profit)) : 0;
  const hiddenCount = DATA.length - filtered.length;

  // 참여 한도(회) 반영: 단건 최대이익 × 가능 횟수 = 최대 누적이익
  const maxCount = selectedBenefit ? (selectedBenefit.totalCount || selectedBenefit.participation || 1) : 1;
  const topN = profitable.map((e) => e.calc.profit).sort((a, b) => b - a).slice(0, maxCount);
  const stackProfit = topN.reduce((s, v) => s + v, 0);
  const countNote = maxCount > 1
    ? \`<span class="pos">최대 \${maxCount}회 누적 <strong>\${fmt(stackProfit)}</strong></span>\`
    : '';

  const hiddenNote = hiddenCount > 0 ? \`<span style="color:var(--dim)">(사이즈 \${hiddenCount} 숨김)</span>\` : '';
  $('summary').innerHTML = \`
    <span><strong>\${enriched.length}</strong>개 \${hiddenNote}</span>
    <span class="pos"><strong>\${profitable.length}</strong>개 이익</span>
    <span class="neg"><strong>\${losing.length}</strong>개 손실</span>
    <span class="pos">단건 최대 <strong>\${fmt(maxProfit)}</strong></span>
    \${countNote}
  \`;

  $('grid').innerHTML = sorted.map((it, idx) => {
    const c = it.calc;
    const klass = c && c.profit > 0 ? 'profit' : c && c.profit < 0 ? 'loss' : '';
    const profitClass = c && c.profit > 0 ? 'pos' : c && c.profit < 0 ? 'neg' : '';
    const sign = c && c.profit > 0 ? '+' : '';
    const rankClass = inp.sortBy === 'profit' && idx < 3 && c && c.profit > 0 ? 'top-profit' : '';
    const express = (it.tags || []).includes('빠른배송');

    return \`
    <a class="card \${klass} \${express ? 'has-express' : ''}" href="\${it.url}" target="_blank" rel="noopener">
      <span class="rank \${rankClass}">#\${idx + 1}</span>
      \${express ? '<span class="badge-express">⚡ 빠른배송</span>' : ''}
      \${it.sized ? '<span class="badge-sized">SIZE</span>' : ''}
      <div class="img-wrap">\${it.img ? \`<img src="\${it.img}" alt="" loading="lazy" />\` : ''}</div>
      <div class="body">
        <div class="head-row">
          <span class="brand">\${it.brand}</span>
          <span class="volume">\${it.volumeText || '-'}</span>
        </div>
        <div class="name-ko">\${it.koName || it.enName}</div>
        <div class="price-main">\${it.price ? fmt(it.price) : '-'}</div>
        \${c ? \`
        <div class="calc">
          <span class="lbl">카드 할인</span><span class="val pos">+\${fmt(c.cardDiscount)}</span>
          <span class="lbl">매수 수수료</span><span class="val neg">-\${fmt(c.buyFee)}</span>
          <span class="lbl">매도 수수료</span><span class="val neg">-\${fmt(c.sellFee)}</span>
        </div>
        <div class="profit-row">
          <span class="lbl">순 손익</span>
          <span class="val \${profitClass}">\${sign}\${fmt(c.profit)}</span>
        </div>\` : ''}
      </div>
    </a>\`;
  }).join('');
}

['buyFeeRate', 'sellFeeRate', 'cardRate', 'cardCap', 'minAmount', 'sortBy'].forEach((id) => {
  $(id).addEventListener('input', render);
  $(id).addEventListener('change', render);
});

['hideSizedSwitch', 'hideLossSwitch', 'expressOnlySwitch'].forEach((id) => {
  $(id).addEventListener('click', () => {
    const sw = $(id);
    sw.classList.toggle('on');
    sw.setAttribute('aria-checked', sw.classList.contains('on'));
    render();
  });
});

// 설정 패널: 데스크탑은 펼침, 모바일(<=640px)은 접힘
const ctrlPanel = $('ctrlPanel');
if (ctrlPanel) ctrlPanel.open = window.matchMedia('(min-width: 641px)').matches;

initBenefitSelect();
initDragScroll();
renderBenefits();
render();
</script>
</body>
</html>
`;

await fs.writeFile(OUT_PATH, html, 'utf8');
console.log(`HTML 저장: ${OUT_PATH}`);

// GitHub Pages 용으로 docs/ 디렉토리에도 출력
const DOCS_DIR = path.join(__dirname, '..', 'docs');
await fs.mkdir(DOCS_DIR, { recursive: true });
const docsName = EXHIBITION_SLUG === 'feepromo' ? 'index.html' : `${EXHIBITION_SLUG}.html`;
await fs.writeFile(path.join(DOCS_DIR, docsName), html, 'utf8');
console.log(`docs HTML 저장: ${path.join(DOCS_DIR, docsName)}`);
