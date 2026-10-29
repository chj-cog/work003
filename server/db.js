// DB에 접근하는 코드는 모두 이 파일에만 둔다.
// supabase는 요청한 사용자의 토큰이 실린 클라이언트다. RLS 때문에 그 사용자의 행만 보이고 바뀐다.

const TODO_COLUMNS = 'id, title, done, due_date, repeat_rule, repeat_source_id, completed_at, created_at, updated_at, todo_tags(tags(id, name, color))';

// Postgres 오류 코드 → HTTP 상태
const PG_STATUS = {
  23505: [409, '이미 있는 이름입니다.'],
  23503: [400, '연결할 수 없는 항목입니다.'],
  23514: [400, '입력값이 올바르지 않습니다.'],
  42501: [403, '권한이 없습니다.'],
};

class DbError extends Error {
  constructor(error) {
    const [status, message] = PG_STATUS[error.code] ?? [500, '데이터베이스 오류가 발생했습니다.'];
    super(message);
    this.status = status;
    this.detail = error;
  }
}

function check({ data, error }) {
  if (error) throw new DbError(error);
  return data;
}

function shapeTodo(row) {
  const { todo_tags, ...todo } = row;
  const tags = todo_tags.map((tt) => tt.tags).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return { ...todo, tags };
}

function createRepo(supabase) {
  // 미완료가 위, 그 안에서는 마감일이 빠른 순(마감일 없는 것은 뒤), 같으면 먼저 만든 순.
  async function listTodos({ q, tagId } = {}) {
    let query = supabase
      .from('todos')
      .select(TODO_COLUMNS)
      .order('done')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id');

    if (q) {
      // LIKE의 특수문자(%, _, \)를 그대로 검색할 수 있도록 이스케이프한다.
      query = query.ilike('title', `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    }
    if (tagId) {
      const links = check(await supabase.from('todo_tags').select('todo_id').eq('tag_id', tagId));
      if (!links.length) return [];
      query = query.in('id', links.map((l) => l.todo_id));
    }
    return check(await query).map(shapeTodo);
  }

  async function getTodo(id) {
    const row = check(await supabase.from('todos').select(TODO_COLUMNS).eq('id', id).maybeSingle());
    return row && shapeTodo(row);
  }

  // 할 일과 태그 연결을 DB 함수 하나로 한 번에 만든다.
  async function createTodo({ title, due_date, repeat_rule, tag_ids }) {
    const id = check(await supabase.rpc('create_todo', {
      p_title: title, p_due_date: due_date, p_repeat_rule: repeat_rule, p_tag_ids: tag_ids,
    }));
    return getTodo(id);
  }

  // 완료/미완료 전환. 반복 할 일의 다음 할 일 생성은 DB 함수가 같은 트랜잭션에서 한다.
  async function setDone(id, done) {
    const [row] = check(await supabase.rpc('set_todo_done', { p_id: id, p_done: done }));
    if (!row) return null;
    return {
      todo: await getTodo(row.todo_id),
      spawned: row.spawned_id ? await getTodo(row.spawned_id) : null,
    };
  }

  async function deleteTodo(id) {
    return check(await supabase.from('todos').delete().eq('id', id).select('id')).length > 0;
  }

  async function listTags() {
    return check(await supabase.from('tags').select('id, name, color').order('name'));
  }

  async function missingTagIds(ids) {
    if (!ids.length) return [];
    const found = new Set(check(await supabase.from('tags').select('id').in('id', ids)).map((t) => t.id));
    return ids.filter((id) => !found.has(id));
  }

  async function createTag({ name, color }) {
    return check(await supabase.from('tags').insert({ name, color }).select('id, name, color').single());
  }

  async function deleteTag(id) {
    return check(await supabase.from('tags').delete().eq('id', id).select('id')).length > 0;
  }

  return {
    listTodos, getTodo, createTodo, setDone, deleteTodo,
    listTags, missingTagIds, createTag, deleteTag,
  };
}

module.exports = { createRepo, DbError };
