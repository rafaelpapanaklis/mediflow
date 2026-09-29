// ws1-t6 — el almacenamiento cuenta TODO lo que la clínica sube y hay UNA sola
// fuente de esa cuenta. Puro (sin base): categorías, suma, avisos al 80/95 %,
// y comprobaciones sobre el código de que cada ruta de subida cuenta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALMACENAMIENTO_AVISO,
  ALMACENAMIENTO_CRITICO,
  CATEGORIAS_ALMACENAMIENTO,
  KINDS_OBJETO_ALMACEN,
  bytesLegibles,
  categoriaDeArchivo,
  categoriaDeObjeto,
  desgloseVacio,
  nivelAlmacenamiento,
  resumirAlmacenamiento,
  sumarEnDesglose,
  totalDesglose,
} from "../storage-usage-core";

const GB = 1024 ** 3;
const raiz = join(__dirname, "..", "..", "..");
const fuente = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");

// ── Cada tipo suma ───────────────────────────────────────────────────────
test("cada FileCategory de patient_files cae en una categoría del desglose", () => {
  const schema = fuente("prisma/schema.prisma");
  const bloque = schema.match(/enum FileCategory \{([\s\S]*?)\n\}/)![1];
  const categorias = bloque
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_0-9]+$/.test(l));
  assert.ok(categorias.length >= 15);
  for (const c of categorias) assert.ok(CATEGORIAS_ALMACENAMIENTO.includes(categoriaDeArchivo(c)), c);
});

test("radiografías, CBCT, fotos, modelos 3D y documentos van cada uno a su categoría", () => {
  assert.equal(categoriaDeArchivo("XRAY_PANORAMIC"), "radiografias");
  assert.equal(categoriaDeArchivo("XRAY_CBCT"), "radiografias");
  assert.equal(categoriaDeArchivo("SCAN_STL", true), "radiografias"); // el zip del CBCT
  assert.equal(categoriaDeArchivo("SCAN_STL"), "modelos3d");
  assert.equal(categoriaDeArchivo("PHOTO_FRONTAL"), "fotos");
  assert.equal(categoriaDeArchivo("ORTHO_PHOTO_T1"), "fotos");
  assert.equal(categoriaDeArchivo("CONSENT_FORM"), "documentos");
  assert.equal(categoriaDeArchivo("OTHER"), "otros");
});

test("cada tipo de objeto registrado (CBCT ligero, GLB, miniatura, firma, comprobante, landing, soporte) suma a algo", () => {
  const esperado: Record<string, string> = {
    CBCT_LITE: "radiografias",
    MODEL_WEB: "modelos3d",
    PHOTO_THUMB: "fotos",
    RECEIPT: "documentos",
    SIGNATURE: "otros",
    LANDING: "otros",
    SUPPORT: "otros",
  };
  assert.deepEqual(Object.keys(esperado).sort(), [...KINDS_OBJETO_ALMACEN].sort());
  for (const k of KINDS_OBJETO_ALMACEN) {
    assert.equal(categoriaDeObjeto(k), esperado[k]);
    const d = desgloseVacio();
    sumarEnDesglose(d, [{ clave: k, bytes: 500 * 1024 * 1024 }], categoriaDeObjeto);
    assert.equal(totalDesglose(d), 500 * 1024 * 1024, k);
  }
});

test("un CBCT de cientos de MB cuenta en GB de la clínica", () => {
  const d = desgloseVacio();
  sumarEnDesglose(d, [{ clave: "SCAN_STL:CBCT", bytes: 600 * 1024 * 1024 }], () => "radiografias");
  const r = resumirAlmacenamiento(d, 5 * GB);
  assert.equal(r.usado, 600 * 1024 * 1024);
  assert.equal(r.desglose.radiografias, 600 * 1024 * 1024);
});

test("bytes negativos o NaN no restan ni rompen la suma", () => {
  const d = desgloseVacio();
  sumarEnDesglose(d, [{ clave: "OTHER", bytes: -50 }, { clave: "OTHER", bytes: NaN }, { clave: "OTHER", bytes: 10 }], categoriaDeArchivo);
  assert.equal(totalDesglose(d), 10);
});

