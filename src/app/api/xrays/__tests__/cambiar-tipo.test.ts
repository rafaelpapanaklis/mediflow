/**
 * CAMBIAR EL TIPO DE UNA RADIOGRAFÍA/FOTO YA SUBIDA Y FILTRAR — ws1-t9 (ticket BEVADENT 5b/5g/5e).
 *
 * Run: npm run test:xrays-tipo
 *
 * Antes `PATCH /api/xrays/[id]` solo aceptaba `doctorNotes`: una panorámica subida como «Periapical» se
 * quedaba así y no contaba para la reevaluación radiográfica de ortodoncia. Ahora el PATCH acepta
 * `{ category }` con `xrays.upload` (las notas siguen pidiendo `medicalRecord.edit`), deja en Movimientos
 * quién lo cambió y de qué a qué, no toca el archivo, y la reevaluación lo cuenta sin más pasos.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filtrarArchivosPorGrupo,
  contarPorGrupo,
  grupoDeCategoria,
  opcionesDeCambioDeTipo,
  validarCambioDeTipo,
  CATEGORIAS_SUBIDA_FICHA,
  NOMBRE_CATEGORIA_ES,
  SIN_FILTRO,
} from "@/lib/uploads/categorias-archivo";

const ctx: any = { userId: "u1", clinicId: "c1", role: "RECEPTIONIST", permissionsOverride: [] };
let archivos: any[];
let auditorias: any[];
let escrituras: any[];
let visibilidadNegada = false;

beforeEach(() => {
  ctx.role = "RECEPTIONIST";
  ctx.permissionsOverride = [];
  visibilidadNegada = false;
  auditorias = [];
  escrituras = [];
  archivos = [
    { id: "f1", clinicId: "c1", patientId: "p1", category: "XRAY_PERIAPICAL", mimeType: "image/png", deletedAt: null, createdAt: new Date("2026-09-01T12:00:00Z"), takenAt: null },
    { id: "f2", clinicId: "c1", patientId: "p1", category: "OTHER", mimeType: "application/pdf", deletedAt: null, createdAt: new Date("2026-09-02T12:00:00Z"), takenAt: null },
    { id: "f3", clinicId: "c1", patientId: "p1", category: "ORTHO_PHOTO_T0", mimeType: "image/jpeg", deletedAt: null, createdAt: new Date(), takenAt: null },
    { id: "f4", clinicId: "c1", patientId: "p1", category: "SCAN_STL", mimeType: "model/stl", deletedAt: null, createdAt: new Date(), takenAt: null },
    { id: "f5", clinicId: "c1", patientId: "p1", category: "XRAY_PERIAPICAL", mimeType: "image/png", deletedAt: new Date(), createdAt: new Date(), takenAt: null },
    { id: "ajena", clinicId: "OTRA", patientId: "px", category: "XRAY_PERIAPICAL", mimeType: "image/png", deletedAt: null, createdAt: new Date(), takenAt: null },
  ];
});

const coincide = (f: any, w: any) =>
  Object.entries(w).every(([k, v]) => (k === "deletedAt" ? f.deletedAt === v : k === "patientId" && v && typeof v === "object" ? (v as any).in.includes(f.patientId) : k === "category" && v && typeof v === "object" ? (v as any).in.includes(f.category) : f[k] === v));

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ctx } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => (visibilidadNegada ? new Response(null, { status: 403 }) : null) },
});
(mock as any).module("@/lib/audit", { namedExports: { logAudit: async (a: any) => { auditorias.push(a); } } });
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patientFile: {
        findFirst: async (a: any) => archivos.find((f) => coincide(f, a.where)) ?? null,
        findMany: async (a: any) => archivos.filter((f) => coincide(f, a.where)),
        updateMany: async (a: any) => {
          const f = archivos.find((x) => coincide(x, a.where));
          if (!f) return { count: 0 };
          Object.assign(f, a.data);
          escrituras.push(a);
          return { count: 1 };
        },
        update: async (a: any) => { escrituras.push(a); return {}; },
      },
    },
  },
});

const req = (body: any) => ({ json: async () => body }) as any;
const par = (id: string) => ({ params: { id } });

test("recepción corrige una panorámica subida como periapical: se guarda y queda en Movimientos", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  const r = await PATCH(req({ category: "XRAY_PANORAMIC" }), par("f1"));
  assert.equal(r.status, 200);
  assert.equal(archivos[0].category, "XRAY_PANORAMIC");
  assert.equal(auditorias.length, 1);
  const a = auditorias[0];
  assert.equal(a.clinicId, "c1");
  assert.equal(a.userId, "u1");
  assert.equal(a.patientId, "p1");
  assert.equal(a.entityType, "patient-file");
  assert.deepEqual(a.changes, { category: { before: "XRAY_PERIAPICAL", after: "XRAY_PANORAMIC" } });
  assert.equal(a.texto, "Cambió el tipo de un estudio: de «Periapical» a «Panorámica»");
  // Solo cambia la etiqueta: la escritura no toca url ni nombre.
  assert.deepEqual(Object.keys(escrituras[0].data), ["category"]);
});

test("5e: la panorámica corregida cuenta para la reevaluación radiográfica del plan de ortodoncia", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  const { cargarRadiografiasTipificadas } = await import("@/lib/orthodontics/plan-radiografias-db");
  const antes = await cargarRadiografiasTipificadas("c1", ["p1"], "America/Mexico_City");
  assert.equal(antes.get("p1"), undefined, "como periapical no cuenta");
  assert.equal((await PATCH(req({ category: "XRAY_PANORAMIC" }), par("f1"))).status, 200);
  const despues = await cargarRadiografiasTipificadas("c1", ["p1"], "America/Mexico_City");
  assert.deepEqual(despues.get("p1")?.map((x) => x.tipo), ["PANORAMICA"]);
  assert.equal((await PATCH(req({ category: "XRAY_CEPHALOMETRIC" }), par("f1"))).status, 200);
  assert.deepEqual((await cargarRadiografiasTipificadas("c1", ["p1"], "America/Mexico_City")).get("p1")?.map((x) => x.tipo), ["TELE"]);
});

test("permisos: cambiar el tipo pide xrays.upload; solo lectura no (403, sin escribir ni registrar)", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  ctx.role = "READONLY";
  const r = await PATCH(req({ category: "XRAY_PANORAMIC" }), par("f1"));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).permiso, "xrays.upload");
  assert.equal(archivos[0].category, "XRAY_PERIAPICAL");
  assert.deepEqual(auditorias, []);
  // permiso a medida: recepción sin xrays.upload tampoco.
  ctx.role = "RECEPTIONIST";
  ctx.permissionsOverride = ["xrays.view"];
  assert.equal((await PATCH(req({ category: "XRAY_PANORAMIC" }), par("f1"))).status, 403);
  for (const role of ["ADMIN", "DOCTOR", "RECEPTIONIST"]) {
    ctx.role = role;
    ctx.permissionsOverride = [];
    archivos[0].category = "XRAY_PERIAPICAL";
    assert.equal((await PATCH(req({ category: "XRAY_BITEWING" }), par("f1"))).status, 200, role);
  }
});

test("las notas del doctor siguen pidiendo medicalRecord.edit (recepción no)", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  ctx.role = "RECEPTIONIST";
  const r = await PATCH(req({ doctorNotes: "hola" }), par("f1"));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).permiso, "medicalRecord.edit");
});

test("tenant y estado: archivo de otra clínica o ya quitado → 404; nunca se toca", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  assert.equal((await PATCH(req({ category: "XRAY_PANORAMIC" }), par("ajena"))).status, 404);
  assert.equal((await PATCH(req({ category: "XRAY_PANORAMIC" }), par("f5"))).status, 404);
  assert.equal(archivos[5].category, "XRAY_PERIAPICAL");
  assert.deepEqual(escrituras, []);
});

test("paciente restringido: sin visibilidad → no cambia", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  visibilidadNegada = true;
  assert.equal((await PATCH(req({ category: "XRAY_PANORAMIC" }), par("f1"))).status, 403);
  assert.equal(archivos[0].category, "XRAY_PERIAPICAL");
  assert.deepEqual(auditorias, []);
});

test("validación: tipo inventado, PDF a periapical, set de ortodoncia y STL → 400 sin escribir", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  assert.equal((await PATCH(req({ category: "NO_EXISTE" }), par("f1"))).status, 400);
  assert.equal((await PATCH(req({ category: "XRAY_PERIAPICAL" }), par("f2"))).status, 400, "un PDF no es periapical");
  assert.equal((await PATCH(req({ category: "ORTHO_PHOTO_T1" }), par("f1"))).status, 400, "no se entra a un set de ortodoncia");
  assert.equal((await PATCH(req({ category: "OTHER" }), par("f3"))).status, 400, "no se saca de un set de ortodoncia");
  assert.equal((await PATCH(req({ category: "OTHER" }), par("f4"))).status, 400);
  assert.equal((await PATCH(req({ category: "XRAY_PANORAMIC", doctorNotes: "x" }), par("f1"))).status, 400);
  assert.deepEqual(escrituras, []);
  assert.deepEqual(auditorias, []);
});

test("mismo tipo: idempotente, no escribe ni deja fila en Movimientos", async () => {
  const { PATCH } = await import("@/app/api/xrays/[id]/route");
  const r = await PATCH(req({ category: "XRAY_PERIAPICAL" }), par("f1"));
  assert.equal(r.status, 200);
  assert.deepEqual(escrituras, []);
  assert.deepEqual(auditorias, []);
});

test("reglas puras: lo que se ofrece respeta el formato del archivo", () => {
  assert.ok(!opcionesDeCambioDeTipo("XRAY_PERIAPICAL", "image/png").includes("CEPH_ANALYSIS_PDF" as never));
  assert.ok(!opcionesDeCambioDeTipo("XRAY_PERIAPICAL", "image/png").includes("XRAY_PERIAPICAL" as never));
  assert.deepEqual(opcionesDeCambioDeTipo("OTHER", "application/pdf"), ["CEPH_ANALYSIS_PDF", "CONSENT_FORM"]);
  assert.deepEqual(opcionesDeCambioDeTipo("ORTHO_PHOTO_T2", "image/png"), []);
  assert.deepEqual(opcionesDeCambioDeTipo("SCAN_STL", null), []);
  assert.deepEqual(validarCambioDeTipo({ actual: "OTHER", nuevo: "OTHER", mimeType: null }), { ok: false, motivo: "mismo_tipo" });
  for (const c of CATEGORIAS_SUBIDA_FICHA) assert.ok(NOMBRE_CATEGORIA_ES[c], `${c} sin nombre en español para Movimientos`);
});

test("5g: los chips filtran radiografías, fotos, documentos y ortodoncia por etapa", () => {
  const lista = [
    { category: "XRAY_PANORAMIC" }, { category: "XRAY_CEPHALOMETRIC" }, { category: "XRAY_CBCT" },
    { category: "PHOTO_INTRAORAL" }, { category: "PHOTO_PATIENT" },
    { category: "CEPH_ANALYSIS_PDF" }, { category: "CONSENT_FORM" }, { category: "OTHER" },
    { category: "ORTHO_PHOTO_T0" }, { category: "ORTHO_PHOTO_T1" }, { category: "ORTHO_PHOTO_T1" },
  ];
  assert.deepEqual(contarPorGrupo(lista), { radiografias: 3, fotos: 2, documentos: 3, ortodoncia: 3 });
  assert.equal(filtrarArchivosPorGrupo(lista, SIN_FILTRO).length, 11);
  assert.equal(filtrarArchivosPorGrupo(lista, { grupo: "radiografias", etapa: null }).length, 3);
  assert.equal(filtrarArchivosPorGrupo(lista, { grupo: "ortodoncia", etapa: "ORTHO_PHOTO_T1" }).length, 2);
  assert.equal(filtrarArchivosPorGrupo(lista, { grupo: "ortodoncia", etapa: null }).length, 3);
  // Una categoría desconocida cae en documentos: ningún archivo desaparece al filtrar.
  assert.equal(grupoDeCategoria("ALGO_NUEVO"), "documentos");
  // La etapa solo cuenta dentro de ortodoncia.
  assert.equal(filtrarArchivosPorGrupo(lista, { grupo: "fotos", etapa: "ORTHO_PHOTO_T1" }).length, 2);
});

const raiz = join(__dirname, "../../../../..");
const leer = (r: string) => readFileSync(join(raiz, r), "utf8");

test("pantallas: ficha y visor tienen los chips y «Cambiar tipo» solo con xrays.upload; textos es/en", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const visor = leer("src/app/dashboard/xrays/xrays-client.tsx");
  for (const [n, f] of [["ficha", ficha], ["visor", visor]] as const) {
    assert.ok(f.includes("<ChipsFiltroArchivos"), `${n}: chips`);
    assert.ok(f.includes("<CambiarTipoDialog"), `${n}: diálogo`);
    assert.ok(/puedeCambiarTipo\(/.test(f), `${n}: el botón respeta el formato`);
  }
  assert.ok(/canUploadXrays && puedeCambiarTipo/.test(ficha));
  assert.ok(/canUpload && activeFile && puedeCambiarTipo/.test(visor));
  const claves = ["filtro.todos", "filtro.radiografias", "filtro.fotos", "filtro.documentos", "filtro.ortodoncia", "filtro.todasEtapas", "filtro.etapaT0", "filtro.etapaT1", "filtro.etapaT2", "filtro.etapaControl", "filtro.vacio", "filtro.aria", "cambiarTipo.boton", "cambiarTipo.titulo", "cambiarTipo.actual", "cambiarTipo.nuevo", "cambiarTipo.aviso", "cambiarTipo.guardar", "cambiarTipo.hecho", "cambiarTipo.error"];
  for (const l of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${l}.json`));
    for (const k of claves) assert.equal(typeof k.split(".").reduce((o: any, p) => o?.[p], d.patients.xrays), "string", `${l}: patients.xrays.${k}`);
  }
});

test("el visor cuenta también la lateral de cráneo", () => {
  assert.ok(leer("src/app/dashboard/xrays/page.tsx").includes("'XRAY_CEPHALOMETRIC'"));
});
