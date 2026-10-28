/**
 * El catálogo como SQL aditivo e idempotente para que Rafael lo pegue en
 * producción: `INSERT … ON CONFLICT ("clave") DO NOTHING`. Las filas que ya
 * existen no se tocan (ni descripción ni grupo): solo entran las nuevas.
 *
 * PURO (cadenas). Lo corre `npm run cums:sql`, que escribe
 * `sql/cums-odontologia-2026-10.sql`, y la prueba de catálogo comprueba que
 * ese archivo esté al día con el seed.
 */

import type { CumsSeed } from "./cums-essentials";

function lit(v: string | undefined | null): string {
  if (v === undefined || v === null) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function sqlDelCatalogo(entradas: ReadonlyArray<CumsSeed>, titulo: string): string {
  const filas = entradas.map(
    (e) =>
      `  (${lit(e.clave)}, ${lit(e.descripcion)}, ${lit(e.presentacion)}, ${lit(e.formaFarmaceutica)}, ${lit(e.grupoTerapeutico)}, ${lit(e.cofeprisGroup)})`,
  );
  return [
    "-- ═══════════════════════════════════════════════════════════════════",
    `-- ${titulo}`,
    "-- GENERADO por `npm run cums:sql` desde src/lib/seeds/cums-essentials.ts",
    "-- (base + cums-odontologia.ts). No se edita a mano: se regenera.",
    "--",
    "-- Idempotente y ADITIVO: ON CONFLICT DO NOTHING deja intactas las filas que",
    "-- ya existen (aunque difieran del seed). Se puede pegar más de una vez.",
    `-- Filas en el seed: ${entradas.length}.`,
    "-- ═══════════════════════════════════════════════════════════════════",
    "",
    'INSERT INTO "cums_items" ("clave", "descripcion", "presentacion", "formaFarmaceutica", "grupoTerapeutico", "cofeprisGroup") VALUES',
    filas.join(",\n"),
    'ON CONFLICT ("clave") DO NOTHING;',
    "",
  ].join("\n");
}
