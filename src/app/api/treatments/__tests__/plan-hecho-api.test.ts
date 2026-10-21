/**
 * «HECHO» → ODONTOGRAMA, CON DESHACER (ws1-t5 · P7, fase 2 B) — el HANDLER REAL de
 * `PATCH /api/treatments/[id]` (`marcar_hecho` / `deshacer_hecho`) y `snapshot.ts` contra un Postgres
 * en memoria (PGlite) con `sql/plan-tratamiento-filas.sql` y `sql/plan-hecho-odontograma.sql`
 * pegados dos veces (una transacción cada vez, como el SQL Editor).
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:plan-hecho-base
 *
 *  · la fila pasa a hecho (quién, cuándo, cita) y el odontograma cambia (resina sobre caries,
 *    endodoncia, extracción → ausente); varias filas en un clic; un segundo clic no escribe nada;
 *  · deshacer exacto (notas incluidas) y sin pisar lo de después;
 *  · lo escrito por «hecho» NUNCA reaparece en «Tratamientos detectados»; lo pintado a mano sí;
 *  · «Ausente» no cobra; «Extracción realizada» sí;
 *  · permisos (sin medicalRecord.edit no se toca el odontograma), sin SQL, y aislamiento entre clínicas.
 *
 * Dobles por `Module._load` (prisma de PGlite, sesión, auditoría, visibilidad, caché). ⛔ Nunca toca
 * una base de verdad. Sin PGlite se SALTA diciéndolo.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { cargarPGlite, crearBase, pegar, sembrarPlan, type Base } from "@/lib/treatments/__tests__/arnes-pg";

let PGlite: (new () => any) | null = null;
let base: Base;
const prismaVivo: any = {};
const ctx: Record<string, any> = {};
const auditoria: any[] = [];
const fotos: Array<{ patientId: string; appointmentId: string; snapshotAt: Date; entries: unknown }> = [];

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaVivo },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/audit": {
    logAudit: async (a: any) => { auditoria.push({ tipo: "audit", ...a }); },
    logMutation: async (a: any) => { auditoria.push({ tipo: "mutation", ...a, req: undefined }); },
    extractAuditMeta: () => ({}),
  },
  "@/lib/patient-visibility": {
    assertPatientVisible: async () => null,
    relatedPatientVisibilityAnd: () => [],
    patientVisibilityFilter: () => null,
  },
  "@/lib/cache/revalidate": { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
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
  ALTER TABLE "appointments" ADD COLUMN "patientId" text;
  ALTER TABLE "procedure_catalog" ADD COLUMN "code" text, ADD COLUMN "category" text;
`;

async function usar(opciones: { conSqlDelPlan?: boolean; conSqlDeHecho?: boolean } = {}) {
  base = await crearBase(PGlite!, { conSqlDelPlan: opciones.conSqlDelPlan });
  await base.db.exec(DDL_ODONTOGRAMA);
  if (opciones.conSqlDelPlan !== false && opciones.conSqlDeHecho !== false) {
    for (let i = 0; i < 2; i++) {
      const e = await pegar(base.db, "plan-hecho-odontograma.sql");
      if (e) throw new Error(`no entró plan-hecho-odontograma.sql (vuelta ${i + 1}): ${e}`);
    }
  }
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, base.prisma);
  // Lo que snapshot.ts usa del odontograma y no está en el arnés.
  prismaVivo.odontogramSnapshot = {
    findFirst: async (a: any) => {
      const w = a.where;
      const f = fotos
        .filter((x) => x.patientId === w.patientId && x.snapshotAt < w.snapshotAt.lt && (!w.appointmentId || x.appointmentId !== w.appointmentId.not))
        .sort((x, y) => +y.snapshotAt - +x.snapshotAt)[0];
      return f ? { entries: f.entries } : null;
    },
  };
  (await import("@/lib/treatments/items-db"))._olvidarSondas();
  (await import("@/lib/treatments/aplicar-hecho-db"))._olvidarSondaHecho();
  await base.db.query(`INSERT INTO "procedure_catalog" ("id","clinicId","name","basePrice","isActive","code","category") VALUES
    ('p-res','c1','Restauración resina 2 caras',1200,true,NULL,'dental'),
    ('p-endo','c1','Endodoncia multirradicular',4500,true,NULL,'dental'),
    ('p-ext','c1','Extracción dental',1200,true,'ODO_EXTRACCION','dental'),
    ('p-imp','c1','Implante dental',18000,true,'ODO_IMPLANTE','dental'),
    ('p-resina','c1','Restauración con resina',1500,true,'ODO_RESINA','dental'),
    ('p-corona','c1','Corona dental',4500,true,'ODO_CORONA','dental'),
    ('p-endo-seed','c1','Endodoncia',4000,true,'ODO_ENDODONCIA','dental'),
    ('p-ajeno','c2','Resina ajena',1,true,'ODO_RESINA','dental')`);
  await base.db.query(`INSERT INTO "appointments" ("id","clinicId","patientId") VALUES ('cita1','c1','pac-c1'), ('cita-c2','c2','pac-c2'), ('cita-otro','c1','pac-otro')`);
}

/** El odontograma de Ana (c1) antes de empezar, y uno igual para Ana de la clínica ajena. */
async function sembrarOdontograma(paciente = "pac-c1") {
  const filas: Array<[number, string | null, string, string | null]> = [
    [16, "M", "caries", "profunda"], [16, "O", "caries", null], [16, null, "__note__", "sensible al frío"],
    [36, null, "pulpitis", null], [38, null, "ext_indicated", null], [38, "O", "caries", null], [46, null, "missing", null],
  ];
  for (const [t, s, c, n] of filas) {
    await base.db.query(
      `INSERT INTO "odontogram_entries" ("id","patientId","toothNumber","surface","conditionId","notes","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [`${paciente}-${t}-${s ?? "x"}-${c}`, paciente, t, s, c, n],
    );
  }
}

async function sembrarFilas(planId = "plan1", clinicId = "c1") {
  const filas = [
    ["f-res", "p-res", "Restauración resina 2 caras", [16], ["M", "O"], "pendiente", 0],
    ["f-endo", "p-endo", "Endodoncia multirradicular", [36], [], "en_curso", 1],
    ["f-ext", "p-ext", "Extracción dental", [38], [], "pendiente", 2],
    ["f-fluor", null, "Aplicación de flúor", [], [], "pendiente", 3],
    ["f-canc", "p-res", "Resina cancelada", [17], ["O"], "cancelado", 4],
  ];
  for (const [id, proc, nombre, dientes, caras, estado, orden] of filas) {
    await base.db.query(
      `INSERT INTO "treatment_plan_items" ("id","clinicId","planId","procedureId","nombre","dientes","caras","estado","orden","precio")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1000)`,
      [`${id}${planId === "plan1" ? "" : `-${planId}`}`, clinicId, planId, clinicId === "c1" ? proc : null, nombre, dientes, caras, estado, orden],
    );
  }
}

const odontograma = async (paciente = "pac-c1") =>
  (await base.db.query(`SELECT "toothNumber","surface","conditionId","notes" FROM "odontogram_entries" WHERE "patientId" = $1`, [paciente])).rows
    .map((r: any) => `${r.toothNumber}${r.surface ?? "·"}:${r.conditionId}${r.notes ? `(${r.notes})` : ""}`)
    .sort();
const fila = async (id: string) => (await base.db.query(`SELECT * FROM "treatment_plan_items" WHERE "id" = $1`, [id])).rows[0];

const pedir = (body: unknown) =>
  new NextRequest("http://x/api/treatments/plan1", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
async function patch(body: unknown, planId = "plan1") {
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const r = await PATCH(pedir(body), { params: Promise.resolve({ id: planId }) });
  return { status: r.status, body: await r.json() };
}

/** Lo que «Completar consulta» propondría cobrar hoy (la misma secuencia que appointments/[id]/complete). */
async function detectados(paciente = "pac-c1") {
  const s = await import("@/lib/odontogram/snapshot");
  const actual = (await base.db.query(`SELECT * FROM "odontogram_entries" WHERE "patientId" = $1 AND "conditionId" <> '__note__'`, [paciente])).rows
    .map((r: any) => ({ toothNumber: r.toothNumber, surface: r.surface, conditionId: r.conditionId, notes: r.notes }));
  const prev = await s.findPreviousSnapshot(paciente, new Date(), "cita-hoy");
  const cambios = prev
    ? s.diffSnapshots(prev, actual)
    : actual.map((e: any) => ({ ...e, type: "added" as const }));
  const clinica = paciente === "pac-c2" ? "c2" : "c1";
  return (await s.changesToTreatments(cambios, clinica)).map((t) => `${t.code}@${t.toothNumber}${t.surface ?? ""}`).sort();
}

before(async () => {
  PGlite = await cargarPGlite();
});

beforeEach(() => {
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1", role: "DOCTOR", isDoctor: false, permissionsOverride: [] });
  auditoria.length = 0;
  fotos.length = 0;
});

const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) {
    t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>");
    return true;
  }
  return false;
};

test("el SQL entra dos veces; pegado antes que el de las filas no falla (avisa y no hace nada)", async (t) => {
  if (salta(t)) return;
  await usar();
  const col = await base.db.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'treatment_plan_items' AND column_name = 'odontogramaHecho'`);
  assert.equal(col.rows[0]?.data_type, "jsonb");
  await usar({ conSqlDelPlan: false });
  assert.equal(await pegar(base.db, "plan-hecho-odontograma.sql"), null);
  assert.equal((await base.db.query(`SELECT to_regclass('public.treatment_plan_items') AS r`)).rows[0].r, null);
});

