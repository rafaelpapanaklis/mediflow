/**
 * WS1-T2 · hallazgos 5 y 6 — GET /api/patients/[id]/timeline.
 *
 * Run: npm run test:timeline-expediente
 *   (necesita --experimental-test-module-mocks: el handler se ejecuta DE VERDAD,
 *    con `@/lib/auth`, `@/lib/prisma`, la visibilidad y `@/lib/branches`
 *    sustituidos. Los dos helpers que deciden qué notas se leen NO se falsean:
 *    el mock re-exporta los reales de `@/lib/clinical/record-scope`, que es un
 *    módulo puro, para que lo que se prueba sea la composición de verdad.)
 *
 * Qué vigila:
 *
 *   · HALLAZGO 5 — el timeline ES el expediente (primera línea del `subjective`
 *     de cada nota + los CIE-10 con código, descripción y nota libre) y su
 *     único gate era la lista de ROLES. RECEPTIONIST no tiene
 *     "medicalRecord.view" por default: la ficha SSR lo respeta y le manda
 *     `records: []`, pero la pestaña "Historia clínica" hacía fetch aquí y lo
 *     recibía igual. Ahora exige el permiso, como su hermana /api/clinical.
 *
 *   · HALLAZGO 6 — la fuente de diagnósticos leía
 *     `medicalRecord: { clinicId, patientId }` SIN `ownPrivateRecordsOnly`. La
 *     fuente SOAP de la misma función sí lo aplica: se puso en una y se olvidó
 *     en la otra. Resultado: la nota privada del Dr. A no salía para el Dr. B,
 *     pero su F32.1 sí, con el nombre del Dr. A.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { sharedRecordScope, ownPrivateRecordsOnly } from "../clinical/record-scope";

const CLINICA = "cli_1";
const DR_A = "user_dr_a";
const DR_B = "user_dr_b";
const PACIENTE = "pat_1";

// ── Doble de Prisma ─────────────────────────────────────────────────────────
// No es un stub que devuelve constantes: EVALÚA el `where` que le pasa la ruta
// contra filas en memoria. Si el filtro de notas privadas no está, la fila
// privada pasa y el test lo canta. Cubre justo la forma que usa el handler
// (string | {in}, AND[], OR[], igualdad de escalares y rangos de fecha).
type Row = Record<string, any>;

function matches(where: any, row: Row): boolean {
  if (where == null) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(cond as any[]).every((c) => matches(c, row))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as any[]).some((c) => matches(c, row))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matches(cond, row)) return false;
      continue;
    }
    const value = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, any>;
      if ("in" in c && !(c.in as any[]).includes(value)) return false;
      if ("notIn" in c && (c.notIn as any[]).includes(value)) return false;
      if ("not" in c && value === c.not) return false;
      if ("gte" in c && !(value >= c.gte)) return false;
      if ("lte" in c && !(value <= c.lte)) return false;
      if ("endsWith" in c && !String(value ?? "").endsWith(c.endsWith)) return false;
      // Relación anidada (`medicalRecord: {...}`) — el objeto ES un where.
      const operadores = ["in", "notIn", "not", "gte", "lte", "lt", "gt", "endsWith"];
      if (!Object.keys(c).some((k) => operadores.includes(k))) {
        if (!matches(c, value ?? {})) return false;
      }
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

/** Notas de expediente: una pública del Dr. A y una PRIVADA del Dr. A. */
const NOTAS: Row[] = [
  {
    id: "rec_pub", clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_A,
    isPrivate: false, visitDate: new Date("2026-01-10T10:00:00Z"),
    subjective: "Dolor en molar", assessment: null, plan: null, specialtyData: null,
    doctor: { firstName: "Ana", lastName: "Ruiz" },
  },
  {
    id: "rec_priv", clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_A,
    isPrivate: true, visitDate: new Date("2026-02-10T10:00:00Z"),
    subjective: "Refiere ánimo bajo", assessment: null, plan: null, specialtyData: null,
    doctor: { firstName: "Ana", lastName: "Ruiz" },
  },
];

/** Un CIE-10 colgando de cada nota. El de la privada es el del hallazgo. */
const DIAGNOSTICOS: Row[] = [
  {
    id: "dx_pub", createdAt: new Date("2026-01-10T10:00:00Z"), isPrimary: true, note: null,
    cie10: { code: "K02.1", description: "Caries de la dentina" },
    medicalRecord: NOTAS[0],
  },
  {
    id: "dx_priv", createdAt: new Date("2026-02-10T10:00:00Z"), isPrimary: true,
    note: "no comentar con recepción",
    cie10: { code: "F32.1", description: "Episodio depresivo moderado" },
    medicalRecord: NOTAS[1],
  },
];

let usuarioActual: { id: string; role: string; clinicId: string; permissionsOverride: string[] };

function tabla(rows: Row[]) {
  return { findMany: async ({ where }: any) => rows.filter((r) => matches(where, r)) };
}

