const path = require('path');
const express = require('express');
const { checkConfig, supabaseFor, IS_PROD } = require('./supabase');
const { createRepo, DbError } = require('./db');
const { isValidDate } = require('./dates');

try {
  checkConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
// 내 컴퓨터에서는 127.0.0.1에만 연다. 클라우드(Render 등)에서는 HOST=0.0.0.0으로 바꾼다.
const HOST = process.env.HOST || '127.0.0.1';
const REPEAT_RULES = ['none', 'daily', 'weekly', 'monthly'];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const app = express();
// 클라우드에서는 앞단 프록시가 HTTPS를 처리하므로, 프록시가 알려준 주소·프로토콜을 믿는다.
if (IS_PROD) app.set('trust proxy', 1);

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

class BadRequest extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// 다른 사이트에서 몰래 보낸 요청(CSRF)을 막는다. 상태를 바꾸는 요청은 같은 출처에서 온 것만 받는다.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  const origin = req.get('origin');
  if (origin && new URL(origin).host !== req.get('host')) {
    return res.status(403).json({ error: '허용되지 않은 출처입니다.' });
  }
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- 로그인 (Supabase Auth) ----
const AUTH_MESSAGES = {
  invalid_credentials: [401, '이메일 또는 비밀번호가 맞지 않습니다.'],
  email_not_confirmed: [403, '이메일 인증을 먼저 완료하세요. 받은 메일의 링크를 누르면 됩니다.'],
  user_already_exists: [409, '이미 가입된 이메일입니다.'],
  email_exists: [409, '이미 가입된 이메일입니다.'],
  weak_password: [400, '비밀번호가 너무 약합니다. 더 길고 복잡하게 정하세요.'],
  over_email_send_rate_limit: [429, '메일 발송 한도를 넘었습니다. 잠시 후 다시 시도하세요.'],
  over_request_rate_limit: [429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'],
  validation_failed: [400, '이메일 형식이 올바르지 않습니다.'],
};

function authError(error) {
  const [status, message] = AUTH_MESSAGES[error.code] ?? [400, '로그인 처리 중 오류가 발생했습니다.'];
  if (!AUTH_MESSAGES[error.code]) console.error('auth error:', error.code, error.message);
  return new BadRequest(message, status);
}

function parseCredentials(body, { signup = false } = {}) {
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) throw new BadRequest('이메일과 비밀번호를 입력하세요.');
  if (signup && password.length < 8) throw new BadRequest('비밀번호는 8자 이상이어야 합니다.');
  return { email, password };
}

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = parseCredentials(req.body, { signup: true });
  const supabase = supabaseFor(req, res);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${req.protocol}://${req.get('host')}/` },
  });
  if (error) throw authError(error);
  // 이메일 인증이 켜져 있으면 세션 없이 돌아온다. 메일의 링크를 누른 뒤 로그인하면 된다.
  res.status(201).json({ needsConfirmation: !data.session, email: data.user?.email ?? email });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = parseCredentials(req.body);
  const { data, error } = await supabaseFor(req, res).auth.signInWithPassword({ email, password });
  if (error) throw authError(error);
  res.json({ email: data.user.email });
});

app.post('/api/auth/logout', async (req, res) => {
  await supabaseFor(req, res).auth.signOut();
  res.status(204).end();
});

// 쿠키의 토큰을 Supabase Auth 서버에 확인받고(getUser), 이 사용자 전용 repo를 붙인다.
async function requireUser(req, res, next) {
  const supabase = supabaseFor(req, res);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.user = data.user;
  req.repo = createRepo(supabase);
  next();
}

app.get('/api/auth/me', requireUser, (req, res) => {
  res.json({ email: req.user.email });
});

app.use(['/api/todos', '/api/tags'], requireUser);

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequest('잘못된 id입니다.');
  return id;
}

async function parseTodoInput(repo, body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new BadRequest('제목을 입력하세요.');
  if (title.length > 200) throw new BadRequest('제목은 200자 이하로 입력하세요.');

  const due_date = body.due_date;
  if (!due_date) throw new BadRequest('마감일을 입력하세요.');
  if (typeof due_date !== 'string' || !isValidDate(due_date)) throw new BadRequest('마감일 형식이 올바르지 않습니다.');

  const repeat_rule = body.repeat_rule || 'none';
  if (!REPEAT_RULES.includes(repeat_rule)) throw new BadRequest('반복 규칙이 올바르지 않습니다.');

  const rawTagIds = body.tag_ids ?? [];
  if (!Array.isArray(rawTagIds)) throw new BadRequest('tag_ids는 배열이어야 합니다.');
  const tag_ids = [...new Set(rawTagIds.map(parseId))];
  const missing = await repo.missingTagIds(tag_ids);
  if (missing.length) throw new BadRequest(`없는 태그입니다: ${missing.join(', ')}`);
  return { title, due_date, repeat_rule, tag_ids };
}

// ---- 할 일 ----
app.get('/api/todos', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const tagId = req.query.tag ? parseId(req.query.tag) : null;
  res.json(await req.repo.listTodos({ q, tagId }));
});

app.post('/api/todos', async (req, res) => {
  const input = await parseTodoInput(req.repo, req.body ?? {});
  res.status(201).json(await req.repo.createTodo(input));
});

app.patch('/api/todos/:id/done', async (req, res) => {
  const id = parseId(req.params.id);
  if (typeof req.body?.done !== 'boolean') throw new BadRequest('done은 true 또는 false여야 합니다.');
  const result = await req.repo.setDone(id, req.body.done);
  if (!result) throw new BadRequest('할 일을 찾을 수 없습니다.', 404);
  res.json(result);
});

app.delete('/api/todos/:id', async (req, res) => {
  if (!(await req.repo.deleteTodo(parseId(req.params.id)))) throw new BadRequest('할 일을 찾을 수 없습니다.', 404);
  res.status(204).end();
});

// ---- 태그 ----
app.get('/api/tags', async (req, res) => {
  res.json(await req.repo.listTags());
});

app.post('/api/tags', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) throw new BadRequest('태그 이름을 입력하세요.');
  if (name.length > 30) throw new BadRequest('태그 이름은 30자 이하로 입력하세요.');
  const color = req.body.color || null;
  if (color !== null && !COLOR_RE.test(color)) throw new BadRequest('색은 #RRGGBB 형식이어야 합니다.');
  try {
    res.status(201).json(await req.repo.createTag({ name, color }));
  } catch (err) {
    if (err instanceof DbError && err.status === 409) throw new BadRequest('이미 있는 태그 이름입니다.', 409);
    throw err;
  }
});

app.delete('/api/tags/:id', async (req, res) => {
  if (!(await req.repo.deleteTag(parseId(req.params.id)))) throw new BadRequest('태그를 찾을 수 없습니다.', 404);
  res.status(204).end();
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: '없는 API입니다.' });
});

app.use((err, req, res, next) => {
  if (err instanceof BadRequest) return res.status(err.status).json({ error: err.message });
  if (err instanceof DbError) {
    if (err.status === 500) console.error(err.detail);
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Todo 앱 실행 중: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