test("marcar hecho: la fila (quién, cuándo, cita) y el odontograma (resina sobre la caries de esas caras), con bitácora", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  const r = await patch({ action: "marcar_hecho", itemId: "f-res", citaId: "cita1" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.odontograma[0].estado, "aplicado");
  assert.equal(r.body.odontograma[0].mensaje, "Hecho. El odontograma ya lo muestra.");
  const f = await fila("f-res");
  assert.equal(f.estado, "hecho");
  assert.equal(f.hechoPor, "doc-c1");
  assert.ok(f.hechoEn);
  assert.equal(f.citaId, "cita1");
  assert.equal(f.odontogramaHecho.estadoAntes, "pendiente");
  assert.equal(f.odontogramaHecho.altas.length, 2);
  assert.equal(f.odontogramaHecho.bajas.find((b: any) => b.surface === "M").notes, "profunda");
  const o = await odontograma();
  assert.ok(o.includes("16M:restoration") && o.includes("16O:restoration"));
  assert.ok(!o.some((x) => x.startsWith("16M:caries") || x.startsWith("16O:caries")));
  assert.ok(o.includes("16·:__note__(sensible al frío)"), "la nota del diente no se toca");
  const log = auditoria.filter((a) => a.tipo === "mutation");
  assert.equal(log.length, 1);
  assert.equal(log[0].clinicId, "c1");
  assert.equal(log[0].patientId, "pac-c1");
  assert.match(log[0].texto, /Marcó como hecho .*Restauración resina 2 caras 16 \(MO\)/);
  assert.deepEqual(log[0].after.odontograma[0].puso, ["16M:restoration", "16O:restoration"]);
});

