/**
 * Arnés de pruebas del plan v2 (ws1-t12): un Postgres EN MEMORIA (PGlite) con las tablas que tocan
 * las filas del plan, su presupuesto y su nota de cobro — mismas columnas y tipos que
 * prisma/schema.prisma —, y encima `sql/plan-tratamiento-filas.sql` pegado como lo pega Rafael
 * (una transacción, DOS veces). ⛔ Nunca toca una base de verdad.
 *
 * `prismaDePrueba(db)` imita lo que el código usa del cliente de Prisma: `$queryRaw`/`$executeRaw`
 * (el SQL de verdad, con sus parámetros), `$transaction` (una a la vez, como el candado FOR UPDATE)
 * y los modelos con `where` sencillos (igual, `in`, `not`, null) e `include`/`select` de relaciones.
 *
 * PGlite NO es dependencia del repo: se busca en `PGLITE_DIR` (carpeta con
 * node_modules/@electric-sql/pglite). Sin él, las pruebas que lo usan se SALTAN diciéndolo.
 */
// Las columnas `timestamp` (sin zona) se leen como hora LOCAL en PGlite; Prisma y Supabase van en UTC.
process.env.TZ = "UTC";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

export async function cargarPGlite(): Promise<null | (new () => any)> {
  const dir = process.env.PGLITE_DIR;
  const ruta = dir ? join(dir, "node_modules/@electric-sql/pglite/dist/index.js") : null;
  try {
    const mod = ruta && existsSync(ruta) ? await import(pathToFileURL(ruta).href) : await import("@electric-sql/pglite" as string);
    return mod.PGlite;
  } catch {
    return null;
  }
}

export const DDL_BASE = `
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT','PENDING','PARTIAL','PAID','OVERDUE','CANCELLED');
  CREATE TYPE "TreatmentStatus" AS ENUM ('ACTIVE','COMPLETED','ABANDONED','PAUSED');
  CREATE TABLE "clinics" ("id" text PRIMARY KEY, "name" text, "cfdiTaxMode" text, "timezone" text, "locale" text);
  CREATE TABLE "users" ("id" text PRIMARY KEY, "clinicId" text, "role" text, "firstName" text, "lastName" text, "isActive" boolean NOT NULL DEFAULT true, "agendaActive" boolean NOT NULL DEFAULT true);
  CREATE TABLE "patients" ("id" text PRIMARY KEY, "clinicId" text NOT NULL, "firstName" text, "lastName" text, "primaryDoctorId" text);
  CREATE TABLE "appointments" ("id" text PRIMARY KEY, "clinicId" text, "patientId" text);
  CREATE TABLE "medical_records" ("id" text PRIMARY KEY, "clinicId" text NOT NULL, "patientId" text NOT NULL, "specialtyData" jsonb);
  CREATE TABLE "procedure_catalog" ("id" text PRIMARY KEY, "clinicId" text NOT NULL, "name" text NOT NULL, "basePrice" float8 NOT NULL DEFAULT 0, "isActive" boolean NOT NULL DEFAULT true);
  CREATE TABLE "treatment_plans" (
    "id" text PRIMARY KEY, "clinicId" text NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
    "patientId" text NOT NULL, "doctorId" text NOT NULL, "name" text NOT NULL, "description" text,
    "totalSessions" integer NOT NULL DEFAULT 1, "sessionIntervalDays" integer NOT NULL DEFAULT 30,
    "totalCost" float8 NOT NULL DEFAULT 0, "status" "TreatmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endDate" timestamp(3), "lastFollowUpSent" timestamp(3),
    "nextExpectedDate" timestamp(3), "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE "invoices" (
    "id" text PRIMARY KEY, "clinicId" text NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE, "patientId" text NOT NULL,
    "appointmentId" text UNIQUE, "invoiceNumber" text NOT NULL, "items" jsonb NOT NULL, "subtotal" float8 NOT NULL,
    "discount" float8 NOT NULL DEFAULT 0, "total" float8 NOT NULL, "paid" float8 NOT NULL DEFAULT 0, "balance" float8 NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING', "paymentMethod" text, "notes" text, "dueDate" timestamp(3),
    "paidAt" timestamp(3), "cfdiUuid" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "doctorId" text, "taxRate" float8 NOT NULL DEFAULT 16,
    "taxIncluded" boolean NOT NULL DEFAULT true, "orthodonticTreatmentPlanId" text,
    UNIQUE ("clinicId", "invoiceNumber"));
  CREATE TABLE "quotes" (
    "id" text PRIMARY KEY, "clinicId" text NOT NULL, "patientId" text NOT NULL, "createdById" text, "folio" text NOT NULL,
    "title" text NOT NULL, "status" text NOT NULL DEFAULT 'DRAFT', "validUntil" timestamp(3),
    "subtotal" numeric(10,2) NOT NULL DEFAULT 0, "discountPct" numeric(5,2), "discountAmount" numeric(10,2) NOT NULL DEFAULT 0,
    "total" numeric(10,2) NOT NULL DEFAULT 0, "notes" text, "acceptToken" text UNIQUE, "presentedAt" timestamp(3),
    "acceptedAt" timestamp(3), "rejectedAt" timestamp(3), "signatureUrl" text, "invoiceId" text, "treatmentPlanId" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("clinicId", "folio"));
  CREATE TABLE "quote_items" (
    "id" text PRIMARY KEY, "quoteId" text NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE, "procedureId" text,
    "name" text NOT NULL, "toothFdi" text, "quantity" integer NOT NULL DEFAULT 1, "unitPrice" numeric(10,2) NOT NULL,
    "discount" numeric(10,2) NOT NULL DEFAULT 0, "lineTotal" numeric(10,2) NOT NULL, "phase" integer, "notes" text,
    "sortOrder" integer NOT NULL DEFAULT 0);
`;

