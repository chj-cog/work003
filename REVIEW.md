# AIFFEL Campus Agent Code Review

- 개발자 : 정채홍
- 리뷰어 : 김원규

> 리뷰 대상: Todo 앱 (Express + Supabase)
> 리뷰 방법: 코드와 PRD를 읽고 작성했습니다. 앱을 직접 실행하거나 Supabase에 연결해 보지는 않았습니다. (✅ = 코드로 확인, 🔎 = 실행해서 확인하면 좋을 것)

# ART(Agent Review Template)

[ ]  **1. 원하는 기능이 의도한 대로 동작하나요?**

코드상으로는 PRD의 기능이 모두 구현되어 있습니다. 다만 **실행 화면 캡처를 확인하지 못해 체크는 비워 두었습니다.**
README 실행 방법대로 돌려 본 화면(할 일 추가·반복 완료·태그 필터·마감 색상)을 첨부하면 이 항목을 완성할 수 있어요.

| PRD 완료 기준 | 코드에서 확인 |
|---|---|
| 회원가입·로그인·로그아웃 | ✅ `/api/auth/*` |
| 비로그인 시 401 | ✅ `requireUser` |
| 할 일 추가·조회·완료·삭제 | ✅ |
| 마감일 없이 추가 불가 | ✅ API 검사 (DB 제약은 개선 제안 4 참고) |
| 마감 지남(빨강)/오늘(주황) 강조 | 🔎 화면에서 확인 필요 |
| 반복 완료 시 새 할 일 | ✅ `set_todo_done` DB 함수 |
| 검색 | ✅ `ilike` (입력 즉시 갱신은 🔎) |
| 태그 다대다·필터·삭제 시 할 일 유지 | ✅ 스키마 |
| 사용자 간 격리(RLS) | ✅ 정책 + `check-rls.js` (🔎 실제 실행 결과) |
| 공개 키만으로 접근 불가 | ✅ `anon` 권한 회수 |

[x]  **2. 보안 검토를 수행했나요?**

- **민감 정보**: ✅ 키는 `.env`에서만 읽고 `.gitignore`로 제외했습니다. `.env.example`에는 값이 없습니다. 관리자 키(service_role)를 넣으면 서버가 시작을 거부하는 점이 좋았습니다.
- **입력값 검증**: ✅ 제목 길이, 날짜 형식, 반복 규칙, 태그 id, 색상(`#RRGGBB`)을 서버에서 검사하고 JSON 크기도 10kb로 제한했습니다. 검색어의 `LIKE` 특수문자도 이스케이프했습니다.
- **DB 보안**: ✅ RLS 정책, `anon` 권한 회수, `(id, user_id)` 복합 외래키로 "같은 사용자 것끼리만 연결"을 DB가 강제합니다.
- **웹 보안**: ✅ httpOnly 쿠키, 출처(Origin) 검사(CSRF), 화면에서 `innerHTML` 없이 `textContent`만 사용(XSS 위험 낮음).
- **의존성**: ✅ 3개뿐(`express`, `@supabase/ssr`, `@supabase/supabase-js`)이고 모두 널리 쓰이는 공식·검증 라이브러리입니다. (취약점 점검 `npm audit`은 실행하지 않았습니다 🔎)
- **보완하면 좋은 점**: 아래 "개선 제안" 1·2·5번(Origin 예외, 인증 메일 주소, 로그인 시도 제한·보안 헤더)을 참고해 주세요.

[ ]  **3. 에러가 난 부분을 디버깅하여 "문제를 해결한 기록"을 남겼나요?**

저장소에서 디버깅 기록(오류 발견 → 원인 → 수정 → 재시도)은 찾지 못했습니다. 커밋도 2개이고 `README`/`PRD`에는 작업 과정이 없습니다.
다만 코드에는 시행착오의 흔적이 보입니다. 예를 들어 `app.js`의 "브라우저 확인 창(confirm)은 환경에 따라 막혀서 바로 '취소'가 될 수 있다" 주석(버튼을 두 번 누르는 삭제 방식)이나 `schema.sql`의 "여러 번 실행해도 안전합니다" 같은 부분이요.
이런 것들을 `docs/DEBUG_LOG.md`나 PR 설명에 "무슨 문제 → 어떻게 발견 → 어떻게 해결 → 다음에 시도해 볼 것" 한 줄씩만 남겨도 이 항목을 채울 수 있습니다.

