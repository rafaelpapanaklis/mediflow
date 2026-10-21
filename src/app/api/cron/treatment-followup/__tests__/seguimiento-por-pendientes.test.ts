/**
 * SEGUIMIENTO DEL PLAN POR PENDIENTES SIN CITA — ws1-t1 (plan de tratamiento, fase 2 · P8).
 *
 * Run: npm run test:plan-citas
 *
 * Llama al HANDLER REAL de `GET /api/cron/treatment-followup` con prisma y la capa de citas del plan
 * dobladas. ⛔ No sale ningún WhatsApp: el cron solo ENCOLA (whatsapp_reminders) y aquí la cola es
 * un arreglo en memoria. Fija:
 *  · pendiente CON cita viva no avisa; SIN cita sí (pasados 14 días de lo último del plan);
 *  · si el paciente ya tiene otra cita en la clínica, no; ni archivado, ni borrado, ni sin WhatsApp;
 *  · el plan de siempre (sin filas) sigue por `nextExpectedDate`, con la misma guarda de cita;
 *  · `status` no se filtra en el `where` (en la base real es TEXT: 42883), y PAUSED/COMPLETED no avisan;
 *  · plan solo presentado no avisa; tope de 3 avisos por plan; plan viejo vencido hace más de 30
 *    días no avisa (el filtro roto de antes no avisaba a nadie: sin esto, el primer día saldría todo);
 *  · un mensaje por paciente aunque tenga dos planes; dos corridas a la vez no mandan dos;
 *  · reclamo (`lastFollowUpSent`) y encolado en la MISMA transacción; sin CRON_SECRET, nada.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

const DIA = 24 * 60 * 60 * 1000;
const ahora = () => Date.now();
const hace = (d: number) => new Date(ahora() - d * DIA);
const enDias = (d: number) => new Date(ahora() + d * DIA);

let planes: any[];
let filas: Map<string, any[]>;
let citasFuturas: Array<{ clinicId: string; patientId: string }>;
let disponible: boolean;
let encolados: any[];
let marcados: string[];
let transacciones: number;
let wheres: any[];
/** Avisos ya encolados por plan (`payload.planId`). */
let avisosPorPlan: Record<string, number>;

function plan(id: string, extra: any = {}) {
  return {
    id,
    clinicId: "c1",
    patientId: `pac-${id}`,
    name: `Plan ${id}`,
    status: "ACTIVE",
    totalSessions: 4,
    nextExpectedDate: null,
    lastFollowUpSent: null,
    createdAt: hace(60),
    paciente: { firstName: "Ana", phone: "5215550000000", status: "ACTIVE", deletedAt: null },
    clinica: { name: "Clínica QA", phone: "555", waConnected: true, waPhoneNumberId: "pn", waAccessToken: "tok" },
    sesionesHechas: 1,
    ...extra,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "s3creto";
  planes = [];
  filas = new Map();
  citasFuturas = [];
  disponible = true;
  encolados = [];
  marcados = [];
  transacciones = 0;
  wheres = [];
  avisosPorPlan = {};
});

