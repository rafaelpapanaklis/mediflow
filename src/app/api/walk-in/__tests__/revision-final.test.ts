/**
 * FILA DE WALK-IN — fallos 1, 3, 5 y 6 de la revisión final (ws1-t4, 2-oct-2026).
 *
 * Run: npm run test:walk-in-revision-final
 *
 *   1. Agregar a la fila deja ELEGIR un paciente que ya existe (no se duplica el expediente al «Iniciar»).
 *   3. «Completar»/«Cancelar» de la fila cierran también la cita que creó «Iniciar».
 *   5. Asignar o iniciar con alguien que no recibe citas dice el MOTIVO (recepción, inactiva…), no «ya no está».
 *   6. La tarjeta de Hoy dice a quién se asignó y enlaza a la Fila de espera.
 *
 * Con el código viejo ninguna pasa: la fila solo cambiaba su estado, el 404 era la frase genérica y la pantalla
 * mandaba solo nombre y servicio.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ctx: any = { userId: "u1", clinicId: "c1", role: "RECEPTIONIST", permissionsOverride: [] };
const INICIO = new Date("2026-10-02T15:00:00.000Z");
let fila: any;
let citas: any[];
let ligada: string | null;
let invitaciones: string[];
let recordatoriosCancelados: any[];
let usuarios: any[];

beforeEach(() => {
  fila = { id: "w1", clinicId: "c1", patientId: "p1", patientName: "Ana López", service: "Dolor", status: "IN_PROGRESS", assignedTo: "doc1", startedAt: INICIO, completedAt: null };
  citas = [
    { id: "cita-otra", clinicId: "c1", patientId: "p1", status: "SCHEDULED", startedAt: null },
    { id: "cita-fila", clinicId: "c1", patientId: "p1", status: "IN_PROGRESS", startedAt: new Date(INICIO) },
    { id: "cita-ajena", clinicId: "c2", patientId: "p1", status: "IN_PROGRESS", startedAt: new Date(INICIO) },
  ];
  ligada = null;
  invitaciones = [];
  recordatoriosCancelados = [];
  usuarios = [
    { id: "doc1", clinicId: "c1", role: "DOCTOR", isActive: true, agendaActive: true },
    { id: "recep1", clinicId: "c1", role: "RECEPTIONIST", isActive: true, agendaActive: true },
    { id: "baja1", clinicId: "c1", role: "DOCTOR", isActive: false, agendaActive: true },
  ];
  ctx.permissionsOverride = [];
});

const cumple = (u: any, where: any) =>
  Object.entries(where).every(([k, v]: [string, any]) =>
    v && typeof v === "object" && Array.isArray(v.in) ? v.in.includes(u[k]) : u[k] === v,
  );

const tx: any = {
  $queryRaw: async () => [{ appointmentId: ligada }],
  walkInQueue: {
    updateMany: async (a: any) => {
      assert.equal(a.where.clinicId, "c1");
      if (a.where.id !== fila.id || (a.where.status && !a.where.status.in.includes(fila.status))) return { count: 0 };
      Object.assign(fila, a.data);
      return { count: 1 };
    },
  },
  appointment: {
    findFirst: async (a: any) => {
      assert.ok(a.where.clinicId, "toda lectura de citas lleva clínica");
      const c = citas.find((x) =>
        x.clinicId === a.where.clinicId &&
        (a.where.id === undefined || x.id === a.where.id) &&
        (a.where.patientId === undefined || x.patientId === a.where.patientId) &&
        (a.where.startedAt === undefined || (x.startedAt && x.startedAt.getTime() === a.where.startedAt.getTime())),
      );
      return c ? { id: c.id } : null;
    },
    updateMany: async (a: any) => {
      assert.equal(a.where.clinicId, "c1");
      const c = citas.find((x) => x.id === a.where.id && x.clinicId === a.where.clinicId && a.where.status.in.includes(x.status));
      if (!c) return { count: 0 };
      Object.assign(c, a.data);
      return { count: 1 };
    },
  },
};

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ctx } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async (id: string) => { invitaciones.push(id); } } });
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: { cancelPendingRemindersForAppointment: async (_tx: any, a: any) => { recordatoriosCancelados.push(a); return 0; } },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, ensureUserCanSeePatient: async () => null },
});
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $transaction: async (fn: any) => {
        const respaldo = { fila: { ...fila }, citas: citas.map((c) => ({ ...c })) };
        try { return await fn(tx); } catch (e) { fila = respaldo.fila; citas = respaldo.citas; throw e; }
      },
      user: {
        findFirst: async (a: any) => {
          const u = usuarios.find((x) => cumple(x, a.where));
          return u ? { id: u.id, role: u.role, isActive: u.isActive, agendaActive: u.agendaActive } : null;
        },
      },
      clinic: { findFirst: async () => ({ category: "DENTAL", defaultSlotMinutes: 20 }) },
      walkInQueue: {
        findFirst: async (a: any) => (a.where.id === fila.id && a.where.clinicId === fila.clinicId ? { ...fila } : null),
        updateMany: tx.walkInQueue.updateMany,
      },
    },
  },
});

const req = (body?: any) => ({ json: async () => body }) as any;
const idp = { params: { id: "w1" } };
const cita = (id: string) => citas.find((c) => c.id === id);

// ── 3. Completar / Cancelar arrastran la cita ───────────────────────────────

test("«Completar» cierra la fila Y su cita (la del mismo paciente con el mismo inicio), con invitación a reseña", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  const r = await PATCH(req({ action: "complete" }), idp);
  assert.equal(r.status, 200);
  assert.equal(fila.status, "COMPLETED");
  assert.equal(cita("cita-fila").status, "COMPLETED");
  assert.ok(cita("cita-fila").completedAt instanceof Date);
  assert.equal(cita("cita-otra").status, "SCHEDULED", "la cita futura del paciente no se toca");
  assert.equal(cita("cita-ajena").status, "IN_PROGRESS", "otra clínica no se toca");
  assert.deepEqual(invitaciones, ["cita-fila"]);
});

test("con la liga de la columna appointmentId se usa ESA cita", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  ligada = "cita-otra";
  cita("cita-otra").status = "IN_PROGRESS";
  assert.equal((await PATCH(req({ action: "complete" }), idp)).status, 200);
  assert.equal(cita("cita-otra").status, "COMPLETED");
  assert.equal(cita("cita-fila").status, "IN_PROGRESS");
});

test("«Cancelar» una fila en atención cancela su cita con motivo, sin WhatsApp y cancelando recordatorios", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  const r = await PATCH(req({ action: "cancel" }), idp);
  assert.equal(r.status, 200);
  assert.equal(fila.status, "CANCELLED");
  const c = cita("cita-fila");
  assert.equal(c.status, "CANCELLED");
  assert.ok(c.cancelledAt instanceof Date);
  assert.match(c.cancelReason, /fila de espera/i);
  assert.equal(recordatoriosCancelados.length, 1);
  assert.equal(recordatoriosCancelados[0].appointmentId, "cita-fila");
  assert.equal(invitaciones.length, 0);
  const src = readFileSync(join(process.cwd(), "src/lib/walk-in/cerrar-con-cita.ts"), "utf8");
  assert.doesNotMatch(src, /avisarCitaPorWhatsApp|@\/lib\/whatsapp/);
});

test("cancelar una fila que ya es cita pide también agenda.delete (como cancelar una cita); sin él nada cambia", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  ctx.permissionsOverride = ["agenda.view", "agenda.edit"];
  const r = await PATCH(req({ action: "cancel" }), idp);
  assert.equal(r.status, 403);
  assert.equal(fila.status, "IN_PROGRESS");
  assert.equal(cita("cita-fila").status, "IN_PROGRESS");
});

test("si la cita ya se cerró por la Agenda, la fila se cierra y la cita no se toca", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  cita("cita-fila").status = "COMPLETED";
  assert.equal((await PATCH(req({ action: "cancel" }), idp)).status, 200);
  assert.equal(fila.status, "CANCELLED");
  assert.equal(cita("cita-fila").status, "COMPLETED");
  assert.equal(recordatoriosCancelados.length, 0);
});

test("cancelar una fila que aún espera no toca citas; transición imposible: 409 sin escribir", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  fila.status = "WAITING"; fila.startedAt = null;
  assert.equal((await PATCH(req({ action: "cancel" }), idp)).status, 200);
  assert.ok(citas.every((c) => c.status !== "CANCELLED"));
  assert.equal((await PATCH(req({ action: "complete" }), idp)).status, 409);
  assert.equal(fila.status, "CANCELLED");
});

// ── 5. El motivo correcto ────────────────────────────────────────────────────

test("asignar a recepción dice que su rol no atiende; a una cuenta inactiva, que está inactiva", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  fila.status = "WAITING";
  let j = await (await PATCH(req({ action: "assign", assignedTo: "recep1" }), idp)).json();
  assert.equal(j.error, "doctor_not_found");
  assert.equal(j.motivo, "rol");
  assert.match(j.reason, /Recepción/);
  assert.doesNotMatch(j.reason, /ya no está en la clínica/);
  j = await (await PATCH(req({ action: "start", assignedTo: "baja1" }), idp)).json();
  assert.equal(j.motivo, "inactivo");
  assert.match(j.reason, /inactiva/);
  assert.equal(fila.status, "WAITING");
});

// ── 1. Paciente existente ────────────────────────────────────────────────────

test("pura: mismo nombre sin acentos ni mayúsculas → preguntar; elegido → ligado; «es nuevo» → nuevo", async () => {
  const m = await import("@/lib/walk-in/paciente-de-la-fila");
  const encontrados = [{ id: "p1", name: "José Pérez", phone: "555" }, { id: "p2", name: "José Pérez Ruiz", phone: null }];
  assert.deepEqual(m.conElMismoNombre("  jose   PEREZ ", encontrados).map((p) => p.id), ["p1"]);
  assert.equal(m.decidirAlAgregar({ patientName: "Jose Perez", patientId: null, encontrados }), "preguntar");
  assert.equal(m.decidirAlAgregar({ patientName: "Jose Perez", patientId: null, encontrados, comoNuevo: true }), "nuevo");
  assert.equal(m.decidirAlAgregar({ patientName: "Jose", patientId: null, encontrados }), "nuevo");
  assert.equal(m.decidirAlAgregar({ patientName: "Jose Perez", patientId: "p1", encontrados }), "ligado");
  assert.deepEqual(m.cuerpoAlAgregar({ patientName: " Ana ", service: " Dolor ", patientId: "p9" }), { patientName: "Ana", service: "Dolor", patientId: "p9" });
  assert.deepEqual(m.cuerpoAlAgregar({ patientName: "Ana", service: "Dolor", patientId: null }), { patientName: "Ana", service: "Dolor" });
});

test("la pantalla busca pacientes al escribir el nombre y manda el patientId elegido; las dos vistas lo ofrecen", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const cliente = leer("src/app/dashboard/walk-in/walk-in-client.tsx");
  assert.match(cliente, /\/api\/patients\/search\?q=/);
  assert.match(cliente, /JSON\.stringify\(cuerpoAlAgregar\(form\)\)/);
  assert.match(cliente, /decidirAlAgregar\(/);
  assert.match(cliente, /<SugerenciasPacienteSimple paciente=\{paciente\} \/>/);
  assert.match(cliente, /paciente=\{paciente\}/);
  const rediseno = leer("src/components/dashboard/piezas-rediseno/fila-espera.tsx");
  assert.match(rediseno, /paciente\.elegir\(p\)/);
  assert.match(rediseno, /paciente\.cambiarNombre\(e\.target\.value\)/);
  // Con el selector de profesional abierto no salen dos «Cancelar» pegados.
  assert.match(rediseno, /asignandoId !== item\.id && item\.status !== "COMPLETED"/);
  assert.match(cliente, /asignandoId !== item\.id && item\.status !== "COMPLETED"/);
});

test("«Iniciar» con la fila ligada a un paciente lo reutiliza: no da de alta otro", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/walk-in/iniciar-consulta.ts"), "utf8");
  assert.match(src, /let pacienteId = entry\.patientId;/);
  assert.match(src, /if \(!pacienteId\) \{/);
});

// ── 6. Tarjeta de Hoy ────────────────────────────────────────────────────────

test("Hoy: la API da el nombre de quien atiende (con el tenant) y las dos tarjetas lo pintan y enlazan a la fila", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const api = leer("src/app/api/dashboard/home/receptionist/route.ts");
  assert.match(api, /where: \{ id: \{ in: asignados \}, clinicId: session\.clinic\.id \}/);
  assert.match(api, /assignedToName:/);
  for (const p of ["src/components/dashboard/hoy-rediseno/hoy-recepcion.tsx", "src/components/dashboard/home/parts/waitlist-card.tsx"]) {
    const src = leer(p);
    assert.match(src, /home\.waitlist\.assignedTo/, p);
    assert.match(src, /href="\/dashboard\/walk-in"/, p);
    assert.match(src, /home\.waitlist\.viewQueue/, p);
  }
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  for (const d of [es, en]) {
    assert.ok(d.home.waitlist.assignedTo.includes("{name}"));
    assert.ok(d.home.waitlist.viewQueue);
    for (const k of ["patientLinked", "patientUnlink", "existingPatients", "sameNameQuestion", "addAsNew"]) assert.ok(d.pages.walkIn[k], k);
  }
});
