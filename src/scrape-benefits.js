import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openKreamBrowser } from './browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENEFITS_CACHE = path.join(__dirname, '..', 'data', 'benefits-cache.json');
const BENEFITS_URL = 'https://kream.co.kr/content/11368';

// "30/50/80만원" → [300000,500000,800000]
function parseThresholds(text) {
  const m = text.match(/([\d]+(?:\s*\/\s*[\d]+)*)\s*만\s*원\s*이상/);
  if (!m) return [];
  return m[1].split('/').map((s) => parseInt(s.trim(), 10) * 10000).filter((n) => n > 0);
}

// 금액 시퀀스 후보를 모두 찾아 토큰이 가장 많은 것을 채택.
// "최대 3만원 즉시할인"(요약, 1개) 보다 "1만원/2만원/3만원 즉시할인"(구간, 3개)을 우선.
function parseAmounts(text) {
  const re = /((?:\d+\s*(?:만|천)\s*원)(?:\s*\/\s*\d+\s*(?:만|천)\s*원)+)/g; // 슬래시로 2개 이상
  let best = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const toks = m[1].split('/').map((tok) => {
      const mm = tok.match(/(\d+)\s*(만|천)/);
      return mm ? parseInt(mm[1], 10) * (mm[2] === '만' ? 10000 : 1000) : 0;
    }).filter((n) => n > 0);
    if (toks.length > best.length) best = toks;
  }
  if (best.length > 0) return best;
  // 단일 금액(정액): "5천원 ... 할인" 또는 "5,000원"
  const single = text.match(/(\d+)\s*(만|천)\s*원\s*(?:즉시|청구)?\s*할인/);
  if (single) return [parseInt(single[1], 10) * (single[2] === '만' ? 10000 : 1000)];
  return [];
}

// "2만 5천원" / "3만원" / "5천원" / "25,000원" → 원 단위 정수
function parseWon(s) {
  if (!s) return 0;
  let m = s.match(/(\d+)\s*만\s*(\d+)\s*천\s*원/);
  if (m) return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 1000;
  m = s.match(/(\d+)\s*만\s*원/);
  if (m) return parseInt(m[1], 10) * 10000;
  m = s.match(/(\d+)\s*천\s*원/);
  if (m) return parseInt(m[1], 10) * 1000;
  m = s.match(/([\d,]+)\s*원/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  return 0;
}

// "주문당 최대 2만 5천원 제공" → 25000 (정률 할인 캡)
function parseCap(text) {
  const m = text.match(/(?:주문당|건당)?\s*최대\s*([\d만천,\s]+?원)\s*(?:제공|할인|적립)/);
  return m ? parseWon(m[1]) : 0;
}

// 상세 페이지 본문 텍스트 → 혜택 타입/구간/참여횟수 분류
function classifyBenefit(title, detailText) {
  const text = `${title}\n${detailText || ''}`;
  // 정률(%) 판정은 제목 기준만 (상세 본문의 무관한 % 텍스트 오인 방지)
  const pct = (title.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1];
  const thresholds = parseThresholds(detailText || '');
  const amounts = parseAmounts(detailText || '');

  // 참여 횟수
  const partM = text.match(/(?:계정당|혜택당|기간\s*내)?\s*(?:최대\s*)?(\d+)\s*회\s*참여/);
  const totalM = text.match(/총\s*(\d+)\s*회/);
  const participation = partM ? parseInt(partM[1], 10) : null;
  const totalCount = totalM ? parseInt(totalM[1], 10) : null;

  const cap = parseCap(detailText || '');

  let type, tiers = [], flatAmount = null, percent = null, minAmount = null;
  if (pct) {
    type = 'percent';
    percent = parseFloat(pct);
    minAmount = thresholds[0] || null;
  } else if (thresholds.length >= 2 || amounts.length >= 2) {
    type = 'tiered';
    const n = Math.min(thresholds.length, amounts.length);
    for (let i = 0; i < n; i++) tiers.push({ threshold: thresholds[i], amount: amounts[i] });
    minAmount = thresholds[0] || null;
  } else {
    type = 'flat';
    // 상세에서 못 잡으면 제목의 "최대 N천/만원"에서 폴백
    flatAmount = amounts[0] || null;
    if (!flatAmount) {
      const tm = title.match(/(\d+)\s*(만|천)\s*원/);
      if (tm) flatAmount = parseInt(tm[1], 10) * (tm[2] === '만' ? 10000 : 1000);
    }
    minAmount = thresholds[0] || null;
  }
  return { benefitType: type, tiers, flatAmount, percent, cap: cap || null, minAmountDetail: minAmount, participation, totalCount };
}

async function scrapeBenefitDetail(page, url) {
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
    // "제공/참여/할인" 같은 본문 키워드가 뜰 때까지 대기 (최대 9초)
    try {
      await page.waitForFunction(
        () => /제공|참여|할인|적립|이상\s*결제/.test(document.body.innerText),
        { timeout: 9000 }
      );
    } catch {}
    await page.waitForTimeout(1500);
    return await page.evaluate(() => {
      const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
      return lines.slice(0, 30).join('\n');
    });
  } catch {
    return '';
  }
}

