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
 * v22 (t5 de la v21, m1): la regla ya no depende de estar en un `where:` de primer nivel. CADA objeto
 * `treatment(s): { … }` del código —a cualquier profundidad, dentro de `where`, `include`, `select`, `_count`
 * o de una variable, y con la clave entre comillas o no— falla si filtra `status` al nivel del PLAN: directo
 * o dentro de `where`/`some`/`every`/`none`/`is`/`isNot`/`AND`/`OR`/`NOT`. No cuentan `status: true/false`
 * (leerlo en un `select`), un `orderBy` ni las escrituras (`data`, `create`…): esos no comparan.
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

// ── v21/v22: filtros por relación ──────────────────────────────────────────────────────────────────

/** Los campos de relación que apuntan a TreatmentPlan, leídos del esquema (`treatments TreatmentPlan[]`…). */
function relacionesAlPlan(): string[] {
  const esquema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const nombres = new Set<string>();
  for (const m of Array.from(esquema.matchAll(/^\s+(\w+)\s+TreatmentPlan(\[\]|\?)?(\s|$)/gm))) nombres.add(m[1]);
  return Array.from(nombres).sort();
}

/** El valor balanceado que empieza en `i` (`{…}` o `[…]`); con cadenas y comentarios saltados. */
function balanceado(s: string, i: number): string {
  const abre = s[i];
  const cierra = abre === "{" ? "}" : "]";
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") {
      j = finDeCadena(s, j);
      continue;
    }
    if (c === "/" && s[j + 1] === "/") {
      j = s.indexOf("\n", j);
      if (j < 0) return s.slice(i);
      continue;
    }
    if (c === abre) d++;
    else if (c === cierra && --d === 0) return s.slice(i, j + 1);
  }
  return s.slice(i);
}

function finDeCadena(s: string, j: number): number {
  const q = s[j];
  for (let k = j + 1; k < s.length; k++) {
    if (s[k] === "\\") k++;
    else if (s[k] === q) return k;
  }
  return s.length;
}

/** Las llaves de primer nivel de un objeto `{ … }` con su valor (clave con o sin comillas; `...x` se ignora). */
function llaves(obj: string): Array<{ clave: string; valor: string }> {
  const cuerpo = obj.slice(1, -1);
  const out: Array<{ clave: string; valor: string }> = [];
  let d = 0;
  let inicio = 0;
  const partes: string[] = [];
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === '"' || c === "'" || c === "`") i = finDeCadena(cuerpo, i);
    else if (c === "{" || c === "(" || c === "[") d++;
    else if (c === "}" || c === ")" || c === "]") d--;
    else if (c === "," && d === 0) {
      partes.push(cuerpo.slice(inicio, i));
      inicio = i + 1;
    }
  }
  partes.push(cuerpo.slice(inicio));
  for (const p of partes) {
    const m = /^\s*(?:["']([\w$]+)["']|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]*)$/.exec(p.replace(/^\s*\/\/[^\n]*\n/gm, ""));
    if (m) out.push({ clave: m[1] ?? m[2], valor: m[3].trim() });
  }
  return out;
}

/** Los elementos `{ … }` de un arreglo `[ … ]`. */
function elementos(arr: string): string[] {
  const out: string[] = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] === '"' || arr[i] === "'" || arr[i] === "`") i = finDeCadena(arr, i);
    else if (arr[i] === "{") {
      const o = balanceado(arr, i);
      out.push(o);
      i += o.length - 1;
    }
  }
  return out;
}

/** Las claves que siguen filtrando EL PLAN (no otro modelo, ni leer, ordenar o escribir). */
const SIGUE_EN_EL_PLAN = ["where", "some", "every", "none", "is", "isNot", "NOT"];

/** ¿Este objeto (el de `treatment(s): { … }`) filtra el `status` del plan? */
function filtraElEstadoDelPlan(obj: string): boolean {
  return llaves(obj).some(({ clave, valor }) => {
    if (clave === "status") return !/^(true|false)\s*$/.test(valor);
    if (SIGUE_EN_EL_PLAN.includes(clave) && valor.startsWith("{")) return filtraElEstadoDelPlan(valor);
    if (["AND", "OR", "NOT"].includes(clave) && valor.startsWith("[")) return elementos(valor).some(filtraElEstadoDelPlan);
    return false;
  });
}

/** Cada `treatment(s): { … }` del texto (clave con o sin comillas) que filtra el estado del plan. */
function relacionesConEstado(s: string, relaciones: string[]): Array<{ linea: number; texto: string }> {
  const out: Array<{ linea: number; texto: string }> = [];
  const clave = new RegExp(`(?:["'](?:${relaciones.join("|")})["']|\\b(?:${relaciones.join("|")}))\\s*:\\s*\\{`, "g");
  for (const m of Array.from(s.matchAll(clave))) {
    const obj = balanceado(s, m.index! + m[0].length - 1);
    if (filtraElEstadoDelPlan(obj)) out.push({ linea: s.slice(0, m.index).split("\n").length, texto: `${m[0]}${obj.slice(1)}` });
  }
  return out;
}

