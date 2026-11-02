#!/usr/bin/env node
// 터미널용 todo 명령. 앱의 DB 코드(server/db.js)를 그대로 쓰는 얇은 진입점이다.
// 앱과 같은 Supabase에 시험용 계정으로 로그인하므로 RLS가 그대로 적용되어 그 계정의 할 일만 다룬다.
// 실행: npm run todo -- <명령>   (.env에 TODO_CLI_EMAIL, TODO_CLI_PASSWORD 필요)
const path = require('path');

// 어느 폴더에서 실행해도 프로젝트의 .env를 읽는다. (이미 있는 환경변수는 덮어쓰지 않음)
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const { createClient } = require('@supabase/supabase-js');
const { checkConfig } = require('../server/supabase');
const { createRepo, DbError } = require('../server/db');
const { isValidDate } = require('../server/dates');

const REPEAT_RULES = ['none', 'daily', 'weekly', 'monthly'];
const REPEAT_LABEL = { daily: '매일', weekly: '매주', monthly: '매월' };

const USAGE = `사용법: todo <명령>
  add <제목> --due <YYYY-MM-DD|today|tomorrow> [--repeat daily|weekly|monthly]
  list [검색어]
  done <id>
  summary         오늘 완료한 할 일 요약`;

class UsageError extends Error {}

// 내 컴퓨터 시간대 기준 YYYY-MM-DD
function localDate(date = new Date()) {
  return date.toLocaleDateString('sv-SE');
}

function parseDue(value) {
  if (value === 'today') return localDate();
  if (value === 'tomorrow') return localDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (typeof value !== 'string' || !isValidDate(value)) throw new UsageError('마감일은 YYYY-MM-DD, today, tomorrow 중 하나로 입력하세요.');
  return value;
}

// "--due 값" 형태의 옵션과 나머지 단어를 나눈다.
function parseArgs(args) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (i + 1 >= args.length) throw new UsageError(`${args[i]} 뒤에 값을 입력하세요.`);
      opts[args[i].slice(2)] = args[++i];
    } else {
      rest.push(args[i]);
    }
  }
  return { opts, rest };
}

function formatTodo(t, today = localDate()) {
  const mark = t.done ? '[x]' : '[ ]';
  let due = t.due_date ?? '          ';
  if (!t.done && t.due_date && t.due_date < today) due += ' (지남)';
  else if (!t.done && t.due_date === today) due += ' (오늘)';
  const extras = [
    REPEAT_LABEL[t.repeat_rule],
    ...t.tags.map((tag) => `#${tag.name}`),
  ].filter(Boolean).join(' ');
  return `${mark} ${String(t.id).padStart(4)}  ${due}  ${t.title}${extras ? `  ${extras}` : ''}`;
}

async function signIn() {
  checkConfig();
  const email = process.env.TODO_CLI_EMAIL;
  const password = process.env.TODO_CLI_PASSWORD;
  if (!email || !password) {
    throw new UsageError('.env에 TODO_CLI_EMAIL, TODO_CLI_PASSWORD(시험용 계정)를 넣어 주세요.');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new UsageError(`로그인 실패: ${error.message}`);
  return createRepo(supabase);
}

// 각 명령은 인자를 먼저 검사한 뒤(로그인 전), 로그인된 repo로 실행할 함수를 돌려준다.
const commands = {
  add(args) {
    const { opts, rest } = parseArgs(args);
    const title = rest.join(' ').trim();
    if (!title) throw new UsageError('제목을 입력하세요.');
    if (title.length > 200) throw new UsageError('제목은 200자 이하로 입력하세요.');
    if (!opts.due) throw new UsageError('마감일을 입력하세요. 예: --due today');
    const repeat_rule = opts.repeat ?? 'none';
    if (!REPEAT_RULES.includes(repeat_rule)) throw new UsageError('반복은 daily, weekly, monthly 중 하나입니다.');
    const due_date = parseDue(opts.due);

    return async (repo) => {
      const todo = await repo.createTodo({ title, due_date, repeat_rule, tag_ids: [] });
      console.log(`추가했습니다.\n${formatTodo(todo)}`);
    };
  },

  list(args) {
    const q = args.join(' ').trim();
    return async (repo) => {
      const todos = await repo.listTodos({ q });
      if (!todos.length) return console.log('할 일이 없습니다.');
      const today = localDate();
      for (const t of todos) console.log(formatTodo(t, today));
    };
  },

  done(args) {
    const id = Number(args[0]);
    if (!Number.isSafeInteger(id) || id <= 0) throw new UsageError('완료할 할 일의 id를 입력하세요. 예: todo done 12');
    return async (repo) => {
      const result = await repo.setDone(id, true);
      if (!result) throw new UsageError(`id ${id}인 할 일을 찾을 수 없습니다.`);
      console.log(`완료했습니다.\n${formatTodo(result.todo)}`);
      if (result.spawned) console.log(`다음 반복 할 일을 만들었습니다.\n${formatTodo(result.spawned)}`);
    };
  },

  summary() {
    return async (repo) => {
      const today = localDate();
      const all = await repo.listTodos();
      const doneToday = all.filter((t) => t.done && t.completed_at && localDate(new Date(t.completed_at)) === today);
      const open = all.filter((t) => !t.done);
      const overdue = open.filter((t) => t.due_date && t.due_date < today);

      console.log(`오늘(${today}) 완료: ${doneToday.length}개`);
      for (const t of doneToday) console.log(`  - ${t.title}`);
      console.log(`남은 할 일: ${open.length}개 (마감 지남 ${overdue.length}개)`);
    };
  },
};

(async () => {
  const [name, ...args] = process.argv.slice(2);
  const command = Object.hasOwn(commands, name) ? commands[name] : null;
  if (!command) {
    console.log(USAGE);
    process.exitCode = name ? 1 : 0;
    return;
  }
  try {
    const run = command(args);
    await run(await signIn());
  } catch (err) {
    if (err instanceof UsageError || err instanceof DbError) console.error(err.message);
    else console.error(err);
    process.exitCode = 1;
  }
})();
