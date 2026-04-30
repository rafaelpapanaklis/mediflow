/**
 * Scanner J — Seguridad de migraciones (Prisma + sql/).
 *
 *   J.1 SQL destructivo sin guard (DROP TABLE, DROP COLUMN, ALTER COLUMN
 *       DROP NOT NULL en columnas con datos, RENAME sin script de copia).
 *   J.2 Drift entre migrations/ y schema (heurística: no podemos correr
 *       prisma migrate status acá; reportamos si los archivos no parecen
 *       sincronizados).
 *   J.3 SQL en sql/ que NO es idempotente (sin IF NOT EXISTS / ON CONFLICT).
 *   J.4 Migrations sin plan de rollback (LOW).
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { AuditItem, ScanResult } from "../types";
import { repoRoot, walk, readManyAbs, findLineMatches, safeSnippet } from "../fs-helpers";

async function exists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(repoRoot(), rel)); return true; }
  catch { return false; }
}

export async function runMigrationScan(): Promise<ScanResult> {
  const t0 = Date.now();
  const items: AuditItem[] = [];

  // Recolecta todo el SQL: prisma/migrations/**/*.sql + sql/*.sql
  const sqlFiles: string[] = [];
  if (await exists("prisma/migrations")) {
    sqlFiles.push(...(await walk(path.join(repoRoot(), "prisma/migrations"), [".sql"])));
  }
  if (await exists("sql")) {
    sqlFiles.push(...(await walk(path.join(repoRoot(), "sql"), [".sql"])));
  }
  const files = await readManyAbs(sqlFiles);

  // J.1 — destructivo sin guard
  const destructive = [
    { re: /\bDROP\s+TABLE\b/i, what: "DROP TABLE" },
    { re: /\bDROP\s+COLUMN\b/i, what: "DROP COLUMN" },
    { re: /\bALTER\s+COLUMN\b[\s\S]{0,80}\bDROP\s+NOT\s+NULL\b/i, what: "ALTER ... DROP NOT NULL" },
    { re: /\bRENAME\s+(TABLE|COLUMN|TO)\b/i, what: "RENAME" },
    { re: /\bTRUNCATE\b/i, what: "TRUNCATE" },
  ];

  for (const f of files) {
    // En prisma/migrations las destructivas son "esperadas" pero igual se
    // marcan para el reviewer. En sql/ son más raras y peligrosas.
    const isManualSql = f.rel.startsWith("sql/");
    for (const d of destructive) {
      const matches = findLineMatches(f.content, d.re);
      for (const m of matches) {
        // Heurística: si encima de la línea hay un comentario "-- backfill"
        // o "-- preserved" lo dejamos pasar.
        const ctxAbove = f.lines.slice(Math.max(0, m.line - 6), m.line - 1).join("\n").toLowerCase();
        const guarded = /backfill|preserved|migrated|dump/.test(ctxAbove);
        if (!guarded) {
          items.push({
            category: "migrations",
            severity: isManualSql ? "high" : "medium",
            file: f.rel,
            line: m.line,
            title: `SQL destructivo: ${d.what}`,
            description:
              `Esta migración ejecuta ${d.what} ${isManualSql ? "y vive en sql/ (manual). Si se aplica en prod sin backup previo, la pérdida de datos es irreversible." : "como parte de un cambio de schema. Valida que el data sea desechable o que exista plan de copia previa."}`,
            suggestion:
              "Antes de aplicar: 1) backup completo, 2) copia los datos a una tabla temporal si es DROP COLUMN, 3) corre en staging primero, 4) ten plan de rollback documentado.",
            code_snippet: safeSnippet(m.text.trim()),
          });
        }
      }
    }

    // J.3 — idempotencia en sql/ (las migrations de Prisma son lineales y
    // no necesitan ser idempotentes — Prisma trackea aplicación).
    if (isManualSql) {
      const hasCreate = /\bCREATE\s+(TABLE|INDEX|POLICY|TYPE)\b/i.test(f.content);
      const hasIfNotExists = /IF\s+NOT\s+EXISTS/i.test(f.content);
      const hasInsert = /\bINSERT\s+INTO\b/i.test(f.content);
      const hasOnConflict = /ON\s+CONFLICT/i.test(f.content);
      const idempotent = (!hasCreate || hasIfNotExists) && (!hasInsert || hasOnConflict);
      if (!idempotent) {
        items.push({
          category: "migrations",
          severity: "medium",
          file: f.rel,
          line: 1,
          title: "SQL manual no idempotente",
          description:
            "Este archivo en sql/ contiene CREATE/INSERT sin IF NOT EXISTS / ON CONFLICT. Si alguien lo corre dos veces (común en revisión manual sobre prod) falla a la mitad y deja la DB en estado inconsistente.",
          suggestion:
            "Agrega IF NOT EXISTS a CREATE TABLE/INDEX/POLICY. Para INSERTs, ON CONFLICT DO NOTHING o DO UPDATE. La meta es que correr el archivo N veces produzca el mismo resultado que una.",
          code_snippet: safeSnippet(f.content.slice(0, 240)),
        });
      }
    }
  }

  // J.2 — drift heurístico: si schema.prisma menciona un modelo/campo que
  // no aparece en NINGUNA migration y tampoco hay SQL manual que lo cree,
  // marca posible drift. Es heurística — el reviewer humano confirma con
  // `npx prisma migrate status`.
  const schemaPath = path.join(repoRoot(), "prisma/schema.prisma");
  if (await exists("prisma/schema.prisma")) {
    const schemaContent = await fs.readFile(schemaPath, "utf-8").catch(() => "");
    const allSqlContent = files.map(f => f.content).join("\n").toLowerCase();
    const modelMatches = Array.from(schemaContent.matchAll(/model\s+(\w+)\s*\{/g)).map(m => m[1]);
    const orphans: string[] = [];
    for (const model of modelMatches) {
      // Snake_case típico que Prisma usa en SQL
      const snake = model.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
      // Plurales comunes (sin pluralización completa, solo +s)
      const candidates = [model.toLowerCase(), `${model.toLowerCase()}s`, snake, `${snake}s`];
      const found = candidates.some(c => allSqlContent.includes(`"${c}"`) || allSqlContent.includes(` ${c} `));
      if (!found) orphans.push(model);
    }
    if (orphans.length > 5 && files.length > 0) {
      items.push({
        category: "migrations",
        severity: "high",
        file: "prisma/schema.prisma",
        line: 1,
        title: `Posible drift entre schema y migrations (${orphans.length} modelos no aparecen en SQL)`,
        description:
          `Los modelos ${orphans.slice(0, 8).join(", ")}${orphans.length > 8 ? "…" : ""} están en schema.prisma pero no se ven mencionados en migrations/ ni en sql/. Si el equipo creó tablas con db push (sin migración), prod puede estar fuera de sync.`,
        suggestion:
          "Corre `npx prisma migrate status` para confirmar. Si hay drift, genera la migración faltante con `npx prisma migrate dev --name sync_schema` y commitea.",
        code_snippet: orphans.slice(0, 8).join(", "),
      });
    }
    if (files.length === 0) {
      items.push({
        category: "migrations",
        severity: "high",
        file: "prisma/",
        line: 0,
        title: "Sin directorio prisma/migrations",
        description:
          "El proyecto usa schema.prisma pero no tiene prisma/migrations/. Probablemente el equipo gestiona el schema con `prisma db push`. Eso pierde el historial reproducible y dificulta rollbacks.",
        suggestion:
          "Inicializa migraciones: `npx prisma migrate dev --name init` (en un entorno limpio). Después usa `migrate deploy` en CI para aplicar a prod.",
        code_snippet: "",
      });
    }
  }

  // J.4 — plan de rollback en migrations
  if (files.length > 0) {
    const hasRollbackDoc = await exists("docs/MIGRATIONS.md") || await exists("prisma/MIGRATIONS.md");
    if (!hasRollbackDoc) {
      items.push({
        category: "migrations",
        severity: "low",
        file: "docs/",
        line: 0,
        title: "Sin documentación de plan de rollback",
        description:
          "No existe docs/MIGRATIONS.md con la estrategia de rollback por migración. Útil cuando una migración rompe prod a las 3 AM y hay que revertir.",
        suggestion:
          "Crea docs/MIGRATIONS.md con: cómo revertir la última migración (down SQL si la hay, o restore desde PITR), cuándo es seguro rebasear migrations, etc.",
        code_snippet: "",
      });
    }
  }

  return { items, duration_ms: Date.now() - t0 };
}
