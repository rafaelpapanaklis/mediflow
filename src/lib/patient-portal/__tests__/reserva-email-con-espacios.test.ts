/**
 * Revisión t12 (dm2) de la auditoría «cloudflare», nº7: `resolveBookingPatient`
 * (la reserva desde el portal con sesión) compara el email como el guard —sin
 * mayúsculas NI espacios—.
 *
 * Run: npm run test:seg-portal-reserva-email
 *   (--experimental-test-module-mocks: se ejecuta de verdad resolveBookingPatient
 *    con Prisma en memoria; los `where` de email se aplican como Postgres:
 *    `equals`/`contains` + `insensitive`, SIN trim.)
 *
 * Con e8b8a02eb un paciente importado con «ana@correo.test » (espacio al final)
 * no encontraba ni su enlace ni su expediente, y la reserva le creaba uno
 * DUPLICADO.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CUENTA = { id: "acc_1", email: "ana@correo.test" };
let pacientes: any[] = [];
let enlaces: any[] = [];
let creados: any[] = [];

beforeEach(() => {
  pacientes = [{ id: "pac_1", clinicId: "cli_1", email: "Ana@Correo.test ", deletedAt: null, createdAt: new Date("2026-01-01") }];
  enlaces = [];
  creados = [];
});

const casaEmail = (valor: string | null, f: any) => {
  if (!f) return true;
  const v = (valor ?? "").toLowerCase();
  if (f.equals !== undefined) return v === String(f.equals).toLowerCase();
  if (f.contains !== undefined) return v.includes(String(f.contains).toLowerCase());
  return true;
};
const conPaciente = (l: any) => ({ ...l, patient: pacientes.find((p) => p.id === l.patientId) ?? null });
const enlacesQue = (where: any) =>
  enlaces.map(conPaciente).filter((l) =>
    l.accountId === where.accountId && l.clinicId === where.clinicId && casaEmail(l.patient?.email, where.patient?.email));
const pacientesQue = (where: any) =>
  pacientes.filter((p) => p.clinicId === where.clinicId && (where.deletedAt !== null || !p.deletedAt) && casaEmail(p.email, where.email));

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patientAccountLink: {
        findFirst: async ({ where }: any) => enlacesQue(where)[0] ?? null,
        findMany: async ({ where }: any) => enlacesQue(where),
        create: async ({ data }: any) => { enlaces.push(data); return data; },
      },
      patient: {
        findFirst: async ({ where }: any) => pacientesQue(where)[0] ?? null,
        findMany: async ({ where }: any) => pacientesQue(where),
      },
      $transaction: async (fn: any) =>
        fn({
          $executeRaw: async () => 1,
          patient: { create: async ({ data }: any) => { creados.push(data); return { id: "pac_nuevo", ...data }; } },
        }),
    },
  },
});
mock.module("@/lib/patients/next-patient-number", {
  namedExports: { nextPatientNumber: async () => "P9999", withPatientNumberRetry: (fn: any) => fn() },
});

const reservar = async () => {
  const { resolveBookingPatient } = await import("@/lib/patient-portal/link");
  return resolveBookingPatient({
    accountId: CUENTA.id, accountEmail: CUENTA.email, clinicId: "cli_1",
    firstName: "Ana", lastName: "García", phone: "5512345678",
  });
};

test("dm2 · con el enlace ya hecho, la reserva usa SU expediente aunque el email guardado traiga espacios", async () => {
  enlaces.push({ accountId: CUENTA.id, patientId: "pac_1", clinicId: "cli_1", createdAt: new Date() });
  const r = await reservar();
  assert.deepEqual(r, { patientId: "pac_1", created: false });
  assert.equal(creados.length, 0, "sin expediente duplicado");
});

test("dm2 · sin enlace, encuentra el expediente por su email (con espacios) y lo liga, sin duplicarlo", async () => {
  const r = await reservar();
  assert.deepEqual(r, { patientId: "pac_1", created: false });
  assert.equal(creados.length, 0);
  assert.deepEqual(enlaces.map((l) => l.patientId), ["pac_1"]);
});

test("dm2 · un expediente cuyo email es OTRO no se adopta (ni con el enlace viejo): se crea uno nuevo", async () => {
  pacientes[0].email = "otra@correo.test";
  enlaces.push({ accountId: CUENTA.id, patientId: "pac_1", clinicId: "cli_1", createdAt: new Date() });
  const r = await reservar();
  assert.deepEqual(r, { patientId: "pac_nuevo", created: true });
});

test("dm2 · un email que solo CONTIENE el de la cuenta tampoco es el suyo", async () => {
  pacientes[0].email = "mariana@correo.test"; // contiene «ana@correo.test»
  const r = await reservar();
  assert.equal(r.created, true);
});
