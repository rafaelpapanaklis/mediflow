/**
 * v20 (B1 de t1, 28-oct-2026): en la base real `treatment_plans.status` es TEXT y schema.prisma lo declara enum
 * `TreatmentStatus`. Prisma manda el parámetro de un `where: { status }` como enum y Postgres contesta
 * 42883 «operator does not exist: text = "TreatmentStatus"» (panel.108, 21-oct: 143 peticiones a
 * `/api/treatments/cuentas` con 500). LEER el estado funciona; FILTRAR por él en el `where` de Prisma, no:
 * se filtra en JS o, en SQL crudo, con `"status"::text`.
 *
 * Este candado recorre TODO `src/` y falla si alguna consulta de Prisma a `treatmentPlan` (también
 * `tx.treatmentPlan`) lleva `status` en su `where`. Escribir el estado (`data: { status }`) sí vale.
 *
 * Run: npx tsx --test src/lib/treatments/__tests__/estado-del-plan-texto.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === "__tests__" || n === "node_modules") continue;
      archivos(p, out);
    } else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

/** El argumento entre paréntesis de la llamada que empieza en `desde` (balanceando paréntesis). */
function argumento(s: string, desde: number): string {
  let d = 1;
  let j = desde;
  while (j < s.length && d > 0) {
    if (s[j] === "(") d++;
    else if (s[j] === ")") d--;
    j++;
  }
  return s.slice(desde, j - 1);
}

/** El objeto que sigue a `where:` (balanceando llaves). Si es una variable (`where: donde`), "" (no se ve aquí). */
function objetoTras(s: string, desde: number): string {
  const i = s.indexOf("{", desde);
  if (i < 0 || s.slice(desde, i).trim() !== "") return "";
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") d++;
    else if (s[j] === "}" && --d === 0) return s.slice(i, j + 1);
  }
  return s.slice(i);
}

test("ninguna consulta de Prisma a treatmentPlan filtra por `status` en el `where` (la columna real es TEXT)", () => {
  const malas: string[] = [];
  const llamada = /\.treatmentPlan\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy|updateMany|update|deleteMany|delete|upsert)\s*\(/g;
  let revisadas = 0;
  for (const f of archivos(join(process.cwd(), "src"))) {
    const s = readFileSync(f, "utf8");
    for (const m of Array.from(s.matchAll(llamada))) {
      revisadas++;
      const arg = argumento(s, m.index! + m[0].length);
      const w = /\bwhere\s*:/.exec(arg);
      if (!w) continue;
      const where = objetoTras(arg, w.index + w[0].length);
      if (/\bstatus\s*:/.test(where)) malas.push(`${f.replace(process.cwd() + "/", "")}:${s.slice(0, m.index).split("\n").length} → ${where.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  assert.ok(revisadas > 20, `el candado sí encuentra las consultas (${revisadas})`);
  assert.deepEqual(malas, [], `filtran treatment_plans.status en el where de Prisma (42883 en la base real):\n${malas.join("\n")}`);
});

test("el candado sí detecta la forma rota (con y sin `in`, también en una transacción)", () => {
  const ejemplos = [
    `await prisma.treatmentPlan.findMany({ where: { clinicId, status: { in: ["ACTIVE"] } }, take: 5 })`,
    `await tx.treatmentPlan.count({ where: { clinicId, patientId, status: "ACTIVE" } })`,
  ];
  for (const e of ejemplos) {
    const m = /\.treatmentPlan\.(findMany|count)\s*\(/.exec(e)!;
    const arg = argumento(e, m.index + m[0].length);
    const w = /\bwhere\s*:/.exec(arg)!;
    assert.match(objetoTras(arg, w.index + w[0].length), /\bstatus\s*:/);
  }
  // Escribir el estado no es filtrar.
  const escribir = `await tx.treatmentPlan.updateMany({ where: { id: planId, clinicId }, data: { status: "ABANDONED" } })`;
  const m = /\.treatmentPlan\.updateMany\s*\(/.exec(escribir)!;
  const arg = argumento(escribir, m.index + m[0].length);
  const w = /\bwhere\s*:/.exec(arg)!;
  assert.doesNotMatch(objetoTras(arg, w.index + w[0].length), /\bstatus\s*:/);
});
