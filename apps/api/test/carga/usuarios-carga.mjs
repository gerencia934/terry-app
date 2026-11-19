// Crea (o reactiva) los usuarios de la prueba de carga en una base de STAGING:
//   carga001@pruebas.terry-go.invalid … cargaNNN@pruebas.terry-go.invalid  (dominio .invalid: ningún correo sale de verdad)
//
// Uso:
//   CONFIRMAR=staging CANTIDAD=400 CLAVE_CARGA=... DATABASE_URL=postgresql://... node apps/api/test/carga/usuarios-carga.mjs
// Al terminar la prueba, dejarlos inactivos (nada se borra):
//   CONFIRMAR=staging CANTIDAD=400 DATABASE_URL=postgresql://... node apps/api/test/carga/usuarios-carga.mjs --desactivar
//
// Opcionales: ROL (por omisión «Logística», que ve solicitudes, manifiestos, conciliaciones y certificados), EMPRESA_NIT.
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const salir = (m) => { console.error(m); process.exit(1); };
if (process.env.CONFIRMAR !== 'staging') salir('Por seguridad defina CONFIRMAR=staging: este guion crea usuarios de prueba y nunca se corre en producción.');
if (/prod/i.test(process.env.DATABASE_URL ?? '')) salir('La DATABASE_URL parece de producción. Cancelado.');
const desactivar = process.argv.includes('--desactivar');
const clave = process.env.CLAVE_CARGA ?? '';
if (!desactivar && (clave.length < 10 || !/[A-Za-z]/.test(clave) || !/\d/.test(clave))) salir('CLAVE_CARGA: mínimo 10 caracteres, con letras y números.');
const cantidad = Math.min(Math.max(Number(process.env.CANTIDAD ?? 400), 1), 2000);
const correo = (i) => `carga${String(i).padStart(3, '0')}@pruebas.terry-go.invalid`;

const db = new PrismaClient();
try {
  if (desactivar) {
    const r = await db.usuario.updateMany({ where: { email: { in: Array.from({ length: cantidad }, (_, i) => correo(i + 1)) } }, data: { activo: false } });
    console.log(`✓ ${r.count} usuarios de carga quedaron inactivos.`);
  } else {
    const empresa = await db.empresa.findFirstOrThrow({ where: { nit: process.env.EMPRESA_NIT ?? '901089780-8' } });
    const rol = await db.rol.findUniqueOrThrow({ where: { empresaId_nombre: { empresaId: empresa.id, nombre: process.env.ROL ?? 'Logística' } } });
    const passwordHash = await hash(clave, { memoryCost: 19456, timeCost: 2, parallelism: 1 }); // mismos parámetros que el API
    for (let i = 1; i <= cantidad; i++) {
      await db.usuario.upsert({
        where: { email: correo(i) },
        update: { passwordHash, activo: true, rolId: rol.id, intentosFallidos: 0, bloqueadoHasta: null },
        create: { empresaId: empresa.id, rolId: rol.id, nombre: `Usuario de carga ${i}`, documento: `CARGA${i}`, email: correo(i), passwordHash },
      });
    }
    console.log(`✓ ${cantidad} usuarios de carga listos (rol ${rol.nombre}). Aceptan la política de datos en su primer ingreso, como cualquier usuario.`);
  }
} finally {
  await db.$disconnect();
}
