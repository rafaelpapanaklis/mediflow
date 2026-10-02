/**
 * ws1-t8 (ticket BEVADENT, punto 3): al firmar la hoja ligada a una cita, la nota de la visita es el borrador
 * que «Pasar a consulta» creó para esa cita — no se crea una segunda nota, y completar la cita ya no encuentra
 * un borrador vacío que exigir.
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/orthodontics/__tests__/una-nota-por-visita.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Fila = {
  id: string;
  patientId: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  specialtyData: Record<string, unknown>;
};
let notas: Fila[] = [];
let creaciones = 0;

type Where = { id?: string; patientId?: string; specialtyData?: { path: string[]; equals: string } };
const coincide = (n: Fila, w: Where) =>
  (!w.id || n.id === w.id) &&
  (!w.patientId || n.patientId === w.patientId) &&
  (!w.specialtyData || n.specialtyData[w.specialtyData.path[0]] === w.specialtyData.equals);

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      procedureCatalog: { findMany: async () => [] },
      medicalRecord: {
        findFirst: async ({ where }: { where: Where }) => notas.find((n) => coincide(n, where)) ?? null,
        findMany: async ({ where }: { where: Where }) => [...notas].reverse().filter((n) => coincide(n, where)),
        create: async ({ data }: { data: Omit<Fila, "id"> }) => {
          creaciones++;
          const fila = { ...data, id: `nueva${creaciones}` } as Fila;
          notas.push(fila);
          return { id: fila.id };
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<Fila> }) => {
          const i = notas.findIndex((n) => n.id === where.id);
          notas[i] = { ...notas[i], ...data };
          return notas[i];
        },
      },
    },
  },
});
mock.module("../catalog-procedures", { namedExports: { listarProcedimientosDeOrtodoncia: async () => [] } });

const borradorDeConsulta = (texto: Partial<Fila> = {}): Fila => ({
  id: "borrador",
  patientId: "p1",
  subjective: null,
  objective: null,
  assessment: null,
  plan: null,
  specialtyData: { status: "DRAFT", appointmentId: "cita1", attachments: [] },
  ...texto,
});

const firma = {
  clinicId: "c1", patientId: "p1", planId: "plan", userId: "dueno", cardId: "hoja1", cardNumber: 4,
  visitDate: new Date("2026-10-02T18:00:00Z"), appointmentId: "cita1",
  soap: { s: "", o: "Higiene buena", a: "", p: "Control en 4 semanas" },
  pedidos: undefined, firmar: true,
};

test("la hoja firmada ADOPTA el borrador vacío de la consulta: una sola nota, firmada y con la hoja", async () => {
  notas = [borradorDeConsulta()]; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  const r = await escribirNotaDeHoja(firma);
  assert.equal(r.ok, true);
  assert.equal(creaciones, 0, "no se crea una segunda nota");
  assert.equal(notas.length, 1);
  assert.equal(r.notaId, "borrador");
  const n = notas[0];
  assert.equal(n.specialtyData.status, "SIGNED");
  assert.equal(n.specialtyData.treatmentCardId, "hoja1");
  assert.equal(n.specialtyData.appointmentId, "cita1");
  assert.deepEqual(n.specialtyData.attachments, [], "lo que ya tenía el borrador se conserva");
  assert.equal(n.plan, "Control en 4 semanas");
});

test("lo que el doctor ya había escrito en la consulta va delante de lo de la hoja", async () => {
  notas = [borradorDeConsulta({ subjective: "Refiere dolor en el 24", plan: "Control en 4 semanas" })]; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  await escribirNotaDeHoja(firma);
  assert.equal(notas[0].subjective, "Refiere dolor en el 24");
  assert.equal(notas[0].objective, "Higiene buena");
  assert.equal(notas[0].plan, "Control en 4 semanas", "sin repetir lo que ya decía igual");
});

test("si la hoja ya tenía su nota-borrador, esa se firma y el de la consulta queda absorbido (no se borra)", async () => {
  notas = [
    borradorDeConsulta({ subjective: "Dolor" }),
    { id: "deHoja", patientId: "p1", subjective: "", objective: "", assessment: "", plan: "", specialtyData: { status: "DRAFT", treatmentCardId: "hoja1", appointmentId: "cita1" } },
  ];
  creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  const r = await escribirNotaDeHoja(firma);
  assert.equal(creaciones, 0);
  assert.equal(r.notaId, "deHoja");
  const deHoja = notas.find((n) => n.id === "deHoja")!;
  const consulta = notas.find((n) => n.id === "borrador")!;
  assert.equal(deHoja.specialtyData.status, "SIGNED");
  assert.equal(deHoja.subjective, "Dolor");
  assert.equal(consulta.specialtyData.absorbidaEnNota, "deHoja");
  assert.equal(consulta.subjective, "Dolor", "el borrador absorbido conserva su texto");
});

test("un borrador ya FIRMADO de esa cita no se toca: la hoja crea la suya (NOM-004)", async () => {
  notas = [borradorDeConsulta({ specialtyData: { status: "SIGNED", appointmentId: "cita1" }, plan: "Nota firmada" })]; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  await escribirNotaDeHoja(firma);
  assert.equal(creaciones, 1);
  assert.equal(notas[0].plan, "Nota firmada");
});

test("sin cita, o guardando borrador de la hoja, no se adopta nada", async () => {
  notas = [borradorDeConsulta()]; creaciones = 0;
  const { escribirNotaDeHoja } = await import("../procedimientos-de-hoja-db");
  await escribirNotaDeHoja({ ...firma, appointmentId: null });
  assert.equal(creaciones, 1);
  assert.equal(notas[0].specialtyData.status, "DRAFT");
  notas = [borradorDeConsulta()]; creaciones = 0;
  await escribirNotaDeHoja({ ...firma, firmar: false });
  assert.equal(creaciones, 1, "el borrador de la hoja no se mezcla con el editor de la consulta mientras ambos siguen abiertos");
});
