/**
 * Lo mínimo que hace falta para poder cargar las herramientas en `tsx --test`.
 *
 * Se importa PRIMERO en cada prueba (los `import` se evalúan en orden, así que
 * los `mock.module` de aquí quedan registrados antes de que se cargue nada de
 * `@/lib/sabina/tools`).
 *
 * ── QUÉ SE SUSTITUYE, Y QUÉ NO ─────────────────────────────────────────
 * Solo dos módulos, y ninguno de los dos participa en lo que se está probando:
 *
 *  · `@/lib/auth/two-factor-identity` — lo arrastra `@/lib/auth-context` y usa
 *    `cache()` de React, que fuera del bundle de Next no existe
 *    ("import_react.cache is not a function"). Ninguna herramienta lo llama: el
 *    segundo factor se resuelve al construir la sesión, mucho antes.
 *  · `@/lib/prisma` — las pruebas inyectan su propio cliente en `ctx.db`, así
 *    que el `prisma` real nunca se usa. Sustituirlo evita instanciar un
 *    PrismaClient que no va a hablar con nada.
 *
 * 🔴 Lo que NO se sustituye, a propósito, porque ES lo que se prueba:
 * `buildPatientWhere` y `buildAppointmentWhere` (@/lib/auth-context),
 * `hasPermission` (@/lib/auth/permissions), los helpers de visibilidad por
 * paciente, `revenuePaymentWhere`/`netRevenueSeries` (@/lib/caja) y la
 * aritmética de conceptos (@/lib/invoice-totals) corren DE VERDAD. Si se
 * mockearan, las pruebas dirían que el criterio de Sabina es el de la pantalla
 * sin haberlo comprobado.
 */

import { mock } from "node:test";

mock.module("@/lib/auth/two-factor-identity", {
  namedExports: {
    personaTieneDosFactores: async () => false,
    dosFactoresDeLaPersona: async () => false,
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      get $connect(): never {
        throw new Error("una prueba de Sabina intentó usar el prisma real en vez de ctx.db");
      },
    },
  },
});

export {};