/** Las dos tablas de la aceptación por concepto (sql/presupuesto-aceptacion-parcial.sql), tal cual. */
export const SQL_ACEPTACION = "presupuesto-aceptacion-parcial.sql";

const leerSql = (archivo: string) => readFileSync(join(process.cwd(), "sql", archivo), "utf8");

/** Pega un archivo de sql/ como el SQL Editor (una transacción). Devuelve el error, si lo hubo. */
export async function pegar(db: any, archivo: string): Promise<string | null> {
  try {
    await db.exec(`BEGIN;\n${leerSql(archivo)}\n;COMMIT;`);
    return null;
  } catch (e) {
    try { await db.exec("ROLLBACK;"); } catch { /* sin transacción abierta */ }
    return e instanceof Error ? e.message : String(e);
  }
}

export interface Base {
  db: any;
  prisma: any;
}

/** Base con dos clínicas (c1 y la ajena c2), sus pacientes y doctores, y el SQL del plan (×2). */
export async function crearBase(PGlite: new () => any, opciones: { conSqlDelPlan?: boolean; conAceptacion?: boolean } = {}): Promise<Base> {
  const db = new PGlite();
  await db.exec(DDL_BASE);
  for (const c of ["c1", "c2"]) {
    await db.query(`INSERT INTO "clinics" ("id", "name", "cfdiTaxMode") VALUES ($1, $1, NULL)`, [c]);
    await db.query(`INSERT INTO "users" ("id", "clinicId", "role", "firstName", "lastName") VALUES ($1, $2, 'DOCTOR', 'Doc', $2)`, [`doc-${c}`, c]);
    await db.query(`INSERT INTO "patients" VALUES ($1, $2, 'Ana', 'López', NULL)`, [`pac-${c}`, c]);
  }
  if (opciones.conAceptacion) {
    const e = await pegar(db, SQL_ACEPTACION);
    if (e) throw new Error(`no entró ${SQL_ACEPTACION}: ${e}`);
  }
  if (opciones.conSqlDelPlan !== false) {
    for (let i = 0; i < 2; i++) {
      const e = await pegar(db, "plan-tratamiento-filas.sql");
      if (e) throw new Error(`no entró plan-tratamiento-filas.sql (vuelta ${i + 1}): ${e}`);
    }
  }
  return { db, prisma: prismaDePrueba(db) };
}

