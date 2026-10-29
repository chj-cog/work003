// RLS(행 수준 보안) 점검 스크립트.
// 시험용 계정 두 개(A, B)로 Supabase에 직접 접속해서, 서로의 데이터를 보거나 바꿀 수 없는지 확인한다.
// 실행: npm run check:rls   (.env에 RLS_TEST_A_EMAIL 등 4개 값이 필요)
// A 계정에 시험용 할 일·태그를 만들었다가 끝나면 지운다.
const assert = require('assert/strict');
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
const need = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'RLS_TEST_A_EMAIL', 'RLS_TEST_A_PASSWORD', 'RLS_TEST_B_EMAIL', 'RLS_TEST_B_PASSWORD'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`.env에 다음 값을 넣어 주세요: ${missing.join(', ')}`);
  process.exit(1);
}

const client = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

async function signIn(prefix) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({
    email: process.env[`${prefix}_EMAIL`],
    password: process.env[`${prefix}_PASSWORD`],
  });
  if (error) throw new Error(`${prefix} 로그인 실패: ${error.message}`);
  return { sb, userId: data.user.id };
}

let passed = 0;
function ok(label) {
  passed++;
  console.log(`  통과  ${label}`);
}

(async () => {
  const a = await signIn('RLS_TEST_A');
  const b = await signIn('RLS_TEST_B');
  const anon = client();
  assert.notEqual(a.userId, b.userId, 'A와 B는 서로 다른 계정이어야 합니다.');

  const tagName = `rls-check-${Date.now()}`;
  const { data: tag, error: tagErr } = await a.sb.from('tags').insert({ name: tagName }).select().single();
  assert.ifError(tagErr);
  const { data: todoId, error: todoErr } = await a.sb.rpc('create_todo', {
    p_title: 'RLS 점검용', p_due_date: '2030-01-01', p_repeat_rule: 'weekly', p_tag_ids: [tag.id],
  });
  assert.ifError(todoErr);

  try {
    console.log('A 계정');
    const own = await a.sb.from('todos').select('id, user_id').eq('id', todoId).single();
    assert.equal(own.data.user_id, a.userId);
    ok('자기 할 일을 볼 수 있고, 소유자가 A로 기록됨');

    console.log('B 계정 (남의 데이터)');
    assert.equal((await b.sb.from('todos').select('id').eq('id', todoId)).data.length, 0);
    assert.equal((await b.sb.from('tags').select('id').eq('id', tag.id)).data.length, 0);
    assert.equal((await b.sb.from('todo_tags').select('todo_id').eq('todo_id', todoId)).data.length, 0);
    ok('A의 할 일·태그·연결이 보이지 않음');

    const upd = await b.sb.from('todos').update({ title: '해킹' }).eq('id', todoId).select();
    assert.equal(upd.data.length, 0);
    const done = await b.sb.rpc('set_todo_done', { p_id: todoId, p_done: true });
    assert.equal(done.data.length, 0);
    ok('A의 할 일을 수정·완료 처리할 수 없음');

    const del = await b.sb.from('todos').delete().eq('id', todoId).select();
    assert.equal(del.data.length, 0);
    const delTag = await b.sb.from('tags').delete().eq('id', tag.id).select();
    assert.equal(delTag.data.length, 0);
    ok('A의 할 일·태그를 삭제할 수 없음');

    const spoof = await b.sb.from('todos').insert({ title: '남의 이름으로', due_date: '2030-01-01', user_id: a.userId });
    assert.ok(spoof.error, 'A 명의로 추가가 막혀야 합니다.');
    ok('A 명의(user_id)로 할 일을 추가할 수 없음');

    const { data: bTodoId } = await b.sb.rpc('create_todo', { p_title: 'B 것', p_due_date: '2030-01-01', p_repeat_rule: 'none', p_tag_ids: [] });
    const link = await b.sb.from('todo_tags').insert({ todo_id: bTodoId, tag_id: tag.id });
    assert.ok(link.error, 'A의 태그를 B의 할 일에 붙이는 것이 막혀야 합니다.');
    await b.sb.from('todos').delete().eq('id', bTodoId);
    ok('A의 태그를 B의 할 일에 붙일 수 없음');

    console.log('로그인 안 함 (공개용 키만)');
    const anonRead = await anon.from('todos').select('id');
    assert.ok(anonRead.error || anonRead.data.length === 0);
    const anonInsert = await anon.from('todos').insert({ title: 'x', due_date: '2030-01-01' });
    assert.ok(anonInsert.error);
    const anonRpc = await anon.rpc('create_todo', { p_title: 'x', p_due_date: '2030-01-01', p_repeat_rule: 'none', p_tag_ids: [] });
    assert.ok(anonRpc.error);
    ok('조회·추가·함수 호출 모두 막힘');

    console.log('A 계정 (원래 데이터가 그대로인지)');
    const after = await a.sb.from('todos').select('title, done').eq('id', todoId).single();
    assert.deepEqual(after.data, { title: 'RLS 점검용', done: false });
    ok('B의 시도 후에도 A의 할 일이 바뀌지 않음');
  } finally {
    await a.sb.from('todos').delete().eq('repeat_source_id', todoId);
    await a.sb.from('todos').delete().eq('id', todoId);
    await a.sb.from('tags').delete().eq('id', tag.id);
  }

  console.log(`\nRLS 점검 ${passed}개 모두 통과. 시험용 데이터는 지웠습니다.`);
})().catch((err) => {
  console.error('\nRLS 점검 실패:', err.message);
  process.exit(1);
});
