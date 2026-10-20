/**
 * ws1-t11 · revisión t4 O4 — «Guardar consulta» no pisa un autoguardado.
 *
 * Run: npm run test:odontograma-sync-cambios
 *   (--experimental-test-module-mocks: se ejecuta el POST /api/odontogram/sync
 *   y el GET /api/odontogram DE VERDAD. Se sustituyen Prisma, la sesión, la
 *   auditoría y la suplantación; la lógica de la ruta es la real.)
 *
 * Caso del revisor: el doctor abre «Nueva consulta», quita la caries del 16 y
 * le pone una restauración. Mientras, en la otra pestaña (Odontograma, con
 * autoguardado) alguien añade una corona al 16 y una caries al 26. Al «Guardar
 * consulta», el modo viejo (`records`) reemplazaba TODO con la foto de la
 * consulta y se perdían la corona y la caries del 26. El modo `cambios` aplica
 * solo lo que el doctor añadió y quitó, sobre lo que hay en la base.
 *
 * El Prisma falso evalúa los `where` de verdad sobre una tabla en memoria y
 * lanza si una consulta llega sin `patientId`.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cli_1";
const PACIENTE = "pat_1";

interface Fila { id: string; patientId: string; toothNumber: number; surface: string | null; conditionId: string; notes: string | null }
let FILAS: Fila[] = [];
let AUDIT: any[] = [];
let CANDADOS: string[] = [];
let TX_OPTS: ({ timeout?: number } | undefined)[] = [];
let seq = 0;

const coincide = (f: Fila, w: any): boolean => {
  if (typeof w?.patientId !== "string" || !w.patientId) throw new Error("consulta de odontograma SIN patientId");
  if (f.patientId !== w.patientId) return false;
  if (w.toothNumber !== undefined) {
    if (typeof w.toothNumber === "object" && w.toothNumber?.in) { if (!w.toothNumber.in.includes(f.toothNumber)) return false; }
    else if (f.toothNumber !== w.toothNumber) return false;
  }
  if ("surface" in w && f.surface !== w.surface) return false;
  if (w.conditionId !== undefined) {
    if (typeof w.conditionId === "string") { if (f.conditionId !== w.conditionId) return false; }
    else if (w.conditionId.in) { if (!w.conditionId.in.includes(f.conditionId)) return false; }
    else if (w.conditionId.not) { if (f.conditionId === w.conditionId.not) return false; }
  }
  return true;
};

const tabla: any = {
  findMany: async ({ where }: any) => FILAS.filter((f) => coincide(f, where)).map((f) => ({ ...f })),
  findFirst: async ({ where }: any) => { const f = FILAS.find((x) => coincide(x, where)); return f ? { id: f.id } : null; },
  deleteMany: async ({ where }: any) => { const antes = FILAS.length; FILAS = FILAS.filter((f) => !coincide(f, where)); return { count: antes - FILAS.length }; },
  create: async ({ data }: any) => { const f = { id: `e${++seq}`, notes: null, updatedAt: new Date(), ...data }; FILAS.push(f); return f; },
  createMany: async ({ data, skipDuplicates }: any) => {
    let n = 0;
    for (const d of data) {
      const dup = FILAS.some((f) => f.patientId === d.patientId && f.toothNumber === d.toothNumber && f.surface === d.surface && f.conditionId === d.conditionId && f.surface !== null);
      if (dup && skipDuplicates) continue;
      FILAS.push({ id: `e${++seq}`, notes: null, ...d }); n++;
    }
    return { count: n };
  },
};
const prismaFalso: any = {
  odontogramEntry: tabla,
  auditLog: { create: async ({ data }: any) => { AUDIT.push(data); return data; } },
  $transaction: async (fn: (tx: any) => Promise<unknown>, opts?: { timeout?: number }) => { TX_OPTS.push(opts); return fn(prismaFalso); },
  $executeRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => { CANDADOS.push(String(vals[0])); return 1; },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/odontogram/api-auth", {
  namedExports: {
    getDbUser: async () => ({ id: "u_dr", role: "DOCTOR", clinicId: CLINICA }),
    puedeEscribirOdontograma: () => true,
    puedeLeerOdontograma: () => true,
    ensurePatientInClinic: async (pid: string) => pid === PACIENTE,
    isMissingTableError: () => false,
  },
});
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/audit", { namedExports: { extractAuditMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }) } });
mock.module("@/lib/admin/suplantacion", {
  namedExports: { suplantacionDeEstaPeticion: async () => null, anotarAccionDeSuplantacion: async () => {} },
});

const fila = (toothNumber: number, surface: string | null, conditionId: string, notes: string | null = null): Fila =>
  ({ id: `e${++seq}`, patientId: PACIENTE, toothNumber, surface, conditionId, notes, updatedAt: new Date("2026-10-19T10:00:00Z") } as Fila);

async function post(body: unknown) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../sync/route");
  return POST(new NextRequest("http://localhost/api/odontogram/sync", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  }));
}

const estado = () => FILAS.map((f) => `${f.toothNumber}:${f.surface ?? "-"}:${f.conditionId}${f.notes ? `=${f.notes}` : ""}`).sort();

beforeEach(() => {
  FILAS = []; AUDIT = []; CANDADOS = []; TX_OPTS = []; seq = 0;
  FILAS.push(fila(16, "O", "caries"), fila(36, null, "rct"), fila(11, null, "__note__", "sensible"));
});

test("O4: «Guardar consulta» aplica solo el cambio del doctor y NO pisa lo que otra pestaña autoguardó", async () => {
  // la otra pestaña autoguarda DESPUÉS de que la consulta leyó el vivo
  FILAS.push(fila(16, null, "crown"), fila(26, "O", "caries"));
  const res = await post({
    patientId: PACIENTE,
    cambios: {
      16: { base: { surfaces: { O: ["caries"] }, tooth: [] }, now: { surfaces: { M: ["restoration"] }, tooth: [] } },
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(estado(), [
    "11:-:__note__=sensible",
    "16:-:crown",          // autoguardado de la otra pestaña: se queda
    "16:M:restoration",    // lo que añadió el doctor
    "26:O:caries",         // autoguardado en un diente que la consulta no tocó: se queda
    "36:-:rct",
  ]);
  assert.equal(AUDIT.length, 1);
  assert.equal(AUDIT[0].action, "odontogram_sync");
  assert.deepEqual(AUDIT[0].changes._odontogram.before.dientes, [16]);
  assert.equal(TX_OPTS[0]?.timeout, 20_000, "tope de la transacción por encima de los 5 s por defecto (t8)");
});

test("t8 N-O6: el modo viejo (`records`, reemplazo total) responde 410 y no toca nada", async () => {
  FILAS.push(fila(16, null, "crown"), fila(26, "O", "caries"));
  const antes = estado();
  const res = await post({ patientId: PACIENTE, records: { 16: { surfaces: { M: ["restoration"] }, tooth: [] } } });
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error, "gone");
  assert.deepEqual(estado(), antes, "antes borraba la corona, la caries del 26, la endodoncia y la nota");
  assert.equal(AUDIT.length, 0);
});

test("O4: diente completo y nota con el mismo candado que el autoguardado; sin duplicar lo que ya está", async () => {
  FILAS.push(fila(16, null, "crown")); // la otra pestaña ya puso la corona que el doctor también puso
  const res = await post({
    patientId: PACIENTE,
    cambios: {
      16: { base: { surfaces: { O: ["caries"] }, tooth: [] }, now: { surfaces: { O: ["caries"] }, tooth: ["crown"] } },
      11: { base: { surfaces: {}, tooth: [], note: "sensible" }, now: { surfaces: {}, tooth: [], note: "fractura" } },
      36: { base: { surfaces: {}, tooth: ["rct"] }, now: { surfaces: {}, tooth: [] } },
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(estado(), ["11:-:__note__=fractura", "16:-:crown", "16:O:caries"]);
  assert.equal(FILAS.filter((f) => f.toothNumber === 16 && f.conditionId === "crown").length, 1, "la corona no se duplica");
  assert.ok(CANDADOS.includes(`odontogram:${PACIENTE}:16:crown`), "alta de diente completo bajo el candado del PUT");
  assert.ok(CANDADOS.includes(`odontogram:${PACIENTE}:11:__note__`), "nota bajo el candado de /note");
});

test("O4: un diente que no existe o mandar los dos modos se rechaza sin tocar nada", async () => {
  const antes = estado();
  assert.equal((await post({ patientId: PACIENTE, cambios: { 19: { base: { surfaces: {}, tooth: [] }, now: { surfaces: {}, tooth: ["crown"] } } } })).status, 400);
  assert.equal((await post({ patientId: PACIENTE, records: {}, cambios: {} })).status, 400);
  assert.equal((await post({ patientId: "otro", cambios: {} })).status, 404);
  assert.deepEqual(estado(), antes);
});

test("O1: GET /api/odontogram devuelve la clínica de la SESIÓN (llave de la copia del navegador)", async () => {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../route");
  const res = await GET(new NextRequest(`http://localhost/api/odontogram?patientId=${PACIENTE}`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.clinicId, CLINICA);
  assert.equal(body.userId, "u_dr", "el usuario de la sesión: de quién es lo pendiente en el navegador (t8 N-O1)");
  assert.deepEqual(body.notes, { 11: "sensible" });
  assert.ok(body.noteTimes[11], "cuándo se tocó la nota (para no pisar una más nueva al recuperar)");
});
