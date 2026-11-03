/**
 * Auditoría de seguridad «cloudflare», revisión de ws1-t2 sobre el nº1 (firmar objetos del bucket):
 *   · MAYOR — el veto va en el ÚLTIMO punto de confianza: `createSignedFileUrl`, `signMaybeUrl` y
 *     `signMaybeUrls` no firman un path con `%`, `\`, control, `//`, `.`/`..` ni `db-backups/…`,
 *     venga de donde venga (también filas ya plantadas);
 *   · H1 — consentimientos de periodoncia: la firma solo puede ser el PNG del SignaturePad, y
 *     GET /api/xrays firma solo lo que vive bajo la carpeta de la clínica dueña de la fila;
 *   · H2 — foto de monitoreo de ortodoncia (portal): `%2e%2e` ya no salta de carpeta, ni al
 *     guardarla ni al firmarla;
 *   · H3 — `createPerioPhoto`: solo objetos bajo `clinical-photos/<clinicId>/`;
 *   · H4 — adjuntos de soporte: `%` fuera.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * Código REAL con dobles por `Module._load` (por nombre de paquete o por archivo resuelto). El doble de
 * Supabase apunta CADA path que se manda a firmar: lo que no aparece ahí, no se firmó.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { NextRequest } from "next/server";

const firmados: string[] = [];
const creados: Array<{ modelo: string; data: any }> = [];
const firma = (p: string) => `https://proyecto.supabase.co/storage/v1/object/sign/patient-files/${p}?token=t`;

let ctx: any = { userId: "u1", clinicId: "cA", role: "DOCTOR", permissionsOverride: null };
let filasXrays: any[] = [];
let filasMonitoreo: any[] = [];

const prisma: any = {
  patient: { findUnique: async () => ({ visibleUserIds: [] }) },
  patientFile: {
    findMany: async () => structuredClone(filasXrays),
    create: async (a: any) => { creados.push({ modelo: "patientFile", data: a.data }); return { id: "f1" }; },
  },
  periodontalSurgery: {
    findFirst: async () => ({ id: "s1", patientId: "pA", surgeryType: "GINGIVECTOMY" }),
    update: async () => ({}),
  },
  clinicalPhoto: { create: async (a: any) => { creados.push({ modelo: "clinicalPhoto", data: a.data }); return { id: "ph1" }; } },
  orthodonticMonitoringPhoto: {
    create: async (a: any) => { creados.push({ modelo: "monitoreo", data: a.data }); return { id: "m1" }; },
    findMany: async () => structuredClone(filasMonitoreo),
  },
  $transaction: async (fn: any) => fn(prisma),
};

const raiz = path.resolve(__dirname, "../../..");
const archivo = (rel: string) => path.join(raiz, rel);
let resultPerio: any = null;
let resultOrto: any = null;
const okPerio = (d: any) => resultPerio.ok(d);

const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "@supabase/supabase-js": {
    createClient: () => ({
      storage: {
        from: () => ({
          createSignedUrl: async (p: string) => { firmados.push(p); return { data: { signedUrl: firma(p) }, error: null }; },
          createSignedUrls: async (ps: string[]) => {
            firmados.push(...ps);
            return { data: ps.map((p) => ({ path: p, signedUrl: firma(p), error: null })), error: null };
          },
        }),
      },
    }),
  },
  "@/lib/prisma": { prisma },
  "@/lib/auth-context": { getAuthContext: async () => ctx },
  // Estas pruebas no son de visibilidad (las fija endo-perio-visibilidad-v6): el paciente se ve.
  "@/lib/patient-visibility": { assertPatientVisible: async () => null, isVisibilityAdmin: () => false, canSeePatient: () => true },
  "@/lib/branches": {
    getVisiblePatientClinicIds: async () => ["cA", "cB"],
    clinicScopeFilter: (ids: string[]) => ({ in: ids }),
  },
  "@/lib/storage-quota": { storageQuotaError: async () => null },
  "@/lib/audit": { extractAuditMeta: () => ({}), logAudit: async () => undefined, logMutation: async () => undefined },
  "@/lib/movimientos-paciente/registrar": {
    registrarMovimientoDelPaciente: async () => undefined,
    registrarMovimientoExterno: async () => undefined,
  },
};
const doblesPorArchivo: Record<string, () => unknown> = {
  [archivo("src/app/actions/periodontics/_helpers.ts")]: () => ({
    ...resultPerio,
    PERIO_AUDIT_ACTIONS: { CONSENT_SRP_SIGNED: "srp", CONSENT_SURGERY_SIGNED: "surgery" },
    auditPerio: async () => undefined,
    getPerioActionContext: async () => okPerio({ ctx }),
    loadPatientForPerio: async () => okPerio({ id: "pA" }),
  }),
  [archivo("src/app/actions/orthodontics/alineadores/_patient-context.ts")]: () => ({
    getOrthoPatientPortalContext: async () => resultOrto.ok({ patientId: "pA", clinicId: "cA" }),
    isMissingRelation: () => false,
  }),
  [archivo("src/app/actions/orthodontics/imagen/_context.ts")]: () => ({
    getOrthoImagingContext: async () => resultOrto.ok({ ctx }),
    isMissingRelation: () => false,
  }),
};
const Mod = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = Mod._load;
Mod._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req in dobles) return dobles[req];
  if (req.startsWith(".") && resultPerio) {
    try {
      const f = Mod._resolveFilename(req, parent, isMain);
      if (f in doblesPorArchivo) return doblesPorArchivo[f]();
    } catch { /* lo resuelve la carga original */ }
  }
  return cargaOriginal.call(this, req, parent, isMain);
};

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://proyecto.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "llave-de-prueba";

