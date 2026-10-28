/**
 * Rojo = por hacer, azul = realizado (ws1-t6) contra un Postgres EN MEMORIA (PGlite) con
 * `sql/odontograma-estado-marca.sql` pegado DOS veces (una transacción cada vez, como el SQL Editor),
 * y las rutas REALES: GET/PUT de /api/odontogram, POST /api/odontogram/sync, PATCH /api/treatments/[id]
 * («hecho» y su deshacer) y `snapshot.ts` (lo que «Completar consulta» propone cobrar).
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:odontograma-rojo-azul
 *
 *  · sin el SQL, todo como hoy: el GET no trae estado ni enseña el selector, el PUT no escribe estado;
 *  · con el SQL: la marca guarda su rojo/azul, cambiarlo no crea otra fila, una pestaña vieja (sin
 *    estado) no lo borra, un hallazgo no lleva estado; «Guardar consulta» aplica solo lo que cambió;
 *  · decisión 3: «hecho» pasa la marca roja a azul (la misma fila) y el deshacer la regresa a rojo;
 *  · lo rojo y lo previo NUNCA se proponen cobrar; lo que pasó de rojo a azul en la consulta, sí.
 *
 * Dobles por `Module._load` (prisma de PGlite, sesión, auditoría, visibilidad, caché). ⛔ Nunca toca
 * una base de verdad. Sin PGlite se SALTA diciéndolo.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";
import { cargarPGlite, crearBase, pegar, sembrarPlan, type Base } from "@/lib/treatments/__tests__/arnes-pg";

let PGlite: (new () => any) | null = null;
let base: Base;
const prismaVivo: any = {};
const ctx: Record<string, any> = {};
const fotos: Array<{ patientId: string; appointmentId: string; snapshotAt: Date; entries: unknown }> = [];
const bitacora: any[] = [];

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaVivo },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/audit": {
    logAudit: async () => undefined,
    logMutation: async () => undefined,
    extractAuditMeta: () => ({}),
  },
  "@/lib/patient-visibility": {
    assertPatientVisible: async () => null,
    patientVisibilityAnd: () => [],
    relatedPatientVisibilityAnd: () => [],
    patientVisibilityFilter: () => null,
  },
  "@/lib/cache/revalidate": { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
  "@/lib/admin/suplantacion": { suplantacionDeEstaPeticion: async () => null, anotarAccionDeSuplantacion: async () => undefined },
  "@/lib/odontogram/api-auth": {
    getDbUser: async () => ({ id: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }),
    puedeEscribirOdontograma: () => true,
    puedeLeerOdontograma: () => true,
    ensurePatientInClinic: async (pid: string, u: { clinicId: string }) => pid === `pac-${u.clinicId}`,
    isMissingTableError: () => false,
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const DDL_ODONTOGRAMA = `
  CREATE TABLE "odontogram_entries" (
    "id" text PRIMARY KEY, "patientId" text NOT NULL, "toothNumber" integer NOT NULL, "surface" text,
    "conditionId" text NOT NULL, "notes" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL);
  CREATE UNIQUE INDEX "odontogram_entries_patientId_toothNumber_surface_conditionId_key"
    ON "odontogram_entries" ("patientId", "toothNumber", "surface", "conditionId");
  CREATE TABLE "audit_logs_vacia" ("id" text);
  ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "patientId" text;
  ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(3); -- ARCO (la tabla real la tiene)
  ALTER TABLE "procedure_catalog" ADD COLUMN "code" text, ADD COLUMN "category" text;
`;

/**
 * `prisma.odontogramEntry` sobre la base de prueba (el arnés del plan no lo trae): lo que usan las
 * rutas del odontograma, con `where` de verdad (y sin `patientId`, lanza).
 */
