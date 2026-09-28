/**
 * WS1-T4 ronda 6 · G4 — el «Asistente IA Clínico» habla para odontólogos en una
 * clínica dental y conserva el texto de siempre en las demás.
 *
 * Run: npx tsx --test src/lib/ai/__tests__/prompts-asistente.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROMPT_ASISTENTE_DENTAL,
  PROMPT_ASISTENTE_GENERAL,
  asistenteEnClaveDental,
  bienvenidaAsistentePara,
  promptAsistentePara,
  sugerenciasAsistentePara,
} from "../prompts-asistente";

const OTRAS = [
  "MEDICINE", "NUTRITION", "PSYCHOLOGY", "DERMATOLOGY", "AESTHETIC_MEDICINE", "HAIR_RESTORATION",
  "BEAUTY_CENTER", "BROW_LASH", "MASSAGE", "LASER_HAIR_REMOVAL", "HAIR_SALON", "ALTERNATIVE_MEDICINE",
  "NAIL_SALON", "SPA", "PHYSIOTHERAPY", "PODIATRY", "OTHER",
];

test("DENTAL recibe el prompt odontológico: dice «odontólog» y no habla de «médicos»", () => {
  const p = promptAsistentePara("DENTAL");
  assert.equal(p, PROMPT_ASISTENTE_DENTAL);
  assert.match(p, /odontólog/i);
  assert.doesNotMatch(p, /médic/i, "el prompt dental no debe decir médico/médicos/médica");
  assert.doesNotMatch(p, /estudios de laboratorio/i);
});

test("el prompt dental cubre lo que pidió el gerente", () => {
  const p = PROMPT_ASISTENTE_DENTAL;
  assert.match(p, /México/);
  assert.match(p, /NOM-013-SSA2/);
  assert.match(p, /NOM-004/);
  assert.match(p, /diagnósticos diferenciales/i);
  assert.match(p, /dolor orofacial/i);
  assert.match(p, /analgésicos/i);
  assert.match(p, /antibióticos/i);
  assert.match(p, /dosis pediátrica/i);
  assert.match(p, /peso/i);
  assert.match(p, /periapical/i);
  assert.match(p, /panorámica/i);
  assert.match(p, /CBCT/);
});

test("el prompt dental conserva las advertencias de seguridad del general", () => {
  const p = PROMPT_ASISTENTE_DENTAL;
  assert.match(p, /apoyo informativo/i);
  assert.match(p, /NO reemplazas el juicio clínico/);
  assert.match(p, /deben validarse con criterio clínico/);
  assert.match(p, /nombres genéricos/);
  assert.match(p, /las dosis deben ajustarse al paciente/);
  assert.match(p, /urgente o de alta complejidad/);
  assert.match(p, /especialista/);
  assert.match(p, /Máximo 300 palabras/);
});

test("las demás categorías conservan el prompt de siempre", () => {
  for (const c of OTRAS) assert.equal(promptAsistentePara(c), PROMPT_ASISTENTE_GENERAL, c);
  assert.equal(promptAsistentePara(null), PROMPT_ASISTENTE_GENERAL);
  assert.equal(promptAsistentePara(undefined), PROMPT_ASISTENTE_GENERAL);
  assert.equal(promptAsistentePara("dental"), PROMPT_ASISTENTE_GENERAL, "solo DENTAL exacto");
  // El literal no se tocó: primera y última línea del texto original.
  assert.ok(PROMPT_ASISTENTE_GENERAL.startsWith("Eres un asistente clínico de apoyo para médicos en México. \n"));
  assert.ok(PROMPT_ASISTENTE_GENERAL.endsWith("- Máximo 300 palabras por respuesta para ser eficiente"));
  assert.match(PROMPT_ASISTENTE_GENERAL, /NO reemplazas el juicio médico del doctor/);
});

test("asistenteEnClaveDental: solo DENTAL", () => {
  assert.equal(asistenteEnClaveDental("DENTAL"), true);
  for (const c of OTRAS) assert.equal(asistenteEnClaveDental(c), false, c);
});

/* ── tarjetas y bienvenida: las llaves existen en es.json y en.json ───────── */

function leer(idioma: "es" | "en"): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), "src/i18n/dictionaries", `${idioma}.json`), "utf8"));
}
function texto(dic: Record<string, unknown>, llave: string): unknown {
  return llave.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dic);
}

test("tarjetas: cuatro por giro, con los títulos dentales que pidió el gerente", () => {
  const es = leer("es");
  const dental = sugerenciasAsistentePara("DENTAL");
  assert.deepEqual(dental.map((s) => s.id), ["ddx", "dose", "soap", "studies"]);
  assert.deepEqual(dental.map((s) => texto(es, s.titleKey)), [
    "Diagnóstico diferencial bucal",
    "Dosis de medicamento",
    "Redactar nota de evolución",
    "Radiografías a pedir",
  ]);
  const general = sugerenciasAsistentePara("MEDICINE");
  assert.deepEqual(general.map((s) => texto(es, s.titleKey)), [
    "Diagnóstico diferencial",
    "Dosis de medicamento",
    "Redactar SOAP",
    "Estudios a pedir",
  ]);
});

test("todas las llaves de tarjetas y bienvenida existen en es.json y en.json", () => {
  for (const idioma of ["es", "en"] as const) {
    const dic = leer(idioma);
    for (const categoria of ["DENTAL", "MEDICINE"]) {
      const llaves = [
        bienvenidaAsistentePara(categoria),
        ...sugerenciasAsistentePara(categoria).flatMap((s) => [s.titleKey, s.descKey, s.textKey]),
      ];
      for (const llave of llaves) {
        const v = texto(dic, llave);
        assert.equal(typeof v, "string", `${idioma}: falta ${llave}`);
        assert.ok((v as string).length > 0, `${idioma}: ${llave} vacío`);
      }
    }
  }
});

test("la bienvenida dental no habla de SOAP ni de laboratorio y conserva la advertencia", () => {
  const es = leer("es");
  const b = texto(es, bienvenidaAsistentePara("DENTAL")) as string;
  assert.doesNotMatch(b, /SOAP/);
  assert.match(b, /no reemplazan el criterio clínico/);
  assert.equal(bienvenidaAsistentePara("SPA"), "pages.aiAssistant.welcomeText");
});
