/**
 * WS1-T2 · hallazgos 3 y 4 — el enlace del portal por token.
 *
 * Run: npm run test:portal-token
 *   (--experimental-test-module-mocks: se ejecutan los handlers DE VERDAD, con
 *    Prisma, la auth y la bitácora sustituidas.)
 *
 *   · HALLAZGO 3 (🔴 LFPDPPP) — una cancelación ARCO anonimizaba al paciente y
 *     lo archivaba, pero NO tocaba `portalToken` / `portalTokenExpiry`, y el GET
 *     del portal no miraba `deletedAt`. El enlace del paciente que pidió su baja
 *     seguía vivo hasta 30 días sirviendo dob, gender, bloodType, patientNumber
 *     y el historial de citas con doctor. Se cierran LOS DOS lados: que uno
 *     falle no debe bastar para que se abra. Por eso hay un test por lado y uno
 *     que comprueba justo eso — la redundancia.
 *
 *   · HALLAZGO 4 — el portal devolvía `notes: a.notes`, las notas INTERNAS que
 *     el staff escribe sobre la cita. El contrato paciente-safe lo prohíbe por
 *     escrito (src/lib/patient-portal/types.ts) y su gemela con cuenta
 *     (/api/paciente/appointments) lo cumple con un select cerrado.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const TOKEN = "tok_vivo_123";
const CLINICA = "cli_1";

const CLINICA_ROW = {
  name: "Clínica Menta", phone: "555", address: "Reforma 1",
  logoUrl: null, timezone: "America/Mexico_City",
};

function pacienteRow(over: Record<string, any> = {}) {
  return {
    id: "pat_1",
    firstName: "Laura", lastName: "Méndez", patientNumber: "P-0007",
    dob: new Date("1990-04-02T00:00:00Z"), gender: "F", bloodType: "O+",
    phone: "5551234567", email: "laura@example.com",
    allergies: [], chronicConditions: [], currentMedications: [],
    portalToken: TOKEN, portalTokenExpiry: null,
    deletedAt: null, anonymizedAt: null, status: "ACTIVE",
    curp: "CURP123", rfcPaciente: "RFC123", address: "Su casa 1", notes: "paga tarde",
    primaryDoctor: { firstName: "Ana", lastName: "Ruiz", specialty: "Ortodoncia" },
    clinic: CLINICA_ROW,
    appointments: [
      {
        startsAt: new Date("2026-03-01T16:00:00Z"),
        endsAt:   new Date("2026-03-01T17:00:00Z"),
        type: "Limpieza", status: "COMPLETED",
        notes: "paciente moroso, cobrar por adelantado",
        doctor: { firstName: "Ana", lastName: "Ruiz" },
      },
    ],
    ...over,
  };
}

// ── Estado compartido por los dobles ────────────────────────────────────────
let filaPortal: any = pacienteRow();
/** Lo que la ruta ARCO le pidió a Prisma escribir sobre el paciente. */
let updateData: Record<string, any> | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patient: {
        // El portal busca por el token: si el token se anuló, no hay fila.
        findUnique: async ({ where }: any) =>
          filaPortal && filaPortal.portalToken === where.portalToken ? filaPortal : null,
        findFirst: async () => filaPortal,
        update: async ({ data }: any) => {
          updateData = data;
          filaPortal = { ...filaPortal, ...data };
          return filaPortal;
        },
      },
      arcoRequest: {
        create: async () => ({ id: "arco_1" }),
        update: async ({ data }: any) => ({ id: "arco_1", ...data }),
      },
    },
  },
});
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({
      userId: "user_admin", clinicId: CLINICA, role: "ADMIN",
      isAdmin: true, permissionsOverride: [],
    }),
  },
});
mock.module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null },
});
mock.module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });

