import readline from 'node:readline';
import { openKreamBrowser, PROFILE_DIR } from './browser.js';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('크림 로그인 — 쿠키 저장');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log(`프로필 저장 위치: ${PROFILE_DIR}`);
console.log('');

const { ctx } = await openKreamBrowser({ headless: false });

// Edge가 자동으로 띄운 초기 페이지(welcome 등) 닫고 새 페이지로 시작
let pages = ctx.pages();
for (const p of pages) {
  const url = p.url();
  if (url && !url.startsWith('about:') && url !== '') {
    try { await p.close(); } catch {}
  }
}
const page = await ctx.newPage();

async function safeGoto(url, label) {
  for (let i = 1; i <= 3; i++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
      await page.waitForTimeout(2500);
      console.log(`✓ ${label} 페이지 로드`);
      return true;
    } catch (e) {
      console.warn(`  ${label} navigate 시도 ${i}/3 실패: ${e.message.split('\n')[0]}`);
      if (i < 3) await page.waitForTimeout(1500);
    }
  }
  return false;
}

const ok = await safeGoto('https://kream.co.kr/login', '로그인');
if (!ok) {
  console.log('');
  console.log('⚠ 자동 navigate 실패. 브라우저 주소창에 직접 입력해주세요:');
  console.log('   https://kream.co.kr/login');
  console.log('');
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('1) 위 브라우저 창에서 크림 로그인 진행');
console.log('   - 이메일/네이버/애플 어느 방식이든 OK');
console.log('   - 비밀번호 8자 이상 + 영문/숫자/특수문자 조합 필요');
console.log('   - 네이버/애플 계정인데 비밀번호가 없다면 "비밀번호 찾기"로 임시 발급');
console.log('2) 로그인 완료되면 이 터미널로 와서 ENTER');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => {
  rl.question('\n로그인 끝났으면 ENTER... ', () => {
    rl.close();
    resolve();
  });
});

// 로그인 검증
try {
  const verifyOk = await safeGoto('https://kream.co.kr/my', '마이페이지');
  if (verifyOk) {
    const cookies = await ctx.cookies('https://kream.co.kr/');
    const allCookieNames = cookies.map((c) => c.name).join(', ');
    const hasAuthCookie = cookies.some((c) => /token|session|auth|sid/i.test(c.name));
    console.log(`\n쿠키 ${cookies.length}개: ${allCookieNames.slice(0, 200)}`);
    console.log(`인증 쿠키 감지: ${hasAuthCookie ? '✓' : '✗ — 로그인이 실제로 완료되지 않은 듯'}`);
  }
} catch (e) {
  console.log('검증 단계 실패 (무시):', e.message.split('\n')[0]);
}

await ctx.close();
console.log('\n✓ 프로필 저장 완료. npm run rank 실행 가능.');
