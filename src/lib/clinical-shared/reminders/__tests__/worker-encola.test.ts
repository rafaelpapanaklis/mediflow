/**
 * H-4 · El cron `clinical-reminders` corría a diario y no encolaba nada.
 *
 * Este test cruza el ENCOLADOR (worker.ts) con el `renderMessage` REAL de la
 * cola, que es justo el hueco por el que se coló el fallo: cada mitad tenía sus
 * tests en verde y nadie comprobaba que lo que una escribe la otra lo sepa leer.
 *
 * La base se sustituye por un doble en memoria a través del singleton
 * `globalThis.prisma` (src/lib/prisma.ts lo reutiliza si existe). No se toca
 * ninguna base, no se manda ningún mensaje.
 *
 * Corre con: npm run test:clinical-reminders
 */
import test from "node:test";
import assert from "node:assert/strict";

const AHORA = new Date("2026-09-17T12:00:00.000Z");
const DIA = 24 * 3600 * 1000;

interface Fila {
  id: string;
  reminderType: string;
  dueDate: Date;
  status: string;
  deletedAt: Date | null;
  payload: unknown;
  patient: { firstName: string; phone: string | null; deletedAt: Date | null };
  clinic: { id: string; name: string; waConnected: boolean };
  whatsappReminderId?: string;
}

function fila(p: Partial<Fila> & { id: string; reminderType: string; dueDate: Date }): Fila {
  return {
    status: "pending",
    deletedAt: null,
    payload: null,
    patient: { firstName: "Lucía", phone: "+5215511112222", deletedAt: null },
    clinic: { id: "c1", name: "Clínica Demo", waConnected: true },
    ...p,
  };
}

/** Doble de Prisma: solo lo que usa el encolador, respetando sus filtros. */
function dobleDeBase(filas: Fila[]) {
  const encolados: any[] = [];
  const casa = (f: Fila, where: any): boolean => {
    if (where.status && f.status !== where.status) return false;
    if (where.deletedAt === null && f.deletedAt !== null) return false;
    if (where.reminderType?.in && !where.reminderType.in.includes(f.reminderType)) return false;
    if (where.reminderType?.notIn && where.reminderType.notIn.includes(f.reminderType)) return false;
    if (where.dueDate?.gte && f.dueDate < where.dueDate.gte) return false;
    if (where.dueDate?.lte && f.dueDate > where.dueDate.lte) return false;
    if (where.dueDate?.lt && !(f.dueDate < where.dueDate.lt)) return false;
    if (where.clinic?.waConnected === true && !f.clinic.waConnected) return false;
    if (where.OR && !where.OR.some((w: any) => casa(f, w))) return false;
    return true;
  };
  const tx = {
    whatsAppReminder: {
      create: async ({ data }: any) => {
        const row = { id: `wa${encolados.length + 1}`, ...data };
        encolados.push(row);
        return row;
      },
    },
    clinicalReminder: {
      update: async ({ where, data }: any) => {
        Object.assign(filas.find((f) => f.id === where.id)!, data);
      },
    },
  };
  const db = {
    clinicalReminder: {
      findMany: async ({ where, take }: any) =>
        filas
          .filter((f) => casa(f, where))
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
          .slice(0, take),
      count: async ({ where }: any) => filas.filter((f) => casa(f, where)).length,
      update: tx.clinicalReminder.update,
    },
    whatsAppReminder: tx.whatsAppReminder,
    $transaction: async (fn: any) => fn(tx),
  };
  return { db, encolados };
}

// El módulo del encolador captura `prisma` UNA vez al importarse, así que el
// singleton es una fachada estable que delega en el doble del test en curso.
let actual: ReturnType<typeof dobleDeBase>["db"];
(globalThis as any).prisma = {
  clinicalReminder: {
    findMany: (a: any) => actual.clinicalReminder.findMany(a),
    count: (a: any) => actual.clinicalReminder.count(a),
    update: (a: any) => actual.clinicalReminder.update(a),
  },
  whatsAppReminder: { create: (a: any) => actual.whatsAppReminder.create(a) },
  $transaction: (fn: any) => actual.$transaction(fn),
};

async function correr(filas: Fila[]) {
  const { db, encolados } = dobleDeBase(filas);
  actual = db;
  const { processClinicalReminders } = await import("../worker");
  const resumen = await processClinicalReminders({ now: AHORA });
  return { resumen, encolados };
}

async function textoParaElPaciente(wa: any): Promise<string | null> {
  const { renderMessage } = await import("@/lib/whatsapp/queue-worker");
  return renderMessage({
    rawMessage: wa.message,
    payload: wa.payload ?? null,
    patient: { firstName: "Lucía", lastName: "Pérez", phone: wa.patientPhone },
    clinic: { id: "c1", name: "Clínica Demo", timezone: "America/Mexico_City", waPhoneNumberId: "x", waAccessToken: "x" },
    appointmentStartsAt: null,
    doctorName: null,
  });
}

