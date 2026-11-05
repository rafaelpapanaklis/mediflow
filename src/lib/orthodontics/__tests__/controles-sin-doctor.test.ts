/**
 * ws1-t11 · fase 2 · P1 — un control de ortodoncia «Sin doctor» tampoco está con su tratante.
 * `{ doctorId: { not: X } }` en SQL deja fuera los NULL: hay que pedirlos con OR.
 *
 * Run: npm run test:cita-sin-doctor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../..");
const consultas: any[] = [];
const prismaStub = { appointment: { findMany: async (a: any) => { consultas.push(a); return []; } } };
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  let r: string | null = null;
  try { r = M._resolveFilename(req, parent, isMain); } catch { r = null; }
  if (r === path.join(RAIZ, "src/lib/prisma.ts")) return { prisma: prismaStub };
  return cargaOriginal.call(this, req, parent, isMain);
};

test("controlesConOtroDoctor: pide los de otro doctor Y los «Sin doctor»", async () => {
  const { controlesConOtroDoctor } = await import("../controles-con-otro-doctor-db");
  await controlesConOtroDoctor({ clinicId: "c1", patientId: "p1", treatingDoctorId: "clx9doc0a000108l4aaaa0001" });
  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0].where.OR, [{ doctorId: { not: "clx9doc0a000108l4aaaa0001" } }, { doctorId: null }]);
  assert.equal(consultas[0].where.doctorId, undefined);
});
