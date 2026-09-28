/**
 * Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t10, H19). Guarda/actualiza
 * el análisis facial de una vista. Cubre: (1) las medidas SIEMPRE se
 * recalculan en el servidor a partir de `points`, nunca se confía en lo
 * que mande el cliente; (2) un registro por caso+vista (upsert), no
 * historial; (3) tolera P2021/P2022 mientras no se pegue el SQL.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npm run test:orto-imagen-facial-analysis
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let upsertCalls: Array<{ where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }> = [];
let auditCalls: Array<Record<string, unknown>> = [];
let throwOnUpsert: { code: string } | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticFacialAnalysis: {
        upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          upsertCalls.push(args);
          if (throwOnUpsert) {
            const e = new Error("boom") as Error & { code: string };
            e.code = throwOnUpsert.code;
            throw e;
          }
          return { id: "fa-saved-1" };
        },
      },
    },
  },
});

mock.module("../_context", {
  namedExports: {
    getOrthoImagingContext: async () => ({
      ok: true,
      data: { ctx: { clinicId: "clinic-1", userId: "u1", role: "DOCTOR" }, treatmentPlanId: "plan-1", patientId: "patient-1" },
    }),
    isMissingRelation: (e: unknown) => (e as { code?: string } | null)?.code === "P2021" || (e as { code?: string } | null)?.code === "P2022",
  },
});

mock.module("../../_helpers", {
  namedExports: {
    auditOrtho: async (args: Record<string, unknown>) => {
      auditCalls.push(args);
    },
  },
});

mock.module("next/cache", {
  namedExports: {
    revalidatePath: () => {},
  },
});

function reset() {
  upsertCalls = [];
  auditCalls = [];
  throwOnUpsert = null;
}

test("recalcula measurements en el servidor a partir de points, no confía en lo que mande el cliente", async () => {
  reset();
  const { saveFacialAnalysis } = await import("../saveFacialAnalysis");
  const points = {
    PRONASALE: { x: 100, y: 100 },
    SOFT_POGONION: { x: 100, y: 300 },
    LABRALE_SUPERIUS: { x: 110, y: 200 },
  };
  const res = await saveFacialAnalysis({ treatmentPlanId: "plan-1", view: "PERFIL", points });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // upperLip está a 10px de la línea E (recta vertical x=100) — recalculado, no un valor inventado.
  assert.equal(Math.abs(res.data.measurements.eLine.upperLipPx!), 10);
  // Y ese mismo número recalculado es lo que se manda a guardar — no el objeto vacío por defecto.
  assert.equal(Math.abs((upsertCalls[0].create.measurements as { eLine: { upperLipPx: number } }).eLine.upperLipPx), 10);
});

test("guarda `points` tal cual (px naturales) y la clave es treatmentPlanId+view, no un id nuevo cada vez", async () => {
  reset();
  const { saveFacialAnalysis } = await import("../saveFacialAnalysis");
  await saveFacialAnalysis({ treatmentPlanId: "plan-1", view: "FRENTE", points: { GLABELLA: { x: 5, y: 5 } } });
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0].where, { treatmentPlanId_view: { treatmentPlanId: "plan-1", view: "FRENTE" } });
  assert.deepEqual(upsertCalls[0].update.points, { GLABELLA: { x: 5, y: 5 } });
});

test("sin calibración, mm sale null y measurements trae la proporción (ratio)", async () => {
  reset();
  const { saveFacialAnalysis } = await import("../saveFacialAnalysis");
  const points = {
    PRONASALE: { x: 0, y: 0 },
    SOFT_POGONION: { x: 0, y: 100 },
    LABRALE_SUPERIUS: { x: 10, y: 50 },
  };
  const res = await saveFacialAnalysis({ treatmentPlanId: "plan-1", view: "PERFIL", points });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.measurements.eLine.upperLipMm, null);
  assert.equal(Math.abs(res.data.measurements.eLine.upperLipRatio!), 0.1);
});

test("con calibrationPxPerMm, measurements trae mm", async () => {
  reset();
  const { saveFacialAnalysis } = await import("../saveFacialAnalysis");
  const points = {
    PRONASALE: { x: 0, y: 0 },
    SOFT_POGONION: { x: 0, y: 100 },
    LABRALE_SUPERIUS: { x: 10, y: 50 },
  };
  const res = await saveFacialAnalysis({ treatmentPlanId: "plan-1", view: "PERFIL", points, calibrationPxPerMm: 5 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(Math.abs(res.data.measurements.eLine.upperLipMm!), 2);
});

test("vista inválida se rechaza antes de tocar la base", async () => {
  reset();
  const { saveFacialAnalysis } = await import("../saveFacialAnalysis");
  // @ts-expect-error — vista fuera del union, es justo lo que se prueba.
  const res = await saveFacialAnalysis({ treatmentPlanId: "plan-1", view: "LATERAL", points: {} });
  assert.equal(res.ok, false);
  assert.equal(upsertCalls.length, 0);
});

test("tabla todavía no pegada en dev.108 (P2021): mensaje claro, no un 500 genérico", async () => {
  reset();
  throwOnUpsert = { code: "P2021" };
  const { saveFacialAnalysis } = await import("../saveFacialAnalysis");
  const res = await saveFacialAnalysis({ treatmentPlanId: "plan-1", view: "PERFIL", points: {} });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /falta pegar el SQL/);
});
