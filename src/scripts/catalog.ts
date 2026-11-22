const input = document.querySelector<HTMLInputElement>('#search')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-type]')];
const records = [...document.querySelectorAll<HTMLElement>('[data-record]')];
const list = document.querySelector('#record-list')!;
const empty = document.querySelector<HTMLElement>('#empty-state')!;
const reset = document.querySelector<HTMLButtonElement>('#reset-filters')!;
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е');
let type = '';
function update() {
  const terms = normalize(input.value).trim().split(/\s+/).filter(Boolean);
  let count = 0;
  for (const record of records) {
    record.hidden = !((!type || record.dataset.type === type) && terms.every(term => record.dataset.search!.includes(term)));
    if (!record.hidden) count++;
    list.append(record);
  }
  buttons.forEach(button => { const active = button.dataset.type === type; button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active); });
  document.querySelector('#result-count')!.textContent = `Записей: ${count}${records.length ? ` из ${records.length}` : ''}`;
  empty.hidden = count !== 0;
  const pristine = records.length === 0 && !type && !input.value.trim();
  document.querySelector('#empty-title')!.textContent = pristine ? 'Первые дампы — впереди' : 'Ничего не найдено';
  document.querySelector('#empty-description')!.textContent = pristine ? 'Коллекция готовится к публикации. Здесь появятся микросхемы, их истории и файлы памяти.' : records.length ? 'Попробуйте другую маркировку или выберите все типы памяти.' : 'В архиве пока нет опубликованных дампов.';
  document.querySelector<HTMLElement>('#empty-about')!.hidden = !pristine;
  reset.hidden = pristine;
  const url = new URL(location.href);
  url.searchParams.delete('sort');
  for (const [key, value] of [['q', input.value.trim()], ['type', type]]) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  history.replaceState(null, '', url);
}
input.addEventListener('input', update);
buttons.forEach(button => button.addEventListener('click', () => { type = button.dataset.type!; update(); }));
reset.addEventListener('click', () => { input.value = ''; type = ''; update(); input.focus(); });
function restore() {
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') || '';
  type = buttons.some(button => button.dataset.type === params.get('type')) ? params.get('type')! : '';
  update();
}
window.addEventListener('popstate', restore);
restore();
