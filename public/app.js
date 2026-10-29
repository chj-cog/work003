// 화면 코드. DB도 Supabase도 모르고 백엔드 API(/api/...)에만 요청한다.
// 로그인 정보는 백엔드가 httpOnly 쿠키로 관리하므로 이 코드는 토큰을 다루지 않는다.

const REPEAT_LABELS = { daily: '매일', weekly: '매주', monthly: '매월' };

const state = {
  tags: [],
  filterTagId: null,
  q: '',
};

const $ = (id) => document.getElementById(id);

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  // 로그인이 풀렸으면(만료 등) 로그인 화면으로 돌아간다.
  if (res.status === 401 && !url.startsWith('/api/auth/')) showAuth();
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

// 브라우저(내 컴퓨터) 기준 오늘 날짜 'YYYY-MM-DD'
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

// 브라우저 확인 창(confirm)은 환경에 따라 막혀서 바로 '취소'가 될 수 있다.
// 대신 버튼을 한 번 누르면 확인 문구로 바뀌고, 3초 안에 한 번 더 누르면 실행한다.
function confirmButton(button, { armedText, armedLabel, onConfirm }) {
  const idle = { text: button.textContent, label: button.getAttribute('aria-label') };
  let timer = null;
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    button.classList.remove('armed');
    button.textContent = idle.text;
    if (idle.label) button.setAttribute('aria-label', idle.label);
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (timer) {
      reset();
      onConfirm();
      return;
    }
    button.classList.add('armed');
    button.textContent = armedText;
    button.setAttribute('aria-label', armedLabel);
    timer = setTimeout(reset, 3000);
  });
  button.addEventListener('blur', reset);
}

function tagChip(tag, extra = []) {
  const dot = el('span', { className: 'dot' });
  if (tag.color) dot.style.background = tag.color;
  return el('span', { className: 'chip' }, [dot, tag.name, ...extra]);
}

// ---- 태그 ----
async function loadTags() {
  state.tags = await api('GET', '/api/tags');
  if (state.filterTagId && !state.tags.some((t) => t.id === state.filterTagId)) state.filterTagId = null;
  renderTagPicks();
  renderTagFilter();
}

function renderTagPicks() {
  const checked = new Set([...$('form-tags').querySelectorAll('input:checked')].map((i) => Number(i.value)));
  $('form-tags').replaceChildren(...state.tags.map((tag) => {
    const box = el('input', { type: 'checkbox', value: tag.id, checked: checked.has(tag.id) });
    const chip = tagChip(tag);
    const label = el('label', { className: 'chip' + (box.checked ? ' on' : '') }, [box, ...chip.childNodes]);
    box.addEventListener('change', () => label.classList.toggle('on', box.checked));
    return label;
  }));
}

function renderTagFilter() {
  const all = el('button', { type: 'button', className: 'chip' + (state.filterTagId ? '' : ' on'), textContent: '전체' });
  all.setAttribute('aria-pressed', String(!state.filterTagId));
  all.addEventListener('click', () => setFilter(null));

  const chips = state.tags.map((tag) => {
    const del = el('button', { type: 'button', className: 'x', textContent: '×', title: `'${tag.name}' 태그 삭제` });
    del.setAttribute('aria-label', `'${tag.name}' 태그 삭제`);
    confirmButton(del, {
      armedText: '삭제?',
      armedLabel: `'${tag.name}' 태그를 정말 삭제하려면 한 번 더 누르세요. 할 일은 지워지지 않습니다.`,
      onConfirm: () => deleteTag(tag),
    });
    const pick = el('button', { type: 'button', className: 'pick' }, [...tagChip(tag).childNodes]);
    pick.setAttribute('aria-pressed', String(state.filterTagId === tag.id));
    pick.addEventListener('click', () => setFilter(tag.id));
    return el('span', { className: 'chip' + (state.filterTagId === tag.id ? ' on' : '') }, [pick, del]);
  });
  $('tag-filter').replaceChildren(...(state.tags.length ? [all, ...chips] : []));
}

function setFilter(tagId) {
  state.filterTagId = tagId;
  renderTagFilter();
  loadTodos();
}

async function deleteTag(tag) {
  $('tag-error').textContent = '';
  try {
    await api('DELETE', `/api/tags/${tag.id}`);
    await loadTags();
    await loadTodos();
  } catch (err) {
    $('tag-error').textContent = err.message;
  }
}

$('tag-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('tag-error').textContent = '';
  try {
    await api('POST', '/api/tags', { name: $('tag-name').value, color: $('tag-color').value });
    $('tag-name').value = '';
    await loadTags();
  } catch (err) {
    $('tag-error').textContent = err.message;
  }
});

// ---- 할 일 ----
async function loadTodos() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.filterTagId) params.set('tag', state.filterTagId);
  try {
    const todos = await api('GET', '/api/todos?' + params);
    $('list-error').textContent = '';
    renderTodos(todos);
  } catch (err) {
    $('list-error').textContent = err.message;
  }
}

