/**
 * Auditoría de seguridad «cloudflare», segunda revisión de ws1-t2 (v2-m1 y el pasaporte de implantes):
 *   · v2-m1 — tres lectores de `PatientFile.url` firmaban o BAJABAN la fila tal cual. Una fila plantada
 *     antes del arreglo de H1 con un path de otra clínica (`cB/…`, `signatures/cB/…`), que el veto global
 *     no frena, salía firmada en el portal del paciente; y `xrays/[id]/analyze` hace `.download`, que ni
 *     pasa por el veto: `db-backups/…` se bajaba y viajaba al modelo. (El expediente PDF lo fija
 *     expediente-pdf-ruta.test.tsx.)
 *   · pasaporte de implantes — `patientFile.findUnique` por id, sin clínica: la foto de otra clínica
 *     entraba al carnet, y @react-pdf baja ese `src` desde el servidor.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * Código REAL con dobles por `Module._load` (por paquete o por archivo resuelto). El doble de Supabase
 * apunta cada path que se firma o se descarga.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { NextRequest } from "next/server";

type Fila = Record<string, any>;
/** Evalúa igualdades y AND de un `where` de Prisma sobre una fila en memoria. */
function casa(fila: Fila, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === "AND") return (v as any[]).every((w) => casa(fila, w));
    return fila[k] === v;
  });
}

const firmados: string[] = [];
const descargados: string[] = [];
const firma = (p: string) => `https://proyecto.supabase.co/storage/v1/object/sign/patient-files/${p}?token=t`;

let archivos: Fila[] = [];
let ctx: any = null;
let datosDelCarnet: any = null;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const prisma: any = {
  patient: {
    findFirst: async () => ({
      id: "pA", firstName: "Ana", lastName: "Pérez", patientNumber: 1, email: null, phone: null, dob: null,
      bloodType: null, allergies: null, chronicConditions: null, portalTokenExpiry: null,
      clinic: { id: "cA", name: "C", logoUrl: null, phone: null, specialty: "x", address: null, city: null, timezone: "America/Mexico_City" },
      appointments: [], records: [], invoices: [], consentForms: [],
      files: archivos.map((f) => ({ ...f, createdAt: new Date("2026-10-01"), notes: null, takenAt: null, category: "XRAY", name: f.id })),
    }),
    findUnique: async () => ({ firstName: "Ana", lastName: "Pérez", dob: null, gender: null, allergies: [], chronicConditions: [] }),
  },
  orthoTreatmentCard: { findMany: async () => [] },
  patientFile: {
    findFirst: async (a: any) => archivos.find((f) => casa(f, a.where)) ?? null,
    findUnique: async (a: any) => archivos.find((f) => casa(f, a.where)) ?? null,
  },
  xrayAnalysis: { findUnique: async () => null },
  clinic: { findUnique: async () => ({ aiTokensUsed: 0, aiTokensLimit: 1_000_000, aiLastResetAt: new Date() }), update: async () => ({}) },
  implant: {
    findFirst: async () => ({
      id: "i1", clinicId: "cA", patientId: "pA", toothFdi: 11, brand: "OTHER", brandCustomName: null, modelName: "M",
      diameterMm: 4, lengthMm: 10, lotNumber: "L", placedAt: new Date("2026-01-01"), expiryDate: null,
      surgicalRecord: null, prostheticPhase: null,
      passport: { patientPhotoFileId: "fFoto", qrPublicEnabled: false, qrToken: null },
      patient: { firstName: "Ana", lastName: "Pérez", dob: null },
      placedByDoctor: { firstName: "D", lastName: "R", cedulaProfesional: null },
      clinic: { name: "C", phone: null, logoUrl: null },
    }),
  },
};