test("varias filas en un clic; un segundo clic no vuelve a escribir; cancelada y ajena no", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  const r = await patch({ action: "marcar_hecho", itemIds: ["f-res", "f-endo", "f-ext", "f-fluor"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.odontograma.map((x: any) => `${x.itemId}:${x.estado}`), ["f-res:aplicado", "f-endo:aplicado", "f-ext:aplicado", "f-fluor:sin_cambio"]);
  const o = await odontograma();
  assert.ok(o.includes("36·:rct") && !o.includes("36·:pulpitis"));
  assert.deepEqual(o.filter((x) => x.startsWith("38")), ["38·:missing"], "extracción → ausente, se va todo lo del diente");
  const antes = await odontograma();
  auditoria.length = 0;
  const otra = await patch({ action: "marcar_hecho", itemIds: ["f-res", "f-endo"] });
  assert.deepEqual(otra.body.odontograma.map((x: any) => x.estado), ["ya_estaba_hecho", "ya_estaba_hecho"]);
  assert.deepEqual(await odontograma(), antes);
  assert.equal(auditoria.length, 0, "sin cambio no hay fila de bitácora");
  assert.equal((await patch({ action: "marcar_hecho", itemId: "f-canc" })).body.code, "fila_cancelada");
  assert.equal((await patch({ action: "marcar_hecho", itemId: "no-existe" })).body.code, "fila_desconocida");
  assert.equal((await patch({ action: "marcar_hecho", itemIds: [] })).status, 400);
});

test("deshacer exacto: la fila vuelve a como estaba (en curso) y el odontograma también, con sus notas", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  const inicio = await odontograma();
  await patch({ action: "marcar_hecho", itemIds: ["f-res", "f-endo"] });
  const d1 = await patch({ action: "deshacer_hecho", itemId: "f-endo" });
  assert.equal(d1.status, 200, JSON.stringify(d1.body));
  assert.equal(d1.body.estado, "en_curso");
  assert.equal((await fila("f-endo")).estado, "en_curso");
  assert.equal((await fila("f-endo")).hechoPor, null);
  const d2 = await patch({ action: "deshacer_hecho", itemId: "f-res" });
  assert.equal(d2.body.estado, "pendiente");
  assert.deepEqual(d2.body.odontograma.conflictos, []);
  assert.deepEqual(await odontograma(), inicio, "caries con su nota «profunda» de vuelta, pulpitis de vuelta");
  assert.ok((await fila("f-res")).odontogramaHecho.deshecho);
  assert.match(auditoria.at(-1).texto, /Deshizo «hecho»/);
  assert.equal((await patch({ action: "deshacer_hecho", itemId: "f-res" })).body.code, "no_esta_hecha");
  // Se puede volver a marcar y vuelve a escribir.
  await patch({ action: "marcar_hecho", itemId: "f-res" });
  assert.ok((await odontograma()).includes("16O:restoration"));
});

