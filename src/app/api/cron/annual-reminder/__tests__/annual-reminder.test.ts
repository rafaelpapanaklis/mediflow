/**
 * Ajuste 1 (ws1-t6) — la revisión anual NO escribe a quien no tiene NINGUNA cita:
 * un paciente importado (o capturado sin historial) no tiene «última visita» que
 * medir. Solo recibe el recordatorio quien tiene al menos una cita no cancelada y
 * la última es anterior a recallMonths.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/app/api/cron/annual-reminder/__tests__/annual-reminder.test.ts
 *
 * Se ejecuta el GET REAL del cron. Prisma es un doble en memoria cuyo intérprete de
 * `where` entiende exactamente los operadores que usa la consulta (some / none /
 * not / gte) y LANZA con cualquier otro: un where distinto no da un falso verde.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type Cita = { startsAt: Date; status: string };
interface Pac { id: string; clinicId: string; firstName: string; lastName: string; phone: string | null; status: string; appointments: Cita[] }

const MESES = 30 * 24 * 60 * 60 * 1000;
const hace = (meses: number) => new Date(Date.now() - meses * MESES);
const en = (meses: number) => new Date(Date.now() + meses * MESES);

let pacientes: Pac[] = [];
let recordatorios: any[] = [];

function citaCumple(c: Cita, w: Record<string, any>): boolean {
  for (const [k, cond] of Object.entries(w)) {
    if (k === "status") {
      for (const [op, arg] of Object.entries(cond as Record<string, any>)) {
        if (op !== "not") throw new Error(`operador sin doble en status: ${op}`);
        if (c.status === arg) return false;
      }
    } else if (k === "startsAt") {
      for (const [op, arg] of Object.entries(cond as Record<string, any>)) {
        if (op !== "gte") throw new Error(`operador sin doble en startsAt: ${op}`);
        if (!(c.startsAt >= arg)) return false;
      }
    } else throw new Error(`campo de cita sin doble: ${k}`);
  }
  return true;
}

function pacienteCumple(p: Pac, w: Record<string, any>): boolean {
  for (const [k, cond] of Object.entries(w)) {
    if (cond === undefined) throw new Error(`where.${k} es undefined`);
    if (k === "clinicId" || k === "status") { if ((p as any)[k] !== cond) return false; continue; }
    if (k === "phone") { if (!(cond as any).not === null || p.phone === null) return false; continue; }
    if (k === "appointments") {
      for (const [op, sub] of Object.entries(cond as Record<string, any>)) {
        if (op === "some") { if (!p.appointments.some((c) => citaCumple(c, sub))) return false; }
        else if (op === "none") { if (p.appointments.some((c) => citaCumple(c, sub))) return false; }
        else throw new Error(`operador de relación sin doble: ${op}`);
      }
      continue;
    }
    throw new Error(`campo de paciente sin doble: ${k}`);
  }
  return true;
}

const prismaDoble = {
  clinic: {
    findMany: async () => [{ id: "cli_A", name: "Clínica Sonrisa", recallMonths: 12 }],
  },
  patient: {
    findMany: async ({ where, select }: any) =>
      pacientes.filter((p) => pacienteCumple(p, where)).map((p) => {
        const w = select.appointments?.where;
        const citas = p.appointments.filter((c) => (w ? citaCumple(c, w) : true)).sort((a, b) => +b.startsAt - +a.startsAt).slice(0, select.appointments?.take ?? 99);
        return { ...p, appointments: citas };
      }),
  },
  whatsAppReminder: {
    findMany: async () => [],
    createMany: async ({ data }: any) => { recordatorios.push(...data); return { count: data.length }; },
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });

const pac = (id: string, citas: Cita[], extra: Partial<Pac> = {}): Pac => ({
  id, clinicId: "cli_A", firstName: id, lastName: "X", phone: `55${id.length}${id.charCodeAt(0)}0000000`, status: "ACTIVE", appointments: citas, ...extra,
});

async function correr() {
  process.env.CRON_SECRET = "s";
  const { GET } = await import("../route");
  const res = await GET(new NextRequest("http://localhost/api/cron/annual-reminder", { headers: { authorization: "Bearer s" } }));
  return res.json();
}

test("revisión anual: sin NINGUNA cita (importado) no se escribe; con última visita vieja sí", async () => {
  recordatorios = [];
  pacientes = [
    pac("Importado", []), // sin ninguna cita: importado o capturado sin historial
    pac("SoloCancelada", [{ startsAt: hace(20), status: "CANCELLED" }]), // nunca vino: tampoco hay última visita
    pac("Vieja", [{ startsAt: hace(14), status: "COMPLETED" }]), // 14 meses: sí
    pac("Reciente", [{ startsAt: hace(2), status: "COMPLETED" }]), // 2 meses: no
    pac("ConFutura", [{ startsAt: hace(14), status: "COMPLETED" }, { startsAt: en(1), status: "SCHEDULED" }]), // ya tiene cita: no
    pac("VieaYCanceladaReciente", [{ startsAt: hace(15), status: "COMPLETED" }, { startsAt: hace(1), status: "CANCELLED" }]), // la cancelada no cuenta: sí
    pac("SinTelefono", [{ startsAt: hace(14), status: "COMPLETED" }], { phone: null }),
  ];
  const r = await correr();
  const nombres = recordatorios.map((x) => x.message.match(/^Hola (\w+)/)![1]).sort();
  assert.deepEqual(nombres, ["VieaYCanceladaReciente", "Vieja"]);
  assert.equal(r.queued, 2);
  // El texto habla de una última visita real, nunca «hace tiempo».
  for (const x of recordatorios) assert.ok(!x.message.includes("hace tiempo"), x.message);
});

test("revisión anual: la última visita del mensaje ignora las citas canceladas", async () => {
  recordatorios = [];
  const visita = hace(15);
  pacientes = [pac("Marta", [{ startsAt: visita, status: "COMPLETED" }, { startsAt: hace(13), status: "CANCELLED" }])];
  await correr();
  assert.equal(recordatorios.length, 1);
  const esperado = visita.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  assert.ok(recordatorios[0].message.includes(esperado), recordatorios[0].message);
});

test("revisión anual: una lista entera importada (500 pacientes sin citas) no genera ni un mensaje", async () => {
  recordatorios = [];
  pacientes = Array.from({ length: 500 }, (_, i) => pac(`Imp${i}`, [], { phone: `55000${String(i).padStart(5, "0")}` }));
  const r = await correr();
  assert.equal(r.queued, 0);
  assert.equal(recordatorios.length, 0);
});