export async function scrapeBenefits() {
  const { ctx } = await openKreamBrowser({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();

  try {
    // 메인 경유 (Sec-Fetch-Site: same-origin 효과 + 자연스러운 트래픽 패턴)
    await page.goto('https://kream.co.kr/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.goto(BENEFITS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    const benefits = await page.evaluate(() => {
      // 각 슬라이드는 absolute positioning 된 vertical layout
      const slides = Array.from(
        document.querySelectorAll('.layout_list_vertical[class*="pos-abso"]')
      );

      const parsed = [];
      for (const s of slides) {
        const text = s.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!text) continue;

        // 슬라이드를 감싸는 부모 a 태그에서 exhibition URL 찾기
        let url = null;
        let p = s.parentElement;
        for (let i = 0; i < 5 && p; i++) {
          if (p.tagName === 'A' && p.getAttribute('href')) {
            const href = p.getAttribute('href');
            url = href.startsWith('http') ? href : `https://kream.co.kr${href}`;
            break;
          }
          p = p.parentElement;
        }

        // 두 줄 구조 가정: 첫 줄 = 제목 (할인 정보), 둘째 줄 = 조건/시작일
        const children = Array.from(s.children).filter((c) => c.textContent?.trim());
        const lines = children.map((c) => c.textContent.replace(/\s+/g, ' ').trim());

        const title = lines[0] || text;
        const subtitle = lines.slice(1).join(' ') || '';

        // 할인율/금액 파싱
        const pctMatch = title.match(/(\d+(?:\.\d+)?)\s*%/);
        const amountMatch = title.match(/(\d{1,3}(?:,\d{3})*|\d+천원|\d+만원)/);

        // 결제 수단 / 카드 파싱
        const payMethods = [];
        for (const kw of ['카카오페이', '토스페이', '페이코', '하나 Pay', '네이버페이', '삼성페이', '애플페이']) {
          if (title.includes(kw)) payMethods.push(kw);
        }
        const cards = [];
        for (const kw of ['삼성카드', '농협카드', '롯데카드', '현대카드', '신한카드', 'BC카드', '우리카드', '하나카드', 'KB카드', 'NH카드', '국민카드']) {
          if (title.includes(kw) || subtitle.includes(kw)) cards.push(kw);
        }

        // 시작일
        const dateMatch = subtitle.match(/(\d+\/\d+)\s*\([월화수목금토일]\)/) || title.match(/(\d+\/\d+)\s*\([월화수목금토일]\)/);
        const startDate = dateMatch ? dateMatch[1] : null;

        // 최소 결제 금액
        const minMatch = subtitle.match(/(\d+)만원\s*이상/);
        const minAmount = minMatch ? parseInt(minMatch[1]) * 10000 : null;

        // 할인 종류
        const isInstant = /즉시\s*할인/.test(title);
        const isBilled = /청구\s*할인/.test(title);

        // "최대 N회" / "선착순 N명" 같은 횟수/한도 정보
        const maxCountMatch = (title + ' ' + subtitle).match(/(?:최대\s*)?(\d+)\s*회/);
        const limitMatch = (title + ' ' + subtitle).match(/선착순\s*([\d,]+)\s*명/);

        parsed.push({
          title,
          subtitle,
          url,
          discountPercent: pctMatch ? parseFloat(pctMatch[1]) : null,
          discountAmount: amountMatch ? amountMatch[1] : null,
          payMethods,
          cards,
          startDate,
          minAmount,
          discountType: isInstant ? '즉시할인' : isBilled ? '청구할인' : null,
          maxCount: maxCountMatch ? parseInt(maxCountMatch[1]) : null,
          firstComeLimit: limitMatch ? limitMatch[1] : null,
          raw: text.slice(0, 200),
        });
      }

      return parsed;
    });

    // 캐시(이전 추출)와 URL로 매칭 — 이번 상세 추출이 비면 캐시의 구간 데이터 재사용
    const cached = await loadCachedBenefits();
    const cacheByUrl = new Map(cached.filter((c) => c.url).map((c) => [c.url, c]));

    // 각 혜택 상세 페이지 방문해서 구간/정액/정률 + 참여횟수 추출
    const detailPage = await ctx.newPage();
    for (const b of benefits) {
      if (!b.url || !/kream\.co\.kr/.test(b.url)) {
        Object.assign(b, { benefitType: 'external', tiers: [], flatAmount: null, percent: null });
        continue;
      }
      const detailText = await scrapeBenefitDetail(detailPage, b.url);
      // 상세 페이지를 실제로 읽었는지 (CI 비로그인 등에서 빈 페이지면 false)
      const detailOk = !!detailText && /제공|참여|이상\s*결제|즉시할인|청구할인/.test(detailText);
      const cls = classifyBenefit(b.title, detailText);
      Object.assign(b, cls);
      if (cls.minAmountDetail && !b.minAmount) b.minAmount = cls.minAmountDetail;
      b.detailRaw = (detailText || '').slice(0, 300);

      // 상세를 못 읽었으면(CI 차단 등) 이전 캐시의 분류를 그대로 신뢰 — 구간 데이터 보존
      const prev = cacheByUrl.get(b.url);
      if (!detailOk && prev && prev.benefitType && prev.benefitType !== 'external') {
        b.benefitType = prev.benefitType;
        b.tiers = prev.tiers || [];
        b.flatAmount = prev.flatAmount ?? b.flatAmount;
        b.percent = prev.percent ?? b.percent;
        b.cap = prev.cap ?? b.cap;
        if (prev.minAmount) b.minAmount = prev.minAmount;
        if (prev.participation) b.participation = prev.participation;
        if (prev.totalCount) b.totalCount = prev.totalCount;
      } else if (!b.cap && prev && prev.cap) {
        b.cap = prev.cap; // 캡은 가격 무관이라 캐시 있으면 보강
      }
    }
    await detailPage.close();

    if (benefits.length > 0) {
      await fs.writeFile(BENEFITS_CACHE, JSON.stringify(benefits), 'utf8');
    }
    return benefits;
  } finally {
    await ctx.close();
  }
}

export async function loadCachedBenefits() {
  try {
    return JSON.parse(await fs.readFile(BENEFITS_CACHE, 'utf8'));
  } catch {
    return [];
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await scrapeBenefits();
  console.log(`총 ${result.length}개 혜택 추출`);
  for (const b of result) {
    const parts = [];
    if (b.payMethods.length) parts.push(b.payMethods.join('/'));
    if (b.cards.length) parts.push(b.cards.join('/'));
    parts.push(`[${b.benefitType}]`);
    if (b.benefitType === 'percent') parts.push(`${b.percent}%${b.cap ? ` (최대 ${b.cap.toLocaleString()})` : ''}`);
    else if (b.benefitType === 'flat') parts.push(`${(b.flatAmount || 0).toLocaleString()}원`);
    else if (b.benefitType === 'tiered') parts.push(b.tiers.map((t) => `${t.threshold / 10000}만→${t.amount.toLocaleString()}`).join(' / '));
    if (b.participation) parts.push(`${b.participation}회${b.totalCount ? `(총${b.totalCount})` : ''}`);
    console.log(`  - ${parts.join(' | ')}`);
    console.log(`    ${b.title}`);
  }
}
