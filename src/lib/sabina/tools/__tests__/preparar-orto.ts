/**
 * Lo que necesita `ortodoncia.test.ts` antes de cargar nada. Se importa PRIMERO.
 *
 * Es `./preparar-caja` con dos añadidos, y los dos por la misma razón: las
 * herramientas de ortodoncia NO leen por su cuenta, llaman a los cargadores del
 * módulo (`loadOrthoCases`, `loadOrthoControles`, `loadOrthoData`…), y esos leen
 * del `prisma` global.
 *
 *  1. `@/lib/prisma` REENVÍA al doble que la prueba ponga en `pantalla.db`. Así
 *     Sabina y la pantalla corren contra la misma base y se les exige el mismo
 *     número. Con `pantalla.db` vacío, cualquier uso del prisma global revienta.
 *  2. `$queryRaw` contesta las cuatro consultas en SQL crudo del módulo (la
 *     sonda de columnas, las condiciones de pago de la factura, el modo de cobro
 *     del caso y los cargos de control) con lo que la prueba ponga en
 *     `pantalla.sql`. El doble no habla SQL; lo que sí se comprueba es que cada
 *     consulta llegue con el `clinicId` de la sesión.
 *
 * 🔴 Lo que NO se sustituye, porque ES lo que se prueba: los cargadores del
 * módulo, `cobranzaDelCasoUnificada`, `filasDeCobranza`, `casosSinControl`, el
 * adaptador de la ficha, la visibilidad por paciente y `hasPermission`.
 *
 * `server-only` (lo arrastra `@/lib/orthodontics/access`) no existe fuera del
 * bundle de Next: lo resuelve `engine-sin-server-only`.
 */

import "../../engine-sin-server-only";
import { mock } from "node:test";

export type SqlCrudo = (texto: string, valores: unknown[]) => unknown[];

export const pantalla: { db: any; sql: SqlCrudo | null; consultasSql: Array<{ texto: string; valores: unknown[] }> } = {
  db: null,
  sql: null,
  consultasSql: [],
};

mock.module("@/lib/auth/two-factor-identity", {
  namedExports: {
    personaTieneDosFactores: async () => false,
    dosFactoresDeLaPersona: async () => false,
  },
});

/** El SQL de una llamada con plantilla (`prisma.$queryRaw\`…\``), con «?» en cada valor. */
function textoDe(cadenas: unknown): string {
  if (Array.isArray(cadenas)) return cadenas.join(" ? ");
  const o = cadenas as { strings?: string[]; sql?: string } | null;
  if (o && Array.isArray(o.strings)) return o.strings.join(" ? ");
  return String(o?.sql ?? cadenas ?? "");
}

async function queryRaw(cadenas: unknown, ...valores: unknown[]): Promise<unknown[]> {
  if (!pantalla.sql) throw new Error("una lectura de ortodoncia usó SQL crudo sin que la prueba lo sembrara");
  const texto = textoDe(cadenas);
  pantalla.consultasSql.push({ texto, valores });
  return pantalla.sql(texto, valores);
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: new Proxy(
      {},
      {
        get(_objetivo, clave) {
          if (clave === "$queryRaw") return queryRaw;
          if (!pantalla.db) {
            throw new Error(`una lectura de ortodoncia usó el prisma global (${String(clave)}) sin base de prueba`);
          }
          return pantalla.db[clave];
        },
      },
    ),
  },
});
