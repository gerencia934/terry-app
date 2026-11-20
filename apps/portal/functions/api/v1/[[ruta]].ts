// Función de Cloudflare Pages: /api/v1/* del portal Terry-App (la Cuenta Terry-App). Todo el código está en servidor/.
import { atender, type Entorno } from '../../../servidor/rutas.ts';

export const onRequest = (ctx: { request: Request; env: Entorno }) => atender(ctx.request, ctx.env);