beforeEach(async () => {
  firmados.length = 0;
  creados.length = 0;
  resultPerio ??= await import("@/app/actions/periodontics/result");
  resultOrto ??= await import("@/app/actions/orthodontics/result");
  ctx = { userId: "u1", clinicId: "cA", role: "DOCTOR", permissionsOverride: null };
});

const MALOS = [
  "db-backups/2026-10-26/__manifest.json",
  "cA/pA/%2e%2e/%2e%2e/db-backups/m.json",
  "cA/pA/..%2Fx.jpg",
  "cA/pA/../../cB/x.jpg",
  "cA/./x.jpg",
  "cA//x.jpg",
  "cA\\..\\cB\\x.jpg",
  "cA/pA/x.jpg\u0000",
];

// ── MAYOR: el veto global en storage.ts ─────────────────────────────────────────────────────────────

test("veto global: createSignedFileUrl no firma db-backups, %2e%2e, .., //, \\ ni control", async () => {
  const { createSignedFileUrl, esPathFirmable } = await import("@/lib/storage");
  for (const p of MALOS) {
    await assert.rejects(createSignedFileUrl(p), /no permitido/, p);
    assert.equal(esPathFirmable(p), false, p);
  }
  assert.deepEqual(firmados, [], "a Supabase no le llegó ni un path malo");
  assert.equal(await createSignedFileUrl("cA/pA/1.jpg"), firma("cA/pA/1.jpg"), "lo normal se sigue firmando");
});

test("veto global: signMaybeUrl y signMaybeUrls dejan \"\" sin firmar; lo legítimo y lo externo, como siempre", async () => {
  const { signMaybeUrl, signMaybeUrls } = await import("@/lib/storage");
  for (const p of MALOS) assert.equal(await signMaybeUrl(p), "", p);
  // una URL legacy del bucket se decodifica antes del veto: `%2e%2e` codificado cae igual
  assert.equal(await signMaybeUrl("https://proyecto.supabase.co/storage/v1/object/public/patient-files/cA/%252e%252e/db-backups/m.json"), "");
  assert.deepEqual(firmados, []);

  const r = await signMaybeUrls([...MALOS, "cA/pA/1.jpg", "https://otro.example/logo.png", null]);
  assert.deepEqual(r.slice(0, MALOS.length), MALOS.map(() => ""));
  assert.deepEqual(r.slice(MALOS.length), [firma("cA/pA/1.jpg"), "https://otro.example/logo.png", ""]);
  assert.deepEqual(firmados, ["cA/pA/1.jpg"], "solo se mandó a firmar el path legítimo");
});

