import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeBenefits, loadCachedBenefits } from './scrape-benefits.js';
import { scrapeExhibitionProducts, computeProfit } from './scrape-products.js';
import { notifyEventWithProfit, fetchCommands, sendCommandReply } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEN_BENEFITS_PATH = path.join(__dirname, '..', 'data', 'seen-benefits.json');
const NOTIFY_STATE_PATH = path.join(__dirname, '..', 'data', 'notify-state.json');

const CARD_RATE = 0.04; // 카드 할인율 4%
const CARD_CAP = 30000; // 한도 3만원
const BUY_FEE_RATE = 0.023; // 매수 수수료
const SELL_FEE_RATE_NORMAL = 0.0055; // 일반 매도 수수료
const MIN_PROFIT_RATE = 0.05; // 차익률 5% 이상만

async function loadJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function saveJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function extractIdFromUrl(url) {
  return url?.match(/exhibitions\/([^/?#]+)/)?.[1] || null;
}

const HELP_TEXT = `🤖 <b>KREAM 결제혜택 알림 봇</b>

매일 1회 결제 혜택 페이지를 스캔해서 신규 혜택이 생기면 차익률 5% 이상 상품 TOP 5와 함께 알림이 옵니다.

명령:
/on — 알림 켜기
/off — 알림 끄기
/status — 현재 상태 + 최근 스캔
/help — 이 도움말`;

async function processCommands({ botToken, chatId, notifyState }) {
  if (!botToken) return false;
  let updates;
  try {
    updates = await fetchCommands({ botToken, sinceUpdateId: notifyState.lastUpdateId || 0 });
  } catch (e) {
    console.warn('명령 수신 실패:', e.message);
    return false;
  }
  if (updates.length === 0) return false;

  for (const u of updates) {
    notifyState.lastUpdateId = Math.max(notifyState.lastUpdateId || 0, u.update_id);
    const msg = u.message || u.edited_message;
    if (!msg || !msg.text) continue;
    if (String(msg.chat?.id) !== String(chatId)) continue;

    const text = msg.text.trim().toLowerCase();
    if (text === '/on') {
      notifyState.enabled = true;
      await sendCommandReply({ botToken, chatId, text: '✓ 알림 켜졌습니다.' });
    } else if (text === '/off') {
      notifyState.enabled = false;
      await sendCommandReply({ botToken, chatId, text: '🔕 알림 꺼졌습니다. 다시 켜려면 /on' });
    } else if (text === '/status') {
      const last = notifyState.lastRun ? new Date(notifyState.lastRun).toLocaleString('ko-KR') : '없음';
      await sendCommandReply({ botToken, chatId, text: `상태: ${notifyState.enabled ? '✓ 켜짐' : '🔕 꺼짐'}\n마지막 스캔: ${last}` });
    } else if (text === '/help' || text === '/start') {
      await sendCommandReply({ botToken, chatId, text: HELP_TEXT });
    }
  }
  return true;
}

async function analyzeBenefit(benefit) {
  const id = extractIdFromUrl(benefit.url);
  if (!id) return { topProducts: [] };

  // 수수료 100% 면제 이벤트인지 여부 (feepromo 등)
  const isFeeWaived = /수수료\s*(100|면제|할인)/.test(benefit.title || '');
  const sellFeeRate = isFeeWaived ? 0 : SELL_FEE_RATE_NORMAL;

  let products;
  try {
    products = await scrapeExhibitionProducts(id);
  } catch (e) {
    console.warn(`  상품 추출 실패 (${id}):`, e.message.split('\n')[0]);
    return { topProducts: [] };
  }

  const topProducts = products
    .map((p) => {
      const profit = computeProfit(p.price, {
        cardRate: CARD_RATE,
        cardCap: CARD_CAP,
        buyFeeRate: BUY_FEE_RATE,
        sellFeeRate,
      });
      const profitRate = profit !== null && p.price > 0 ? profit / p.price : 0;
      return { ...p, profit, profitRate };
    })
    .filter((p) => p.profit !== null && p.profitRate >= MIN_PROFIT_RATE)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  return { topProducts, totalProducts: products.length, isFeeWaived };
}

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const dryRun = process.env.DRY_RUN === '1';

  if (!dryRun && (!botToken || !chatId)) {
    throw new Error('TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 가 필요합니다.');
  }

  console.log(`[${new Date().toISOString()}] KREAM 결제혜택 모니터 시작`);

  const notifyState = await loadJson(NOTIFY_STATE_PATH, { enabled: true, lastUpdateId: 0, lastRun: null });
  if (!dryRun) await processCommands({ botToken, chatId, notifyState });

  // 결제 혜택 페이지 스크랩
  let benefits = [];
  try {
    benefits = await scrapeBenefits();
  } catch (e) {
    console.warn('혜택 스크랩 실패 — 캐시 사용:', e.message);
  }
  if (benefits.length === 0) benefits = await loadCachedBenefits();
  console.log(`결제 혜택 ${benefits.length}개`);

  const seenBenefits = await loadJson(SEEN_BENEFITS_PATH, { ids: {} });
  const isFirstRun = Object.keys(seenBenefits.ids).length === 0;
  const newBenefits = benefits.filter((b) => {
    const id = extractIdFromUrl(b.url);
    return id && !seenBenefits.ids[id];
  });
  console.log(`신규 결제 혜택: ${newBenefits.length}개`);

  if (isFirstRun) {
    console.log('첫 실행 — baseline 등록만, 알림 생략');
  } else if (newBenefits.length > 0 && notifyState.enabled && !dryRun) {
    for (const benefit of newBenefits) {
      const id = extractIdFromUrl(benefit.url);
      console.log(`  → 신규 혜택 [${id}] "${(benefit.title || '').slice(0, 40)}"`);
      const { topProducts } = await analyzeBenefit(benefit);
      console.log(`     차익률 ${(MIN_PROFIT_RATE * 100).toFixed(0)}% 이상 상품 ${topProducts.length}건`);
      try {
        await notifyEventWithProfit({
          botToken,
          chatId,
          event: { title: benefit.title || '결제 혜택', url: benefit.url },
          topProducts,
        });
      } catch (e) {
        console.warn(`     텔레그램 발송 실패:`, e.message.split('\n')[0]);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    console.log(`알림 ${newBenefits.length}건 발송`);
  } else if (newBenefits.length > 0 && !notifyState.enabled) {
    console.log('알림 꺼짐 — 발송 생략');
  } else if (newBenefits.length > 0 && dryRun) {
    console.log('(DRY_RUN) 신규 혜택:');
    for (const b of newBenefits) console.log(`  - ${b.title}`);
  }

  const now = new Date().toISOString();
  const nextSeen = {
    ids: {
      ...seenBenefits.ids,
      ...Object.fromEntries(
        benefits
          .map((b) => extractIdFromUrl(b.url))
          .filter(Boolean)
          .map((id) => [id, seenBenefits.ids[id] || now])
      ),
    },
  };
  await saveJson(SEEN_BENEFITS_PATH, nextSeen);
  notifyState.lastRun = now;
  await saveJson(NOTIFY_STATE_PATH, notifyState);
  console.log('상태 저장 완료');
}

main().catch((err) => {
  console.error('실행 실패:', err);
  process.exit(1);
});