test("deshacer no pisa lo de después: lo que se cambió en el diente se queda y se avisa", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  await patch({ action: "marcar_hecho", itemId: "f-res" });
  // Después, en el odontograma: la oclusal pasa a incrustación y aparece una caries nueva en 17.
  await base.db.query(`DELETE FROM "odontogram_entries" WHERE "patientId" = 'pac-c1' AND "toothNumber" = 16 AND "surface" = 'O' AND "conditionId" = 'restoration'`);
  await base.db.query(`INSERT INTO "odontogram_entries" VALUES ('n1','pac-c1',16,'O','inlay',NULL,now(),now()), ('n2','pac-c1',17,'D','caries',NULL,now(),now())`);
  const d = await patch({ action: "deshacer_hecho", itemId: "f-res" });
  assert.equal(d.status, 200);
  const o = await odontograma();
  assert.ok(o.includes("16M:caries(profunda)"), "la mesial vuelve");
  assert.ok(o.includes("16O:inlay") && !o.includes("16O:caries"), "la oclusal se queda como la dejaron");
  assert.ok(o.includes("17D:caries"));
  assert.deepEqual(d.body.odontograma.conflictos.map((c: any) => c.mensaje).sort(), [
    "Diente 16: no se devolvió «Caries» porque ese diente cambió después.",
    "Diente 16: «Restauración (resina/amalgama)» ya se había quitado después; no se tocó.",
  ]);
});

