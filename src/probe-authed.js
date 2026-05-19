import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKreamBrowser } from './browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'data', 'probe-result.json');

const PRODUCT_ID = process.argv[2] || '38367';
const BENEFIT_ID = process.argv[3] || '15931';

const result = {
  productId: PRODUCT_ID,
  benefitId: BENEFIT_ID,
  startedAt: new Date().toISOString(),
};

const { ctx, isAuthenticated } = await openKreamBrowser({ headless: true, viewport: { width: 1280, height: 1600 } });
result.isAuthenticated = isAuthenticated;
console.log(`로그인 상태(쿠키 검사): ${isAuthenticated ? '✓' : '?'}`);

const page = await ctx.newPage();

// ========== 1) 상품 상세 ==========
console.log(`상품 ${PRODUCT_ID} probe...`);
try {
  await page.goto(`https://kream.co.kr/products/${PRODUCT_ID}`, { waitUntil: 'commit', timeout: 60000 });
  try {
    await page.waitForSelector('[class*="price-info"], [class*="transaction"]', { timeout: 25000 });
  } catch {}
  await page.waitForTimeout(7000);

  result.product = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const out = {
      bodyLength: bodyText.length,
      bodyExcerpt: bodyText.slice(0, 5000),
      hasLogin: /^로그인$/m.test(bodyText),
      hasLogout: /로그아웃/.test(bodyText),
      hasNickname: /님$|회원님|마이/.test(bodyText),
      pricesAll: [],
      fastShippingArea: null,
      bidsTabsData: { sellBids: [], buyBids: [], trades: [] },
      cookieNames: document.cookie.split(';').map((s) => s.split('=')[0].trim()),
    };

    // 모든 가격을 부모 클래스와 함께
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const text = n.nodeValue?.trim() || '';
      if (/^[0-9,]+원$/.test(text)) {
        const parent = n.parentElement;
        const grand = parent?.parentElement;
        const ggp = grand?.parentElement;
        out.pricesAll.push({
          price: text,
          parentCls: typeof parent?.className === 'string' ? parent.className.slice(0, 80) : '',
          grandCls: typeof grand?.className === 'string' ? grand.className.slice(0, 80) : '',
          ggCls: typeof ggp?.className === 'string' ? ggp.className.slice(0, 80) : '',
          contextText: ggp?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200),
        });
      }
    }

    // "빠른배송" 또는 "fast-shipping" 컨테이너 영역
    const fastEls = Array.from(document.querySelectorAll('*')).filter((el) => {
      const t = el.textContent || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      return (
        (/빠른배송/.test(t) || /fast/i.test(cls)) &&
        /[0-9,]+원/.test(t) &&
        t.length < 800
      );
    });
    out.fastShippingArea = fastEls.slice(0, 8).map((el) => ({
      cls: typeof el.className === 'string' ? el.className.slice(0, 100) : '',
      text: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300),
    }));

    // 체결 거래 / 판매 입찰 / 구매 입찰 탭의 가격을 컨테이너로 분리
    const transactionEls = Array.from(document.querySelectorAll('.transaction_history_summary__content__item'));
    out.bidsTabsData.allTransactionItems = transactionEls.slice(0, 30).map((el) => ({
      cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
      text: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200),
    }));

    return out;
  });
  console.log(`  본문 길이: ${result.product.bodyLength}, 가격 ${result.product.pricesAll.length}개, 빠른배송영역 ${result.product.fastShippingArea?.length || 0}개`);
} catch (e) {
  result.product = { error: e.message };
  console.log('상품 probe 실패:', e.message.split('\n')[0]);
}

// ========== 2) 구매하기 모달 시도 ==========
console.log('구매하기 모달 시도...');
try {
  const btn = page.getByRole('button', { name: '구매하기' }).first();
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(4000);

  result.buyModal = await page.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="layer"], [class*="bottom-sheet"], [class*="popup"]'))
      .filter((m) => {
        const r = m.getBoundingClientRect();
        return r.width > 200 && r.height > 200 && getComputedStyle(m).display !== 'none';
      });

    // 모달 안의 가격 + 사이즈 정보
    return modals.slice(0, 3).map((m) => {
      const text = m.textContent?.replace(/\s+/g, ' ').trim().slice(0, 3000) || '';
      const sizes = Array.from(m.querySelectorAll('*')).filter((el) => {
        const t = el.textContent?.trim() || '';
        return /^[0-9]{2,3}(?:\.[0-9])?$/.test(t) && el.children.length === 0;
      }).slice(0, 30).map((el) => el.textContent.trim());
      const prices = Array.from(m.querySelectorAll('*')).filter((el) => {
        const t = el.textContent?.trim() || '';
        return /^[0-9,]+원$/.test(t) && el.children.length === 0;
      }).slice(0, 40).map((el) => el.textContent.trim());
      return { cls: typeof m.className === 'string' ? m.className.slice(0, 100) : '', text, sizes, prices };
    });
  });
  console.log(`  모달 ${result.buyModal.length}개 감지`);
} catch (e) {
  result.buyModal = { error: e.message.split('\n')[0] };
  console.log('  모달 안 뜸:', e.message.split('\n')[0]);
}

// ========== 3) 혜택 상세 페이지 ==========
console.log(`혜택 ${BENEFIT_ID} probe...`);
try {
  const page2 = await ctx.newPage();
  await page2.goto(`https://kream.co.kr/exhibitions/${BENEFIT_ID}`, { waitUntil: 'commit', timeout: 60000 });
  await page2.waitForTimeout(6000);

  result.benefit = await page2.evaluate(() => {
    const bodyText = document.body.innerText;
    const imgs = Array.from(document.querySelectorAll('img'))
      .filter((img) => img.alt && img.alt.length > 5)
      .map((img) => ({ alt: img.alt.slice(0, 200), src: img.src?.slice(0, 100) }));
    return {
      bodyLength: bodyText.length,
      bodyExcerpt: bodyText.slice(0, 6000),
      imageAlts: imgs.slice(0, 15),
    };
  });
  console.log(`  본문 길이: ${result.benefit.bodyLength}, 이미지 ${result.benefit.imageAlts?.length || 0}개`);
  await page2.close();
} catch (e) {
  result.benefit = { error: e.message };
  console.log('혜택 probe 실패:', e.message.split('\n')[0]);
}

await ctx.close();

result.finishedAt = new Date().toISOString();
await fs.writeFile(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');
console.log(`\n✓ 결과 저장: ${OUT_PATH}`);
console.log('파일 통째로 Claude에게 보내거나, 이 경로를 알려주세요.');
