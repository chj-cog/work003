// 'YYYY-MM-DD' 문자열 날짜 검사. 시간대 영향을 받지 않도록 UTC로만 계산한다.
// (반복 할 일의 다음 마감일 계산은 DB 함수 set_todo_done이 한다.)

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(value) {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

module.exports = { isValidDate };