let ipSeq = 0;
async function nuevaRequest(url: string, init: RequestInit = {}) {
  const { NextRequest } = await import("next/server");
  // IP distinta por llamada: el rate limit real (20/min por IP+ruta) sigue
  // puesto y no es lo que se está probando.
  return new NextRequest(url, {
    ...init,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++ipSeq % 250 + 1}`, ...(init.headers as any) },
  } as any);
}

async function abrirPortal(token = TOKEN) {
  const { GET } = await import("@/app/api/portal/[token]/route");
  const req = await nuevaRequest(`https://dalecontrol.test/api/portal/${token}`);
  const res = await GET(req, { params: { token } });
  return { status: res.status, body: await res.json() };
}

async function cancelarPorArco() {
  const { POST } = await import("@/app/api/arco-request/route");
  const req = await nuevaRequest("https://dalecontrol.test/api/arco-request", {
    method: "POST",
    body: JSON.stringify({
      action: "cancellation",
      patientId: "pat_1",
      reason: "La paciente solicita la baja de sus datos personales por escrito.",
    }),
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

// ── HALLAZGO 4 ──────────────────────────────────────────────────────────────

test("H4 · el portal no devuelve las notas internas de la cita", async () => {
  filaPortal = pacienteRow();
  const { status, body } = await abrirPortal();
  assert.equal(status, 200);
  assert.equal(body.appointments.length, 1);
  assert.equal("notes" in body.appointments[0], false, "`notes` las escribe el staff, no son del paciente");
  assert.equal(JSON.stringify(body).includes("paciente moroso"), false);
});

test("H4 · lo que el paciente SÍ debe ver sigue ahí", async () => {
  // El arreglo es quitar una clave, no vaciar el portal.
  filaPortal = pacienteRow();
  const { body } = await abrirPortal();
  const cita = body.appointments[0];
  assert.deepEqual(Object.keys(cita).sort(), ["date", "doctor", "endTime", "startTime", "status", "type"]);
  assert.equal(cita.type, "Limpieza");
  assert.equal(cita.doctor, "Dr/a. Ana Ruiz");
});

// ── HALLAZGO 3 · lado A: invalidar el token al anonimizar ───────────────────

test("H3a · la cancelación ARCO borra portalToken y portalTokenExpiry", async () => {
  filaPortal = pacienteRow({ portalTokenExpiry: new Date("2026-12-31T00:00:00Z") });
  updateData = null;
  const { status } = await cancelarPorArco();
  assert.equal(status, 201);
  assert.ok(updateData, "la cancelación tiene que escribir sobre el paciente");
  assert.equal(updateData!.portalToken, null);
  assert.equal(updateData!.portalTokenExpiry, null);
  // Y sigue haciendo lo que ya hacía (soft delete + anonimización).
  assert.equal(updateData!.firstName, "[ANONIMIZADO]");
  assert.ok(updateData!.deletedAt instanceof Date);
  assert.ok(updateData!.anonymizedAt instanceof Date);
});

test("H3a · tras la cancelación, el enlace que tenía el paciente ya no abre", async () => {
  filaPortal = pacienteRow();
  await cancelarPorArco();
  const { status, body } = await abrirPortal(TOKEN);
  assert.equal(status, 404);
  assert.equal(body.error, "Enlace inválido");
});

// ── HALLAZGO 3 · lado B: el GET rechaza a un paciente con deletedAt ─────────

test("H3b · el GET rechaza a un paciente dado de baja aunque el token siga vivo", async () => {
  // Este es el caso "falló el otro lado": una baja anterior al arreglo, o
  // cualquier otro camino que ponga deletedAt sin tocar el token.
  filaPortal = pacienteRow({ deletedAt: new Date("2026-02-01T00:00:00Z"), anonymizedAt: new Date() });
  const { status, body } = await abrirPortal();
  assert.equal(status, 404);
  assert.equal(body.error, "Enlace inválido", "mismo texto que un token inexistente: no se confirma que existió");
});

test("H3b · y no se le escapa NADA de lo que servía (dob, gender, bloodType, citas)", async () => {
  filaPortal = pacienteRow({ deletedAt: new Date("2026-02-01T00:00:00Z") });
  const { body } = await abrirPortal();
  const crudo = JSON.stringify(body);
  for (const dato of ["1990-04", "O+", "P-0007", "Limpieza", "Ana", "5551234567"]) {
    assert.equal(crudo.includes(dato), false, `se filtró "${dato}" de un paciente dado de baja`);
  }
});

test("H3 · los dos cierres son independientes: cada uno solo basta", async () => {
  // La redundancia es el punto del hallazgo. Token anulado pero deletedAt sin
  // poner → tampoco abre, porque no hay fila que casar con el token.
  filaPortal = pacienteRow({ portalToken: null, deletedAt: null });
  assert.equal((await abrirPortal()).status, 404);
  // Y al revés: deletedAt puesto pero el token intacto → lo corta el GET.
  filaPortal = pacienteRow({ portalToken: TOKEN, deletedAt: new Date() });
  assert.equal((await abrirPortal()).status, 404);
});

test("H3 · un paciente vivo con enlace vigente sigue entrando", async () => {
  filaPortal = pacienteRow();
  const { status, body } = await abrirPortal();
  assert.equal(status, 200);
  assert.equal(body.patient.patientNumber, "P-0007");
  assert.equal(body.clinic.name, "Clínica Menta");
});