test("lo escrito por «hecho» NUNCA reaparece en «Tratamientos detectados»; lo pintado a mano sí", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  // Primera consulta del paciente (sin foto anterior): «Ausente» (46) ya no se cobra.
  assert.deepEqual(await detectados(), []);
  await patch({ action: "marcar_hecho", itemIds: ["f-res", "f-endo"] });
  // El doctor pinta a mano una corona en 11 (no estaba en el plan): esa sí se propone.
  await base.db.query(`INSERT INTO "odontogram_entries" VALUES ('m1','pac-c1',11,NULL,'crown',NULL,now(),now())`);
  assert.deepEqual(await detectados(), ["ODO_CORONA@11"], "sin foto anterior");
  // Con foto de la consulta anterior (antes del «hecho»): igual.
  fotos.push({ patientId: "pac-c1", appointmentId: "cita-antes", snapshotAt: new Date(Date.now() - 86_400_000),
    entries: [{ toothNumber: 16, surface: "M", conditionId: "caries" }, { toothNumber: 36, surface: null, conditionId: "pulpitis" }] });
  assert.deepEqual(await detectados(), ["ODO_CORONA@11"], "con foto anterior");
  // Deshecho, ya no se salta (y ya no está dibujado).
  await patch({ action: "deshacer_hecho", itemId: "f-res" });
  assert.deepEqual(await detectados(), ["ODO_CORONA@11"]);
  // Las marcas de Ana de c1 no cuentan para Ana de c2.
  await sembrarOdontograma("pac-c2");
  await base.db.query(`INSERT INTO "odontogram_entries" VALUES ('x1','pac-c2',36,NULL,'rct',NULL,now(),now())`);
  assert.deepEqual(await detectados("pac-c2"), ["ODO_ENDODONCIA@36"], "el conducto pintado en c2 sí se propone: lo de c1 no lo tapa");
  const { marcasQueNoSeCobran } = await import("@/lib/treatments/aplicar-hecho-db");
  assert.deepEqual(await marcasQueNoSeCobran("pac-c2", null), []);
  assert.deepEqual((await marcasQueNoSeCobran("pac-c1", null)).filter((e) => e.toothNumber === 36).map((e) => `${e.toothNumber}:${e.conditionId}`), ["36:rct"]);
});

test("«Ausente» no cobra; «Extracción realizada» sí (y la fila de extracción del plan va por la nota del plan)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { changesToTreatments } = await import("@/lib/odontogram/snapshot");
  const cambio = (conditionId: string, toothNumber: number) => ({ toothNumber, surface: null, conditionId, type: "added" as const });
  assert.deepEqual(await changesToTreatments([cambio("missing", 46)], "c1"), []);
  const ext = await changesToTreatments([cambio("ext_done", 48)], "c1");
  assert.deepEqual(ext.map((x) => `${x.code}@${x.toothNumber}:${x.unitPrice}`), ["ODO_EXTRACCION@48:1200"]);
  // La extracción hecha desde el plan deja «Ausente»: tampoco se cobra aparte.
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  await patch({ action: "marcar_hecho", itemId: "f-ext" });
  assert.deepEqual(await detectados(), []);
});

test("permisos: sin medicalRecord.edit se marca la fila pero NO se toca el odontograma; y no se deshace lo que escribió un doctor", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  const inicio = await odontograma();
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", permissionsOverride: ["treatments.view", "treatments.edit"] });
  const r = await patch({ action: "marcar_hecho", itemId: "f-res" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.odontograma[0].estado, "sin_permiso");
  assert.equal((await fila("f-res")).estado, "hecho");
  assert.deepEqual(await odontograma(), inicio);
  // Deshacer lo suyo (no escribió odontograma) sí puede.
  assert.equal((await patch({ action: "deshacer_hecho", itemId: "f-res" })).status, 200);
  // Lo que marcó un doctor (con odontograma), no.
  Object.assign(ctx, { userId: "doc-c1", role: "DOCTOR", permissionsOverride: [] });
  await patch({ action: "marcar_hecho", itemId: "f-res" });
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", permissionsOverride: ["treatments.view", "treatments.edit"] });
  const d = await patch({ action: "deshacer_hecho", itemId: "f-res" });
  assert.equal(d.status, 403);
  assert.equal(d.body.code, "sin_permiso_odontograma");
  assert.equal((await fila("f-res")).estado, "hecho");
});

