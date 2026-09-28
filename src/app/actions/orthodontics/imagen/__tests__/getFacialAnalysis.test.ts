/**
 * Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t10, H19). Self-fetch para
 * reabrir el análisis facial guardado de una vista. Mismo patrón de mocks
 * que listCephalometricAnalyses.test.ts.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npm run test:orto-imagen-facial-analysis
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

interface Row {
  id: string;
  view: string;
  points: unknown;
  imageWidth: number | null;
  imageHeight: number | null;
  measurements: unknown;
  calibrationPxPerMm: number | null;
  photoFileId: string | null;
  photoFile: { url: string } | null;
  updatedAt: Date;
}

let rows: Row[] = [];
let signedCalls: Array<string | null | undefined>[] = [];
let signResponses: string[] = [];
let throwOnFindFirst: { code: string } | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticFacialAnalysis: {
        findFirst: async ({ where }: { where: { view: string } }) => {
          if (throwOnFindFirst) {
            const e = new Error("boom") as Error & { code: string };
            e.code = throwOnFindFirst.code;
            throw e;
          }
          return rows.find((r) => r.view === where.view) ?? null;
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

mock.module("@/lib/storage", {
  namedExports: {
    signMaybeUrls: async (urls: Array<string | null | undefined>) => {
      signedCalls.push(urls);
      return signResponses;
    },
  },
});

function reset() {
  rows = [];
  signedCalls = [];
  signResponses = [];
  throwOnFindFirst = null;
}

test("sin análisis guardado para esa vista, devuelve null (nunca error)", async () => {
  reset();
  const { getFacialAnalysis } = await import("../getFacialAnalysis");
  const res = await getFacialAnalysis("plan-1", "PERFIL");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data, null);
});

test("con análisis guardado, firma photoFileUrl en vez de devolver el path crudo", async () => {
  reset();
  rows.push({
    id: "fa-1",
    view: "PERFIL",
    points: { PRONASALE: { x: 120, y: 80 } },
    imageWidth: 1200,
    imageHeight: 1600,
    measurements: { eLine: {}, nasolabialAngle: null, midline: {} },
    calibrationPxPerMm: null,
    photoFileId: "file-1",
    photoFile: { url: "clinic-1/orthodontics/patient-1/facial-perfil-1.jpg" },
    updatedAt: new Date("2026-09-28T00:00:00Z"),
  });
  signResponses = ["https://supabase.example/signed-facial?token=abc"];

  const { getFacialAnalysis } = await import("../getFacialAnalysis");
  const res = await getFacialAnalysis("plan-1", "PERFIL");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(signedCalls[0], ["clinic-1/orthodontics/patient-1/facial-perfil-1.jpg"]);
  assert.equal(res.data?.photoFileUrl, "https://supabase.example/signed-facial?token=abc");
  assert.deepEqual(res.data?.points, { PRONASALE: { x: 120, y: 80 } });
  assert.equal(res.data?.imageWidth, 1200);
});

test("solo trae la vista pedida — FRENTE no devuelve el análisis de PERFIL", async () => {
  reset();
  rows.push({
    id: "fa-1", view: "PERFIL", points: {}, imageWidth: null, imageHeight: null,
    measurements: {}, calibrationPxPerMm: null, photoFileId: null, photoFile: null,
    updatedAt: new Date(),
  });
  const { getFacialAnalysis } = await import("../getFacialAnalysis");
  const res = await getFacialAnalysis("plan-1", "FRENTE");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data, null);
});

test("tabla todavía no pegada en dev.108 (P2021) se calla — null, no rompe la ficha", async () => {
  reset();
  throwOnFindFirst = { code: "P2021" };
  const { getFacialAnalysis } = await import("../getFacialAnalysis");
  const res = await getFacialAnalysis("plan-1", "PERFIL");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data, null);
});
