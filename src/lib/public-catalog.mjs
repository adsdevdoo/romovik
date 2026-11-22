import { validateRecord } from './catalog.mjs';

const base = () => process.env.API_ORIGIN || 'http://127.0.0.1:8080';
export async function getCatalog() {
  const response = await fetch(`${base()}/api/catalog`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Catalog temporarily unavailable');
  return (await response.json()).map(validateRecord).sort((a, b) => a.sequence - b.sequence);
}
export async function getRecord(id) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) return null;
  const response = await fetch(`${base()}/api/catalog/${id}`, { signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Catalog temporarily unavailable');
  return validateRecord(await response.json());
}
