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
 * v21 (t5 de la v20, m1): también los filtros POR RELACIÓN, en consultas a CUALQUIER modelo:
 * `treatment: { status }` (TreatmentSession), `treatments: { some: { status } }` (Patient, Clinic, User)…
 * Las relaciones que apuntan a TreatmentPlan se sacan de prisma/schema.prisma (un `plan TreatmentPlan`
 * nuevo también entra); las de otros planes (periodoncia, edu) no son esta columna.
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

// ── v21: filtros por relación ──────────────────────────────────────────────────────────────────────

/** Los campos de relación que apuntan a TreatmentPlan, leídos del esquema (`treatments TreatmentPlan[]`…). */
function relacionesAlPlan(): string[] {
  const esquema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const nombres = new Set<string>();
  for (const m of Array.from(esquema.matchAll(/^\s+(\w+)\s+TreatmentPlan(\[\]|\?)?(\s|$)/gm))) nombres.add(m[1]);
  return Array.from(nombres).sort();
}

/** Todos los objetos `where: { … }` del texto (los literales; un `where: variable` no se ve). */
function wheres(s: string): Array<{ desde: number; obj: string }> {
  const out: Array<{ desde: number; obj: string }> = [];
  for (const m of Array.from(s.matchAll(/\bwhere\s*:/g))) {
    const obj = objetoTras(s, m.index! + m[0].length);
    if (obj) out.push({ desde: m.index!, obj });
  }
  return out;
}

/** Las llaves de primer nivel de un objeto `{ … }` con el texto de su valor (balanceando llaves y paréntesis). */
function llaves(obj: string): Array<{ clave: string; valor: string }> {
  const cuerpo = obj.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Array<{ clave: string; valor: string }> = [];
  let d = 0;
  let inicio = 0;
  const partes: string[] = [];
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === "{" || c === "(" || c === "[") d++;
    else if (c === "}" || c === ")" || c === "]") d--;
    else if (c === "," && d === 0) {
      partes.push(cuerpo.slice(inicio, i));
      inicio = i + 1;
    }
  }
  partes.push(cuerpo.slice(inicio));
  for (const p of partes) {
    const m = /^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(p.replace(/\/\/[^\n]*/g, ""));
    if (m) out.push({ clave: m[1], valor: m[2].trim() });
  }
  return out;
}

/** ¿El filtro de una relación al plan pone `status` (directo o dentro de some/every/none/is/isNot/AND/OR/NOT)? */
function filtraElEstado(valor: string): boolean {
  if (!valor.startsWith("{")) return false;
  return llaves(valor).some(({ clave, valor: v }) => {
    if (clave === "status") return true;
    if (["some", "every", "none", "is", "isNot", "NOT"].includes(clave)) return filtraElEstado(v);
    if (["AND", "OR"].includes(clave) && v.startsWith("[")) return v.slice(1, -1).split(/(?<=\})\s*,\s*(?=\{)/).some((x) => filtraElEstado(x.trim()));
    return false;
  });
}

/** Recorre un `where` (y sus AND/OR/NOT) buscando una relación al plan que filtre el estado. */
function relacionConEstado(obj: string, relaciones: string[]): string | null {
  for (const { clave, valor } of llaves(obj)) {
    if (relaciones.includes(clave) && filtraElEstado(valor)) return `${clave}: ${valor}`;
    if (["AND", "OR", "NOT"].includes(clave)) {
      const hijos = valor.startsWith("[") ? valor.slice(1, -1).split(/(?<=\})\s*,\s*(?=\{)/) : [valor];
      for (const h of hijos) if (h.trim().startsWith("{")) {
        const r = relacionConEstado(h.trim(), relaciones);
        if (r) return r;
      }
    }
  }
  return null;
}

test("v21: ningún `where` de Prisma (de cualquier modelo) filtra el estado del plan POR RELACIÓN", () => {
  const relaciones = relacionesAlPlan();
  // El esquema de hoy: Clinic/User/Patient.treatments y TreatmentSession.treatment.
  assert.deepEqual(relaciones, ["treatment", "treatments"]);
  const malas: string[] = [];
  let vistos = 0;
  for (const f of archivos(join(process.cwd(), "src"))) {
    const s = readFileSync(f, "utf8");
    if (!/\bwhere\s*:/.test(s)) continue;
    for (const w of wheres(s)) {
      vistos++;
      const r = relacionConEstado(w.obj, relaciones);
      if (r) malas.push(`${f.replace(process.cwd() + "/", "")}:${s.slice(0, w.desde).split("\n").length} → ${r.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  assert.ok(vistos > 500, `el candado sí recorre los where (${vistos})`);
  assert.deepEqual(malas, [], `filtran treatment_plans.status por relación (42883 en la base real):\n${malas.join("\n")}`);
});

test("v21: el candado de relaciones sí detecta las formas rotas y deja pasar las buenas", () => {
  const rel = ["treatment", "treatments"];
  const ver = (codigo: string) => wheres(codigo).map((w) => relacionConEstado(w.obj, rel)).find(Boolean) ?? null;
  // Rotas (la de listOpenTreatmentSessions hasta la v20, y las de Patient/Clinic/User).
  assert.ok(ver(`prisma.treatmentSession.findMany({ where: { completedAt: null, treatment: { clinicId, patientId, status: "ACTIVE" } } })`));
  assert.ok(ver(`prisma.patient.findMany({ where: { clinicId, treatments: { some: { status: "ACTIVE" } } } })`));
  assert.ok(ver(`prisma.patient.count({ where: { AND: [{ clinicId }, { treatments: { none: { status: { in: ["ACTIVE"] } } } }] } })`));
  assert.ok(ver(`db.user.findMany({ where: { treatments: { every: { AND: [{ status: "COMPLETED" }] } } } })`));
  assert.ok(ver(`prisma.treatmentSession.count({ where: { treatment: { is: { status: "ACTIVE" } } } })`));
  // Buenas: la relación sin estado, el estado de OTRO modelo, y leer el estado en el select.
  assert.equal(ver(`prisma.treatmentSession.findMany({ where: { completedAt: null, treatment: { clinicId, patientId } }, select: { treatment: { select: { status: true } } } })`), null);
  assert.equal(ver(`prisma.appointment.findMany({ where: { clinicId, status: "COMPLETED", patient: { treatments: { some: { clinicId } } } } })`), null);
  assert.equal(ver(`prisma.edu.findMany({ where: { id, plan: { status: "ACTIVO" } } })`), null, "otro plan (edu), otra columna");
});

