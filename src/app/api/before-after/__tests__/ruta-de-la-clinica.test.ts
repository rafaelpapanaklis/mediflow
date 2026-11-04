/**
 * Auditoría de seguridad «cloudflare», nº1 — POST /api/before-after guardaba y FIRMABA (con la llave
 * de servicio) cualquier path del bucket privado que mandara el cliente: el de otra clínica o los
 * respaldos de la plataforma (`db-backups/<fecha>/__manifest.json`). Ahora solo acepta objetos de la
 * carpeta de la clínica de la sesión, y GET (y la exportación) solo firman esos.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * El handler REAL con dobles por `Module._load` (sesión, Prisma, visibilidad, Movimientos y el
 * cliente de Supabase, que apunta qué se firma). Sin red, sin base.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "llave-de-prueba";

const firmados: string[] = [];
let filas: any[] = [];
const ctx = { userId: "u1", clinicId: "cA", role: "RECEPTIONIST", permissionsOverride: null as string[] | null };

const storageDoble = {
  from: (bucket: string) => ({
    createSignedUrl: async (p: string) => { firmados.push(`${bucket}:${p}`); return { data: { signedUrl: `firmada://${p}` }, error: null }; },
    createSignedUrls: async (ps: string[]) => { ps.forEach((p) => firmados.push(`${bucket}:${p}`)); return { data: ps.map((p) => ({ signedUrl: `firmada://${p}`, error: null })), error: null }; },
  }),
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "@supabase/supabase-js": { createClient: () => ({ storage: storageDoble }) },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/patient-visibility": { assertPatientVisible: async () => null },
  "@/lib/movimientos-paciente/registrar": { registrarMovimientoDelPaciente: async () => undefined },
  "@/lib/prisma": {
    prisma: {
      patient: { findFirst: async (a: any) => (a.where.clinicId === ctx.clinicId && a.where.id === "pA" ? { id: "pA" } : null) },
      beforeAfterPhoto: {
        create: async (a: any) => { const f = { id: `f${filas.length + 1}`, ...a.data }; filas.push(f); return f; },
        findMany: async (a: any) => filas.filter((f) => f.clinicId === a.where.clinicId && f.patientId === a.where.patientId),
      },
    },
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

beforeEach(() => { firmados.length = 0; filas = []; });

async function post(url: string) {
  const { POST } = await import("@/app/api/before-after/route");
  const res = await POST(new NextRequest("http://x/api/before-after", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ patientId: "pA", category: "before", angle: "front", url }),
  }));
  return { status: res.status, body: await res.json() };
}

test("nº1: un path de OTRA clínica, un respaldo de la plataforma o un «..» → 400 y no se firma nada", async () => {
  for (const url of [
    "cB/pB/1_x.jpg",
    "db-backups/2026-10-25/__manifest.json",
    "cA/../cB/pB/1_x.jpg",
    "cA/%2e%2e/db-backups/2026-10-27/__manifest.json", // fetch normaliza %2e%2e como ..
    "cA/.%2E/cB/pB/1_x.jpg",
    "https://proyecto.supabase.co/storage/v1/object/public/patient-files/cA/%252e%252e/cB/pB/1_x.jpg",
    "https://proyecto.supabase.co/storage/v1/object/public/patient-files/cB/pB/1_x.jpg",
    "https://proyecto.supabase.co/storage/v1/object/sign/patient-files/db-backups/2026-10-25/cB.ndjson.enc?token=t",
  ]) {
    const r = await post(url);
    assert.equal(r.status, 400, `${url} → ${r.status}`);
  }
  assert.deepEqual(firmados, [], "nada firmado con la llave de servicio");
  assert.equal(filas.length, 0, "nada guardado");
});

test("nº1: lo de ESTA clínica sigue igual: path o URL del bucket → 201 y firmado", async () => {
  const a = await post("cA/pA/1_foto.jpg");
  assert.equal(a.status, 201);
  assert.equal(a.body.url, "firmada://cA/pA/1_foto.jpg");
  const b = await post("https://proyecto.supabase.co/storage/v1/object/public/patient-files/cA/pA/2_foto.jpg");
  assert.equal(b.status, 201);
  assert.deepEqual(firmados, ["patient-files:cA/pA/1_foto.jpg", "patient-files:cA/pA/2_foto.jpg"]);
});

test("nº1: GET no firma una fila vieja con un path ajeno (la que ya se hubiera colado)", async () => {
  filas = [
    { id: "f1", clinicId: "cA", patientId: "pA", url: "cA/pA/1_foto.jpg" },
    { id: "f2", clinicId: "cA", patientId: "pA", url: "db-backups/2026-10-25/__manifest.json" },
    { id: "f3", clinicId: "cA", patientId: "pA", url: "cB/pB/1_x.jpg" },
  ];
  const { GET } = await import("@/app/api/before-after/route");
  const res = await GET(new NextRequest("http://x/api/before-after?patientId=pA"));
  assert.equal(res.status, 200);
  const fotos = await res.json();
  assert.deepEqual(fotos.map((f: any) => f.url), ["firmada://cA/pA/1_foto.jpg", "", ""]);
  assert.deepEqual(firmados, ["patient-files:cA/pA/1_foto.jpg"]);
});

test("nº1: esPathDeLaClinica", async () => {
  const { esPathDeLaClinica } = await import("@/lib/storage");
  assert.equal(esPathDeLaClinica("cA/pA/x.jpg", "cA"), true);
  assert.equal(esPathDeLaClinica("cA/pA/1_foto (1)..final.jpg", "cA"), true, "nombres que deja validar-archivo.ts");
  for (const p of ["cB/x.jpg", "cAx/y.jpg", "db-backups/x", "cA/../cB/x", "cA//x", "cA\\x", "cA/x\u0000.jpg", "", "cA/%2e%2e/x", "cA/./x", "cA/x/.."]) {
    assert.equal(esPathDeLaClinica(p, "cA"), false, JSON.stringify(p));
  }
  assert.equal(esPathDeLaClinica("cA/x.jpg", ""), false, "sin clínica, nada");
});

test("m3: un archivo de OTRO paciente de la misma clínica no se ata a éste (400 y nada firmado)", async () => {
  const bucket = "https://proyecto.supabase.co/storage/v1/object/public/patient-files";
  for (const url of [
    "cA/pB/1_x.jpg",
    "cA/models-3d/pB/arcada.jpg",
    `${bucket}/cA/orthodontics/pB/frontal.jpg`,
    "cA/pB/pA.jpg", // el id como nombre de archivo no cuenta: tiene que ser una carpeta del paciente
  ]) {
    const r = await post(url);
    assert.equal(r.status, 400, `${url} → ${r.status}`);
  }
  assert.deepEqual(firmados, []);
  assert.equal(filas.length, 0);
});

test("m3: las carpetas legítimas del paciente siguen valiendo", async () => {
  for (const url of ["cA/pA/1_foto.jpg", "cA/models-3d/pA/arcada.jpg", "cA/orthodontics/pA/frontal.jpg", "cA/dicom-sets/pA/x.jpg", "cA/pA/ortho-monitoreo/1.jpg"]) {
    assert.equal((await post(url)).status, 201, url);
  }
});
