import { chromium } from 'playwright';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 시스템 Chrome으로 만든 쿠키는 DPAPI 암호화로 번들 Chromium이 못 읽음.
// 따라서 둘을 분리. USE_SYSTEM_CHROME=1 이면 chrome-profile (시스템 Chrome용),
// 기본(번들 Chromium)이면 chrome-profile-chromium 사용.
const useSystemChromeEnv = process.env.USE_SYSTEM_CHROME === '1';
const useEdgeEnv = process.env.USE_EDGE === '1';
const PROFILE_DIR = path.join(
  __dirname,
  '..',
  'data',
  useEdgeEnv
    ? 'edge-profile'
    : useSystemChromeEnv
      ? 'chrome-profile'
      : 'chrome-profile-chromium'
);

// user-data-dir lock 파일 정리 (이전 Chrome 인스턴스 잔존 lock 제거)
async function clearProfileLocks() {
  const lockFiles = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'lockfile',
  ];
  for (const f of lockFiles) {
    try {
      await fsp.unlink(path.join(PROFILE_DIR, f));
    } catch {}
  }
}

// KBPM 방식과 동일: 사용자 PC의 실제 Chrome을 launchPersistentContext 로 띄움.
// → 번들 Chromium이 아니라 진짜 Chrome이라 자동화 지문이 사실상 없음.
// → user-data-dir(PROFILE_DIR)에 쿠키·세션이 저장되어 다음 실행 시 자동 로그인 상태 유지.

export async function openKreamBrowser({ headless = true, viewport = { width: 1280, height: 900 } } = {}) {
  const wasInitialized = fs.existsSync(PROFILE_DIR);
  await clearProfileLocks();

  const useSystemChrome = useSystemChromeEnv;
  const useEdge = useEdgeEnv;

  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-default-browser-check',
    '--no-first-run',
    '--disable-features=msEdgeShortcut,msSearchAndAssistant,msInstallPromptEnabled,EdgeAutoLaunchProtocolFromOrigins',
    '--disable-prompt-on-repost',
  ];
  if (useEdge) {
    // Edge 첫 실행 시 온보딩/시작 페이지가 뜨면서 우리 navigate와 충돌함 → 차단
    args.push('--disable-features=msEdgeWelcomePage');
  }
  const baseOptions = {
    headless,
    viewport,
    locale: 'ko-KR',
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  if (useEdge) baseOptions.channel = 'msedge';
  else if (useSystemChrome) baseOptions.channel = 'chrome';

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, baseOptions);
  } catch (err) {
    if (err.message?.includes('Target page, context or browser has been closed') || err.message?.includes('Failed to launch')) {
      console.warn('Chrome 시작 실패 — lock 정리 후 재시도...');
      await new Promise((r) => setTimeout(r, 2000));
      await clearProfileLocks();
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, baseOptions);
    } else {
      throw err;
    }
  }

  // 자동화 탐지 회피 (번들 Chromium 사용 시 필수, real Chrome일 때는 보험)
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' },
      ],
    });
    if (!window.chrome) {
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    }
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });

  // 로그인 쿠키가 있는지로 인증 상태 추정
  let isAuthenticated = false;
  try {
    const cookies = await ctx.cookies('https://kream.co.kr/');
    isAuthenticated = cookies.some((c) => /token|session|auth|sid/i.test(c.name));
  } catch {}

  return { browser: ctx, ctx, isAuthenticated, wasInitialized };
}

export { PROFILE_DIR };