// ── Límite y avisos ──────────────────────────────────────────────────────
test("umbrales: 80 % aviso, 95 % crítico, 100 % lleno; sin tope siempre ok", () => {
  assert.equal(ALMACENAMIENTO_AVISO, 0.8);
  assert.equal(ALMACENAMIENTO_CRITICO, 0.95);
  assert.equal(nivelAlmacenamiento(0.79 * GB, GB), "ok");
  assert.equal(nivelAlmacenamiento(0.8 * GB, GB), "aviso");
  assert.equal(nivelAlmacenamiento(0.949 * GB, GB), "aviso");
  assert.equal(nivelAlmacenamiento(0.95 * GB, GB), "critico");
  assert.equal(nivelAlmacenamiento(GB, GB), "lleno");
  assert.equal(nivelAlmacenamiento(2 * GB, GB), "lleno");
  assert.equal(nivelAlmacenamiento(999 * GB, null), "ok");
  assert.equal(nivelAlmacenamiento(999 * GB, 0), "ok");
});

test("resumen: porcentaje saturado a 100, null sin tope, total = suma del desglose", () => {
  const d = desgloseVacio();
  d.fotos = 2 * GB;
  d.radiografias = 4 * GB;
  const r = resumirAlmacenamiento(d, 5 * GB);
  assert.equal(r.usado, 6 * GB);
  assert.equal(r.porcentaje, 100);
  assert.equal(r.nivel, "lleno");
  assert.equal(resumirAlmacenamiento(d, null).porcentaje, null);
});

test("bytesLegibles: «X GB de Y GB»", () => {
  assert.equal(bytesLegibles(5 * GB), "5 GB");
  assert.equal(bytesLegibles(12.44 * GB), "12.4 GB");
  assert.equal(bytesLegibles(830 * 1024 * 1024), "830 MB");
  assert.equal(bytesLegibles(0), "0 MB");
  assert.equal(bytesLegibles(1000), "<1 MB");
});