function renderTodos(todos) {
  const t = today();
  $('list').replaceChildren(...todos.map((todo) => {
    const li = el('li', { className: 'todo' });
    if (todo.done) li.classList.add('done');
    else if (todo.due_date && todo.due_date < t) li.classList.add('overdue');
    else if (todo.due_date === t) li.classList.add('today');

    const box = el('input', { type: 'checkbox', checked: todo.done });
    box.setAttribute('aria-label', `'${todo.title}' 완료`);
    box.addEventListener('change', () => toggleDone(todo, box.checked));

    const meta = el('div', { className: 'meta' });
    if (todo.due_date) {
      let label = todo.due_date;
      if (!todo.done && todo.due_date < t) label += ' (지남)';
      else if (!todo.done && todo.due_date === t) label += ' (오늘)';
      meta.append(el('span', { className: 'due', textContent: label }));
    }
    if (REPEAT_LABELS[todo.repeat_rule]) meta.append(el('span', { textContent: '↻ ' + REPEAT_LABELS[todo.repeat_rule] }));
    for (const tag of todo.tags) meta.append(tagChip(tag));

    const body = el('div', { className: 'body' }, [el('div', { className: 'title', textContent: todo.title })]);
    if (meta.childElementCount) body.append(meta);

    const del = el('button', { type: 'button', className: 'del', textContent: '삭제' });
    del.setAttribute('aria-label', `'${todo.title}' 삭제`);
    confirmButton(del, {
      armedText: '정말 삭제?',
      armedLabel: `'${todo.title}'을(를) 정말 삭제하려면 한 번 더 누르세요`,
      onConfirm: () => deleteTodo(todo),
    });

    li.append(box, body, del);
    return li;
  }));
  $('empty').hidden = todos.length > 0;
}

async function toggleDone(todo, done) {
  try {
    await api('PATCH', `/api/todos/${todo.id}/done`, { done });
  } catch (err) {
    $('list-error').textContent = err.message;
  }
  await loadTodos();
}

async function deleteTodo(todo) {
  try {
    await api('DELETE', `/api/todos/${todo.id}`);
  } catch (err) {
    $('list-error').textContent = err.message;
  }
  await loadTodos();
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('form-error').textContent = '';
  const repeat_rule = $('repeat').value;
  const due_date = $('due').value;
  if (!$('title').value.trim()) {
    $('form-error').textContent = '할 일을 입력하세요.';
    $('title').focus();
    return;
  }
  if (!due_date) {
    $('form-error').textContent = '마감일을 입력하세요.';
    $('due').focus();
    return;
  }
  const tag_ids = [...$('form-tags').querySelectorAll('input:checked')].map((i) => Number(i.value));
  try {
    await api('POST', '/api/todos', { title: $('title').value, due_date, repeat_rule, tag_ids });
    $('add-form').reset();
    renderTagPicks();
    $('title').focus();
    await loadTodos();
  } catch (err) {
    $('form-error').textContent = err.message;
  }
});

// 입력하는 즉시 검색 (연속 입력은 잠깐 모아서 한 번에 요청)
let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = $('search').value.trim();
    loadTodos();
  }, 150);
});

// ---- 로그인 ----
let signupMode = false;

function setAuthMode(signup) {
  signupMode = signup;
  $('auth-title').textContent = signup ? '회원가입' : '로그인';
  $('auth-submit').textContent = signup ? '가입하기' : '로그인';
  $('auth-switch').textContent = signup ? '이미 계정이 있어요. 로그인' : '처음이세요? 회원가입';
  $('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('auth-error').textContent = '';
}

function showAuth() {
  $('app-view').hidden = true;
  $('account').hidden = true;
  $('auth-view').hidden = false;
  $('auth-email').focus();
}

async function showApp(email) {
  $('auth-view').hidden = true;
  $('auth-form').reset();
  $('auth-info').textContent = '';
  $('user-email').textContent = email;
  $('account').hidden = false;
  $('app-view').hidden = false;
  state.filterTagId = null;
  state.q = '';
  $('search').value = '';
  try {
    await loadTags();
    await loadTodos();
  } catch (err) {
    $('list-error').textContent = err.message;
  }
}

$('auth-switch').addEventListener('click', () => setAuthMode(!signupMode));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  $('auth-info').textContent = '';
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) {
    $('auth-error').textContent = '이메일과 비밀번호를 입력하세요.';
    return;
  }
  if (signupMode && password.length < 8) {
    $('auth-error').textContent = '비밀번호는 8자 이상이어야 합니다.';
    return;
  }
  $('auth-submit').disabled = true;
  try {
    if (signupMode) {
      const result = await api('POST', '/api/auth/signup', { email, password });
      if (result.needsConfirmation) {
        setAuthMode(false);
        $('auth-email').value = email;
        $('auth-info').textContent = `${result.email}로 인증 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요.`;
        return;
      }
      return await showApp(result.email);
    }
    const result = await api('POST', '/api/auth/login', { email, password });
    await showApp(result.email);
  } catch (err) {
    $('auth-error').textContent = err.message;
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  try {
    await api('POST', '/api/auth/logout');
  } finally {
    $('list').replaceChildren();
    setAuthMode(false);
    showAuth();
  }
});

// 시작: 이미 로그인돼 있으면 바로 목록, 아니면 로그인 화면
api('GET', '/api/auth/me')
  .then((me) => showApp(me.email))
  .catch((err) => {
    showAuth();
    if (!/로그인이 필요/.test(err.message)) {
      $('auth-error').textContent = '서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요. (' + err.message + ')';
    }
  });
