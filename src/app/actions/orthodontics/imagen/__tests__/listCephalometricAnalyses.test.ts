/**
 * Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8). Hallazgo de ws1-t11:
 * el trazador y las fotos pedían la imagen a `/api/files/<id>`, una ruta
 * que nunca existió (404 en dev.108, recuadro vacío). La causa raíz de la
 * mitad del problema vivía AQUÍ: esta acción devolvía el PATH crudo de
 * Supabase Storage (`PatientFile.url`) tal cual — el bucket es privado, así
 * que un `<img src>` con eso nunca carga nada, con o sin la ruta
 * `/api/files/`. El arreglo firma las URLs bajo demanda con
 * `signMaybeUrls` (mismo mecanismo que ya usa `listMonitoringPhotos.ts`
 * para lo mismo) — no se necesitó ninguna ruta nueva.
 *
 * Necesita --experimental-test-module-mocks (mock.module sustituye
 * "@/lib/prisma", "../_context" y "@/lib/storage"). El módulo bajo prueba
 * se importa DESPUÉS de declarar los mocks, mismo patrón que
 * `_context.test.ts`.
 *
 * Run: npm run test:orto-imagen-list-signed-urls
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

interface AnalysisRow {
  id: string;
  kind: string;
  analysisType: string;
  normSet: string;
  points: unknown;
  measurements: unknown;
  calibrationMmPerPixel: number | null;
  lateralXrayFile: { url: string } | null;
  tracingPdfFile: { url: string } | null;
  createdAt: Date;
}

let rows: AnalysisRow[] = [];
/** Las URLs que de verdad recibió `signMaybeUrls`, en orden — para comprobar qué se le mandó a firmar. */
let signedCalls: Array<string | null | undefined>[] = [];
/** Lo que `signMaybeUrls` devuelve para el siguiente llamado — el test lo arma por caso. */
let signResponses: string[] = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticCephalometryAnalysis: {
        findMany: async () => rows,
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
}

test("firma lateralXrayFileUrl/tracingPdfFileUrl en vez de devolver el path crudo del bucket", async () => {
  reset();
  rows.push({
    id: "a1",
    kind: "INITIAL",
    analysisType: "STEINER",
    normSet: "STANDARD",
    points: {},
    measurements: {},
    calibrationMmPerPixel: null,
    lateralXrayFile: { url: "clinic-1/orthodontics/patient-1/cefalometria-123.jpg" },
    tracingPdfFile: null,
    createdAt: new Date("2026-09-28T00:00:00Z"),
  });
  signResponses = ["https://supabase.example/signed-xray?token=abc", ""];

  const { listCephalometricAnalyses } = await import("../listCephalometricAnalyses");
  const res = await listCephalometricAnalyses("plan-1");
  assert.equal(res.ok, true);
  if (!res.ok) return;

  // Se le mandó a firmar el PATH crudo, no una URL ya armada.
  assert.deepEqual(signedCalls[0], ["clinic-1/orthodontics/patient-1/cefalometria-123.jpg", null]);

  // Y lo que sale al cliente es la URL firmada, nunca el path.
  assert.equal(res.data[0].lateralXrayFileUrl, "https://supabase.example/signed-xray?token=abc");
  assert.notEqual(res.data[0].lateralXrayFileUrl, "clinic-1/orthodontics/patient-1/cefalometria-123.jpg");
  // Sin PDF de trazado: null, nunca "" ni el path.
  assert.equal(res.data[0].tracingPdfFileUrl, null);
});

test("varias filas: firma TODAS las URLs en un solo viaje (2 por fila), en orden", async () => {
  reset();
  rows.push(
    {
      id: "a1", kind: "INITIAL", analysisType: "STEINER", normSet: "STANDARD",
      points: {}, measurements: {}, calibrationMmPerPixel: null,
      lateralXrayFile: { url: "path/xray-1.jpg" }, tracingPdfFile: { url: "path/pdf-1.pdf" },
      createdAt: new Date(),
    },
    {
      id: "a2", kind: "PROGRESS", analysisType: "STEINER", normSet: "STANDARD",
      points: {}, measurements: {}, calibrationMmPerPixel: null,
      lateralXrayFile: { url: "path/xray-2.jpg" }, tracingPdfFile: null,
      createdAt: new Date(),
    },
  );
  signResponses = ["signed-xray-1", "signed-pdf-1", "signed-xray-2", ""];

  const { listCephalometricAnalyses } = await import("../listCephalometricAnalyses");
  const res = await listCephalometricAnalyses("plan-1");
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.deepEqual(signedCalls[0], ["path/xray-1.jpg", "path/pdf-1.pdf", "path/xray-2.jpg", null]);
  assert.equal(res.data[0].lateralXrayFileUrl, "signed-xray-1");
  assert.equal(res.data[0].tracingPdfFileUrl, "signed-pdf-1");
  assert.equal(res.data[1].lateralXrayFileUrl, "signed-xray-2");
  assert.equal(res.data[1].tracingPdfFileUrl, null);
});

test("si firmar falla para una fila (string vacío de signMaybeUrls), sale null — nunca un path ni un string vacío", async () => {
  reset();
  rows.push({
    id: "a1", kind: "INITIAL", analysisType: "STEINER", normSet: "STANDARD",
    points: {}, measurements: {}, calibrationMmPerPixel: null,
    lateralXrayFile: { url: "path/xray-1.jpg" }, tracingPdfFile: null,
    createdAt: new Date(),
  });
  signResponses = ["", ""]; // signMaybeUrls falla en suave y deja "" — mismo contrato que su propio código.

  const { listCephalometricAnalyses } = await import("../listCephalometricAnalyses");
  const res = await listCephalometricAnalyses("plan-1");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data[0].lateralXrayFileUrl, null);
});

test("sin filas, no llama a signMaybeUrls con nada raro y devuelve lista vacía", async () => {
  reset();
  rows = [];
  const { listCephalometricAnalyses } = await import("../listCephalometricAnalyses");
  const res = await listCephalometricAnalyses("plan-1");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.data, []);
});