const raiz = path.resolve(__dirname, "../../..");
const doblesPorArchivo: Record<string, unknown> = {
  [path.join(raiz, "src/app/portal/[token]/portal-client.tsx")]: { PatientPortalClient: () => null },
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/navigation": { notFound: () => { throw new Error("NEXT_NOT_FOUND"); } },
  "@supabase/supabase-js": {
    createClient: () => ({
      storage: {
        from: () => ({
          createSignedUrl: async (p: string) => { firmados.push(p); return { data: { signedUrl: firma(p) }, error: null }; },
          createSignedUrls: async (ps: string[]) => {
            firmados.push(...ps);
            return { data: ps.map((p) => ({ path: p, signedUrl: firma(p), error: null })), error: null };
          },
          download: async (p: string) => { descargados.push(p); return { data: new Blob([PNG]), error: null }; },
        }),
      },
    }),
  },
  "@/lib/prisma": { prisma },
  "@/lib/auth-context": { getAuthContext: async () => ctx },
  "@/lib/auth": { getCurrentUser: async () => ctx?.user },
  "@/lib/auth/guardia-clinica": { denyIfNotClinical: () => null },
  "@/lib/marketplace/access-control": { canAccessModule: async () => ({ hasAccess: true }) },
  "@/lib/patient-visibility": { assertPatientVisible: async () => null },
  "@/lib/failban": { persistentRateLimit: async () => null },
  "@/lib/ai-tokens": { addAiTokens: async () => undefined },
  "@/lib/ai-tokens-owner": { tokensDeLasOtrasSedes: async () => ({ tokens: 0 }) },
  "@/lib/ai-billing/record-usage": { recordUsageNoCharge: async () => undefined },
  "@/lib/ai-billing/interruptores.server": { cortarSiIaApagada: async () => null },
  "@/lib/implants/pdf-templates/implant-passport": { ImplantPassportDocument: () => null },
  "@react-pdf/renderer": {
    renderToBuffer: async (el: any) => { datosDelCarnet = el.props.data; return Buffer.from("%PDF"); },
  },
};
const Mod = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = Mod._load;
Mod._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req in dobles) return dobles[req];
  if (req.startsWith(".")) {
    try {
      const f = Mod._resolveFilename(req, parent, isMain);
      if (f in doblesPorArchivo) return doblesPorArchivo[f];
    } catch { /* lo resuelve la carga original */ }
  }
  return cargaOriginal.call(this, req, parent, isMain);
};

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://proyecto.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "llave-de-prueba";

beforeEach(() => {
  firmados.length = 0;
  descargados.length = 0;
  datosDelCarnet = null;
  const user = { id: "u1", clinicId: "cA", role: "ADMIN", permissionsOverride: null, clinic: { category: "DENTAL" } };
  ctx = { userId: "u1", clinicId: "cA", role: "ADMIN", permissionsOverride: null, user };
});

// ── v2-m1: el portal del paciente ───────────────────────────────────────────────────────────────────

test("v2-m1: el portal firma solo lo que vive bajo la carpeta de la clínica de cada fila", async () => {
  archivos = [
    { id: "propia", clinicId: "cA", url: "cA/pA/1.jpg", mimeType: "image/jpeg" },
    { id: "otra-clinica", clinicId: "cA", url: "cB/pB/ajena.jpg", mimeType: "image/jpeg" },
    { id: "firma-ajena", clinicId: "cA", url: "signatures/cB/c1.png", mimeType: "image/png" },
    { id: "sede", clinicId: "cB", url: "cB/pA/sede.jpg", mimeType: "image/jpeg" },
    { id: "externa", clinicId: "cA", url: "https://otro.example/x.jpg", mimeType: "image/jpeg" },
  ];
  const { default: Pagina } = await import("@/app/portal/[token]/page");
  const el: any = await Pagina({ params: Promise.resolve({ token: "tok" }) });
  const urls = Object.fromEntries(el.props.patient.files.map((f: any) => [f.id, f.url]));
  assert.deepEqual(urls, {
    propia: firma("cA/pA/1.jpg"),
    "otra-clinica": "",
    "firma-ajena": "",
    sede: firma("cB/pA/sede.jpg"),
    externa: "https://otro.example/x.jpg",
  });
  assert.deepEqual(firmados.sort(), ["cA/pA/1.jpg", "cB/pA/sede.jpg"]);
});

