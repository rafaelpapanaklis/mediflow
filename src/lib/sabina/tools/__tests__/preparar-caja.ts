/**
 * Lo que necesita `caja.test.ts` antes de cargar nada. Es `./preparar` con UNA
 * diferencia, y es a propósito:
 *
 * `./preparar` convierte `@/lib/prisma` en un objeto que revienta si alguien lo
 * usa, porque las herramientas deben leer SOLO por `ctx.db`. Aquí el `prisma`
 * falso REENVÍA al doble que la prueba ponga en `pantalla.db`. No lo usa la
 * herramienta —ella sigue leyendo por `ctx.db`—: lo usa `getCajaState`, que es
 * la función con la que la PANTALLA de Caja pinta sus cifras y que sigue leyendo
 * del `prisma` global. Así se puede correr la pantalla y Sabina contra la misma
 * base y exigir el mismo número.
 *
 * Mientras `pantalla.db` esté vacío, cualquier uso del `prisma` global revienta
 * igual que en `./preparar`: una lectura de la herramienta que se saltara
 * `ctx.db` no pasaría desapercibida.
 */

import { mock } from "node:test";

export const pantalla: { db: any } = { db: null };

mock.module("@/lib/auth/two-factor-identity", {
  namedExports: {
    personaTieneDosFactores: async () => false,
    dosFactoresDeLaPersona: async () => false,
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: new Proxy(
      {},
      {
        get(_objetivo, clave) {
          if (!pantalla.db) {
            throw new Error(`una lectura de Caja usó el prisma global (${String(clave)}) en vez de ctx.db`);
          }
          return pantalla.db[clave];
        },
      },
    ),
  },
});
