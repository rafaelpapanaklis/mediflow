/**
 * Analítica › Procedimientos con citas «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.7).
 *
 * Run: node_modules/.bin/tsx --test src/app/api/analytics/procedures/__tests__/procedures-sin-doctor.test.ts
 *
 * HANDLER REAL de `GET /api/analytics/procedures` con dobles por Module._load. La ruta armaba el
 * nombre con `a.doctor.firstName`: con una sola cita «Sin doctor» en la ventana respondía 500 y
 * la pantalla entera se quedaba sin datos. Ahora va a la cubeta «Sin doctor»: cuenta en el total
 * del tipo (y en el promedio), y no se nombra como «el más rápido». Con el código de f4d8fe31d
 * fallan las dos pruebas (TypeError en `a.doctor.firstName`).
 *
 * Ids cuid, de siembra y una cita importada de Dentalink (id no uuid).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const CLINICA = "cmclinic0000qa00000000001";
const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra

type Fila = { id: string; type: string; doctorId: string | null; timeline: { totalConsultMin: number }; doctor: { firstName: string; lastName: string } | null };
const renata = { firstName: "Renata", lastName: "Ruiz" };
const mario = { firstName: "Mario", lastName: "López" };
const filas: Fila[] = [
  { id: "cmcita0000000000000000001", type: "Limpieza dental", doctorId: DRA, timeline: { totalConsultMin: 30 }, doctor: renata },
  { id: "cmcita0000000000000000002", type: "Limpieza dental", doctorId: DRA, timeline: { totalConsultMin: 20 }, doctor: renata },
  { id: "seed-appt-3", type: "Limpieza dental", doctorId: DR_SIEMBRA, timeline: { totalConsultMin: 40 }, doctor: mario },
  // «Sin doctor», la más rápida: no puede salir como «el doctor más rápido».
  { id: "dentalink-appt-88231", type: "Limpieza dental", doctorId: null, timeline: { totalConsultMin: 10 }, doctor: null },
  { id: "cmcita0000000000000000005", type: "Extracción", doctorId: null, timeline: { totalConsultMin: 35 }, doctor: null },
];

const prisma = {
  appointment: {
    findMany: async ({ where }: any) => {
      assert.equal(where.clinicId, CLINICA, "las citas se leen con el clinicId de la sesión");
      return filas.map(({ id: _id, ...f }) => f);
    },
  },
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma },
  "@/lib/auth": { getCurrentUser: async () => ({ id: "cmadmin00000000000000001", clinicId: CLINICA, role: "ADMIN" }) },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function procedimientos() {
  const { GET } = await import("@/app/api/analytics/procedures/route");
  const res = await GET({ url: "http://x/api/analytics/procedures" } as any);
  assert.equal(res.status, 200);
  return res.json();
}

test("una cita «Sin doctor» no tumba el reporte: va a la cubeta «Sin doctor» y las cubetas suman el total", async () => {
  const body = await procedimientos();
  assert.equal(body.insufficientData, false);
  const total = body.procedures.reduce((s: number, p: any) => s + p.count, 0);
  assert.equal(total, filas.length, "suma por tipo = citas con tiempo");
  const limpieza = body.procedures.find((p: any) => p.type === "Limpieza dental");
  assert.equal(limpieza.count, 4, "la «Sin doctor» cuenta en el tipo");
  // El detalle por doctor no viaja (la ruta no pide rol): solo el más rápido y el más lento, como siempre.
  assert.equal("porDoctor" in limpieza, false);
  assert.equal(limpieza.avgConsultMin, 25, "el promedio del tipo incluye la «Sin doctor»");
});

test("«más rápido / más lento» comparan doctores: la cubeta «Sin doctor» no se nombra", async () => {
  const body = await procedimientos();
  const limpieza = body.procedures.find((p: any) => p.type === "Limpieza dental");
  assert.equal(limpieza.fastest.name, "Renata Ruiz");
  assert.equal(limpieza.slowest.name, "Mario López");
  const extraccion = body.procedures.find((p: any) => p.type === "Extracción");
  assert.equal(extraccion.count, 1);
  assert.equal(extraccion.fastest, null, "un tipo con solo citas «Sin doctor» no tiene «más rápido»");
  assert.equal(extraccion.slowest, null);
});