mock.module("@/lib/auth", {
  namedExports: { getCurrentUser: async () => usuarioActual },
});
mock.module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null },
});
mock.module("@/lib/branches", {
  namedExports: {
    getVisiblePatientClinicIds: async (clinicId: string) => [clinicId],
    clinicScopeFilter: (ids: string[]) =>
      !ids || ids.length === 0 ? { in: [] } : ids.length === 1 ? ids[0] : { in: ids },
    // Los REALES: es su composición lo que se está probando.
    sharedRecordScope,
    ownPrivateRecordsOnly,
  },
});
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      medicalRecord:           tabla(NOTAS),
      medicalRecordDiagnosis:  tabla(DIAGNOSTICOS),
      appointment:             tabla([]),
      prescription:            tabla([]),
      patientFile:             tabla([]),
      treatmentPlan:           tabla([]),
      referral:                tabla([]),
    },
  },
});

// Import perezoso: `tsx --test` compila a CJS y no admite top-level await, y
// además la ruta debe cargarse DESPUÉS de registrar los mocks de arriba.
let rutaTimeline: { GET: (req: any, ctx: any) => Promise<Response> } | null = null;
async function cargarRuta() {
  if (!rutaTimeline) rutaTimeline = await import("@/app/api/patients/[id]/timeline/route");
  return rutaTimeline;
}

async function pedirTimeline(
  usuario: typeof usuarioActual,
  query = "",
): Promise<{ status: number; body: any }> {
  usuarioActual = usuario;
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(
    `https://dalecontrol.test/api/patients/${PACIENTE}/timeline${query}`,
    { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` } },
  );
  const { GET } = await cargarRuta();
  const res = await GET(req, { params: { id: PACIENTE } });
  return { status: res.status, body: await res.json() };
}

const recepcion = { id: "user_recep", role: "RECEPTIONIST", clinicId: CLINICA, permissionsOverride: [] };
const doctorB   = { id: DR_B, role: "DOCTOR", clinicId: CLINICA, permissionsOverride: [] };
const doctorA   = { id: DR_A, role: "DOCTOR", clinicId: CLINICA, permissionsOverride: [] };

// ── HALLAZGO 5 ──────────────────────────────────────────────────────────────

test("H5 · recepción SIN medicalRecord.view ya no recibe el expediente", async () => {
  // Con el código de hoy esto devuelve 200 y, dentro, la primera línea del
  // `subjective` de cada nota y los CIE-10 con código y descripción.
  const { status, body } = await pedirTimeline(recepcion);
  assert.equal(status, 403);
  assert.match(String(body.error), /medicalRecord\.view/);
});

test("H5 · el doctor, que sí tiene el permiso, sigue viendo su timeline", async () => {
  const { status, body } = await pedirTimeline(doctorA);
  assert.equal(status, 200);
  assert.ok(body.events.length > 0, "el arreglo no puede dejar sin expediente a quien sí puede verlo");
});

test("H5 · el override manda: recepción CON el permiso encendido sí entra", async () => {
  // El dueño puede dárselo desde el modal de Permisos. El gate lee el permiso
  // efectivo (default del rol + override), no el rol pelado.
  const { status } = await pedirTimeline({ ...recepcion, permissionsOverride: ["medicalRecord.view"] });
  assert.equal(status, 200);
});

test("H5 · un rol fuera de la lista sigue cortado antes que nada", async () => {
  const { status } = await pedirTimeline({ ...recepcion, role: "READONLY" });
  assert.equal(status, 403);
});

// ── HALLAZGO 6 ──────────────────────────────────────────────────────────────

test("H6 · el CIE-10 de una nota privada ajena NO sale en el timeline", async () => {
  // Este es el caso del hallazgo, entero: el Dr. B pide su timeline y hoy
  // recibe `F32.1 — Episodio depresivo moderado · no comentar con recepción`
  // firmado "Dr/a. Ana Ruiz", aunque la nota que lo contiene no le salga.
  const { status, body } = await pedirTimeline(doctorB, "?types=diagnosis");
  assert.equal(status, 200);
  const codigos = body.events.map((e: any) => e.meta.code);
  assert.deepEqual(codigos, ["K02.1"], "sólo debe salir el diagnóstico de la nota pública");
  assert.equal(JSON.stringify(body).includes("F32.1"), false);
  assert.equal(JSON.stringify(body).includes("Episodio depresivo moderado"), false);
  assert.equal(JSON.stringify(body).includes("no comentar con recepción"), false);
});

test("H6 · el AUTOR de la nota privada sí ve su propio diagnóstico", async () => {
  // El arreglo no puede convertirse en "nadie ve nada": privada quiere decir
  // de su autor, no de nadie.
  const { body } = await pedirTimeline(doctorA, "?types=diagnosis");
  const codigos = body.events.map((e: any) => e.meta.code).sort();
  assert.deepEqual(codigos, ["F32.1", "K02.1"]);
});

test("H6 · las dos fuentes del mismo archivo filtran igual (SOAP y diagnósticos)", async () => {
  // La causa raíz del hallazgo fue que una fuente se arregló y la otra no.
  // Aquí se comparan las dos salidas del MISMO request: si mañana alguien
  // vuelve a tocar sólo una, las listas dejan de cuadrar.
  const { body } = await pedirTimeline(doctorB, "?types=soap,diagnosis");
  const notasVisibles = body.events.filter((e: any) => e.type === "soap").map((e: any) => e.meta.recordId);
  const notasDeDx     = body.events.filter((e: any) => e.type === "diagnosis").map((e: any) => e.meta.recordId);
  assert.deepEqual(notasVisibles, ["rec_pub"]);
  assert.deepEqual(notasDeDx, ["rec_pub"]);
});