// ── El «prisma» de prueba ──────────────────────────────────────────────────

const TABLAS: Record<string, string> = {
  treatmentPlan: "treatment_plans",
  invoice: "invoices",
  quote: "quotes",
  quoteItem: "quote_items",
  procedureCatalog: "procedure_catalog",
  clinic: "clinics",
  patient: "patients",
  user: "users",
  appointment: "appointments",
  // Solo las pruebas que crean estas tablas (cerrar plan) las usan.
  payment: "payments",
  patientCredit: "patient_credits",
};
const JSONB = new Set(["items"]);
const ENUMS: Record<string, Record<string, string>> = {
  invoices: { status: "InvoiceStatus" },
  treatment_plans: { status: "TreatmentStatus" },
};

type Rel = { tabla: string; fk: string; local?: string; orden?: string; muchos: boolean };
const RELACIONES: Record<string, Record<string, Rel>> = {
  quotes: {
    items: { tabla: "quote_items", fk: "quoteId", orden: "sortOrder", muchos: true },
    patient: { tabla: "patients", fk: "id", local: "patientId", muchos: false },
    createdBy: { tabla: "users", fk: "id", local: "createdById", muchos: false },
  },
  treatment_plans: {
    patient: { tabla: "patients", fk: "id", local: "patientId", muchos: false },
    doctor: { tabla: "users", fk: "id", local: "doctorId", muchos: false },
    sessions: { tabla: "treatment_sessions_vacia", fk: "treatmentId", muchos: true },
  },
  invoices: { payments: { tabla: "payments_vacia", fk: "invoiceId", muchos: true } },
};

const q = (c: string) => `"${c}"`;

function compilarWhere(tabla: string, where: Record<string, any> | undefined, valores: unknown[]): string {
  if (!where) return "TRUE";
  const partes: string[] = [];
  const v = (x: unknown) => {
    valores.push(x);
    return `$${valores.length}`;
  };
  for (const [k, val] of Object.entries(where)) {
    if (val === undefined) continue; // Prisma descarta la clave
    if (k === "AND") {
      for (const w of Array.isArray(val) ? val : [val]) partes.push(compilarWhere(tabla, w, valores));
      continue;
    }
    const col = `${q(tabla)}.${q(k)}`;
    const enumCast = ENUMS[tabla]?.[k] ? `::text` : "";
    if (val === null) partes.push(`${col} IS NULL`);
    else if (typeof val === "object" && !(val instanceof Date)) {
      if ("in" in val) partes.push(`${col}${enumCast} = ANY(${v(val.in)})`);
      else if ("not" in val) partes.push(val.not === null ? `${col} IS NOT NULL` : `${col}${enumCast} IS DISTINCT FROM ${v(val.not)}`);
      else if ("equals" in val) partes.push(`${col}${enumCast} = ${v(val.equals)}`);
      else throw new Error(`where no soportado: ${k} ${JSON.stringify(val)}`);
    } else partes.push(`${col}${enumCast} = ${v(val)}`);
  }
  return partes.length ? partes.join(" AND ") : "TRUE";
}

function compilarOrden(orderBy: any): string {
  if (!orderBy) return "";
  const lista = Array.isArray(orderBy) ? orderBy : [orderBy];
  const partes = lista.flatMap((o: Record<string, string>) => Object.entries(o).map(([k, d]) => `${q(k)} ${d === "desc" ? "DESC" : "ASC"} NULLS LAST`));
  return partes.length ? ` ORDER BY ${partes.join(", ")}` : "";
}