function modeloOdontograma(cx: any) {
  let seq = 0;
  const sql = (texto: string, vals: unknown[]) => {
    const partes = texto.split("?");
    return cx.$queryRaw(Object.assign([...partes], { raw: [...partes] }), ...vals);
  };
  const donde = (w: any, vals: unknown[]): string => {
    if (typeof w?.patientId !== "string" || !w.patientId) throw new Error("consulta de odontograma SIN patientId");
    const p = [`"patientId" = ?`];
    vals.push(w.patientId);
    if (w.toothNumber !== undefined) {
      if (w.toothNumber?.in) { p.push(`"toothNumber" = ANY(?::int[])`); vals.push(w.toothNumber.in); }
      else { p.push(`"toothNumber" = ?::int`); vals.push(w.toothNumber); }
    }
    if ("surface" in w) {
      if (w.surface === null) p.push(`"surface" IS NULL`);
      else { p.push(`"surface" = ?`); vals.push(w.surface); }
    }
    if (typeof w.conditionId === "string") { p.push(`"conditionId" = ?`); vals.push(w.conditionId); }
    else if (w.conditionId?.in) { p.push(`"conditionId" = ANY(?::text[])`); vals.push(w.conditionId.in); }
    else if (w.conditionId?.not) { p.push(`"conditionId" <> ?`); vals.push(w.conditionId.not); }
    return p.join(" AND ");
  };
  const COLS = `"id","toothNumber","surface","conditionId","notes","updatedAt","createdAt"`;
  const m = {
    async findMany(a: any) {
      const v: unknown[] = [];
      return sql(`SELECT ${COLS} FROM "odontogram_entries" WHERE ${donde(a.where, v)} ORDER BY "toothNumber", "surface" NULLS FIRST`, v);
    },
    async findFirst(a: any) { return (await m.findMany(a))[0] ?? null; },
    async create(a: any) {
      const d = a.data;
      const r = await sql(
        `INSERT INTO "odontogram_entries" ("id","patientId","toothNumber","surface","conditionId","notes","updatedAt") VALUES (?,?,?::int,?,?,?,now()) RETURNING ${COLS}`,
        [`o${Date.now()}${++seq}`, d.patientId, d.toothNumber, d.surface, d.conditionId, d.notes ?? null],
      );
      return r[0];
    },
    async update(a: any) {
      // como Prisma: solo lo que trae `data` (sin `notes`, la nota no se toca)
      const r = "notes" in a.data
        ? await sql(`UPDATE "odontogram_entries" SET "notes" = ?, "updatedAt" = now() WHERE "id" = ? RETURNING ${COLS}`, [a.data.notes, a.where.id])
        : await sql(`UPDATE "odontogram_entries" SET "updatedAt" = now() WHERE "id" = ? RETURNING ${COLS}`, [a.where.id]);
      return r[0];
    },
    async upsert(a: any) {
      const ya = await m.findFirst({ where: a.where.patientId_toothNumber_surface_conditionId });
      return ya ? m.update({ where: { id: ya.id }, data: a.update }) : m.create({ data: a.create });
    },
    async createMany(a: any) {
      let n = 0;
      for (const d of a.data) {
        const r = await sql(
          `INSERT INTO "odontogram_entries" ("id","patientId","toothNumber","surface","conditionId","notes","updatedAt") VALUES (?,?,?::int,?,?,?,now()) ON CONFLICT DO NOTHING RETURNING "id"`,
          [`o${Date.now()}${++seq}`, d.patientId, d.toothNumber, d.surface, d.conditionId, d.notes ?? null],
        );
        n += r.length;
      }
      return { count: n };
    },
    async deleteMany(a: any) {
      const v: unknown[] = [];
      const r = await sql(`DELETE FROM "odontogram_entries" WHERE ${donde(a.where, v)} RETURNING "id"`, v);
      return { count: r.length };
    },
  };
  return m;
}

async function usar(opciones: { conSqlEstado?: boolean } = {}) {
  base = await crearBase(PGlite!);
  await base.db.exec(DDL_ODONTOGRAMA);
  for (let i = 0; i < 2; i++) {
    const e = await pegar(base.db, "plan-hecho-odontograma.sql");
    if (e) throw new Error(`no entró plan-hecho-odontograma.sql (vuelta ${i + 1}): ${e}`);
  }
  if (opciones.conSqlEstado !== false) {
    for (let i = 0; i < 2; i++) {
      const e = await pegar(base.db, "odontograma-estado-marca.sql");
      if (e) throw new Error(`no entró odontograma-estado-marca.sql (vuelta ${i + 1}): ${e}`);
    }
  }
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, base.prisma);
  prismaVivo.odontogramEntry = modeloOdontograma(base.prisma);
  prismaVivo.auditLog = { create: async (a: any) => { bitacora.push(a.data); return {}; } };
  const txDelArnes = base.prisma.$transaction;
  prismaVivo.$transaction = (fn: (tx: any) => Promise<unknown>, o?: unknown) =>
    txDelArnes((tx: any) => fn(Object.assign(tx, { odontogramEntry: modeloOdontograma(tx), auditLog: { create: async () => ({}) } })), o);
  prismaVivo.odontogramSnapshot = {
    findFirst: async (a: any) => {
      const w = a.where;
      const f = fotos
        .filter((x) => x.patientId === w.patientId && x.snapshotAt < w.snapshotAt.lt && (!w.appointmentId || x.appointmentId !== w.appointmentId.not))
        .sort((x, y) => +y.snapshotAt - +x.snapshotAt)[0];
      return f ? { entries: f.entries, snapshotAt: f.snapshotAt } : null;
    },
  };
  (await import("@/lib/treatments/items-db"))._olvidarSondas();
  (await import("@/lib/treatments/aplicar-hecho-db"))._olvidarSondaHecho();
  (await import("@/lib/odontogram/estado-db"))._olvidarSondaEstado();
  await base.db.query(`INSERT INTO "procedure_catalog" ("id","clinicId","name","basePrice","isActive","code","category") VALUES
    ('p-res','c1','Restauración resina 2 caras',1200,true,NULL,'dental'),
    ('p-resina','c1','Restauración con resina',1500,true,'ODO_RESINA','dental'),
    ('p-corona','c1','Corona dental',4500,true,'ODO_CORONA','dental')`);
}