// ── v2-m1: análisis de radiografía con IA ───────────────────────────────────────────────────────────

async function analizar(id: string) {
  process.env.ANTHROPIC_API_KEY = "llave-falsa";
  const { POST } = await import("@/app/api/xrays/[id]/analyze/route");
  const res = await POST(new NextRequest(`http://x/api/xrays/${id}/analyze`, { method: "POST" }), { params: Promise.resolve({ id }) });
  return res.status;
}

test("v2-m1: el análisis IA no DESCARGA una fila plantada (db-backups, otra clínica, %2e%2e)", async () => {
  archivos = [
    { id: "x1", clinicId: "cA", patientId: "pA", url: "db-backups/2026-10-26/__manifest.json", mimeType: "image/png" },
    { id: "x2", clinicId: "cA", patientId: "pA", url: "cB/pB/ajena.png", mimeType: "image/png" },
    { id: "x3", clinicId: "cA", patientId: "pA", url: "cA/pA/%2e%2e/%2e%2e/db-backups/m.json", mimeType: "image/png" },
  ];
  // La llamada al modelo no llega: se corta antes, en la descarga.
  globalThis.fetch = (async () => { throw new Error("no debía llamar al modelo"); }) as typeof fetch;
  for (const id of ["x1", "x2", "x3"]) {
    assert.notEqual(await analizar(id), 200, id);
  }
  assert.deepEqual(descargados, [], "no se bajó ni un objeto ajeno");
});

test("v2-m1: la radiografía propia SÍ se descarga para el análisis", async () => {
  archivos = [{ id: "x4", clinicId: "cA", patientId: "pA", url: "cA/pA/pano.png", mimeType: "image/png" }];
  globalThis.fetch = (async () => { throw new Error("corte después de la descarga"); }) as typeof fetch;
  await analizar("x4").catch(() => 0);
  assert.deepEqual(descargados, ["cA/pA/pano.png"]);
});

// ── Pasaporte de implantes ──────────────────────────────────────────────────────────────────────────

async function carnet() {
  const { GET } = await import("@/app/api/implants/[id]/passport/route");
  const res = await GET(new NextRequest("http://x/api/implants/i1/passport"), { params: Promise.resolve({ id: "i1" }) });
  assert.equal(res.status, 200);
  return datosDelCarnet;
}

test("pasaporte: la foto de OTRA clínica (id ajeno) no entra al carnet", async () => {
  archivos = [{ id: "fFoto", clinicId: "cB", patientId: "pB", url: "https://proyecto.supabase.co/storage/v1/object/public/patient-files/cB/pB/foto.jpg" }];
  assert.equal((await carnet()).patientPhotoUrl, null);
  assert.deepEqual(firmados, []);
});

test("pasaporte: ni la de otro paciente de la clínica, ni una URL http cruda (@react-pdf la bajaría)", async () => {
  archivos = [{ id: "fFoto", clinicId: "cA", patientId: "pOtro", url: "cA/pOtro/foto.jpg" }];
  assert.equal((await carnet()).patientPhotoUrl, null, "otro paciente");
  archivos = [{ id: "fFoto", clinicId: "cA", patientId: "pA", url: "http://169.254.169.254/latest/meta-data/x.png" }];
  assert.equal((await carnet()).patientPhotoUrl, null, "URL cruda");
  assert.deepEqual(firmados, []);
});

test("pasaporte: la foto propia del paciente va FIRMADA (antes viajaba el path crudo)", async () => {
  archivos = [{ id: "fFoto", clinicId: "cA", patientId: "pA", url: "cA/pA/foto.jpg" }];
  assert.equal((await carnet()).patientPhotoUrl, firma("cA/pA/foto.jpg"));
});
