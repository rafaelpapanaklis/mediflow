/**
 * La nota del expediente de la hoja: se crea/firma con los procedimientos escritos.
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/orthodontics/__tests__/procedimientos-de-hoja-db.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Fila = { id: string; plan: string | null; specialtyData: Record<string, unknown>; subjective: string | null };
let notas: Fila[] = [];
let creaciones = 0;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      procedureCatalog: { findMany: async () => [{ id: "ctl", code: "ORTO_CONTROL" }, { id: "pc", code: null }, { id: "pi", code: null }] },
      medicalRecord: {
        findFirst: async () => {
          const n = notas[0];
          return n ? { id: n.id, specialtyData: n.specialtyData } : null;
        },
        create: async ({ data }: { data: { plan: string; subjective: string; specialtyData: Record<string, unknown> } }) => {
          creaciones++;
          notas.push({ id: `n${creaciones}`, plan: data.plan, subjective: data.subjective, specialtyData: data.specialtyData });
          return { id: `n${creaciones}` };
        },
        update: async ({ data }: { data: { plan: string; subjective: string; specialtyData: Record<string, unknown> } }) => {
          notas[0] = { ...notas[0], plan: data.plan, subjective: data.subjective, specialtyData: data.specialtyData };
        },
      },
    },
  },
});
mock.module("../catalog-procedures", {
  namedExports: {
    listarProcedimientosDeOrtodoncia: async () => [
      { id: "pc", name: "Recementado de bracket", basePrice: 250, orthoIncludedInTreatment: false, isActive: true },
      { id: "pi", name: "Retenedor incluido", basePrice: 0, orthoIncludedInTreatment: true, isActive: true },
      { id: "ctl", name: "Control de ortodoncia", basePrice: 300, orthoIncludedInTreatment: null, isActive: true },
    ],
  },
});

const base = {
  clinicId: "c1", patientId: "p1", planId: "plan", userId: "u1", cardId: "card", cardNumber: 1,
  visitDate: new Date("2026-09-28T18:00:00Z"), appointmentId: null,
  soap: { s: "S", o: "O", a: "A", p: "Seguir con elásticos" },
};

test("borrador con procedimientos: nota en borrador, sin nada por cobrar todavía", async () => {
  notas = []; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  const r = await escribirNotaDeHoja({ ...base, pedidos: [{ procedureId: "pc", quantity: 1 }], firmar: false });
  assert.equal(r.ok, true);
  assert.equal(notas[0].specialtyData.status, "DRAFT");
  assert.equal(notas[0].specialtyData.hayPorCobrar, false, "por cobrar solo desde la firma");
  assert.equal(notas[0].plan, "Seguir con elásticos", "el borrador no escribe la lista en el texto");
});

test("al firmar, la nota queda FIRMADA y lista los procedimientos con nombre y tipo de cobro", async () => {
  notas = []; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  await escribirNotaDeHoja({ ...base, pedidos: [{ procedureId: "pc", quantity: 2 }], firmar: false });
  const r = await escribirNotaDeHoja({ ...base, pedidos: [{ procedureId: "pc", quantity: 2 }, { procedureId: "pi", quantity: 1 }], firmar: true });
  assert.equal(r.ok, true);
  assert.equal(creaciones, 1, "la nota del borrador se firma, no se duplica");
  assert.equal(notas[0].specialtyData.status, "SIGNED");
  assert.equal(notas[0].specialtyData.hayPorCobrar, true);
  assert.match(notas[0].plan ?? "", /Procedimientos de esta visita:\n• Recementado de bracket ×2 — con costo aparte\n• Retenedor incluido — incluido en el tratamiento/);
  assert.match(notas[0].plan ?? "", /^Seguir con elásticos/);
});

test("solo incluidos: la hoja firmada no deja nada por cobrar", async () => {
  notas = []; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  await escribirNotaDeHoja({ ...base, pedidos: [{ procedureId: "pi", quantity: 1 }], firmar: true });
  assert.equal(notas[0].specialtyData.hayPorCobrar, false);
});

test("una nota ya firmada no se reescribe (NOM-004): ni texto ni procedimientos", async () => {
  notas = []; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  await escribirNotaDeHoja({ ...base, pedidos: [{ procedureId: "pi", quantity: 1 }], firmar: true });
  const antes = JSON.stringify(notas[0]);
  const r = await escribirNotaDeHoja({ ...base, soap: { ...base.soap, p: "OTRO PLAN" }, pedidos: [{ procedureId: "pc", quantity: 5 }], firmar: true });
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(notas[0]), antes);
});

test("el control no se puede registrar como procedimiento de la visita", async () => {
  notas = []; creaciones = 0;
  const { escribirNotaDeHoja, validarPedidos } = await import("../procedimientos-de-hoja-db");
  const r = await escribirNotaDeHoja({ ...base, pedidos: [{ procedureId: "ctl", quantity: 1 }], firmar: false });
  assert.equal(r.ok, false);
  assert.equal(notas.length, 0);
  assert.match((await validarPedidos({ clinicId: "c1", cardId: null, pedidos: [{ procedureId: "ctl", quantity: 1 }] })) ?? "", /ya no está disponible/);
});
