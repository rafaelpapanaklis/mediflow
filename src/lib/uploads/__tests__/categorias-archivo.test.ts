/**
 * Tipo de archivo del expediente (ws1-t9, ticket BEVADENT 5a/5c/5d).
 * Run: npx tsx --test src/lib/uploads/__tests__/categorias-archivo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORIAS_SUBIDA_FICHA,
  CLAVE_ETIQUETA_CATEGORIA,
  categoriaSugeridaParaSubida,
} from "../categorias-archivo";
import { guessFileCategory, FILE_CATEGORIES } from "../patient-bulk-file-upload";

const raiz = join(__dirname, "../../../..");
const leer = (r: string) => readFileSync(join(raiz, r), "utf8");

function enumDelEsquema(nombre: string): string[] {
  const m = leer("prisma/schema.prisma").match(new RegExp(`enum ${nombre} \\{([^}]*)\\}`));
  assert.ok(m, `no encontré enum ${nombre}`);
  return m![1].split("\n").map((l) => l.replace(/\/\/.*/, "").trim()).filter(Boolean);
}

test("5c: «Rx lateral» es una cefalométrica, no una periapical", () => {
  assert.equal(guessFileCategory("Rx lateral.jpg"), "XRAY_CEPHALOMETRIC");
  assert.equal(guessFileCategory("Radiografía lateral de cráneo.png"), "XRAY_CEPHALOMETRIC");
  assert.equal(guessFileCategory("teleradiografia_juan.jpg"), "XRAY_CEPHALOMETRIC");
  assert.equal(guessFileCategory("cefalometria.jpg"), "XRAY_CEPHALOMETRIC");
  assert.equal(guessFileCategory("Cefalo Perez.JPEG"), "XRAY_CEPHALOMETRIC");
});

test("5c: el PDF de trazado sigue siendo el análisis y la foto lateral sigue siendo foto", () => {
  assert.equal(guessFileCategory("cefalo_trazado.pdf"), "CEPH_ANALYSIS_PDF");
  assert.equal(guessFileCategory("foto_lateral.jpg"), "PHOTO_LATERAL");
  assert.equal(guessFileCategory("RX periapical 16.jpg"), "XRAY_PERIAPICAL");
  assert.equal(guessFileCategory("rx_21.jpg"), "XRAY_PERIAPICAL");
});

test("5c: la categoría nueva pasa la whitelist del importador", () => {
  assert.ok((FILE_CATEGORIES as readonly string[]).includes("XRAY_CEPHALOMETRIC"));
});

test("5a: la sugerencia de la ficha sale del nombre y es null si el nombre no dice", () => {
  assert.equal(categoriaSugeridaParaSubida("Panoramica Ana.jpg"), "XRAY_PANORAMIC");
  assert.equal(categoriaSugeridaParaSubida("Rx lateral.jpg"), "XRAY_CEPHALOMETRIC");
  assert.equal(categoriaSugeridaParaSubida("CBCT_maxilar.pdf"), "XRAY_CBCT");
  assert.equal(categoriaSugeridaParaSubida("foto_frontal.jpg"), "PHOTO_EXTRAORAL");
  assert.equal(categoriaSugeridaParaSubida("IMG_0341.jpg"), null);
  assert.equal(categoriaSugeridaParaSubida("12345.pdf"), null);
});

test("5a: la sugerencia siempre es una opción que el selector ofrece", () => {
  for (const n of ["a.jpg", "foto_lateral.jpg", "oclusal rx.jpg", "foto_paciente.jpg", "cefalo.pdf", "consentimiento.pdf"]) {
    const c = categoriaSugeridaParaSubida(n);
    if (c) assert.ok((CATEGORIAS_SUBIDA_FICHA as readonly string[]).includes(c), `${n} → ${c}`);
  }
});

test("5a: el selector cubre periapical, panorámica, lateral, CBCT, fotos, PDF y otro", () => {
  for (const c of ["XRAY_PERIAPICAL", "XRAY_PANORAMIC", "XRAY_CEPHALOMETRIC", "XRAY_CBCT", "PHOTO_INTRAORAL", "PHOTO_EXTRAORAL", "CEPH_ANALYSIS_PDF", "OTHER"]) {
    assert.ok((CATEGORIAS_SUBIDA_FICHA as readonly string[]).includes(c), c);
  }
});

test("5d: TODA categoría del esquema tiene etiqueta, y existe en español e inglés", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  const buscar = (d: any, clave: string) => clave.split(".").reduce((o, k) => o?.[k], d);
  for (const c of enumDelEsquema("FileCategory")) {
    const clave = CLAVE_ETIQUETA_CATEGORIA[c];
    assert.ok(clave, `${c} sin clave de etiqueta`);
    for (const [idioma, d] of [["es", es], ["en", en]] as const) {
      const v = buscar(d, clave);
      assert.equal(typeof v, "string", `${c}: falta ${clave} en ${idioma}`);
      assert.notEqual(v, c, `${c} se pintaría como código en ${idioma}`);
    }
  }
});

test("5a: la ficha ya no manda «Periapical» fijo", () => {
  const f = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.ok(!/append\("category", "XRAY_PERIAPICAL"\)/.test(f));
  assert.ok(/append\("category", tipoArchivo\)/.test(f));
});
