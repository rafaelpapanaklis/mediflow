/**
 * La tarjeta de detalles al pasar el mouse (decisión de Rafael, 28-oct-2026) — las DOS rutas, con sus
 * handlers de verdad y `detalles-al-pasar.server.ts` de verdad; dobles de prisma, la sesión, la
 * visibilidad del paciente y `loQueAunNoSeDebe`. ⛔ Sin base.
 *
 * Run: npm run test:agenda-detalles-al-pasar
 *
 *  · GET /api/appointments/[id]/detalles-al-pasar: 401 / 403 sin `agenda.view` / 400 id raro / 404 cita de
 *    otra clínica / paciente restringido; y lo pesado: edad, primera vez o recurrente, teléfono, alergias,
 *    confirmada por WhatsApp, «En esta cita» y «Debe hoy» = saldo − `loQueAunNoSeDebe` (la cifra de
 *    Pacientes). Toda consulta lleva el `clinicId` de la SESIÓN. Lo ve un DOCTOR (no pide `billing.view`).
 *  · /api/agenda/detalles-al-pasar: sin el SQL, encendida y el PUT dice 503 sin escribir; con el SQL, lee la
 *    fila de quien llama y guarda en las filas de la MISMA persona (su `supabaseId`).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const TZ = "America/Mexico_City";

let sesion: any;
let citas: any[];
let respuestas: any[];
let facturas: any[];
let noSeDebe: number;
let filasPlan: any[];
let restringido: boolean;
let columnaExiste: boolean;
let preferencia: boolean | null;
let wheres: Array<{ modelo: string; where: any }>;
let sqls: string[];
let escrito: { sql: string; valores: unknown[] } | null;
let contadas: number;

function usuario(role: string, permissionsOverride: string[] = []) {
  return {
    user: { id: "u1", role, clinicId: "c1", displayName: "QA", permissionsOverride },
    clinic: { id: "c1", name: "Clínica QA", category: "DENTAL", timezone: TZ, schedules: [] },
  };
}

beforeEach(() => {
  sesion = usuario("DOCTOR");
  citas = [
    {
      id: "a-hoy",
      clinicId: "c1",
      patientId: "p1",
      startsAt: new Date("2026-10-28T17:00:00Z"),
      confirmedAt: new Date("2026-10-27T15:00:00Z"),
      patient: { dob: new Date("1990-03-15T00:00:00Z"), phone: " 55 1234 5678 ", allergies: ["Penicilina", " Látex "] },
    },
    { id: "a-otra-clinica", clinicId: "c2", patientId: "p9", startsAt: new Date(), confirmedAt: null, patient: { dob: null, phone: null, allergies: [] } },
  ];
  respuestas = [{ clinicId: "c1", appointmentId: "a-hoy", repliedAt: new Date("2026-10-27T15:00:02Z") }];
  facturas = [
    { id: "f-nota", clinicId: "c1", patientId: "p1", balance: 1500 },
    { id: "f-vieja", clinicId: "c1", patientId: "p1", balance: 200 },
  ];
  noSeDebe = 1000;
  filasPlan = [{ id: "i1", nombre: "Resina", dientes: [16], caras: ["M", "O"], cantidad: 1, precio: "700.00", estado: "pendiente" }];
  restringido = false;
  columnaExiste = false;
  preferencia = null;
  wheres = [];
  sqls = [];
  escrito = null;
  contadas = 0;
  delete (globalThis as any)[Symbol.for("dalecontrol.agenda-nueva.detalles-al-pasar")];
});

const textoDe = (tpl: TemplateStringsArray) => tpl.join("?");

const prismaStub: any = {
  appointment: {
    findFirst: async ({ where, select }: any) => {
      wheres.push({ modelo: "appointment.findFirst", where });
      const c = citas.find((x) => x.id === where.id && x.clinicId === where.clinicId);
      if (!c) return null;
      return select.patient ? c : { id: c.id, patientId: c.patientId };
    },
    count: async ({ where }: any) => {
      wheres.push({ modelo: "appointment.count", where });
      return contadas;
    },
  },
  whatsAppReminder: {
    findMany: async ({ where }: any) => {
      wheres.push({ modelo: "whatsAppReminder.findMany", where });
      return respuestas.filter((r) => r.clinicId === where.clinicId && r.appointmentId === where.appointmentId);
    },
  },
  invoice: {
    findMany: async ({ where }: any) => {
      wheres.push({ modelo: "invoice.findMany", where });
      return facturas.filter((f) => f.clinicId === where.clinicId && f.patientId === where.patientId);
    },
  },
  $queryRaw: async (tpl: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = textoDe(tpl);
    sqls.push(sql);
    if (sql.includes("information_schema.columns")) return [{ existe: columnaExiste }];
    if (sql.includes('"agendaDetallesAlPasar" AS valor')) {
      assert.deepEqual(valores, ["u1", "c1"], "la fila de quien llama, en su clínica");
      return preferencia === null ? [] : [{ valor: preferencia }];
    }
    if (sql.includes("treatment_plan_items")) {
      assert.equal(valores[0], "c1", "las filas del plan, de la clínica de la sesión");
      return filasPlan;
    }
    throw new Error(`SQL inesperado: ${sql}`);
  },
  $executeRaw: async (tpl: TemplateStringsArray, ...valores: unknown[]) => {
    escrito = { sql: textoDe(tpl), valores };
    return 1;
  },
};

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaStub },
  "@/lib/agenda/api-helpers": {
    loadClinicSession: async () => {
      if (!sesion) {
        const { NextResponse } = await import("next/server");
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      return sesion;
    },
  },
  "@/lib/patient-visibility": {
    assertPatientVisible: async (patientId: string, viewer: any) => {
      assert.equal(viewer.clinicId, "c1");
      assert.equal(patientId, "p1");
      return restringido ? new Response(JSON.stringify({ error: "Paciente restringido" }), { status: 403 }) : null;
    },
  },
  "@/lib/dinero/lo-que-se-debe.server": {
    loQueAunNoSeDebe: async (clinicId: string, o: any) => {
      assert.equal(clinicId, "c1");
      assert.deepEqual(o.ids.sort(), ["f-nota", "f-vieja"], "solo las facturas de ESTE paciente");
      return { porFactura: { "f-nota": noSeDebe }, porHacer: noSeDebe, porVencer: 0, porVencerCuotas: 0, total: noSeDebe };
    },
  },
  "@/lib/treatments/items-db": { tablaDeFilasExiste: async () => true },
  "@/lib/treatments/citas-del-plan-db": { citasDelPlanDisponible: async () => true },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function pedir(id: string) {
  const { GET } = await import("@/app/api/appointments/[id]/detalles-al-pasar/route");
  const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

test("lo pesado de la cita: edad, recurrente, teléfono, alergias, por WhatsApp, «En esta cita» y «Debe hoy» — y lo ve un DOCTOR", async () => {
  contadas = 3;
  const r = await pedir("a-hoy");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.paciente.edad, 36);
  assert.equal(r.body.paciente.primeraVez, false);
  assert.equal(r.body.paciente.telefono, "55 1234 5678");
  assert.deepEqual(r.body.alergias, ["Penicilina", "Látex"]);
  assert.equal(r.body.confirmadaPorWhatsapp, true);
  assert.deepEqual(r.body.enEstaCita, [{ id: "i1", nombre: "Resina 16 (MO)", importe: 700, estado: "pendiente" }]);
  // La cifra de Pacientes: saldo por cobrar (1500 + 200) − lo que aún no se debe (1000).
  assert.equal(r.body.debeHoy, 700);
  for (const w of wheres) assert.equal(w.where.clinicId, "c1", `${w.modelo} sin el clinicId de la sesión`);
  const cuenta = wheres.find((w) => w.modelo === "appointment.count")!.where;
  assert.deepEqual(cuenta.status, { notIn: ["CANCELLED", "NO_SHOW"] }, "canceladas y plantones no son «visitas»");
  assert.equal(cuenta.patientId, "p1");
  const deuda = wheres.find((w) => w.modelo === "invoice.findMany")!.where;
  assert.deepEqual(deuda.status, { notIn: ["DRAFT", "CANCELLED"] }, "por cobrar = receivableInvoiceWhere");
  assert.deepEqual(deuda.balance, { gt: 0 });
});

test("primera vez: sin ninguna cita anterior que cuente", async () => {
  contadas = 0;
  respuestas = [];
  const r = await pedir("a-hoy");
  assert.equal(r.body.paciente.primeraVez, true);
  assert.equal(r.body.confirmadaPorWhatsapp, false, "confirmada a mano: sin respuesta al recordatorio");
});

test("nada de dinero que no se debe: «Debe hoy» nunca sale negativo", async () => {
  noSeDebe = 5000;
  const r = await pedir("a-hoy");
  assert.equal(r.body.debeHoy, 0);
});

test("si «En esta cita» falla, lo demás se pinta igual", async () => {
  filasPlan = null as any; // `.map` de null revienta dentro de la pieza
  const r = await pedir("a-hoy");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.enEstaCita, []);
  assert.deepEqual(r.body.alergias, ["Penicilina", "Látex"]);
});

test("puertas: 401 sin sesión, 403 sin agenda.view, 400 id raro, 404 cita de OTRA clínica, 403 paciente restringido", async () => {
  sesion = null;
  assert.equal((await pedir("a-hoy")).status, 401);
  sesion = usuario("RECEPTIONIST", ["patients.view"]);
  assert.equal((await pedir("a-hoy")).status, 403);
  sesion = usuario("RECEPTIONIST");
  assert.equal((await pedir("x'; drop")).status, 400);
  assert.equal((await pedir("a-otra-clinica")).status, 404, "la cita existe, pero en otra clínica");
  restringido = true;
  const r = await pedir("a-hoy");
  assert.equal(r.status, 403);
  assert.equal(r.body.alergias, undefined, "nada del paciente");
});

async function preferenciaGet() {
  const { GET } = await import("@/app/api/agenda/detalles-al-pasar/route");
  const res = await GET();
  return { status: res.status, body: await res.json() };
}
async function preferenciaPut(cuerpo: unknown) {
  const { PUT } = await import("@/app/api/agenda/detalles-al-pasar/route");
  const res = await PUT({ json: async () => cuerpo } as any);
  return { status: res.status, body: await res.json() };
}

test("preferencia SIN el SQL: encendida para todos, sin tocar la columna; el PUT dice 503 y no escribe", async () => {
  columnaExiste = false;
  assert.deepEqual((await preferenciaGet()).body, { encendida: true });
  assert.equal(sqls.filter((s) => s.includes('"agendaDetallesAlPasar" AS valor')).length, 0, "ni una consulta a la columna");
  const r = await preferenciaPut({ encendida: false });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "SQL_PENDIENTE");
  assert.equal(escrito, null);
  // La sonda se recuerda: diez lecturas = una sola pregunta a information_schema.
  sqls = [];
  delete (globalThis as any)[Symbol.for("dalecontrol.agenda-nueva.detalles-al-pasar")];
  for (let i = 0; i < 10; i++) await preferenciaGet();
  assert.equal(sqls.filter((s) => s.includes("information_schema")).length, 1);
});

test("preferencia CON el SQL: lee la de quien llama (sin fila = encendida) y guarda en las filas de la MISMA persona", async () => {
  columnaExiste = true;
  preferencia = null;
  assert.deepEqual((await preferenciaGet()).body, { encendida: true });
  preferencia = false;
  assert.deepEqual((await preferenciaGet()).body, { encendida: false });
  const r = await preferenciaPut({ encendida: false });
  assert.equal(r.status, 200);
  assert.ok(escrito, "escribió");
  assert.match(escrito!.sql, /UPDATE "users" SET "agendaDetallesAlPasar" = \?/);
  assert.match(escrito!.sql, /WHERE "supabaseId" = \(SELECT "supabaseId" FROM "users" WHERE "id" = \? AND "clinicId" = \?\)/);
  assert.deepEqual(escrito!.valores, [false, "u1", "c1"], "la persona sale de la SESIÓN, nunca del cuerpo");
  assert.equal((await preferenciaPut({ encendida: "no" })).status, 400);
  assert.equal((await preferenciaPut({ encendida: true, userId: "otro" })).status, 200);
  assert.deepEqual(escrito!.valores, [true, "u1", "c1"], "un userId en el cuerpo no cambia a quién se le guarda");
  sesion = usuario("RECEPTIONIST", ["patients.view"]);
  assert.equal((await preferenciaPut({ encendida: true })).status, 403);
});