# 참고 링크 및 코드 개선

## 1. 리뷰 시 참고한 링크

- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS 정책 작성 방식 비교
- [OWASP Cheat Sheet: CSRF Prevention (Origin 검사)](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — 출처 검사 방식 확인
- [Node.js `node:test`](https://nodejs.org/api/test.html) — 추가 패키지 없이 쓸 수 있는 테스트 러너

## 2. 개선 제안 (중요도 순, 모두 "이렇게 하면 어떨까요?" 수준입니다)

1. **`Origin: null`이면 403이 아니라 500이 나요** (✅ 재현 확인): `server/index.js`의 `new URL(origin)`이 `Origin: null`에서 `Invalid URL` 예외를 던집니다. 막으려던 요청이 "서버 오류"로 보이므로 `try/catch`로 감싸 403을 돌려주면 좋겠습니다.
   ```js
   let originHost;
   try { originHost = new URL(origin).host; } catch { originHost = null; }
   if (originHost !== req.get('host')) return res.status(403)...
   ```
2. **자동 테스트 추가**: `check-rls.js`는 훌륭하지만 실제 Supabase 계정이 있어야 돌아갑니다. `isValidDate`, `parseTodoInput` 같은 입력 검증은 DB 없이 `node:test`로 테스트할 수 있고, GitHub Actions로 `npm test`를 돌리면 수정할 때 안심이 됩니다.
3. **매월 반복에서 날짜가 계속 밀려요** (✅ 확인): `1/31 → 2/28 → 3/28 → 4/28`. PRD의 "말일 처리"는 맞게 구현됐지만 이후 달은 28일에 고정됩니다. 원본 마감일의 "일"을 기억하거나, "밀려도 괜찮다"고 PRD에 적어 두면 좋겠습니다.
4. **PRD와 DB 제약 맞추기**: PRD는 "마감일 필수"인데 `todos.due_date`는 NULL을 허용하고 API에서만 검사합니다. `create_todo`를 직접 호출할 수도 있으니 DB에서도 `not null`로 두면 규칙이 한 곳에서 지켜집니다. (기존 데이터 마이그레이션 필요)
5. **인증 메일 주소 고정 · 로그인 제한 · 보안 헤더**: `emailRedirectTo`를 `Host` 헤더로 조립하는 대신 `SITE_URL` 환경변수로 고정, `/api/auth`에 `express-rate-limit`, `helmet`(CSP) 적용을 고려해 보세요.
6. **태그 필터가 쿼리 두 번**: `todo_tags` 조회 후 `.in('id', [...])`를 합니다. 데이터가 많아지면 `todo_tags!inner(...)` 조인으로 한 번에 처리할 수 있습니다. (지금 규모에서는 문제 없음)
7. **사소한 정리**: `package.json`의 `name`이 `local-todo`(SQLite 시절 이름), `.gitignore`의 `todo.db*`, 저장소에 포함된 `.claude/launch.json`.

# 총평

설계 의도가 PRD → 스키마 → 코드까지 일관되게 이어져 있어서 읽기가 편했습니다. 특히 DB에서 보안을 지키는 방식(RLS + 복합 외래키 + 트랜잭션 함수)은 저도 배우고 싶은 부분이었어요.
보완하면 좋을 점은 크게 **실행 화면/디버깅 기록 남기기**(템플릿 1·3번)와 **테스트·Origin 예외 처리**(개선 1·2번)입니다. 기능과 보안의 기본기는 탄탄해서, 이 부분만 채우면 완성도가 많이 올라갈 것 같습니다. 고맙습니다! 🙌
