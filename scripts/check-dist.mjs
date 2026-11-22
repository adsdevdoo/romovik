import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadCatalog, sha256 } from '../src/lib/catalog.mjs';

const records = await loadCatalog();
const dist = path.join(ROOT, 'dist');
const paths = ['index.html', 'about/index.html', '404.html', ...records.map(record => `rom/${record.id}/index.html`)];
let links = 0;
for (const pathname of paths) {
  const html = await readFile(path.join(dist, pathname), 'utf8');
  assert.match(html, /<html lang="ru"/); assert.match(html, /<title>.+?<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\//);
  for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)[^\"]*"/g)) {
    const relative = decodeURIComponent(match[1]);
    if (relative.startsWith('//')) continue;
    const target = path.join(dist, relative, relative.endsWith('/') ? 'index.html' : '');
    assert.ok((await stat(target)).isFile(), `${pathname}: ${relative}`); links++;
  }
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(json); JSON.parse(json[1]);
}
const sitemap = await readFile(path.join(dist, 'sitemap-0.xml'), 'utf8');
for (const record of records) {
  assert.ok(sitemap.includes(`/rom/${record.id}/`));
  for (const asset of [record.dump, ...record.photos]) {
    const bytes = await readFile(path.join(dist, 'dumps', record.id, asset.file));
    assert.equal(bytes.length, asset.size); assert.equal(sha256(bytes), asset.sha256);
  }
  const html = await readFile(path.join(dist, 'rom', record.id, 'index.html'), 'utf8');
  assert.ok(!html.includes('noindex'));
  for (const item of record.strings) assert.ok(html.includes(item.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')));
}
assert.match(await readFile(path.join(dist, 'robots.txt'), 'utf8'), /Allow: \/[\s\S]+Sitemap: https:/);
console.log(`Проверены ${paths.length} HTML-страниц, ${links} внутренних ссылок, ${records.length} дампов и фото, строки в HTML, sitemap, robots и JSON-LD.`);