const prismaStub: any = {
  treatmentPlan: {
    findMany: async ({ where, select }: any) => {
      wheres.push(where);
      // La base real: `status` es TEXT y Prisma castea al enum → 42883.
      if (JSON.stringify(where).includes('"status"')) throw Object.assign(new Error("operator does not exist: text = \"TreatmentStatus\""), { code: "42883" });
      if (where.id?.in) {
        return planes
          .filter((p) => where.id.in.includes(p.id))
          .map((p) => ({
            id: p.id,
            clinicId: p.clinicId,
            patient: { ...p.paciente, clinicId: p.pacienteClinicId ?? p.clinicId },
            doctor: { firstName: "Luis", lastName: "Ruiz" },
            clinic: p.clinica,
            sessions: Array.from({ length: p.sesionesHechas }, (_, i) => ({ id: `s${i}` })),
          }));
      }
      assert.ok(select && !select.patient, "el primer barrido no trae relaciones");
      const corte = where.OR[1].lastFollowUpSent.lt.getTime();
      return planes
        .filter((p) => p.lastFollowUpSent == null || p.lastFollowUpSent.getTime() < corte)
        .map(({ paciente: _p, clinica: _c, sesionesHechas: _s, pacienteClinicId: _x, ...resto }) => resto);
    },
  },
  appointment: {
    findMany: async ({ where }: any) =>
      citasFuturas.filter((c) => where.patientId.in.includes(c.patientId)),
  },
  // El tope: cuántos avisos ya llevan `payload.planId` de cada plan.
  $queryRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const s = Prisma.sql(strings, ...vals);
    assert.match(s.text, /whatsapp_reminders/);
    return (s.values as string[]).filter((id) => avisosPorPlan[id]).map((id) => ({ planId: id, n: avisosPorPlan[id] }));
  },
  // Reclamo + encolado, como en Postgres: el UPDATE solo marca lo que sigue sin aviso reciente.
  $transaction: async (fn: any) => {
    transacciones++;
    await Promise.resolve();
    return fn({
      $queryRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => {
        const s = Prisma.sql(strings, ...vals);
        assert.match(s.text, /UPDATE "treatment_plans" SET "lastFollowUpSent"/);
        const [ahoraV, ...resto] = s.values as any[];
        const corte = resto.pop() as Date;
        const ids = resto as string[];
        const reclamados = planes.filter((p) => ids.includes(p.id) && (p.lastFollowUpSent == null || p.lastFollowUpSent < corte));
        for (const p of reclamados) { p.lastFollowUpSent = ahoraV; marcados.push(p.id); }
        return reclamados.map((p) => ({ id: p.id }));
      },
      whatsAppReminder: {
        createMany: async ({ data }: any) => {
          encolados.push(...data);
          return { count: data.length };
        },
      },
    });
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/treatments/citas-del-plan-db", {
  namedExports: {
    citasDelPlanDisponible: async () => disponible,
    filasParaSeguimiento: async (ids: string[]) => {
      const m = new Map<string, any[]>();
      for (const id of ids) if (filas.has(id)) m.set(id, filas.get(id)!);
      return m;
    },
  },
});

async function correr(secreto = "s3creto") {
  const { GET } = await import("@/app/api/cron/treatment-followup/route");
  const res = await GET({ headers: new Headers({ authorization: `Bearer ${secreto}` }) } as any);
  return { status: res.status, body: await res.json() };
}

/** Pendiente de un plan ACEPTADO (ya en su nota de cobro). */
const pendiente = (cita: any = null, invoiceId: string | null = "nota1") => ({ planId: "x", estado: "pendiente", cantidad: 1, hechoEn: null, invoiceId, cita });
const hecha = (dias: number) => ({ planId: "x", estado: "hecho", cantidad: 1, hechoEn: hace(dias), invoiceId: null, cita: null });
const citaViva = () => ({ id: "a1", startsAt: enDias(3), endsAt: new Date(enDias(3).getTime() + 3_600_000), status: "SCHEDULED" });

test("pendiente CON cita viva no avisa; SIN cita sí — y el estado se filtra en JS, no en el where", async () => {
  planes = [plan("con-cita"), plan("sin-cita")];
  filas.set("con-cita", [pendiente(citaViva()), hecha(30)]);
  filas.set("sin-cita", [pendiente(), pendiente({ ...citaViva(), status: "CANCELLED" }), hecha(30)]);
  const r = await correr();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(encolados.length, 1);
  assert.deepEqual(marcados, ["sin-cita"]);
  assert.equal(transacciones, 1, "encolado y marca juntos");
  assert.equal(encolados[0].type, "TREATMENT_FOLLOWUP");
  assert.equal(encolados[0].status, "PENDING", "solo se encola: el envío lo hace la cola, con su ventana de 24 h");
  assert.deepEqual(encolados[0].payload, { planId: "sin-cita" }, "lleva el plan (para el tope)");
  assert.match(encolados[0].message, /1 de 3 procedimientos · 2 restantes/);
  assert.ok(wheres.every((w) => !JSON.stringify(w).includes('"status"')));
});

test("el paciente ya tiene OTRA cita por delante en la clínica → no se le escribe", async () => {
  planes = [plan("p1")];
  filas.set("p1", [pendiente()]);
  citasFuturas = [{ clinicId: "c1", patientId: "pac-p1" }];
  await correr();
  assert.equal(encolados.length, 0);
  assert.equal(marcados.length, 0, "ni se marca: cuando deje de tener cita, se le podrá avisar");
  // Una cita en OTRA clínica no cuenta.
  citasFuturas = [{ clinicId: "c2", patientId: "pac-p1" }];
  await correr();
  assert.equal(encolados.length, 1);
});

test("no por intervalo: plan nuevo (3 días) o con algo hecho ayer espera; avisado hace 3 días, también", async () => {
  planes = [plan("nuevo", { createdAt: hace(3) }), plan("activo"), plan("avisado", { lastFollowUpSent: hace(3) })];
  filas.set("nuevo", [pendiente()]);
  filas.set("activo", [pendiente(), hecha(1)]);
  filas.set("avisado", [pendiente()]);
  await correr();
  assert.equal(encolados.length, 0);
});