/** El odontograma: «16O:restoration(por_hacer)», con el estado si la base lo tiene. */
async function odontograma(paciente = "pac-c1") {
  const col = (await base.db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'odontogram_entries' AND column_name = 'estado'`)).rows.length > 0;
  const r = await base.db.query(`SELECT * FROM "odontogram_entries" WHERE "patientId" = $1 AND "conditionId" <> '__note__'`, [paciente]);
  return r.rows.map((x: any) => `${x.toothNumber}${x.surface ?? "·"}:${x.conditionId}${col && x.estado ? `(${x.estado})` : ""}`).sort();
}
const idDe = async (diente: number, cara: string | null, cond: string) =>
  (await base.db.query(`SELECT "id" FROM "odontogram_entries" WHERE "patientId" = 'pac-c1' AND "toothNumber" = $1 AND "surface" IS NOT DISTINCT FROM $2 AND "conditionId" = $3`, [diente, cara, cond])).rows[0]?.id;

async function ruta(metodo: "GET" | "PUT", body?: unknown) {
  const r = await import("@/app/api/odontogram/route");
  const req = new NextRequest(`http://x/api/odontogram${metodo === "GET" ? "?patientId=pac-c1" : ""}`, {
    method: metodo, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
  const res = await (r as any)[metodo](req);
  return { status: res.status, body: await res.json() };
}
const put = (toothNumber: number, surface: string | null, conditionId: string, estado?: string | null) =>
  ruta("PUT", { patientId: "pac-c1", toothNumber, surface, conditionId, ...(estado !== undefined ? { estado } : {}) });

async function sync(cambios: unknown) {
  const { POST } = await import("@/app/api/odontogram/sync/route");
  const res = await POST(new NextRequest("http://x/api/odontogram/sync", {
    method: "POST", body: JSON.stringify({ patientId: "pac-c1", cambios }), headers: { "content-type": "application/json" },
  }));
  return { status: res.status, body: await res.json() };
}

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const r = await PATCH(
    new NextRequest("http://x/api/treatments/plan1", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id: "plan1" }) },
  );
  return { status: r.status, body: await r.json() };
}

/** Lo que «Completar consulta» propondría cobrar hoy (la misma secuencia que appointments/[id]/complete). */
async function detectados() {
  const s = await import("@/lib/odontogram/snapshot");
  const actual = await s.readCurrentEntries("pac-c1");
  const prev = await s.findPreviousSnapshot("pac-c1", new Date(), "cita-hoy");
  const cambios = prev
    ? s.diffSnapshots(prev, actual)
    : actual.map((e) => ({ toothNumber: e.toothNumber, surface: e.surface, conditionId: e.conditionId, type: "added" as const, estado: e.estado ?? null }));
  return (await s.changesToTreatments(cambios, "c1")).map((t) => `${t.code}@${t.toothNumber}${t.surface ?? ""}`).sort();
}
async function foto() {
  const s = await import("@/lib/odontogram/snapshot");
  fotos.push({ patientId: "pac-c1", appointmentId: `cita-${fotos.length}`, snapshotAt: new Date(Date.now() - 60_000 + fotos.length), entries: await s.readCurrentEntries("pac-c1") });
}

before(async () => { PGlite = await cargarPGlite(); });
beforeEach(() => {
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1", role: "DOCTOR", isDoctor: false, permissionsOverride: [] });
  fotos.length = 0;
  bitacora.length = 0;
});
const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) { t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>"); return true; }
  return false;
};

