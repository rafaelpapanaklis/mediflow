// Genera scripts/backfill-prisma-migrations.sql leyendo cada migración local,
// calculando su sha256 (formato Prisma) y emitiendo INSERTs idempotentes.
//
// Uso:
//   npx tsx scripts/generate-backfill-sql.mts
//
// Re-correr después de añadir migraciones nuevas que ya se aplicaron en prod
// vía SQL manual (caso histórico). Para el flow nuevo (post-fix), las
// migraciones se registran solas vía `prisma migrate deploy`.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const MIGRATIONS_DIR = "prisma/migrations";
const OUT_FILE = "scripts/backfill-prisma-migrations.sql";

function migrationNameToTimestamp(name: string): string {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/);
  if (!m) throw new Error(`Invalid migration name: ${name}`);
  // Algunos prefijos legacy del repo tienen HH>23 (ej. 20260428240000) como
  // sufijos numéricos para forzar orden, no como horas reales. Date.UTC
  // normaliza el overflow (hora 25 → siguiente día +1h) preservando el orden.
  const date = new Date(
    Date.UTC(
      parseInt(m[1]),
      parseInt(m[2]) - 1,
      parseInt(m[3]),
      parseInt(m[4]),
      parseInt(m[5]),
      parseInt(m[6])
    )
  );
  return date.toISOString();
}

const migDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const lines: string[] = [];
const header = [
  `-- ════════════════════════════════════════════════════════════════════════════`,
  `-- Backfill _prisma_migrations en producción`,
  `--`,
  `-- Causa raíz: el equipo aplicaba SQL idempotente directo en Supabase en lugar`,
  `-- de \`prisma migrate deploy\`. Por eso la tabla _prisma_migrations nunca se`,
  `-- creó y cada sprint se necesitaba un nuevo SQL manual para sincronizar.`,
  `--`,
  `-- Este script:`,
  `--   1. Crea la tabla _prisma_migrations (estructura idéntica a la que crea`,
  `--      \`prisma migrate deploy\` en su primera ejecución).`,
  `--   2. Inserta una fila por cada migración local cuya estructura ya está en`,
  `--      prod (verificado con scripts/diagnose-prisma-migrations.mts y`,
  `--      scripts/verify-drop-only-migrations.mts).`,
  `--`,
  `-- IDEMPOTENTE — re-correrlo es seguro:`,
  `--   * CREATE TABLE IF NOT EXISTS`,
  `--   * INSERT ... WHERE NOT EXISTS por migration_name`,
  `--`,
  `-- Después de aplicar este script:`,
  `--   $env:DATABASE_URL = "..."`,
  `--   npx prisma migrate status   # esperado: "Database schema is up to date"`,
  `--`,
  `-- Generado por scripts/generate-backfill-sql.mts — no editar a mano.`,
  `-- ════════════════════════════════════════════════════════════════════════════`,
  ``,
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
  ``,
  `CREATE TABLE IF NOT EXISTS _prisma_migrations (`,
  `    id                      VARCHAR(36) PRIMARY KEY NOT NULL,`,
  `    checksum                VARCHAR(64) NOT NULL,`,
  `    finished_at             TIMESTAMPTZ,`,
  `    migration_name          VARCHAR(255) NOT NULL,`,
  `    logs                    TEXT,`,
  `    rolled_back_at          TIMESTAMPTZ,`,
  `    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),`,
  `    applied_steps_count     INTEGER NOT NULL DEFAULT 0`,
  `);`,
  ``,
];
lines.push(...header);

let inserts = 0;
let skipped = 0;
for (const dir of migDirs) {
  const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
  if (!existsSync(sqlPath)) {
    lines.push(`-- SKIP: ${dir} (migration.sql no existe)`);
    lines.push(``);
    skipped++;
    continue;
  }
  const sql = readFileSync(sqlPath);
  const checksum = createHash("sha256").update(sql).digest("hex");
  const ts = migrationNameToTimestamp(dir);
  lines.push(
    `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)`
  );
  lines.push(
    `SELECT gen_random_uuid(), '${checksum}', '${dir}', '${ts}'::timestamptz, '${ts}'::timestamptz, 1`
  );
  lines.push(
    `WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${dir}');`
  );
  lines.push(``);
  inserts++;
}

lines.push(`-- Verificación:`);
lines.push(
  `-- SELECT migration_name, finished_at, applied_steps_count`
);
lines.push(`-- FROM _prisma_migrations ORDER BY started_at;`);
lines.push(``);

writeFileSync(OUT_FILE, lines.join("\n"));
console.log(
  `Generated ${OUT_FILE} (${inserts} inserts, ${skipped} skipped)`
);