test("opt-out de hoy: sin WhatsApp conectado, sin teléfono, archivado o borrado → nada", async () => {
  planes = [
    plan("sin-wa", { clinica: { name: "X", phone: null, waConnected: false, waPhoneNumberId: null, waAccessToken: null } }),
    plan("sin-tel", { paciente: { firstName: "A", phone: null, status: "ACTIVE", deletedAt: null } }),
    plan("archivado", { paciente: { firstName: "A", phone: "52155", status: "ARCHIVED", deletedAt: null } }),
    plan("borrado", { paciente: { firstName: "A", phone: "52155", status: "ACTIVE", deletedAt: hace(1) } }),
    plan("pausado", { status: "PAUSED" }),
    plan("terminado", { status: "COMPLETED" }),
  ];
  for (const p of planes) filas.set(p.id, [pendiente()]);
  const r = await correr();
  assert.equal(encolados.length, 0);
  assert.equal(marcados.length, 0);
  assert.equal(r.body.queued, 0);
});

test("todo hecho o cancelado: no hay a quién recordarle nada", async () => {
  planes = [plan("todo")];
  filas.set("todo", [hecha(40), { ...pendiente(), estado: "cancelado" }]);
  await correr();
  assert.equal(encolados.length, 0);
});

test("plan de siempre (sin filas): por nextExpectedDate como hoy (si se venció hace ≤ 30 días), pero no si ya tiene cita", async () => {
  planes = [
    plan("viejo", { nextExpectedDate: hace(20) }),
    plan("viejo-a-tiempo", { nextExpectedDate: enDias(5) }),
    plan("vencido-hace-meses", { nextExpectedDate: hace(90) }),
  ];
  await correr();
  assert.equal(encolados.length, 1);
  assert.match(encolados[0].message, /1 de 4 sesiones · 3 restantes/);
  assert.deepEqual(marcados, ["viejo"]);

  encolados = [];
  marcados = [];
  citasFuturas = [{ clinicId: "c1", patientId: "pac-viejo" }];
  await correr();
  assert.equal(encolados.length, 0);
});

test("sin el SQL de las citas: todos los planes siguen la regla de siempre", async () => {
  disponible = false;
  planes = [plan("con-filas", { nextExpectedDate: null })];
  filas.set("con-filas", [pendiente()]);
  await correr();
  assert.equal(encolados.length, 0, "sin nextExpectedDate y sin poder leer filas, no se avisa");
});

test("plan solo presentado (nada hecho ni en la nota) no avisa; con 3 avisos ya, tampoco", async () => {
  planes = [plan("presentado"), plan("topado")];
  filas.set("presentado", [pendiente(null, null)]);
  filas.set("topado", [pendiente()]);
  avisosPorPlan = { topado: 3 };
  await correr();
  assert.equal(encolados.length, 0);
  avisosPorPlan = { topado: 2 };
  await correr();
  assert.deepEqual(encolados.map((e) => e.payload.planId), ["topado"]);
});

test("un mensaje por paciente aunque tenga dos planes que tocan (el más reciente); los dos quedan marcados", async () => {
  planes = [plan("a", { patientId: "pac-ana", createdAt: hace(90) }), plan("b", { patientId: "pac-ana", createdAt: hace(40) })];
  filas.set("a", [pendiente()]);
  filas.set("b", [pendiente()]);
  await correr();
  assert.equal(encolados.length, 1);
  assert.equal(encolados[0].payload.planId, "b");
  assert.deepEqual(marcados.sort(), ["a", "b"]);
  await correr();
  assert.equal(encolados.length, 1, "al día siguiente no llega el otro");
});

test("dos corridas a la vez: un solo mensaje (la segunda no reclama nada)", async () => {
  planes = [plan("p1")];
  filas.set("p1", [pendiente()]);
  const [r1, r2] = await Promise.all([correr(), correr()]);
  assert.equal(encolados.length, 1);
  assert.equal(r1.body.queued + r2.body.queued, 1);
});

test("sin CRON_SECRET o con otro secreto: no corre", async () => {
  planes = [plan("p1")];
  filas.set("p1", [pendiente()]);
  assert.equal((await correr("otro")).status, 401);
  delete process.env.CRON_SECRET;
  assert.equal((await correr()).status, 503);
  assert.equal(encolados.length, 0);
});