test("sin el SQL de «hecho»: la fila se marca y el odontograma no se toca; sin el de las filas: 409", async (t) => {
  if (salta(t)) return;
  await usar({ conSqlDeHecho: false });
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  const inicio = await odontograma();
  const r = await patch({ action: "marcar_hecho", itemId: "f-res" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.odontograma[0].estado, "pendiente_de_base");
  assert.deepEqual(await odontograma(), inicio);
  assert.deepEqual(await detectados(), [], "y nada se salta ni se inventa");
  assert.equal((await patch({ action: "deshacer_hecho", itemId: "f-res" })).body.estado, "pendiente");

  await usar({ conSqlDelPlan: false });
  await sembrarPlan(base.db);
  const sin = await patch({ action: "marcar_hecho", itemId: "f-res" });
  assert.equal(sin.status, 409);
  assert.equal(sin.body.code, "sin_filas_en_plan");
});

test("aislamiento: plan de otra clínica 404, fila de otro plan 409, cita de otro paciente u otra clínica 400", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarPlan(base.db, { id: "plan-c2", clinicId: "c2" });
  await sembrarPlan(base.db, { id: "plan1b" });
  await sembrarFilas();
  await sembrarFilas("plan-c2", "c2");
  await sembrarFilas("plan1b");
  await sembrarOdontograma();
  await sembrarOdontograma("pac-c2");
  const ajeno = await odontograma("pac-c2");
  assert.equal((await patch({ action: "marcar_hecho", itemId: "f-res-plan-c2" }, "plan-c2")).status, 404);
  assert.equal((await patch({ action: "marcar_hecho", itemId: "f-res-plan-c2" })).body.code, "fila_desconocida");
  assert.equal((await patch({ action: "marcar_hecho", itemId: "f-res-plan1b" })).body.code, "fila_desconocida");
  for (const citaId of ["cita-c2", "cita-otro", "no-existe"]) {
    const r = await patch({ action: "marcar_hecho", itemId: "f-res", citaId });
    assert.equal(r.status, 400, citaId);
    assert.equal(r.body.code, "cita_invalida");
  }
  assert.equal((await fila("f-res")).estado, "pendiente");
  assert.equal((await fila("f-res-plan-c2")).estado, "pendiente");
  assert.deepEqual(await odontograma("pac-c2"), ajeno);
  // El procedimiento de otra clínica no da la llave: una fila con procedureId ajeno no se reconoce por él.
  await base.db.query(`UPDATE "treatment_plan_items" SET "procedureId" = 'p-ajeno', "nombre" = 'Algo raro' WHERE "id" = 'f-fluor'`);
  const r = await patch({ action: "marcar_hecho", itemId: "f-fluor" });
  assert.equal(r.body.odontograma[0].sinCambio, "procedimiento_desconocido");
});

/** Cierra la consulta como `complete`: guarda la foto del odontograma de hoy. */
async function cerrarConsulta(cita: string, paciente = "pac-c1") {
  const entries = (await base.db.query(`SELECT * FROM "odontogram_entries" WHERE "patientId" = $1 AND "conditionId" <> '__note__'`, [paciente])).rows
    .map((r: any) => ({ toothNumber: r.toothNumber, surface: r.surface, conditionId: r.conditionId, notes: r.notes }));
  fotos.push({ patientId: paciente, appointmentId: cita, snapshotAt: new Date(), entries });
  await new Promise((r) => setTimeout(r, 5));
}

test("revisión 1 · deshacer DESPUÉS de cerrar la consulta: lo devuelto (corona, conducto) no se propone cobrar", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await base.db.query(`INSERT INTO "odontogram_entries" VALUES ('k1','pac-c1',38,NULL,'crown',NULL,now(),now()), ('k2','pac-c1',38,NULL,'rct',NULL,now(),now())`);
  await cerrarConsulta("c0");
  await patch({ action: "marcar_hecho", itemId: "f-ext" });
  await cerrarConsulta("c1");
  assert.deepEqual(await detectados(), []);
  await patch({ action: "deshacer_hecho", itemId: "f-ext" });
  assert.ok((await odontograma()).includes("38·:crown"));
  assert.deepEqual(await detectados(), [], "corona y conducto ya estaban: no son trabajo nuevo");
  // Pero lo que se pinte a mano después sí.
  await base.db.query(`INSERT INTO "odontogram_entries" VALUES ('k3','pac-c1',11,NULL,'crown',NULL,now(),now())`);
  assert.deepEqual(await detectados(), ["ODO_CORONA@11"]);
});