test("el SQL entra dos veces, es aditivo (lo de antes queda NULL) y solo acepta por_hacer / hecho / previo", async (t) => {
  if (salta(t)) return;
  await usar({ conSqlEstado: false });
  await base.db.query(`INSERT INTO "odontogram_entries" ("id","patientId","toothNumber","surface","conditionId","updatedAt") VALUES ('vieja','pac-c1',16,'O','restoration',now())`);
  for (let i = 0; i < 2; i++) assert.equal(await pegar(base.db, "odontograma-estado-marca.sql"), null, `vuelta ${i + 1}`);
  const col = await base.db.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'odontogram_entries' AND column_name = 'estado'`);
  assert.deepEqual(col.rows[0], { data_type: "text", is_nullable: "YES" });
  assert.equal((await base.db.query(`SELECT "estado" FROM "odontogram_entries" WHERE "id" = 'vieja'`)).rows[0].estado, null, "lo guardado no se reescribe");
  await assert.rejects(base.db.query(`UPDATE "odontogram_entries" SET "estado" = 'pagado' WHERE "id" = 'vieja'`));
  await base.db.query(`UPDATE "odontogram_entries" SET "estado" = 'previo' WHERE "id" = 'vieja'`);
});

test("sin el SQL, todo como hoy: el GET no trae estado ni el selector; el PUT con estado guarda la marca sin él", async (t) => {
  if (salta(t)) return;
  await usar({ conSqlEstado: false });
  const p1 = await put(16, "O", "restoration", "por_hacer");
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  const g = await ruta("GET");
  assert.equal(g.body.conEstado, false);
  assert.deepEqual(g.body.entries.map((e: any) => [e.toothNumber, e.surface, e.conditionId, e.estado]), [[16, "O", "restoration", undefined]]);
  assert.deepEqual(await odontograma(), ["16O:restoration"]);
});

test("con el SQL: la marca guarda su rojo/azul; cambiarlo no crea otra fila; una pestaña vieja no lo borra; un hallazgo no lleva estado", async (t) => {
  if (salta(t)) return;
  await usar();
  assert.equal((await put(16, "O", "restoration", "por_hacer")).status, 200);
  const id = await idDe(16, "O", "restoration");
  assert.equal((await put(16, "O", "restoration", "hecho")).status, 200);
  assert.equal(await idDe(16, "O", "restoration"), id, "la misma fila");
  assert.equal((await put(16, "O", "restoration")).status, 200, "PUT sin estado (JS de antes del despliegue)");
  assert.equal((await put(26, null, "crown", "previo")).status, 200);
  assert.equal((await put(36, "O", "caries", "por_hacer")).status, 200);
  assert.deepEqual(await odontograma(), ["16O:restoration(hecho)", "26·:crown(previo)", "36O:caries"]);
  const g = await ruta("GET");
  assert.equal(g.body.conEstado, true);
  assert.deepEqual(
    g.body.entries.map((e: any) => `${e.toothNumber}${e.surface ?? "·"}:${e.conditionId}:${e.estado ?? "-"}`).sort(),
    ["16O:restoration:hecho", "26·:crown:previo", "36O:caries:-"],
  );
});

test("«Guardar consulta»: aplica solo el rojo/azul que el doctor cambió; lo que no tocó, como esté en la base", async (t) => {
  if (salta(t)) return;
  await usar();
  await put(16, "O", "restoration", "por_hacer");
  await put(16, "M", "restoration", "por_hacer");
  // mientras, otra pestaña pasó la M a «previo»
  await put(16, "M", "restoration", "previo");
  const r = await sync({
    16: {
      base: { surfaces: { O: ["restoration"], M: ["restoration"] }, tooth: [], estados: { "O:restoration": "por_hacer", "M:restoration": "por_hacer" } },
      now: { surfaces: { O: ["restoration"], M: ["restoration"] }, tooth: ["crown"], estados: { "O:restoration": "hecho", "M:restoration": "por_hacer", "_:crown": "por_hacer" } },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await odontograma(), ["16M:restoration(previo)", "16O:restoration(hecho)", "16·:crown(por_hacer)"]);
});

test("«Hecho» en el plan: la resina roja del 16 O pasa a azul (la misma fila), la M se pone azul, la caries se va; deshacer lo regresa", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await base.db.query(
    `INSERT INTO "treatment_plan_items" ("id","clinicId","planId","procedureId","nombre","dientes","caras","estado","orden","precio")
     VALUES ('f-res','c1','plan1','p-res','Restauración resina 2 caras',$1,$2,'pendiente',0,1200)`, [[16], ["M", "O"]]);
  await put(16, "O", "restoration", "por_hacer");
  await put(16, "O", "caries");
  const id = await idDe(16, "O", "restoration");

  const h = await patch({ action: "marcar_hecho", itemId: "f-res" });
  assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.equal(h.body.odontograma[0].estado, "aplicado");
  assert.deepEqual(h.body.odontograma[0].aHecho.map((e: any) => `${e.toothNumber}${e.surface}:${e.conditionId}`), ["16O:restoration"]);
  assert.deepEqual(await odontograma(), ["16M:restoration(hecho)", "16O:restoration(hecho)"]);
  assert.equal(await idDe(16, "O", "restoration"), id, "no se creó otra resina: la roja pasó a azul");
  assert.deepEqual(await detectados(), [], "lo que «hecho» resolvió lo cobra la nota del plan, no la consulta");

  const d = await patch({ action: "deshacer_hecho", itemId: "f-res" });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual(await odontograma(), ["16O:caries", "16O:restoration(por_hacer)"]);
  assert.equal(await idDe(16, "O", "restoration"), id);
});

test("«Completar consulta»: lo rojo y lo previo NUNCA se proponen cobrar; lo que pasó de rojo a azul en la consulta, sí", async (t) => {
  if (salta(t)) return;
  await usar();
  await put(16, "O", "restoration", "por_hacer");
  await put(26, null, "crown", "previo");
  assert.deepEqual(await detectados(), [], "primera consulta: ni la resina roja ni la corona previa");
  await foto();
  await put(16, "O", "restoration", "hecho");
  await put(36, null, "crown", "hecho");
  assert.deepEqual(await detectados(), ["ODO_CORONA@36", "ODO_RESINA@16O"]);
});

test("revisión 1: cambiarle el color a una marca no borra su nota (marca y lote de un implante, lo importado)", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.query(`INSERT INTO "odontogram_entries" ("id","patientId","toothNumber","surface","conditionId","notes","updatedAt")
    VALUES ('imp','pac-c1',36,NULL,'implant','Straumann BLT 4.1 · lote 7781',now()), ('res','pac-c1',16,'O','restoration','importado de Dentalink',now())`);
  assert.equal((await put(36, null, "implant", "hecho")).status, 200);
  assert.equal((await put(16, "O", "restoration", "por_hacer")).status, 200);
  const notas = (await base.db.query(`SELECT "id","notes","estado" FROM "odontogram_entries" ORDER BY "id"`)).rows;
  assert.deepEqual(notas, [
    { id: "imp", notes: "Straumann BLT 4.1 · lote 7781", estado: "hecho" },
    { id: "res", notes: "importado de Dentalink", estado: "por_hacer" },
  ]);
  // quien SÍ manda la nota la cambia, como siempre
  assert.equal((await ruta("PUT", { patientId: "pac-c1", toothNumber: 36, surface: null, conditionId: "implant", notes: "otra" })).status, 200);
  assert.equal((await base.db.query(`SELECT "notes" FROM "odontogram_entries" WHERE "id" = 'imp'`)).rows[0].notes, "otra");
});

test("revisión 2: si no se puede saber si la base guarda el estado, «Completar consulta» no propone nada (no cobra lo rojo)", async (t) => {
  if (salta(t)) return;
  await usar({ conSqlEstado: false });
  const db = await import("@/lib/odontogram/estado-db");
  const s = await import("@/lib/odontogram/snapshot");
  const real = prismaVivo.$queryRaw;
  prismaVivo.$queryRaw = (strings: TemplateStringsArray, ...v: unknown[]) =>
    strings.join("?").includes("information_schema.columns") && strings.join("?").includes("'estado'")
      ? Promise.reject(new Error("timeout del pooler")) : real(strings, ...v);
  try {
    db._olvidarSondaEstado();
    assert.equal(await db.columnaEstadoExiste(), false, "la pantalla sigue como hoy");
    await assert.rejects(s.readCurrentEntries("pac-c1"), /timeout del pooler/, "el cobro no se fía");
  } finally {
    prismaVivo.$queryRaw = real;
  }
  // un «no» recordado tampoco vale para cobrar: recién pegado el SQL, se pregunta otra vez
  db._olvidarSondaEstado();
  assert.equal(await db.columnaEstadoExiste(), false);
  for (let i = 0; i < 2; i++) assert.equal(await pegar(base.db, "odontograma-estado-marca.sql"), null);
  await put(16, "O", "restoration");
  await base.db.query(`UPDATE "odontogram_entries" SET "estado" = 'por_hacer'`); // la pintó otra instancia que ya sabía
  assert.equal(await db.columnaEstadoExiste(), false, "la pantalla espera a volver a preguntar (2 min)");
  assert.deepEqual((await s.readCurrentEntries("pac-c1")).map((e) => e.estado), ["por_hacer"], "el cobro pregunta ya");
});

/* ─────── v2 (revisión de t1) ─────── */

/** La sonda de la columna `estado` falla (timeout del pooler) mientras corre `fn`. */
async function conSondaCaida<T>(fn: () => Promise<T>): Promise<T> {
  const db = await import("@/lib/odontogram/estado-db");
  const real = prismaVivo.$queryRaw;
  prismaVivo.$queryRaw = (strings: TemplateStringsArray, ...v: unknown[]) =>
    strings.join("?").includes("information_schema.columns") && strings.join("?").includes("'estado'")
      ? Promise.reject(new Error("timeout del pooler")) : real(strings, ...v);
  db._olvidarSondaEstado();
  try { return await fn(); } finally { prismaVivo.$queryRaw = real; db._olvidarSondaEstado(); }
}

test("v2 m7: la restricción entra NOT VALID y queda validada; el archivo se pega dos veces", async (t) => {
  if (salta(t)) return;
  await usar();
  const r = await base.db.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'odontogram_entries_estado_check'`);
  assert.deepEqual(r.rows, [{ convalidated: true }]);
});

