import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('.env 에 TELEGRAM_BOT_TOKEN 을 먼저 입력하세요.');
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('텔레그램 chat_id 확인 도구');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('실행 전 체크:');
console.log('  1) 텔레그램에서 본인 봇 찾기');
console.log('  2) /start 누르거나 아무 메시지 보내기 (예: "hi")');
console.log('  3) 이 스크립트 실행');
console.log('');

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();

if (!data.ok) {
  console.error('API 호출 실패:', data.description || data);
  process.exit(1);
}

if (!data.result || data.result.length === 0) {
  console.log('⚠ 봇이 받은 메시지 없음.');
  console.log('  → 텔레그램에서 본인 봇한테 메시지를 먼저 보내고 다시 실행하세요.');
  console.log('');
  console.log('  참고: 메시지 보낸 지 24시간 이상 지나면 getUpdates 에서 사라집니다.');
  process.exit(1);
}

console.log(`받은 메시지 ${data.result.length}건:\n`);

const chatIds = new Set();
for (const update of data.result) {
  const msg = update.message || update.edited_message || update.channel_post;
  if (!msg) continue;
  const chat = msg.chat;
  if (!chat) continue;
  const id = chat.id;
  const name = chat.first_name || chat.title || chat.username || '?';
  const type = chat.type;
  chatIds.add(id);
  console.log(`  - chat_id: ${id} (${type}, ${name}) | "${msg.text || '(텍스트 없음)'}"`);
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (chatIds.size === 1) {
  const id = Array.from(chatIds)[0];
  console.log(`✓ 본인의 chat_id: ${id}`);
  console.log('');
  console.log(`.env 파일에 추가/수정하세요:`);
  console.log(`TELEGRAM_CHAT_ID=${id}`);
} else {
  console.log(`여러 채팅에서 메시지 받음. 본인 chat_id 골라서 .env 에 입력:`);
  for (const id of chatIds) console.log(`  - ${id}`);
}
