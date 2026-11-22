const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let csrf = '', page = 0, current: any = null;
const message = (value: string) => { el('moderation-message').textContent = value; };
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/${path}`, {...options, headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...options.headers}});
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || 'Не удалось выполнить действие.');
  return data;
}
function show(id: string) { for (const section of ['login-form', 'password-form', 'moderation-workspace']) el(section).hidden = section !== id; }
async function session() {
  try { const auth = await api('auth/session'); csrf = auth.csrf; show(auth.mustChangePassword ? 'password-form' : 'moderation-workspace'); if (!auth.mustChangePassword) await queue(); }
  catch { csrf = ''; show('login-form'); }
}
async function queue() {
  const result = await api(`moderation/submissions?status=${el<HTMLSelectElement>('queue-status').value}&page=${page}`);
  el('queue-count').textContent = `Заявок: ${result.total}`; el('queue-list').replaceChildren();
  for (const item of result.items) {
    const button = document.createElement('button'); button.className = 'queue-item'; button.type = 'button';
    button.textContent = `${item.chip} · ${item.dump.originalFilename} · ${new Date(item.createdAt).toLocaleString('ru')}`;
    button.addEventListener('click', () => review(item.id).catch(e => message(e.message))); el('queue-list').append(button);
  }
  if (!result.items.length) el('queue-list').textContent = 'В этой очереди пока нет заявок.';
  el('previous-page').hidden = page === 0; el('next-page').hidden = (page + 1) * 30 >= result.total;
}
async function review(id: string) {
  current = await api(`moderation/submissions/${id}`); el('review').hidden = false;
  el('review-title').textContent = current.chip; el('review-contact').textContent = `Контакт: ${current.contact || 'не оставлен'}`;
  el('review-file').textContent = `${current.dump.originalFilename} · ${current.dump.size} байт · SHA-256 ${current.dump.sha256}`;
  el('review-duplicates').textContent = current.duplicates.length ? `Такое содержимое есть у: ${current.duplicates.map((d: any) => `№${d.sequence} ${d.chip}`).join(', ')}. Отдельный экземпляр можно сохранить.` : 'Совпадений с опубликованными дампами нет.';
  el('review-photos').replaceChildren();
  for (const photo of current.photos) {
    const link = document.createElement('a'); link.href = `/api/moderation/submissions/${id}/files/${photo.file}`; link.target = '_blank'; link.rel = 'noopener';
    const image = document.createElement('img'); image.src = link.href; image.alt = photo.alt; link.append(image); el('review-photos').append(link);
  }
  el<HTMLAnchorElement>('review-download').href = `/api/moderation/submissions/${id}/files/${current.dump.file}`;
  const form = el<HTMLFormElement>('review-form'); form.reset();
  for (const name of ['chip', 'manufacturer', 'type', 'package', 'label', 'description', 'notes', 'device', 'board', 'origin', 'programmer', 'profile']) (form.elements.namedItem(name) as HTMLInputElement).value = current[name] || '';
  el('string-candidates').replaceChildren();
  current.candidates.forEach((candidate: any, index: number) => {
    const label = document.createElement('label'); label.className = 'check-label';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'candidate'; checkbox.value = String(index);
    const text = document.createElement('code'); text.textContent = `0x${candidate.offset.toString(16)}  ${candidate.text}`; label.append(checkbox, text); el('string-candidates').append(label);
  });
  if (!current.candidates.length) el('string-candidates').textContent = 'Подходящих ASCII-кандидатов нет.';
  form.hidden = current.status !== 'pending'; el('reject-form').hidden = current.status !== 'pending';
  el('review-result').replaceChildren();
  if (current.status === 'approved') { const a = document.createElement('a'); a.href = `/rom/${id}/`; a.textContent = 'Открыть опубликованную карточку'; el('review-result').append(a); }
  if (current.status === 'rejected') el('review-result').textContent = `Отклонено: ${current.reason}`;
  el('review').scrollIntoView({behavior: 'smooth'});
}
function handleForm(id: string, action: (form: HTMLFormElement) => Promise<void>) {
  el<HTMLFormElement>(id).addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const button = form.querySelector<HTMLButtonElement>('button')!; button.disabled = true; message('');
    try { await action(form); } catch (e) { message((e as Error).message); el('moderation-message').scrollIntoView({behavior: 'smooth'}); } finally { button.disabled = false; }
  });
}
handleForm('login-form', async form => { const auth = await api('auth/login', {method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form)))}); csrf = auth.csrf; form.reset(); show(auth.mustChangePassword ? 'password-form' : 'moderation-workspace'); if (!auth.mustChangePassword) await queue(); });
handleForm('password-form', async form => { const result = await api('auth/password', {method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form)))}); form.reset(); csrf = ''; show('login-form'); message(result.message); });
handleForm('review-form', async form => {
  const data = new FormData(form), body: any = Object.fromEntries(data);
  let extra; try { extra = JSON.parse(String(data.get('extraStrings'))); } catch { throw new Error('Проверьте JSON дополнительных строк.'); }
  if (!Array.isArray(extra)) throw new Error('Дополнительные строки должны быть массивом JSON.');
  body.strings = [...data.getAll('candidate').map(index => current.candidates[Number(index)]), ...extra];
  body.markingsConfirmed = data.has('markingsConfirmed'); body.stringsReviewed = data.has('stringsReviewed');
  await api(`moderation/submissions/${current.id}/approve`, {method: 'POST', body: JSON.stringify(body)}); message('Дамп опубликован в конце каталога.'); await review(current.id); await queue();
});
handleForm('reject-form', async form => { await api(`moderation/submissions/${current.id}/reject`, {method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form)))}); message('Заявка отклонена.'); await review(current.id); await queue(); });
el('logout').addEventListener('click', async () => { try { await api('auth/logout', {method: 'POST'}); csrf = ''; show('login-form'); } catch (e) { message((e as Error).message); } });
el('change-password').addEventListener('click', () => show('password-form'));
el('queue-status').addEventListener('change', () => { page = 0; el('review').hidden = true; queue().catch(e => message(e.message)); });
el('next-page').addEventListener('click', () => { page++; queue().catch(e => message(e.message)); });
el('previous-page').addEventListener('click', () => { page = Math.max(0, page - 1); queue().catch(e => message(e.message)); });
session();
