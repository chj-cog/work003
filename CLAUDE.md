# Todo 앱

## 개요
할 일을 추가·완료·조회하는 1인용 앱.

## 명령
- 목록: node bin/todo.js list
- 추가: node bin/todo.js add "<내용>" --due <YYYY-MM-DD|today|tomorrow>
- 완료: node bin/todo.js done <번호>
- 오늘 완료 요약: node bin/todo.js summary

## 규칙
- 데이터는 Supabase에 저장한다. (예전 SQLite 데이터는 todo.db에 남아 있다.) UI 문구는 존댓말로.

## 하지 말 것
- todo.db(실데이터)를 직접 지우거나 덮어쓰지 말 것.
