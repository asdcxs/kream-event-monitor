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
await page.waitForTimeout(4000);

console.log('=== 구매하기 버튼 후보 ===');
const buyBtns = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  return all
    .filter((el) => /구매하기|구매$|즉시 구매/.test(el.textContent || ''))
    .map((el) => ({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 100) : '', text: el.textContent?.trim().slice(0, 50) }));
});
console.log(JSON.stringify(buyBtns.slice(0, 10), null, 2));

console.log('\n=== "구매하기" 버튼 클릭 시도 ===');
try {
  const btn = page.getByRole('button', { name: '구매하기' }).first();
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(2500);

  // 모달 내용 추출
  const modalContent = await page.evaluate(() => {
    // 자주 쓰이는 모달 selector
    const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="layer"], [class*="popup"], [class*="bottom-sheet"]'))
      .filter((m) => {
        const r = m.getBoundingClientRect();
        return r.width > 200 && r.height > 200 && getComputedStyle(m).display !== 'none';
      });
    return modals.slice(0, 3).map((m) => ({
      cls: typeof m.className === 'string' ? m.className.slice(0, 80) : '',
      text: m.textContent?.replace(/\s+/g, ' ').trim().slice(0, 2000),
    }));
  });
  console.log('보이는 모달:');
  console.log(JSON.stringify(modalContent, null, 2));

  console.log('\n=== 모달 + 페이지 전체에서 "빠른배송" 텍스트 + 인접 가격 ===');
  const fastPriceCandidates = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const fastEls = all.filter((el) => {
      const text = el.textContent || '';
      // "빠른배송"이 있고 가격도 함께 있는 작은 컴포넌트
      return /빠른배송/.test(text) && /[0-9,]+원/.test(text) && text.length < 300;
    });
    return fastEls.slice(0, 15).map((el) => ({
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className.slice(0, 100) : '',
      text: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 250),
    }));
  });
  console.log(JSON.stringify(fastPriceCandidates, null, 2));
} catch (e) {
  console.log('구매하기 클릭 실패:', e.message);

  // 대안: 페이지 본문에서 빠른배송 + 가격이 나란히 있는 패턴 찾기
  console.log('\n페이지 전체에서 빠른배송+가격 텍스트 패턴 검색:');
  const text = await page.evaluate(() => document.body.innerText);
  const matches = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (/빠른배송/.test(ln)) {
      const ctx_ = lines.slice(Math.max(0, i - 3), i + 5).map((l) => l.trim()).filter(Boolean).join(' | ');
      matches.push(ctx_);
    }
  }
  console.log(matches.slice(0, 10).join('\n---\n'));
}

await browser.close();
