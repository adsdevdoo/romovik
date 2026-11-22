const input = document.querySelector<HTMLInputElement>('#search')!;
const sort = document.querySelector<HTMLSelectElement>('#sort')!;
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
  const sorted = [...records].sort((a, b) => sort.value === 'chip' ? a.dataset.chip!.localeCompare(b.dataset.chip!, 'ru') : sort.value === 'size' ? Number(a.dataset.size) - Number(b.dataset.size) : b.dataset.date!.localeCompare(a.dataset.date!));
  for (const record of sorted) {
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
  for (const [key, value] of [['q', input.value.trim()], ['type', type], ['sort', sort.value === 'new' ? '' : sort.value]]) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  history.replaceState(null, '', url);
}
input.addEventListener('input', update);
sort.addEventListener('change', update);
buttons.forEach(button => button.addEventListener('click', () => { type = button.dataset.type!; update(); }));
reset.addEventListener('click', () => { input.value = ''; type = ''; sort.value = 'new'; update(); input.focus(); });
function restore() {
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') || '';
  type = buttons.some(button => button.dataset.type === params.get('type')) ? params.get('type')! : '';
  sort.value = ['new', 'chip', 'size'].includes(params.get('sort')!) ? params.get('sort')! : 'new';
  update();
}
window.addEventListener('popstate', restore);
restore();
