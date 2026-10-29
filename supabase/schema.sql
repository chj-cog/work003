-- Todo 앱 DB 구조 (Supabase / Postgres)
-- Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- 핵심 규칙
--   * 모든 행에 소유자(user_id)를 기록한다. 기본값은 로그인한 사용자(auth.uid()).
--   * RLS를 켜고, 로그인한 사용자(authenticated)가 자기 행만 조회·추가·수정·삭제하도록 정책을 둔다.
--   * 로그인하지 않은 요청(anon)에는 정책이 없으므로 아무것도 보이지 않고 바꿀 수 없다.

-- ---------------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------------
create table if not exists public.todos (
  id               bigint generated always as identity primary key,
  user_id          uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  title            text        not null check (char_length(title) between 1 and 200),
  done             boolean     not null default false,
  due_date         date,
  repeat_rule      text        not null default 'none'
                   check (repeat_rule in ('none', 'daily', 'weekly', 'monthly')),
  repeat_source_id bigint,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- 다른 표가 (id, user_id) 묶음으로 참조해서 "같은 사용자 것끼리만" 연결되게 한다.
  unique (id, user_id),
  -- 반복 원본도 같은 사용자의 할 일이어야 한다. 원본이 지워지면 repeat_source_id만 비운다.
  foreign key (repeat_source_id, user_id)
    references public.todos (id, user_id) on delete set null (repeat_source_id)
);

create table if not exists public.tags (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name    text not null check (char_length(name) between 1 and 30),
  color   text check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (user_id, name),   -- 태그 이름은 사용자마다 중복 불가
  unique (id, user_id)
);

create table if not exists public.todo_tags (
  todo_id bigint not null,
  tag_id  bigint not null,
  user_id uuid   not null default auth.uid(),
  primary key (todo_id, tag_id),
  -- 할 일과 태그 모두 같은 사용자 것이어야 연결된다.
  foreign key (todo_id, user_id) references public.todos (id, user_id) on delete cascade,
  foreign key (tag_id,  user_id) references public.tags  (id, user_id) on delete cascade
);

create index if not exists idx_todos_user_done_due on public.todos (user_id, done, due_date);
create index if not exists idx_todos_repeat_src    on public.todos (repeat_source_id);
create index if not exists idx_todo_tags_tag       on public.todo_tags (tag_id);
create index if not exists idx_todo_tags_user      on public.todo_tags (user_id);

-- ---------------------------------------------------------------------------
-- RLS (행 수준 보안)
-- ---------------------------------------------------------------------------
alter table public.todos     enable row level security;
alter table public.tags      enable row level security;
alter table public.todo_tags enable row level security;

-- 로그인하지 않은 사용자는 표에 아예 접근하지 못하게 권한도 뺀다. (RLS와 이중 잠금)
revoke all on public.todos, public.tags, public.todo_tags from anon;

-- 로그인한 사용자에게는 필요한 작업 권한만 명시적으로 준다.
-- (새 프로젝트는 표 권한을 자동으로 주지 않을 수 있다. 어떤 "행"을 다룰 수 있는지는 아래 RLS 정책이 정한다.)
grant select, insert, update, delete on public.todos, public.tags to authenticated;
grant select, insert, delete on public.todo_tags to authenticated;

-- todos: 자기 할 일만 조회·추가·수정·삭제
drop policy if exists "todos: select own" on public.todos;
drop policy if exists "todos: insert own" on public.todos;
drop policy if exists "todos: update own" on public.todos;
drop policy if exists "todos: delete own" on public.todos;
create policy "todos: select own" on public.todos for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "todos: insert own" on public.todos for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "todos: update own" on public.todos for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "todos: delete own" on public.todos for delete to authenticated
  using ((select auth.uid()) = user_id);

-- tags: 자기 태그만 조회·추가·수정·삭제
drop policy if exists "tags: select own" on public.tags;
drop policy if exists "tags: insert own" on public.tags;
drop policy if exists "tags: update own" on public.tags;
drop policy if exists "tags: delete own" on public.tags;
create policy "tags: select own" on public.tags for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "tags: insert own" on public.tags for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "tags: update own" on public.tags for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "tags: delete own" on public.tags for delete to authenticated
  using ((select auth.uid()) = user_id);

-- todo_tags: 자기 연결만 조회·추가·삭제 (연결은 수정할 일이 없어 update 정책을 두지 않는다)
drop policy if exists "todo_tags: select own" on public.todo_tags;
drop policy if exists "todo_tags: insert own" on public.todo_tags;
drop policy if exists "todo_tags: delete own" on public.todo_tags;
create policy "todo_tags: select own" on public.todo_tags for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "todo_tags: insert own" on public.todo_tags for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "todo_tags: delete own" on public.todo_tags for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 함수: 여러 줄을 한 번에(트랜잭션으로) 바꿔야 하는 작업
-- security invoker = 호출한 사용자 권한으로 실행되므로 위의 RLS가 그대로 적용된다.
-- ---------------------------------------------------------------------------

-- 할 일 추가 + 태그 연결
create or replace function public.create_todo(
  p_title text,
  p_due_date date,
  p_repeat_rule text,
  p_tag_ids bigint[]
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id bigint;
begin
  insert into public.todos (title, due_date, repeat_rule)
  values (p_title, p_due_date, p_repeat_rule)
  returning id into new_id;

  insert into public.todo_tags (todo_id, tag_id)
  select new_id, t from unnest(coalesce(p_tag_ids, '{}')) as t
  on conflict do nothing;

  return new_id;
end;
$$;

-- 완료/미완료 전환. 반복 할 일을 완료하면 다음 마감일로 새 할 일(태그 포함)을 만든다.
-- 이미 다음 할 일을 만든 적이 있으면(완료 → 취소 → 다시 완료) 또 만들지 않는다.
-- 매월 반복: Postgres의 '+ 1 month'는 다음 달에 같은 날이 없으면 그 달 마지막 날이 된다. (1/31 → 2/28)
create or replace function public.set_todo_done(p_id bigint, p_done boolean)
returns table (todo_id bigint, spawned_id bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t public.todos;
  new_id bigint;
begin
  update public.todos
     set done = p_done,
         completed_at = case when p_done then now() else null end,
         updated_at = now()
   where id = p_id
  returning * into t;

  if not found then
    return;  -- 없는 할 일이거나 남의 할 일 (RLS 때문에 보이지 않음)
  end if;

  if p_done and t.repeat_rule <> 'none' and t.due_date is not null
     and not exists (select 1 from public.todos where repeat_source_id = t.id) then
    insert into public.todos (title, due_date, repeat_rule, repeat_source_id)
    values (
      t.title,
      case t.repeat_rule
        when 'daily'   then t.due_date + 1
        when 'weekly'  then t.due_date + 7
        when 'monthly' then (t.due_date + interval '1 month')::date
      end,
      t.repeat_rule,
      t.id
    )
    returning id into new_id;

    insert into public.todo_tags (todo_id, tag_id)
    select new_id, tt.tag_id from public.todo_tags tt where tt.todo_id = t.id;
  end if;

  return query select t.id, new_id;
end;
$$;

revoke all on function public.create_todo(text, date, text, bigint[]) from public, anon;
revoke all on function public.set_todo_done(bigint, boolean)          from public, anon;
grant execute on function public.create_todo(text, date, text, bigint[]) to authenticated;
grant execute on function public.set_todo_done(bigint, boolean)          to authenticated;