test("H-4 · un recall de periodoncia que vence mañana SE ENCOLA (antes: enqueued = 0 para siempre)", async () => {
  const filas = [fila({ id: "r1", reminderType: "perio_maintenance_4m", dueDate: new Date(AHORA.getTime() + DIA) })];
  const { resumen, encolados } = await correr(filas);
  assert.equal(resumen.enqueued, 1);
  assert.equal(encolados.length, 1);
  assert.equal(filas[0].status, "sent");
  assert.equal(filas[0].whatsappReminderId, "wa1");
  assert.equal(encolados[0].scheduledFor.getTime(), filas[0].dueDate.getTime(), "sale en su fecha, no hoy");
  assert.equal(encolados[0].payload.sourceClinicalReminderId, "r1");
});

test("H-4 · lo encolado lo sabe leer la cola: el paciente recibe TEXTO, no una clave", async () => {
  for (const [tipo, meses] of [["perio_maintenance_3m", 3], ["perio_maintenance_4m", 4], ["perio_maintenance_6m", 6]] as const) {
    const { encolados } = await correr([fila({ id: "r", reminderType: tipo, dueDate: AHORA })]);
    assert.equal(encolados.length, 1, tipo);
    const texto = await textoParaElPaciente(encolados[0]);
    assert.ok(texto, `${tipo}: la cola lo daría por fallido`);
    assert.match(texto!, /Hola Lucía/);
    assert.match(texto!, new RegExp(`cada ${meses} meses`));
    assert.match(texto!, /Clínica Demo/);
    assert.doesNotMatch(texto!, /PERIO_|::|\{\w+\}|_REMINDER_/, "nada de claves ni llaves sin sustituir");
  }
});

test("H-4 · el ATRASO de meses no sale de golpe: vencido hace más de 7 días no se encola y sigue pending", async () => {
  const filas = [
    fila({ id: "viejo", reminderType: "perio_maintenance_6m", dueDate: new Date(AHORA.getTime() - 90 * DIA) }),
    fila({ id: "reciente", reminderType: "perio_maintenance_6m", dueDate: new Date(AHORA.getTime() - 3 * DIA) }),
    fila({ id: "lejano", reminderType: "perio_maintenance_6m", dueDate: new Date(AHORA.getTime() + 30 * DIA) }),
  ];
  const { resumen, encolados } = await correr(filas);
  assert.deepEqual(encolados.map((e) => e.payload.sourceClinicalReminderId), ["reciente"]);
  assert.equal(filas[0].status, "pending", "el viejo NO se marca sent sin haber salido");
  assert.equal(filas[2].status, "pending");
  assert.equal(resumen.unsupported, 1, "y el atraso queda contado, a la vista");
});

test("H-6 no se detona: lo que la cola NO sabe renderizar no se encola ni se marca sent", async () => {
  const filas = [
    fila({ id: "ped", reminderType: "ped_profilaxis_6m", dueDate: AHORA }),
    fila({ id: "orto", reminderType: "other", dueDate: AHORA, payload: { subtype: "ortho_aligner_change_2w" } }),
    fila({ id: "imp", reminderType: "implant_cicatrizacion_7d", dueDate: AHORA }),
  ];
  const { resumen, encolados } = await correr(filas);
  assert.equal(encolados.length, 0, "antes: PED_REMINDER_ped_profilaxis_6m::id salía EN CRUDO al tutor");
  assert.ok(filas.every((f) => f.status === "pending"));
  assert.equal(resumen.unsupported, 3);
});

test("no se encola a clínicas sin WhatsApp conectado, ni a pacientes sin teléfono o borrados", async () => {
  const filas = [
    fila({ id: "a", reminderType: "perio_maintenance_3m", dueDate: AHORA, clinic: { id: "c2", name: "Otra", waConnected: false } }),
    fila({ id: "b", reminderType: "perio_maintenance_3m", dueDate: AHORA, patient: { firstName: "X", phone: null, deletedAt: null } }),
    fila({ id: "c", reminderType: "perio_maintenance_3m", dueDate: AHORA, patient: { firstName: "X", phone: "+52", deletedAt: new Date() } }),
  ];
  const { encolados } = await correr(filas);
  assert.equal(encolados.length, 0);
});

test("una fila que no se puede encolar NO tapona el lote (antes: 200 saltadas bloqueaban todo)", async () => {
  const filas: Fila[] = [];
  for (let i = 0; i < 250; i++) {
    filas.push(fila({ id: `imp${i}`, reminderType: "implant_control_anual", dueDate: new Date(AHORA.getTime() - 2 * DIA) }));
  }
  filas.push(fila({ id: "perio", reminderType: "perio_maintenance_6m", dueDate: AHORA }));
  const { encolados } = await correr(filas);
  assert.deepEqual(encolados.map((e) => e.payload.sourceClinicalReminderId), ["perio"]);
});