test("v2 m5: con la sonda caída, el PUT con color da 503 sin guardar nada (la cola reintenta); el GET avisa; el sync guarda y avisa", async (t) => {
  if (salta(t)) return;
  await usar();
  await put(16, "O", "restoration", "por_hacer");
  await conSondaCaida(async () => {
    const p = await put(26, "O", "restoration", "hecho");
    assert.equal(p.status, 503);
    assert.equal(p.body.error, "estado_no_disponible");
    assert.deepEqual(await odontograma(), ["16O:restoration(por_hacer)"], "ni la marca ni su color: se reintentan juntos");
    const sinColor = await put(36, "O", "caries");
    assert.equal(sinColor.status, 200, "un hallazgo (sin color) se guarda como siempre");
    const g = await ruta("GET");
    assert.equal(g.status, 200);
    assert.equal(g.body.estadoNoLeido, true);
    assert.equal("conEstado" in g.body, false, "no dice «sin columna»: el selector se queda como estaba");
    const sy = await sync({ 46: { base: { surfaces: {}, tooth: [] }, now: { surfaces: {}, tooth: ["crown"], estados: { "_:crown": "por_hacer" } } } });
    assert.equal(sy.status, 200);
    assert.equal(sy.body.estadoNoGuardado, true);
  });
  assert.deepEqual(await odontograma(), ["16O:restoration(por_hacer)", "36O:caries", "46·:crown"]);
});

test("v2 m5: «Hecho» y «Deshacer» con la sonda caída: 503 y no se toca nada (ni la fila ni el odontograma)", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await base.db.query(
    `INSERT INTO "treatment_plan_items" ("id","clinicId","planId","procedureId","nombre","dientes","caras","estado","orden","precio")
     VALUES ('f-res','c1','plan1','p-res','Restauración resina 2 caras',$1,$2,'pendiente',0,1200)`, [[16], ["O"]]);
  await put(16, "O", "restoration", "por_hacer");
  const h = await conSondaCaida(() => patch({ action: "marcar_hecho", itemId: "f-res" }));
  assert.equal(h.status, 503, JSON.stringify(h.body));
  assert.equal(h.body.code, "estado_no_disponible");
  assert.match(h.body.error, /no se tocó nada/);
  assert.equal((await base.db.query(`SELECT "estado" FROM "treatment_plan_items" WHERE "id" = 'f-res'`)).rows[0].estado, "pendiente");
  assert.deepEqual(await odontograma(), ["16O:restoration(por_hacer)"]);
  assert.equal((await patch({ action: "marcar_hecho", itemId: "f-res" })).status, 200);
  const d = await conSondaCaida(() => patch({ action: "deshacer_hecho", itemId: "f-res" }));
  assert.equal(d.status, 503);
  assert.deepEqual(await odontograma(), ["16O:restoration(hecho)"], "no queda deshecho a medias");
  assert.equal((await base.db.query(`SELECT "estado" FROM "treatment_plan_items" WHERE "id" = 'f-res'`)).rows[0].estado, "hecho");
});

