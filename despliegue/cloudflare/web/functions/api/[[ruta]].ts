// Todo lo que llega a residuos.terravivasas.net/api/... pasa al Worker del servidor («terra-residuos-api»), que lo
// entrega al contenedor con el API. Las pantallas (archivos fijos) no pasan por aquí.
//
// La dirección del navegador viaja en X-Forwarded-For (una sola, la que vio Cloudflare: no la que diga el navegador).
// El API la usa para la auditoría y para los límites de intentos de ingreso (Express con «trust proxy» = 1).
export const onRequest: PagesFunction<Env> = ({ request, env }) => {
  const headers = new Headers(request.headers);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  else headers.delete('x-forwarded-for');
  headers.set('x-forwarded-proto', 'https');
  return env.API.fetch(new Request(request, { headers }));
};
