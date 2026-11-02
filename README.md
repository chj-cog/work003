# todo-summary 스킬

"오늘 할 일 요약해줘" 한마디로 오늘 완료한 할 일을 정리해 주는 Claude Code 스킬입니다.

## 왜 만들었나

**불편했던 점**
- 요약을 보려면 명령을 정확히 기억해야 했습니다. 파일 위치는 `bin/todo.js`이고, npm으로 부를 때는 `npm run todo -- summary`처럼 `--`를 붙여야 합니다. 실제로 `node todo.js summary`처럼 경로를 틀리게 적는 일이 있었습니다.
- Claude에게 "오늘 한 일 정리해줘"라고 하면 매번 방법이 달라질 수 있었습니다. 목록을 받아서 직접 거르기도 하고, 다른 명령을 쓰기도 했습니다. 그러면 결과 형식과 기준(오늘의 범위, 완료 판단)이 그때그때 달라집니다.

**스킬이 없앤 방법**
- 요약 요청을 `node bin/todo.js summary` **한 명령으로 고정**했습니다. 명령을 기억할 필요가 없습니다.
- 출력을 **손대지 않고 그대로** 보여 주게 했습니다. 오늘 완료 판단은 항상 앱과 같은 코드(`server/db.js`)와 같은 기준(내 컴퓨터 시간대의 오늘)을 따릅니다.

## 설치 위치

이 스킬은 프로젝트 안의 `bin/todo.js`를 실행합니다. 그래서 **Todo 앱 프로젝트에 설치**해야 합니다.

```
<Todo 앱 프로젝트>/
  .claude/
    skills/
      todo-summary/
        SKILL.md      ← 이 파일만 있으면 동작합니다
        README.md     (이 문서, 선택)
  bin/
    todo.js           ← 스킬이 실행하는 명령
```

- 다른 컴퓨터나 복사본에 설치할 때는 `todo-summary` 폴더를 통째로 `<프로젝트>/.claude/skills/` 아래에 복사합니다.
- 사용자 전체 위치(`~/.claude/skills/`)에 두면 다른 프로젝트에서도 스킬이 보입니다. 하지만 그 프로젝트에는 `bin/todo.js`가 없어서 실패합니다. 프로젝트 위치를 쓰세요.
- 설치하거나 고친 뒤에는 **새 세션**을 열어야 스킬 목록에 나타납니다.

**동작에 필요한 것** (값은 각자 `.env`에 넣고, 이 문서나 Git에는 넣지 않습니다)
- Node.js 22.9 이상, `npm install` 완료
- `.env`의 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `.env`의 `TODO_CLI_EMAIL`, `TODO_CLI_PASSWORD`: 앱에서 가입한 시험용 계정. RLS가 적용되어 이 계정의 할 일만 요약됩니다.

## 부르는 법

Claude Code에서 다음처럼 말하거나 입력합니다.

- `/todo-summary`
- `요약 스킬 써서 오늘 한 일 정리해줘`
- `오늘 할 일 요약해줘`

## 실제로 확인한 결과

2026-11-02에 `요약 스킬 써서 오늘 한 일 정리해줘`로 불러서 확인했습니다.

- `todo-summary` 스킬이 로드됐습니다.
- `node bin/todo.js summary`가 실행되고, 그 출력이 바뀌지 않고 그대로 표시됐습니다.

할 일 제목은 개인 데이터라 가렸습니다.

```
오늘(2026-11-02) 완료: 2개
  - (할 일 제목)
  - (할 일 제목)
남은 할 일: 3개 (마감 지남 0개)
```

- 완료한 할 일이 없을 때는 `오늘(…) 완료: 0개`와 남은 할 일 수만 나오는 것도 확인했습니다.
- `done <번호>`로 완료 처리한 직후 summary를 실행하면 방금 완료한 할 일이 목록에 바로 반영됐습니다.
- `/todo-summary`와 `오늘 할 일 요약해줘`로 부르는 경우는 아직 따로 확인하지 않았습니다.

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

## 터미널에서 쓰기 (todo 명령)

앱과 같은 Supabase 데이터를 터미널에서 다룹니다. DB 코드는 앱의 [server/db.js](server/db.js)를 그대로 씁니다.
시험용 계정으로 로그인하므로 RLS가 그대로 적용되어 그 계정의 할 일만 보입니다.

`.env`에 `TODO_CLI_EMAIL`, `TODO_CLI_PASSWORD`(앱에서 회원가입한 시험용 계정)를 채운 뒤:

```bash
npm run todo -- add "보고서 쓰기" --due today --repeat weekly
npm run todo -- list
npm run todo -- list 보고서
npm run todo -- done 12
npm run todo -- summary
```

- `add`: 마감일(`--due`)은 필수입니다. `YYYY-MM-DD`, `today`, `tomorrow`를 쓸 수 있습니다.
- `done`: 반복 할 일이면 앱과 똑같이 다음 할 일이 생깁니다.
- `summary`: 오늘(내 컴퓨터 시간대 기준) 완료한 할 일과 남은 할 일 수를 보여 줍니다.
- `npm link`를 한 번 실행하면 어느 폴더에서나 `todo list`처럼 쓸 수 있습니다.

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
bin/
  todo.js      터미널용 todo 명령 (server/db.js 재사용)
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
