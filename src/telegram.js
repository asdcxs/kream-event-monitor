const API_BASE = 'https://api.telegram.org/bot';

export async function sendTelegram({ botToken, chatId, text, parseMode = 'HTML', disableLinkPreview = false }) {
  const url = `${API_BASE}${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: disableLinkPreview,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`텔레그램 전송 실패 (${res.status}): ${errText}`);
  }
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function notifyNewEvents({ botToken, chatId, events }) {
  if (events.length === 0) return { sent: 0 };
  let sent = 0;
  for (const event of events) {
    const text = `🔔 <b>KREAM 신규 이벤트</b>\n\n${escapeHtml(event.title)}\n\n<a href="${event.url}">이벤트 보기 →</a>`;
    await sendTelegram({ botToken, chatId, text });
    sent += 1;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { sent };
}

function fmtKrw(n) {
  return n.toLocaleString('ko-KR') + '원';
}

export async function notifyEventWithProfit({ botToken, chatId, event, topProducts }) {
  let text = `🔔 <b>KREAM 신규 이벤트</b>\n\n${escapeHtml(event.title)}\n`;

  if (topProducts && topProducts.length > 0) {
    text += `\n💰 <b>차익률 5%↑ 상품 TOP ${topProducts.length}</b> (카드 4% 적용)\n`;
    topProducts.forEach((p, i) => {
      const sign = p.profit >= 0 ? '+' : '';
      const name = (p.brand ? p.brand + ' ' : '') + (p.koName || p.enName || '');
      const rate = p.profitRate ? ` (${(p.profitRate * 100).toFixed(1)}%)` : '';
      text += `\n${i + 1}. <a href="${p.url}">${escapeHtml(name.slice(0, 60))}</a>\n`;
      text += `   ${fmtKrw(p.price)} → <b>${sign}${fmtKrw(p.profit)}</b>${rate}\n`;
    });
  } else {
    text += `\n(차익률 5% 이상 상품 없음 또는 상품 추출 실패)\n`;
  }

  text += `\n<a href="${event.url}">이벤트 페이지로 →</a>`;
  return sendTelegram({ botToken, chatId, text, disableLinkPreview: true });
}

export async function fetchCommands({ botToken, sinceUpdateId = 0 }) {
  const params = new URLSearchParams({ offset: String(sinceUpdateId + 1), timeout: '0' });
  const url = `${API_BASE}${botToken}/getUpdates?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getUpdates 실패: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`getUpdates 실패: ${data.description}`);
  return data.result || [];
}

export async function sendCommandReply({ botToken, chatId, text }) {
  return sendTelegram({ botToken, chatId, text, disableLinkPreview: true });
}

export async function notifyRelogin({ botToken, chatId, reason = '쿠키 만료' }) {
  const text = `⚠️ <b>크림 자동화 — 재로그인 필요</b>\n\n사유: ${escapeHtml(reason)}\n\nPC에서 다음 명령 실행해주세요:\n<code>$env:USE_SYSTEM_CHROME='1'; npm run login</code>`;
  return sendTelegram({ botToken, chatId, text });
}