test("v2 m4: la bitácora del PUT dice si la marca ya existía (Movimientos: «Marcó…» vs «Registró…»)", async (t) => {
  if (salta(t)) return;
  await usar();
  await put(16, "O", "restoration", "por_hacer");
  await put(16, "O", "restoration", "hecho");
  await put(26, null, "crown", "por_hacer");
  await put(26, null, "crown", "previo");
  const despues = bitacora.filter((b) => b.action === "odontogram_write").map((b) => b.changes._odontogram.after).map((a: any) => `${a.toothNumber}:${a.estado}:${a.existia}`);
  assert.deepEqual(despues, ["16:por_hacer:false", "16:hecho:true", "26:por_hacer:false", "26:previo:true"]);
});

test("v2 M2: Sabina y el lector del PDF/exportación dicen «(por hacer)» / «(previo, otra clínica)»; sin la columna, como hoy", async (t) => {
  if (salta(t)) return;
  await usar();
  await put(16, "O", "restoration", "por_hacer");
  await put(17, "O", "restoration", "hecho");
  await put(26, null, "crown", "previo");
  const { odontograma: herramienta } = await import("@/lib/sabina/tools/odontograma");
  const dbSabina: any = {
    patient: { findFirst: async (a: any) => (a.where.id === "pac-c1" && a.where.clinicId === "c1" ? { id: "pac-c1" } : null) },
    odontogramEntry: modeloOdontograma(base.prisma),
    $queryRaw: (...a: any[]) => base.prisma.$queryRaw(...a),
  };
  const sab = { clinicId: "c1", userId: "doc-c1", role: "DOCTOR", permissionsOverride: [], timezone: "America/Mexico_City", db: dbSabina } as any;
  const datos = await herramienta.ejecutar(sab, { patientId: "pac-c1" });
  assert.deepEqual(datos.hallazgos.map((h: any) => `${h.hallazgo}: ${h.dientes}`).sort(), [
    "Corona (previo, otra clínica): 26",
    "Restauración (resina/amalgama) (por hacer): 16",
    "Restauración (resina/amalgama): 17",
  ]);
  const { estadosParaMostrar } = await import("@/lib/odontogram/estado-db");
  assert.equal((await estadosParaMostrar(base.prisma, "pac-c1")).size, 3);
  // sin la columna: mapa vacío, nunca lanza
  await usar({ conSqlEstado: false });
  assert.equal((await estadosParaMostrar(base.prisma, "pac-c1")).size, 0);
});

/* ─────── v3 (segunda revisión de t1) ─────── */

async function sembrarFilasDePlan(planId: string, doctor: string, filas: Array<[string, number[], string]>, nombrePlan = planId) {
  await base.db.query(`INSERT INTO "treatment_plans" ("id","clinicId","patientId","doctorId","name") VALUES ($1,'c1','pac-c1',$2,$3)`, [planId, doctor, nombrePlan]);
  for (const [i, [nombre, dientes, estado]] of filas.entries()) {
    await base.db.query(
      `INSERT INTO "treatment_plan_items" ("id","clinicId","planId","procedureId","nombre","dientes","caras","estado","orden","precio","hechoEn")
       VALUES ($1,'c1',$2,NULL,$3,$4,'{}',$5,$6,1200,$7)`,
      [`${planId}-${i}`, planId, nombre, dientes, estado, i, estado === "hecho" ? new Date(Date.now() - 400 * 86_400_000) : null]);
  }
}

test("v3 MAYOR-B: GET /api/treatments/en-planes da, de TODOS los doctores, tipo + dientes + plan + estado (sin precios ni notas); otra clínica 404", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.query(`INSERT INTO "users" ("id","clinicId","role","firstName","lastName") VALUES ('doc-otro','c1','DOCTOR','Otra','Doctora')`);
  await sembrarFilasDePlan("plan-a", "doc-otro", [["Resina posterior", [16], "pendiente"], ["Corona metal-porcelana", [26], "hecho"]], "Plan de la Dra. Otra");
  await sembrarFilasDePlan("plan-b", "doc-c1", [["Endodoncia multirradicular", [36], "cancelado"]], "Plan mío");
  Object.assign(ctx, { isDoctor: true }); // un doctor: GET /api/treatments solo le daría SUS planes
  const { GET } = await import("@/app/api/treatments/en-planes/route");
  const r = await GET(new NextRequest("http://x/api/treatments/en-planes?patientId=pac-c1"));
  assert.equal(r.status, 200);
  const { filas } = await r.json();
  assert.deepEqual(filas.map((f: any) => `${f.plan}:${f.clave}:${f.dientes}:${f.estado}`), [
    "Plan de la Dra. Otra:resina:16:pendiente", "Plan de la Dra. Otra:corona:26:hecho",
  ]);
  for (const f of filas) assert.deepEqual(Object.keys(f).sort(), ["caras", "clave", "dientes", "estado", "hechoEn", "plan", "planId"], "sin precio, nombre de la fila ni notas (v6: con caras)");
  const ajena = await GET(new NextRequest("http://x/api/treatments/en-planes?patientId=pac-c2"));
  assert.equal(ajena.status, 404, "el paciente de otra clínica no existe aquí");
  Object.assign(ctx, { role: "RECEPTIONIST", permissionsOverride: ["patients.view"] });
  assert.equal((await GET(new NextRequest("http://x/api/treatments/en-planes?patientId=pac-c1"))).status, 403, "sin treatments.view, no");
});

