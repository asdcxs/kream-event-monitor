import { chromium } from 'playwright';

// 우리카드 1만원 청구할인 — 횟수/구간 정보가 있을 가능성이 높은 케이스
const targets = [
  { name: '우리카드', url: 'https://kream.co.kr/exhibitions/15931' },
  { name: '하나Pay', url: 'https://kream.co.kr/exhibitions/15932' },
  { name: 'BC카드', url: 'https://kream.co.kr/exhibitions/16109' },
  { name: '토스페이x삼성카드', url: 'https://kream.co.kr/exhibitions/16265' },
];

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 1600 },
});

for (const t of targets) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${t.name}] ${t.url}`);
  console.log('='.repeat(60));
  const page = await ctx.newPage();
  try {
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try {
      await page.waitForSelector('main, [class*="content"], img', { timeout: 12000 });
    } catch {}
    await page.waitForTimeout(6000);
    const htmlLen = (await page.content()).length;
    console.log(`HTML 길이: ${htmlLen}`);

    const title = await page.title();
    console.log('Title:', title);

    // 페이지 본문 텍스트 (이미지 영역 alt 포함)
    const bodyText = await page.evaluate(() => document.body.innerText);
    const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);

    // 횟수/구간 정보 패턴 추출
    const interesting = [];
    for (const ln of lines) {
      if (/회|선착순|만원\s+(이상|이하)|건당|일\s*1회|월\s*\d+회|총\s*\d+회|최대|쿠폰|발급/.test(ln)) {
        interesting.push(ln);
      }
    }
    console.log('\n관련 라인:');
    interesting.slice(0, 30).forEach((l) => console.log('  -', l));

    // 이미지 alt 추출 (배너에 종종 정보 포함)
    const imgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .filter((img) => img.alt && img.alt.length > 10 && !/품|product/i.test(img.alt))
        .map((img) => ({ alt: img.alt, src: img.src?.slice(0, 80) }));
    });
    console.log('\n주요 이미지 alt:');
    imgs.slice(0, 8).forEach((i) => console.log(`  - alt: ${i.alt}`));
  } catch (e) {
    console.log('실패:', e.message);
  } finally {
    await page.close();
  }
}

await browser.close();