// ── H1: consentimientos de periodoncia + GET /api/xrays ─────────────────────────────────────────────

test("H1: el consentimiento de cirugía y el de SRP solo aceptan el PNG del SignaturePad", async () => {
  const { signSurgeryConsent, signSrpConsent } = await import("@/app/actions/periodontics/consents");
  for (const signatureUrl of ["db-backups/2026-10-26/__manifest.json", "cB/pB/radiografia.jpg", "signatures/cB/c1.png", "https://x.example/a.png", "data:image/svg+xml;base64,PHN2Zz4="]) {
    assert.equal((await signSurgeryConsent({ surgeryId: "s1", signatureUrl })).ok, false, signatureUrl);
    assert.equal((await signSrpConsent({ patientId: "pA", signatureUrl })).ok, false, signatureUrl);
  }
  assert.deepEqual(creados, [], "no se guardó ningún PatientFile");

  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  assert.equal((await signSurgeryConsent({ surgeryId: "s1", signatureUrl: png })).ok, true);
  assert.equal((await signSrpConsent({ patientId: "pA", signatureUrl: png })).ok, true);
  assert.equal(creados.length, 2);
});

test("H1: GET /api/xrays firma solo lo de la carpeta de la clínica dueña de cada fila", async () => {
  const bucket = "https://proyecto.supabase.co/storage/v1/object/public/patient-files";
  filasXrays = [
    { id: "1", clinicId: "cA", url: "cA/pA/1.jpg" },
    { id: "2", clinicId: "cA", url: "db-backups/2026-10-26/__manifest.json" },
    { id: "3", clinicId: "cA", url: "cB/pB/ajena.jpg" },
    { id: "4", clinicId: "cA", url: "signatures/cB/c1.png" },
    { id: "5", clinicId: "cB", url: "cB/pA/sede.jpg" }, // sede vinculada: es de cB y vive en cB/
    { id: "6", clinicId: "cA", url: `${bucket}/cA/pA/legacy.jpg` },
    { id: "7", clinicId: "cA", url: "https://otro.example/externa.jpg" },
  ];
  const { GET } = await import("@/app/api/xrays/route");
  const res = await GET(new NextRequest("http://x/api/xrays?patientId=pA"));
  assert.equal(res.status, 200);
  const urls = Object.fromEntries((await res.json()).map((f: any) => [f.id, f.url]));
  assert.deepEqual(urls, {
    1: firma("cA/pA/1.jpg"),
    2: "",
    3: "",
    4: "",
    5: firma("cB/pA/sede.jpg"),
    6: firma("cA/pA/legacy.jpg"),
    7: "https://otro.example/externa.jpg",
  });
  assert.deepEqual(firmados.sort(), ["cA/pA/1.jpg", "cA/pA/legacy.jpg", "cB/pA/sede.jpg"]);
});

// ── H2: foto de monitoreo de ortodoncia ─────────────────────────────────────────────────────────────