// ── Una sola fuente ──────────────────────────────────────────────────────
test("la cuota de subida, la tarjeta de Suscripción y /admin leen medirAlmacenamiento", () => {
  assert.match(fuente("src/lib/storage-quota.ts"), /medirAlmacenamientoDeClinica/);
  assert.match(fuente("src/app/api/storage/usage/route.ts"), /medirAlmacenamiento\(/);
  const admin = fuente("src/lib/admin/uso-clinica.ts");
  assert.match(admin, /medirAlmacenamiento\(ids\)/);
  // Ya no hay una segunda suma a mano en /admin.
  assert.doesNotMatch(admin, /patientFile\.groupBy|clinicalPhoto\.groupBy|patientUpload\.groupBy/);
  assert.doesNotMatch(fuente("src/lib/storage-quota.ts"), /aggregate\(/);
});

test("la fotos quitadas cuentan hasta que el binario sale del bucket", () => {
  const uso = fuente("src/lib/storage-usage.ts");
  // clinical_photos se suma SIN filtrar deletedAt.
  const consultaFotos = uso.match(/clinicalPhoto\.groupBy\(\{[^}]*\}/)![0];
  assert.doesNotMatch(consultaFotos, /deletedAt/);
  const acciones = fuente("src/app/actions/clinical-shared/photos.ts");
  // Solo se libera (sizeBytes 0) si el borrado del bucket tuvo éxito.
  assert.match(acciones, /principalBorrada && miniaturaBorrada/);
  assert.match(acciones, /sizeBytes: 0/);
  // patient_files (borrado lógico con blob preservado) tampoco se filtra.
  assert.doesNotMatch(uso.match(/patientFile\.groupBy\(\{ by: \["clinicId", "category"\][^}]*\}/)![0], /deletedAt/);
});

// ── Cada ruta cuenta ─────────────────────────────────────────────────────
const RUTAS_QUE_REGISTRAN: Array<[string, string]> = [
  ["src/app/api/patients/[id]/dicom-set/[fileId]/lite/route.ts", "CBCT_LITE"],
  ["src/app/api/patients/[id]/models-3d/route.ts", "MODEL_WEB"],
  ["src/app/api/patients/[id]/uploads/confirm/route.ts", "MODEL_WEB"],
  ["src/app/api/orthodontics/photos/upload/route.ts", "PHOTO_THUMB"],
  ["src/lib/consent/signature.ts", "SIGNATURE"],
  ["src/app/api/presupuesto/[token]/route.ts", "SIGNATURE"],
  ["src/app/api/landing-upload/route.ts", "LANDING"],
  ["src/app/api/ai-wallet/spei/topup/route.ts", "RECEIPT"],
  ["src/lib/inventory/comprobante.server.ts", "RECEIPT"],
  ["src/app/api/support/attachments/route.ts", "SUPPORT"],
  ["src/app/api/import/assisted/route.ts", "SUPPORT"],
];

test("cada ruta que sube algo sin columna de tamaño lo registra con su kind", () => {
  for (const [ruta, kind] of RUTAS_QUE_REGISTRAN) {
    const src = fuente(ruta);
    assert.match(src, /registrarObjetoAlmacen/, ruta);
    assert.ok(src.includes(`kind: "${kind}"`), `${ruta} debe registrar ${kind}`);
  }
  const usados = new Set(RUTAS_QUE_REGISTRAN.map(([, k]) => k));
  for (const k of KINDS_OBJETO_ALMACEN) assert.ok(usados.has(k), `ninguna ruta registra ${k}`);
});

const RUTAS_CON_CUOTA_ANTES_DE_SUBIR: Array<[string, RegExp]> = [
  ["src/app/api/patients/[id]/dicom-set/[fileId]/lite/route.ts", /storageQuotaError[\s\S]*\.upload\(litePath/],
  ["src/app/api/patients/[id]/models-3d/route.ts", /storageQuotaError\(ctx\.clinicId, glb\.length\)[\s\S]*\.upload\(webPath/],
  ["src/app/api/patients/[id]/uploads/confirm/route.ts", /storageQuotaError\(ctx\.clinicId, glb\.length\)[\s\S]*\.upload\(webPath/],
  ["src/app/api/landing-upload/route.ts", /storageQuotaError[\s\S]*\.upload\(path/],
  ["src/app/api/ai-wallet/spei/topup/route.ts", /storageQuotaError[\s\S]*\.upload\(path/],
  ["src/app/api/support/attachments/route.ts", /storageQuotaError[\s\S]*\.upload\(path/],
  ["src/app/api/import/assisted/route.ts", /storageQuotaError[\s\S]*\.upload\(path/],
  ["src/lib/inventory/comprobante.server.ts", /storage-quota"\)[\s\S]*storageQuotaError[\s\S]*uploadFileToStorage\(path/],
  ["src/app/api/dental-labs/[labId]/ordenes/[orderId]/files/route.ts", /storageQuotaError[\s\S]*\.upload\(path/],
  ["src/app/api/paciente/documentos/subir/route.ts", /storageQuotaError[\s\S]*uploadFileToStorage\(storageKey/],
  ["src/app/api/paciente/ortodoncia/monitoreo/route.ts", /storageQuotaError[\s\S]*uploadFileToStorage\(storageKey/],
  // Las que ya la llamaban siguen llamándola:
  ["src/app/api/xrays/route.ts", /storageQuotaError[\s\S]*\.upload\(path/],
  ["src/app/api/orthodontics/photos/upload/route.ts", /storageQuotaError[\s\S]*\.upload\(originalPath/],
  ["src/app/api/orthodontics/imagen/upload/route.ts", /storageQuotaError[\s\S]*\.upload\(path/],
  ["src/app/api/patients/[id]/models-3d/route.ts", /storageQuotaError\(ctx\.clinicId, \(file as Blob\)\.size\)[\s\S]*\.upload\(path/],
];

test("cada ruta llama a storageQuotaError ANTES de subir", () => {
  for (const [ruta, re] of RUTAS_CON_CUOTA_ANTES_DE_SUBIR) {
    assert.match(fuente(ruta), re, ruta);
  }
});

test("las firmas se anotan pero NUNCA se bloquean por cuota (el consentimiento no se pierde)", () => {
  assert.doesNotMatch(fuente("src/lib/consent/signature.ts"), /storageQuotaError/);
  assert.doesNotMatch(fuente("src/app/api/presupuesto/[token]/route.ts"), /storageQuotaError/);
});

test("el aviso del panel y la tarjeta viven en Suscripción / Hoy", () => {
  assert.match(fuente("src/components/dashboard/subscription-tab.tsx"), /<StorageUsageCard/);
  assert.match(fuente("src/app/dashboard/page.tsx"), /<StorageQuotaBanner/);
});

test("el SQL es aditivo e idempotente", () => {
  const sql = fuente("sql/ws1-t6-clinic-storage-objects.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "clinic_storage_objects"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  const sinComentarios = sql.replace(/--.*$/gm, "").replace(/ON DELETE CASCADE/g, "");
  assert.doesNotMatch(sinComentarios, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/i);
});
