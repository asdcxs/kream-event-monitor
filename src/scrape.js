import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const KREAM_HOME = 'https://kream.co.kr/';

export async function scrapeKreamEvents() {
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

  try {
    await page.goto(KREAM_HOME, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try {
      await page.waitForSelector('a[href*="/exhibitions/"]', { timeout: 15000 });
    } catch {
      // 셀렉터가 안 보이면 일단 진행 (페이지 구조 변경 가능성)
    }
    await page.waitForTimeout(3000);

    const events = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/exhibitions/"]'));
      const seen = new Map();

      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/exhibitions\/([^/?#]+)/);
        if (!match) continue;
        const id = match[1];
        if (seen.has(id)) continue;

        const title =
          a.querySelector('img')?.getAttribute('alt') ||
          a.getAttribute('aria-label') ||
          a.textContent?.trim() ||
          '(제목 없음)';

        const img = a.querySelector('img')?.getAttribute('src') || null;

        seen.set(id, {
          id,
          title: title.replace(/\s+/g, ' ').slice(0, 200),
          url: `https://kream.co.kr/exhibitions/${id}`,
          image: img,
        });
      }

      return Array.from(seen.values());
    });

    return events;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  scrapeKreamEvents()
    .then((events) => {
      console.log(`발견된 이벤트: ${events.length}개`);
      for (const e of events) {
        console.log(`  - [${e.id}] ${e.title}`);
        console.log(`    ${e.url}`);
      }
    })
    .catch((err) => {
      console.error('스크래핑 실패:', err);
      process.exit(1);
    });
}
