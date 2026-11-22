import { getCatalog } from '../lib/public-catalog.mjs';
export async function GET({ site }) {
  const paths = ['/', '/about/', '/submit/', ...(await getCatalog()).map(r => `/rom/${r.id}/`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${new URL(path, site)}</loc></url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml' } });
}
