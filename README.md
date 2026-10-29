# Todo 앱 (Express + Supabase)

로그인해서 쓰는 할 일 앱입니다. 데이터는 Supabase(무료 클라우드 Postgres)에 저장되고,
RLS(행 수준 보안)로 사용자마다 자기 할 일만 보고 바꿀 수 있습니다.
기능과 요구사항은 [PRD.md](PRD.md)를 보세요.

## 처음 한 번: Supabase 준비

1. https://supabase.com 에서 무료 계정을 만들고 **New project**로 프로젝트를 만듭니다.
2. 왼쪽 메뉴 **SQL Editor**를 열고, [supabase/schema.sql](supabase/schema.sql) 내용을 통째로 붙여 넣은 뒤 **Run**을 누릅니다.
3. **Project Settings → API Keys**(또는 상단 **Connect** 버튼)에서 두 값을 확인합니다.
   - Project URL → `SUPABASE_URL`
   - **Publishable key**(`sb_publishable_...`) 또는 legacy **anon public** 키 → `SUPABASE_PUBLISHABLE_KEY`
   - **secret / service_role 키는 쓰지 마세요.** RLS를 무시하는 키라서 서버가 시작을 거부합니다.
4. **Authentication → URL Configuration**에서 **Site URL**을 `http://localhost:3000`으로 둡니다.
   - 회원가입 인증 메일의 링크가 이 주소로 돌아옵니다.
   - 배포하면 배포 주소로 바꾸고, 그 주소를 **Redirect URLs**에도 추가합니다.

## 실행

Node.js 22.9 이상이 필요합니다.

```bash
npm install
```

`.env.example`을 `.env`로 복사하고 위에서 확인한 두 값을 채운 뒤:

```bash
npm start
```

브라우저에서 http://localhost:3000 을 열고 회원가입 → (인증 메일 확인) → 로그인합니다.

## 환경변수

| 이름 | 필수 | 설명 |
|------|------|------|
| `SUPABASE_URL` | 예 | Supabase 프로젝트 주소 |
| `SUPABASE_PUBLISHABLE_KEY` | 예 | Publishable(또는 anon) 키. 백엔드에서만 씀 |
| `PORT` | | 서버 포트 (기본 `3000`) |
| `HOST` | | 접속 주소 (기본 `127.0.0.1`, 클라우드에서는 `0.0.0.0`) |
| `NODE_ENV` | | 클라우드에서는 `production` (로그인 쿠키를 HTTPS 전용으로) |

## RLS 점검

앱에서 시험용 계정 두 개를 회원가입하고, `.env`의 `RLS_TEST_A_EMAIL`·`RLS_TEST_A_PASSWORD`·`RLS_TEST_B_EMAIL`·`RLS_TEST_B_PASSWORD`를 채운 뒤:

```bash
npm run check:rls
```

B가 A의 할 일·태그를 보거나 바꾸지 못하는지, 로그인 없이 공개용 키로는 아무것도 안 되는지 확인합니다.

## 구조

```
server/
  index.js     백엔드 API (Express) + 로그인 API
  supabase.js  Supabase 접속 설정. 키는 .env에서만 읽음. 로그인 정보는 httpOnly 쿠키
  db.js        DB 접근 코드는 모두 여기에만 있음
  dates.js     날짜 형식 검사
public/
  index.html, app.js, style.css   화면. /api/... 에만 요청 (Supabase를 모름)
supabase/
  schema.sql   표, RLS 정책, DB 함수
scripts/
  check-rls.js RLS 점검
```

## API

`/api/todos`, `/api/tags`는 로그인이 필요합니다(아니면 401).

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/signup` | 회원가입 `{ email, password }` (비밀번호 8자 이상) |
| POST | `/api/auth/login` | 로그인 `{ email, password }` |
| POST | `/api/auth/logout` | 로그아웃 |
| GET | `/api/auth/me` | 로그인한 사용자 확인 |
| GET | `/api/todos?q=검색어&tag=태그id` | 내 할 일 목록 |
| POST | `/api/todos` | 할 일 추가 `{ title, due_date, repeat_rule, tag_ids }`. `title`, `due_date`(`YYYY-MM-DD`) 필수 |
| PATCH | `/api/todos/:id/done` | 완료/미완료 `{ done: true }`. 반복 할 일이면 다음 할 일 생성 |
| DELETE | `/api/todos/:id` | 할 일 삭제 |
| GET | `/api/tags` | 내 태그 목록 |
| POST | `/api/tags` | 태그 추가 `{ name, color }` |
| DELETE | `/api/tags/:id` | 태그 삭제 (할 일은 남음) |
| GET | `/healthz` | 서버 상태 확인 (배포용) |