test("H2: el portal no registra un storageKey que salta de carpeta con %2e%2e", async () => {
  const { submitMonitoringPhoto } = await import("@/app/actions/orthodontics/alineadores/submitMonitoringPhoto");
  const pref = "cA/pA/ortho-monitoreo/";
  for (const storageKey of [`${pref}%2e%2e/%2e%2e/%2e%2e/db-backups/m.json`, `${pref}..%2F..%2Fx.jpg`, `${pref}a//b.jpg`, `${pref}../x.jpg`, "cB/pA/ortho-monitoreo/x.jpg"]) {
    const r = await submitMonitoringPhoto({ treatmentPlanId: "t1", storageKey, angle: "FRONTAL" });
    assert.equal(r.ok, false, storageKey);
  }
  assert.deepEqual(creados, []);
  assert.equal((await submitMonitoringPhoto({ treatmentPlanId: "t1", storageKey: `${pref}1730000000_abc.jpg`, angle: "FRONTAL" })).ok, true);
});

test("H2: al listar, una fila ya plantada con %2e%2e o de otra clínica no se firma", async () => {
  const fila = (id: string, storageKey: string) => ({ id, storageKey, fileName: null, angle: "FRONTAL", patientNote: null, doctorNote: null, reviewStatus: "PENDING", submittedAt: new Date("2026-10-28") });
  filasMonitoreo = [
    fila("a", "cA/pA/ortho-monitoreo/1.jpg"),
    fila("b", "cA/pA/ortho-monitoreo/%2e%2e/%2e%2e/%2e%2e/db-backups/m.json"),
    fila("c", "cB/pB/ortho-monitoreo/2.jpg"),
  ];
  const { listMonitoringPhotos } = await import("@/app/actions/orthodontics/alineadores/listMonitoringPhotos");
  const r: any = await listMonitoringPhotos("t1");
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.map((f: any) => f.url), [firma("cA/pA/ortho-monitoreo/1.jpg"), null, null]);
  assert.deepEqual(firmados, ["cA/pA/ortho-monitoreo/1.jpg"]);
});

// ── H3: createPerioPhoto ────────────────────────────────────────────────────────────────────────────

test("H3: createPerioPhoto solo guarda objetos bajo clinical-photos/<clinicId>/", async () => {
  const { createPerioPhoto } = await import("@/app/actions/periodontics/photos");
  const bucket = "https://proyecto.supabase.co/storage/v1/object/public/patient-files";
  const { PERIO_PHOTO_KIND } = await import("@/lib/periodontics/photo-types");
  const base = { patientId: "pA", kind: PERIO_PHOTO_KIND[0] };
  for (const blobUrl of [
    `${bucket}/clinical-photos/cB/pA/periodontics/1_x.jpg`,
    `${bucket}/db-backups/2026-10-26/__manifest.json`,
    `${bucket}/cA/pA/1.jpg`,
    `${bucket}/clinical-photos/cA/%252e%252e/%252e%252e/db-backups/m.json`,
    "https://otro.example/x.jpg",
  ]) {
    assert.equal((await createPerioPhoto({ ...base, blobUrl })).ok, false, blobUrl);
  }
  const propia = `${bucket}/clinical-photos/cA/pA/periodontics/1_x.jpg`;
  assert.equal((await createPerioPhoto({ ...base, blobUrl: propia, thumbnailUrl: `${bucket}/cB/x.webp` })).ok, false, "la miniatura también");
  assert.deepEqual(creados, []);
  assert.equal((await createPerioPhoto({ ...base, blobUrl: propia })).ok, true);
  assert.equal(creados.length, 1);
});

// ── H4: adjuntos de soporte ─────────────────────────────────────────────────────────────────────────

test("H4: los adjuntos de soporte con % se rechazan; los normales pasan", async () => {
  const { validateAttachmentsMeta } = await import("@/lib/support/service");
  const adj = (p: string) => [{ path: p, name: "foto.png", size: 1000, type: "image/png" }];
  assert.throws(() => validateAttachmentsMeta(adj("support/cA/%2e%2e/%2e%2e/db-backups/m.json"), "cA"), /Adjunto inválido/);
  assert.equal(validateAttachmentsMeta(adj("support/cA/1730000000-foto.png"), "cA").length, 1);
});
