export const GET = async ({ params }) => {
  const path = params.path || '';
  if (!/^(catalog\.json|[a-z0-9-]+\/[a-zA-Z0-9._-]+)$/.test(path) || path.includes('..')) return new Response(null, {status: 404});
  const response = await fetch(new URL(`/dumps/${path}`, process.env.API_ORIGIN || 'http://127.0.0.1:8080'));
  const headers = new Headers(response.headers); headers.delete('content-encoding'); headers.delete('content-length');
  return new Response(response.body, { status: response.status, headers });
};