test("v21/v22: ningún objeto de relación al plan (`treatment(s): { … }`, en cualquier sitio y profundidad) filtra su estado", () => {
  const relaciones = relacionesAlPlan();
  // El esquema de hoy: Clinic/User/Patient.treatments y TreatmentSession.treatment.
  assert.deepEqual(relaciones, ["treatment", "treatments"]);
  const malas: string[] = [];
  let vistos = 0;
  const clave = new RegExp(`\\b(?:${relaciones.join("|")})["']?\\s*:\\s*\\{`, "g");
  for (const f of archivos(join(process.cwd(), "src"))) {
    const s = readFileSync(f, "utf8");
    vistos += (s.match(clave) ?? []).length;
    for (const r of relacionesConEstado(s, relaciones)) {
      malas.push(`${f.replace(process.cwd() + "/", "")}:${r.linea} → ${r.texto.replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  // Hoy (v22) son 18 en src/: si un día baja de 10, el patrón dejó de encontrarlos.
  assert.ok(vistos >= 10, `el candado sí encuentra objetos de relación al plan (${vistos})`);
  assert.deepEqual(malas, [], `filtran treatment_plans.status por relación (42883 en la base real):\n${malas.join("\n")}`);
});

/** Lo que diría el candado de un trozo de código (los dos: la llamada directa de la v20 y el de relación). */
function rota(codigo: string): boolean {
  const relacion = relacionesConEstado(codigo, ["treatment", "treatments"]).length > 0;
  const directa = Array.from(codigo.matchAll(/\.treatmentPlan\.(\w+)\s*\(/g)).some((m) => {
    const arg = argumento(codigo, m.index! + m[0].length);
    const w = /\bwhere\s*:/.exec(arg);
    return !!w && /\bstatus\s*:/.test(objetoTras(arg, w.index + w[0].length));
  });
  return relacion || directa;
}

test("v22: las 10 formas rotas de t5 (revisión de la v21) fallan", () => {
  const formas = [
    `prisma.appointment.findMany({ where: { clinicId, patient: { treatments: { some: { status: "ACTIVE" } } } } })`,
    `prisma.invoice.findMany({ where: { patient: { is: { treatments: { none: { status: "ACTIVE" } } } } } })`,
    `prisma.patient.findMany({ where: { clinicId }, include: { treatments: { where: { status: "ACTIVE" } } } })`,
    `prisma.patient.findMany({ select: { id: true, treatments: { where: { status: { in: ["ACTIVE", "PAUSED"] } } } } })`,
    `prisma.patient.findMany({ select: { _count: { select: { treatments: { where: { status: "ACTIVE" } } } } } })`,
    `prisma.treatmentSession.findMany({ where: { treatment: { "status": "ACTIVE" } } })`,
    `prisma.treatmentPlan.findMany({ where: { clinicId }, include: { sessions: { where: { treatment: { status: "ACTIVE" } } } } })`,
    `prisma.treatmentSession.findMany({ where: { treatment: { status: { not: "ABANDONED" } } } })`,
    `prisma.treatmentSession.findMany({ where: { treatment: { AND: [{ clinicId }, { status: "ACTIVE" }] } } })`,
    `prisma.patient.findMany({ where: { treatments: { some: { OR: [{ clinicId }, { AND: [{ status: "PAUSED" }] }] } } } })`,
  ];
  for (const f of formas) assert.equal(rota(f), true, `no la ve: ${f}`);
  // Y en una variable (el `where` que se arma aparte), con comillas simples.
  assert.equal(rota(`const donde = { patient: { 'treatments': { some: { status: "ACTIVE" } } } };`), true);
});

test("v22: no marca leer, ordenar ni escribir el estado, ni el estado de otro modelo", () => {
  const buenas = [
    `prisma.treatmentSession.findMany({ where: { completedAt: null, treatment: { clinicId, patientId } }, select: { treatment: { select: { id: true, status: true } } } })`,
    `prisma.patient.findMany({ include: { treatments: { select: { id: true, status: false }, orderBy: { status: "asc" } } } })`,
    `prisma.patient.findMany({ select: { _count: { select: { treatments: true } } } })`,
    `prisma.appointment.findMany({ where: { clinicId, status: "COMPLETED", patient: { treatments: { some: { clinicId } } } } })`,
    `prisma.treatment.findMany({ where: { treatment: { patient: { status: "ACTIVE" } } } })`,
    `prisma.patient.update({ where: { id }, data: { treatments: { create: { name, status: "ACTIVE" } } } })`,
    `prisma.edu.findMany({ where: { id, plan: { status: "ACTIVO" } } })`,
    `const fila = { treatment: { name: "x", "statusText": "ok" } };`,
  ];
  for (const b of buenas) assert.equal(rota(b), false, `la marca y no debía: ${b}`);
});
