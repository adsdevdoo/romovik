// Development/standalone proxy. In production nginx routes directly to the API.
export const ALL = async ({ request, params }) => {
  const url = new URL(request.url);
  const upstream = new URL(`/api/${params.path}${url.search}`, process.env.API_ORIGIN || 'http://127.0.0.1:8080');
  const headers = new Headers(request.headers);
  headers.delete('host'); headers.delete('x-client-ip');
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.body;
  const response = await fetch(upstream, { method: request.method, headers, body, duplex: 'half', redirect: 'manual' });
  const outgoing = new Headers(response.headers);
  outgoing.delete('content-encoding'); outgoing.delete('content-length');
  return new Response(response.body, { status: response.status, headers: outgoing });
};
