// Supabase 접속 설정. 접속 키는 .env에서만 읽고, 이 백엔드 밖으로 내보내지 않는다.
const { createServerClient, parseCookieHeader, serializeCookieHeader } = require('@supabase/ssr');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const IS_PROD = process.env.NODE_ENV === 'production';

// 관리자 키(service_role / secret)는 RLS를 무시하므로 이 앱에서는 쓰지 않는다.
function isAdminKey(key) {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'service_role';
  } catch {
    return false;
  }
}

function checkConfig() {
  const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`.env에 ${missing.join(', ')} 값이 없습니다. .env.example을 참고하세요.`);
  }
  if (isAdminKey(SUPABASE_KEY)) {
    throw new Error(
      'SUPABASE_PUBLISHABLE_KEY에 관리자 키(service_role/secret)가 들어 있습니다. ' +
      'RLS를 무시하는 키이므로 쓸 수 없습니다. Publishable(또는 anon) 키를 넣으세요.',
    );
  }
}

// 요청마다 클라이언트를 만든다. 로그인 정보는 httpOnly 쿠키에 담겨 브라우저 스크립트가 읽을 수 없다.
// DB 요청에는 이 사용자의 토큰이 실려 가므로 RLS가 "이 사용자" 기준으로 적용된다.
function supabaseFor(req, res) {
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookieOptions: { httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: '/' },
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie ?? '');
      },
      setAll(cookiesToSet, headers) {
        if (res.headersSent) return;
        for (const { name, value, options } of cookiesToSet) {
          res.append('Set-Cookie', serializeCookieHeader(name, value, options));
        }
        for (const [key, value] of Object.entries(headers ?? {})) res.setHeader(key, value);
      },
    },
  });
}

module.exports = { checkConfig, supabaseFor, IS_PROD };