test("v3 MAYOR-B: el servidor avisa (no rechaza) la fila que ya está en otro plan, al crear y al agregar filas", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarFilasDePlan("plan-a", "doc-c1", [["Resina posterior", [16], "pendiente"]], "Plan A");
  const { POST } = await import("@/app/api/treatments/route");
  const fila = (nombre: string, dientes: number[]) => ({ nombre, procedureId: null, dientes, caras: [], fase: "higienica", cantidad: 1, precioCentavos: 70000, motivo: "", estado: "pendiente" });
  const alta = await POST(new NextRequest("http://x/api/treatments", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ patientId: "pac-c1", name: "Plan B", totalCost: 1400, items: [fila("Restauración resina 1 cara", [16]), fila("Restauración resina 1 cara", [26])] }),
  }));
  const cuerpo = await alta.json();
  assert.equal(alta.status, 201, JSON.stringify(cuerpo));
  assert.deepEqual(cuerpo.yaEnOtrosPlanes, [{ nombre: "Restauración resina 1 cara", dientes: [16], plan: "Plan A" }]);
  assert.equal(cuerpo.items.length, 2, "se guardó igual: es un aviso");
  // agregar al plan A una corona del 26 que ya está en el B
  await sembrarFilasDePlan("plan-c", "doc-c1", [["Corona metal-porcelana", [26], "pendiente"]], "Plan C");
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const actuales = (await base.db.query(`SELECT "id","nombre","dientes","caras","fase","cantidad","precio","motivo","estado" FROM "treatment_plan_items" WHERE "planId" = 'plan-a'`)).rows;
  const r = await PATCH(new NextRequest("http://x/api/treatments/plan-a", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [
      ...actuales.map((f: any) => ({ id: f.id, nombre: f.nombre, procedureId: null, dientes: f.dientes, caras: f.caras, fase: f.fase ?? "higienica", cantidad: f.cantidad ?? 1, precioCentavos: Math.round(Number(f.precio) * 100), motivo: f.motivo ?? "", estado: f.estado })),
      fila("Corona de porcelana", [26]),
    ] }),
  }), { params: Promise.resolve({ id: "plan-a" }) });
  const b = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b));
  assert.deepEqual(b.yaEnOtrosPlanes, [{ nombre: "Corona de porcelana", dientes: [26], plan: "Plan C" }]);
});

/* ─────── v4 (tercera revisión de t1) ─────── */

test("v4 B1: con treatment_plans.status como TEXT (la base real) la ruta funciona: no filtra por estado en la consulta", async (t) => {
  if (salta(t)) return;
  await usar();
  // la base real: status es TEXT aunque Prisma lo declare enum; un `status: { in }` en el where da 42883
  await base.db.exec(`ALTER TABLE "treatment_plans" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "treatment_plans" ALTER COLUMN "status" TYPE text USING "status"::text;
    ALTER TABLE "treatment_plans" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';`);
  await sembrarFilasDePlan("plan-a", "doc-c1", [["Resina posterior", [16], "pendiente"]], "Plan A");
  await sembrarFilasDePlan("plan-x", "doc-c1", [["Corona metal-porcelana", [26], "pendiente"], ["Corona metal-porcelana", [27], "hecho"]], "Plan cancelado");
  await base.db.query(`UPDATE "treatment_plans" SET "status" = 'ABANDONED' WHERE "id" = 'plan-x'`);
  const real = prismaVivo.treatmentPlan.findMany;
  const wheres: any[] = [];
  prismaVivo.treatmentPlan = { ...prismaVivo.treatmentPlan, findMany: async (a: any) => {
    wheres.push(a.where);
    if (a.where && "status" in a.where) throw Object.assign(new Error('operator does not exist: text = "TreatmentStatus"'), { code: "42883" });
    return real(a);
  } };
  try {
    const { GET } = await import("@/app/api/treatments/en-planes/route");
    const r = await GET(new NextRequest("http://x/api/treatments/en-planes?patientId=pac-c1"));
    assert.equal(r.status, 200);
    const { filas } = await r.json();
    assert.deepEqual(filas.map((f: any) => `${f.plan}:${f.clave}:${f.dientes}:${f.estado}`).sort(), [
      "Plan A:resina:16:pendiente", "Plan cancelado:corona:27:hecho",
    ], "lo pendiente del plan cancelado no cuenta (se decide en JS); lo hecho sí");
    assert.ok(wheres.length > 0 && wheres.every((w) => !("status" in w)), "ninguna consulta de planes filtra por status");
    // y el aviso del servidor también funciona con TEXT
    const { avisoDeFilasRepetidas } = await import("@/lib/treatments/ya-en-planes.server");
    assert.deepEqual(await avisoDeFilasRepetidas("c1", "pac-c1", [{ nombre: "Resina", procedureId: null, dientes: [16] }]), [{ nombre: "Resina", dientes: [16], plan: "Plan A" }]);
  } finally {
    prismaVivo.treatmentPlan = { ...prismaVivo.treatmentPlan, findMany: real };
  }
});