/**
 * PGlite tiene UNA conexión: mientras una transacción está abierta, una consulta por el cliente global
 * (en Postgres de verdad iría por otra conexión del pool) esperaría para siempre. Aquí va por la
 * transacción abierta. Las transacciones son una a la vez, así que hay a lo más una.
 */
const abierta = new WeakMap<object, { tx: any | null }>();

export function prismaDePrueba(db: any, conn: any = db): any {
  if (!abierta.has(db)) abierta.set(db, { tx: null });
  const estado = abierta.get(db)!;
  if (conn === db) conn = { query: (...a: unknown[]) => (estado.tx ?? db).query(...a) };
  async function relaciones(tabla: string, fila: any, pide: any, cx: any) {
    if (!fila || !pide) return fila;
    for (const [nombre, sel] of Object.entries(pide)) {
      const rel = RELACIONES[tabla]?.[nombre];
      if (!rel || !sel) continue;
      if (rel.tabla.endsWith("_vacia")) { fila[nombre] = []; continue; }
      if (rel.muchos) {
        const orden = (sel as any)?.orderBy ? compilarOrden((sel as any).orderBy) : rel.orden ? ` ORDER BY ${q(rel.orden)}` : "";
        fila[nombre] = (await cx.query(`SELECT * FROM ${q(rel.tabla)} WHERE ${q(rel.fk)} = $1${orden}`, [fila.id])).rows;
      } else {
        fila[nombre] = fila[rel.local!] == null ? null : (await cx.query(`SELECT * FROM ${q(rel.tabla)} WHERE ${q(rel.fk)} = $1`, [fila[rel.local!]])).rows[0] ?? null;
      }
    }
    return fila;
  }

  function modelo(nombreModelo: string, cx: any) {
    const tabla = TABLAS[nombreModelo];
    const pedido = (a: any) => a?.include ?? a?.select;
    const valor = (k: string, v: unknown) => (JSONB.has(k) && v != null ? JSON.stringify(v) : v);
    return {
      async findFirst(a: any = {}) {
        const vals: unknown[] = [];
        const r = await cx.query(`SELECT * FROM ${q(tabla)} WHERE ${compilarWhere(tabla, a.where, vals)}${compilarOrden(a.orderBy)} LIMIT 1`, vals);
        return relaciones(tabla, r.rows[0] ?? null, pedido(a), cx);
      },
      async findUnique(a: any = {}) {
        return this.findFirst(a);
      },
      async findMany(a: any = {}) {
        const vals: unknown[] = [];
        const lim = a.take ? ` LIMIT ${Number(a.take)}` : "";
        const r = await cx.query(`SELECT * FROM ${q(tabla)} WHERE ${compilarWhere(tabla, a.where, vals)}${compilarOrden(a.orderBy)}${lim}`, vals);
        const out = [];
        for (const f of r.rows) out.push(await relaciones(tabla, f, pedido(a), cx));
        return out;
      },
      async create(a: any) {
        const anidados = tabla === "quotes" ? a.data.items : undefined;
        const { items: _i, ...resto } = a.data;
        const data = tabla === "quotes" ? resto : a.data;
        const items = anidados;
        const fila: Record<string, unknown> = { id: data.id ?? randomUUID(), ...data };
        const cols = Object.keys(fila).filter((k) => fila[k] !== undefined);
        const vals = cols.map((k) => valor(k, fila[k]));
        const ph = cols.map((k, i) => `$${i + 1}${ENUMS[tabla]?.[k] ? `::"${ENUMS[tabla][k]}"` : ""}`);
        const r = await cx.query(`INSERT INTO ${q(tabla)} (${cols.map(q).join(", ")}) VALUES (${ph.join(", ")}) RETURNING *`, vals);
        const creada = r.rows[0];
        if (tabla === "quotes" && items?.create) {
          for (const it of items.create) {
            const f: Record<string, unknown> = { id: randomUUID(), quoteId: creada.id, ...it };
            const c2 = Object.keys(f).filter((k) => f[k] !== undefined);
            await cx.query(`INSERT INTO "quote_items" (${c2.map(q).join(", ")}) VALUES (${c2.map((_, i) => `$${i + 1}`).join(", ")})`, c2.map((k) => f[k]));
          }
        }
        return relaciones(tabla, creada, pedido(a), cx);
      },
      async updateMany(a: any) {
        const sets = Object.entries(a.data).filter(([, v]) => v !== undefined);
        const vals: unknown[] = sets.map(([k, v]) => valor(k, v));
        const set = sets.map(([k], i) => `${q(k)} = $${i + 1}${ENUMS[tabla]?.[k] ? `::"${ENUMS[tabla][k]}"` : ""}`).join(", ");
        const r = await cx.query(`UPDATE ${q(tabla)} SET ${set} WHERE ${compilarWhere(tabla, a.where, vals)}`, vals);
        return { count: r.affectedRows ?? 0 };
      },
      async update(a: any) {
        const items = tabla === "quotes" ? a.data.items : undefined;
        const { items: _i, ...resto } = a.data;
        const data = tabla === "quotes" ? resto : a.data;
        await this.updateMany({ where: a.where, data });
        const fila = await this.findFirst({ where: a.where });
        if (tabla === "quotes" && items?.create) {
          for (const [i, it] of items.create.entries()) {
            const f: Record<string, unknown> = { id: randomUUID(), quoteId: fila.id, sortOrder: i, ...it };
            const c2 = Object.keys(f).filter((k) => f[k] !== undefined);
            await cx.query(`INSERT INTO "quote_items" (${c2.map(q).join(", ")}) VALUES (${c2.map((_, j) => `$${j + 1}`).join(", ")})`, c2.map((k) => f[k]));
          }
        }
        return relaciones(tabla, fila, pedido(a), cx);
      },
      async deleteMany(a: any) {
        const vals: unknown[] = [];
        const r = await cx.query(`DELETE FROM ${q(tabla)} WHERE ${compilarWhere(tabla, a.where, vals)}`, vals);
        return { count: r.affectedRows ?? 0 };
      },
    };
  }

  const crudo = (cx: any) => ({
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const s = Prisma.sql(strings, ...values);
      return (await cx.query(s.text, s.values)).rows;
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const s = Prisma.sql(strings, ...values);
      return (await cx.query(s.text, s.values)).affectedRows ?? 0;
    },
  });

  const cliente: any = { ...crudo(conn) };
  for (const m of Object.keys(TABLAS)) cliente[m] = modelo(m, conn);
  // payments y patientCredit: solo existen si la prueba crea sus tablas (cerrar plan); si no, usarlos falla.
  if (!(conn as any).__esTx) {
    let cola: Promise<unknown> = Promise.resolve();
    cliente.$transaction = (fn: (tx: any) => Promise<unknown>) => {
      // Una a la vez, como lo dejaría el FOR UPDATE del plan en Postgres.
      const turno = cola.then(() =>
        db.transaction(async (t: any) => {
          estado.tx = t;
          try {
            return await fn(prismaDePrueba(db, Object.assign(t, { __esTx: true })));
          } finally {
            estado.tx = null;
          }
        }),
      );
      cola = turno.catch(() => undefined);
      return turno;
    };
  }
  return cliente;
}

/** Siembra un plan de c1 (o de la clínica que se diga). */
export async function sembrarPlan(db: any, extra: { id?: string; clinicId?: string; name?: string; totalCost?: number } = {}) {
  const id = extra.id ?? "plan1";
  const c = extra.clinicId ?? "c1";
  await db.query(
    `INSERT INTO "treatment_plans" ("id", "clinicId", "patientId", "doctorId", "name", "totalCost") VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, c, `pac-${c}`, `doc-${c}`, extra.name ?? "Rehabilitación", extra.totalCost ?? 0],
  );
  return id;
}
