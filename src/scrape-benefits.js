import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openKreamBrowser } from './browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENEFITS_CACHE = path.join(__dirname, '..', 'data', 'benefits-cache.json');
const BENEFITS_URL = 'https://kream.co.kr/content/11368';

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
    if (b.discountPercent) parts.push(`${b.discountPercent}%`);
    else if (b.discountAmount) parts.push(b.discountAmount);
    if (b.discountType) parts.push(b.discountType);
    if (b.startDate) parts.push(b.startDate);
    if (b.minAmount) parts.push(`${b.minAmount.toLocaleString()}+`);
    console.log(`  - ${parts.join(' | ')}`);
    console.log(`    raw: ${b.raw}`);
  }
}