test("revisión 2 · el doctor pintó la resina ANTES de «hecho» (o la pinta después de que recepción marcó): no se cobra aparte", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  await cerrarConsulta("c0");
  // Pintó la restauración en 16 M y O con «Guardar consulta» y luego pulsa «hecho».
  await base.db.query(`DELETE FROM "odontogram_entries" WHERE "patientId" = 'pac-c1' AND "toothNumber" = 16 AND "conditionId" = 'caries'`);
  await base.db.query(`INSERT INTO "odontogram_entries" VALUES ('r1','pac-c1',16,'M','restoration',NULL,now(),now()), ('r2','pac-c1',16,'O','restoration',NULL,now(),now())`);
  const r = await patch({ action: "marcar_hecho", itemId: "f-res" });
  assert.equal(r.body.odontograma[0].sinCambio, "ya_estaba");
  assert.deepEqual(await detectados(), []);
  // Deshacer no borra lo que pintó el doctor (no lo escribió «hecho»), y entonces sí se propone.
  await patch({ action: "deshacer_hecho", itemId: "f-res" });
  assert.ok((await odontograma()).includes("16M:restoration"));
  assert.deepEqual(await detectados(), ["ODO_RESINA@16M", "ODO_RESINA@16O"]);
  // Recepción marca la endodoncia (sin tocar el odontograma) y el doctor pinta el conducto después.
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", permissionsOverride: ["treatments.view", "treatments.edit"] });
  assert.equal((await patch({ action: "marcar_hecho", itemId: "f-endo" })).body.odontograma[0].estado, "sin_permiso");
  await base.db.query(`INSERT INTO "odontogram_entries" VALUES ('r3','pac-c1',36,NULL,'rct',NULL,now(),now())`);
  assert.ok(!(await detectados()).includes("ODO_ENDODONCIA@36"));
});

test("revisión 3 · si no se pueden leer las marcas del plan, la consulta no propone NADA (lanza, la ruta lo atrapa)", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  await patch({ action: "marcar_hecho", itemId: "f-res" });
  const qr = prismaVivo.$queryRaw;
  prismaVivo.$queryRaw = (s: TemplateStringsArray, ...v: unknown[]) =>
    s.join("?").includes("odontogramaHecho") ? Promise.reject(new Error("pooler caído")) : qr(s, ...v);
  try {
    const { findPreviousSnapshot } = await import("@/lib/odontogram/snapshot");
    await assert.rejects(findPreviousSnapshot("pac-c1", new Date(), "cita-hoy"), /pooler caído/);
  } finally {
    prismaVivo.$queryRaw = qr;
  }
});

test("revisión 4 y 6 · deshacer quita la marca aunque le hayan escrito una nota (y la avisa); la fila recupera su cita de antes", async (t) => {
  if (salta(t)) return;
  await usar();
  await sembrarPlan(base.db);
  await sembrarFilas();
  await sembrarOdontograma();
  await base.db.query(`INSERT INTO "appointments" ("id","clinicId","patientId") VALUES ('cita-agendada','c1','pac-c1')`);
  await base.db.query(`UPDATE "treatment_plan_items" SET "citaId" = 'cita-agendada' WHERE "id" = 'f-res'`);
  await patch({ action: "marcar_hecho", itemId: "f-res", citaId: "cita1" });
  assert.equal((await fila("f-res")).citaId, "cita1");
  await base.db.query(`UPDATE "odontogram_entries" SET "notes" = 'A2, sensibilidad' WHERE "patientId" = 'pac-c1' AND "toothNumber" = 16 AND "surface" = 'O' AND "conditionId" = 'restoration'`);
  const d = await patch({ action: "deshacer_hecho", itemId: "f-res" });
  assert.equal(d.status, 200);
  assert.ok(!(await odontograma()).some((x) => x.includes("restoration")));
  assert.deepEqual(d.body.odontograma.conflictos.map((c: any) => c.mensaje),
    ["Diente 16: «Restauración (resina/amalgama)» se quitó con la nota que tenía («A2, sensibilidad»); la nota queda registrada en la bitácora."]);
  assert.match(JSON.stringify(auditoria.at(-1).after), /A2, sensibilidad/);
  assert.equal((await fila("f-res")).citaId, "cita-agendada");
});
