// ws1-t3 (auditoría BEVADENT F1): Ortodoncia pedía el consentimiento aunque hubiera uno firmado,
// porque solo contaba procedureKey «ortodoncia» y las cartas hechas desde una plantilla de la
// clínica se guardaban con procedureKey null.
//
// Con el código viejo fallan: la plantilla de la clínica sale con procedureKey null, el alta y
// Documentos no usan el filtro común, y el aviso no dice qué carta busca.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAVE_ORTODONCIA,
  NOMBRE_CARTA_ORTODONCIA,
  claveDePlantillaPorNombre,
  esConsentimientoDeOrtodoncia,
  whereConsentimientoDeOrtodoncia,
} from "../consentimiento-ortodoncia";
import { resolveClinicConsentTemplate, type ClinicTemplatesDb } from "../clinic-templates";
import { textosConsentimientoOrto } from "@/components/specialties/orthodontics/redesign/textos-consentimiento-orto";

const raiz = process.cwd();
const leer = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");

// ── Prisma de mentira: interpreta el `where` que devuelve el filtro, igual que la base ──
type Fila = { procedureKey: string | null; procedure: string };
type Cond = Record<string, unknown>;
function cumple(f: Fila, w: Cond): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Cond[]).some((c) => cumple(f, c));
    if (k === "NOT") return !cumple(f, v as Cond);
    const valor = (f as unknown as Record<string, unknown>)[k];
    if (v === null || typeof v !== "object") return valor === v;
    const op = v as { contains?: string; startsWith?: string; mode?: string };
    const a = String(valor ?? "").toLowerCase();
    if (op.contains != null) return a.includes(op.contains.toLowerCase());
    if (op.startsWith != null) return a.startsWith(op.startsWith.toLowerCase());
    throw new Error(`operador no previsto: ${JSON.stringify(v)}`);
  });
}

const CASOS: Array<[Fila, boolean, string]> = [
  [{ procedureKey: "ortodoncia", procedure: "Ortodoncia (brackets o alineadores)" }, true, "la del catálogo"],
  [{ procedureKey: null, procedure: "Consentimiento de Ortodoncia BEVADENT" }, true, "plantilla de la clínica ya creada"],
  [{ procedureKey: null, procedure: "ORTODONCIA" }, true, "título en mayúsculas"],
  [{ procedureKey: null, procedure: "Asentimiento del menor — ortodoncia" }, false, "el asentimiento NO es el consentimiento"],
  [{ procedureKey: null, procedure: "Endodoncia" }, false, "otra carta"],
  [{ procedureKey: "extraccion-simple", procedure: "Extracción previa a ortodoncia" }, false, "otra clave del catálogo"],
];

describe("¿es la carta de ortodoncia?", () => {
  for (const [fila, esperado, nombre] of CASOS) {
    it(`${nombre}: ${esperado ? "sí" : "no"}`, () => {
      assert.equal(esConsentimientoDeOrtodoncia(fila), esperado);
      // El filtro de la base dice lo mismo que la regla en memoria.
      assert.equal(cumple(fila, whereConsentimientoDeOrtodoncia()), esperado);
    });
  }
});

describe("de qué procedimiento es una plantilla de la clínica", () => {
  it("el nombre sembrado del catálogo da su clave", () => {
    assert.equal(claveDePlantillaPorNombre("Ortodoncia (brackets o alineadores)"), CLAVE_ORTODONCIA);
    assert.equal(claveDePlantillaPorNombre("Endodoncia (tratamiento de conductos)"), "endodoncia");
  });
  it("un nombre propio que dice «ortodoncia» es la de ortodoncia", () => {
    assert.equal(claveDePlantillaPorNombre("Consentimiento ortodóncia Bevadent"), CLAVE_ORTODONCIA);
    assert.equal(claveDePlantillaPorNombre("Carta de Ortodoncia"), CLAVE_ORTODONCIA);
  });
  it("lo que no se sabe sigue en null", () => {
    assert.equal(claveDePlantillaPorNombre("Endodoncia propia"), null);
    assert.equal(claveDePlantillaPorNombre("Asentimiento del menor — ortodoncia"), null);
    assert.equal(claveDePlantillaPorNombre(""), null);
  });

  it("crear desde la plantilla de la clínica guarda procedureKey «ortodoncia» (antes null)", async () => {
    const db = {
      documentTemplate: {
        count: async () => 1,
        createMany: async () => ({ count: 0 }),
        findMany: async () => [],
        findFirst: async ({ where }: { where: { id?: string; clinicId: string } }) =>
          where.id === "tpl_orto" && where.clinicId === "clinica_qa_prueba"
            ? { name: "Ortodoncia BEVADENT", body: "<p>CARTA</p>" }
            : null,
      },
    } as unknown as ClinicTemplatesDb;
    const out = await resolveClinicConsentTemplate("clinica_qa_prueba", "tpl_orto", db);
    assert.equal(out?.procedureKey, CLAVE_ORTODONCIA);
  });
});

describe("el alta y Documentos de Ortodoncia usan el mismo filtro", () => {
  it("getCaseIntakeOptions ya no busca solo procedureKey «ortodoncia»", () => {
    const src = leer("src/app/actions/orthodontics/getCaseIntakeOptions.ts");
    assert.match(src, /\.\.\.whereConsentimientoDeOrtodoncia\(\)/);
    assert.doesNotMatch(src, /procedureKey:\s*"ortodoncia"/);
  });
  it("Documentos (loader) lee las mismas cartas", () => {
    const src = leer("src/lib/orthodontics/redesign/loader.ts");
    assert.match(src, /whereConsentimientoDeOrtodoncia\(\)\.OR/);
  });
});

describe("el aviso dice qué carta busca", () => {
  for (const locale of ["es", "en"]) {
    it(locale, () => {
      const tx = textosConsentimientoOrto(locale);
      assert.ok(tx.cuerpo.includes(NOMBRE_CARTA_ORTODONCIA), tx.cuerpo);
      assert.ok(tx.cuerpo.includes("«ortodoncia»"), tx.cuerpo);
    });
  }
  it("el componente usa esos textos", () => {
    const src = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
    assert.match(src, /useTextosConsentimientoOrto\(\)/);
    assert.doesNotMatch(src, /consentimiento general de ortodoncia firmado en «Consentimientos»/);
  });
});