test("v4 m2 y m3: se miran más de 20 planes; un paciente archivado (ARCO) da 404", async (t) => {
  if (salta(t)) return;
  await usar();
  // 25 planes: la resina hecha está en el MÁS VIEJO
  await sembrarFilasDePlan("plan-viejo", "doc-c1", [["Resina posterior", [16], "hecho"]], "Plan viejo");
  await base.db.query(`UPDATE "treatment_plans" SET "createdAt" = now() - interval '5 years' WHERE "id" = 'plan-viejo'`);
  for (let i = 0; i < 24; i++) await sembrarFilasDePlan(`plan-${i}`, "doc-c1", [["Profilaxis", [], "pendiente"]], `Plan ${i}`);
  const { GET } = await import("@/app/api/treatments/en-planes/route");
  const { filas } = await (await GET(new NextRequest("http://x/api/treatments/en-planes?patientId=pac-c1"))).json();
  assert.ok(filas.some((f: any) => f.plan === "Plan viejo" && f.clave === "resina"), "lo hecho en el plan nº 25 cuenta");
  await base.db.exec(`ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(3)`);
  await base.db.query(`UPDATE "patients" SET "deletedAt" = now() WHERE "id" = 'pac-c1'`);
  assert.equal((await GET(new NextRequest("http://x/api/treatments/en-planes?patientId=pac-c1"))).status, 404);
});

/* ─────── v6 (quinta revisión de t1) ─────── */

test("v6 m2: «estadoDesde» = cuándo la marca pasó a su estado (rojo); el GET lo manda; rehacer una resina vieja se ofrece", async (t) => {
  if (salta(t)) return;
  await usar();
  const col = await base.db.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'odontogram_entries' AND column_name = 'estadoDesde'`);
  assert.equal(col.rows[0]?.data_type, "timestamp without time zone");
  // F2 de t1: resina 16 O pintada en 2023, hecha (azul) en 2024 en un plan; hoy se repinta en ROJO
  await put(16, "O", "restoration", "hecho");
  await base.db.query(`UPDATE "odontogram_entries" SET "createdAt" = '2023-01-01', "estadoDesde" = '2024-01-01'`);
  await sembrarFilasDePlan("plan-a", "doc-c1", [["Restauración resina 1 cara", [16], "hecho"]], "Plan A"); // hecha hace 400 días (≈ 2025)
  const antes = (await base.db.query(`SELECT "estadoDesde" FROM "odontogram_entries"`)).rows[0].estadoDesde;
  assert.equal((await put(16, "O", "restoration", "hecho")).status, 200);
  assert.equal(String((await base.db.query(`SELECT "estadoDesde" FROM "odontogram_entries"`)).rows[0].estadoDesde), String(antes), "mismo estado: no se mueve");
  assert.equal((await put(16, "O", "restoration", "por_hacer")).status, 200);
  const g = await ruta("GET");
  const e = g.body.entries[0];
  assert.equal(e.estado, "por_hacer");
  assert.ok(Date.now() - Date.parse(e.estadoDesde) < 60_000, "pasó a rojo ahora");
  assert.ok(Date.parse(e.createdAt) < Date.parse("2023-06-01"), "createdAt sigue siendo el de 2023");
  // lo que hace la ventana con eso: la fecha de la roja es estadoDesde → la resina hecha antes no la tapa
  const { fechaDeMarca, hallazgosPorTratar } = await import("@/components/dashboard/plan-tratamiento-rediseno/plan-clinico");
  const { chipsDelPlan } = await import("@/components/dashboard/plan-tratamiento-rediseno/armar-plan");
  const { GET: enPlanesGET } = await import("@/app/api/treatments/en-planes/route");
  const { filas } = await (await enPlanesGET(new NextRequest("http://x/api/treatments/en-planes?patientId=pac-c1"))).json();
  const entradas = g.body.entries.map((x: any) => ({ ...x, marcadaEn: fechaDeMarca(x) }));
  const tarifario = [{ id: "p1", name: "Restauración resina 1 cara", basePrice: 700, duration: 30, category: "dental", code: null, isActive: true }];
  const chip = chipsDelPlan(hallazgosPorTratar(entradas), tarifario, entradas, [], filas)[0];
  assert.equal(chip.clave, "r:h:16:restoration");
  assert.equal(chip.enOtroPlan ?? null, null, "rehacerla sale con un toque");
  assert.equal(chip.sugerencia?.precio, 700);
});

test("v6 m2: la sonda pide las DOS columnas del mismo SQL; con solo «estado» (SQL a medias), todo como hoy", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.exec(`ALTER TABLE "odontogram_entries" DROP COLUMN "estadoDesde"`); // solo en esta base de prueba
  (await import("@/lib/odontogram/estado-db"))._olvidarSondaEstado();
  const g = await ruta("GET");
  assert.equal(g.body.conEstado, false);
  assert.equal((await put(16, "O", "restoration", "por_hacer")).status, 200);
  assert.deepEqual(await odontograma(), ["16O:restoration"], "el PUT no escribe estado sin las dos columnas");
});

test("v7 m1: estadoDesde se guarda en UTC aunque la sesión tenga otra zona horaria", async (t) => {
  if (salta(t)) return;
  await usar();
  await put(16, "O", "restoration", "hecho");
  await base.db.exec(`SET TIME ZONE 'America/Mexico_City'`); // solo esta base de prueba
  try {
    await put(16, "O", "restoration", "por_hacer");
    const r = (await base.db.query(`SELECT "estadoDesde", timezone('UTC', now()) AS utc FROM "odontogram_entries"`)).rows[0];
    assert.ok(Math.abs(new Date(r.estadoDesde).getTime() - new Date(r.utc).getTime()) < 60_000, `en UTC (${r.estadoDesde} vs ${r.utc})`);
  } finally {
    await base.db.exec(`SET TIME ZONE 'UTC'`);
  }
});
