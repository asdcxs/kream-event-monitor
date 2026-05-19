import 'dotenv/config';
import { sendTelegram } from './telegram.js';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!botToken || !chatId) {
  console.error('.env 의 TELEGRAM_BOT_TOKEN 과 TELEGRAM_CHAT_ID 를 먼저 설정하세요.');
  process.exit(1);
}

const text = `🔔 <b>KREAM 자동화 — 알림 테스트</b>\n\n이 메시지가 보이면 텔레그램 봇 연동이 정상입니다.\n\n시간: ${new Date().toLocaleString('ko-KR')}`;

const result = await sendTelegram({ botToken, chatId, text });
console.log('전송 성공:', result.ok ? '✓' : '?', `message_id=${result.result?.message_id}`);
