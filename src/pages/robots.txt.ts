export function GET({ site }: { site: URL }) {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /moderation/\nDisallow: /api/moderation/\nDisallow: /api/auth/\n\nSitemap: ${new URL('sitemap-index.xml', site)}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
