// ws1-t3 (auditoría BEVADENT F6): la tarjeta «Banderas de riesgo» decía «Ninguna» con un asma
// marcado. Con el código viejo fallan: no existía el resumen y la tarjeta solo miraba
// computeRiskFlags.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeRiskFlags, RISK_FLAG_LABELS } from "@/lib/health-questionnaire";
import {
  PREGUNTA_DE_CADA_BANDERA,
  preguntasQueLevantanBandera,
  resumenDeBanderas,
} from "../resumen-banderas";
import { textosBanderas } from "@/components/dashboard/pacientes-rediseno/textos-banderas";

describe("qué respuestas levantan bandera", () => {
  it("el espejo dice lo mismo que computeRiskFlags, una por una", () => {
    for (const [bandera, pregunta] of Object.entries(PREGUNTA_DE_CADA_BANDERA)) {
      assert.deepEqual(computeRiskFlags({ [pregunta]: true }), [bandera], pregunta);
    }
    // …y no hay ninguna bandera que el espejo no conozca.
    const todas = Object.values(PREGUNTA_DE_CADA_BANDERA).reduce<Record<string, boolean>>((a, k) => ({ ...a, [k]: true }), {});
    assert.deepEqual(computeRiskFlags(todas).sort(), Object.keys(RISK_FLAG_LABELS).sort());
  });
  it("la lista enseña la pregunta y la bandera", () => {
    const lista = preguntasQueLevantanBandera();
    assert.equal(lista.length, 10);
    assert.deepEqual(lista[0], { bandera: "ANTICOAGULANTES", etiqueta: "Anticoagulantes", pregunta: "Toma anticoagulantes" });
    assert.deepEqual(lista[3], { bandera: "ALERGIA_ANESTESIA", etiqueta: "Alergia a anestesia", pregunta: "Alergia: Anestésicos locales" });
  });
});

describe("resumenDeBanderas", () => {
  it("asma marcada: sin banderas, pero con el padecimiento nombrado", () => {
    const r = resumenDeBanderas({ asthma: true });
    assert.deepEqual(r, { banderas: [], padecimientos: ["Asma"], alergias: [] });
    assert.equal(textosBanderas("es").sinBanderasCon(r), "Sin banderas de riesgo · Padecimientos: Asma");
    assert.equal(textosBanderas("en").sinBanderasCon(r), "No risk flags · Conditions: Asma");
  });
  it("lo que es bandera no se repite como padecimiento", () => {
    const r = resumenDeBanderas({ diabetes: true, epilepsy: true, allergyNsaids: true, allergyPenicillin: true });
    assert.deepEqual(r.banderas, ["ALERGIA_PENICILINA", "DIABETES"]);
    assert.deepEqual(r.padecimientos, ["Epilepsia"]);
    assert.deepEqual(r.alergias, ["AINEs / aspirina"]);
    assert.equal(textosBanderas("es").tambienMarcado(r), "También marcado, sin bandera: Padecimientos: Epilepsia · Alergias: AINEs / aspirina");
  });
  it("«Otras alergias» sin decir cuáles también cuenta; con detalle, salen las escritas", () => {
    assert.deepEqual(resumenDeBanderas({ allergyOther: true }).alergias, ["Otras alergias"]);
    assert.deepEqual(resumenDeBanderas({ allergyOther: true, allergyOtherDetail: "Mariscos, polen" }).alergias, ["Mariscos", "polen"]);
  });
  it("nada marcado: nada que nombrar", () => {
    assert.deepEqual(resumenDeBanderas({}), { banderas: [], padecimientos: [], alergias: [] });
    assert.deepEqual(resumenDeBanderas({ asthma: false }), { banderas: [], padecimientos: [], alergias: [] });
  });
});

describe("la tarjeta", () => {
  const src = readFileSync(join(process.cwd(), "src/components/dashboard/pacientes-rediseno/cuestionario.tsx"), "utf8");
  it("usa el resumen, no solo computeRiskFlags", () => {
    assert.match(src, /resumenDeBanderas\(answers\)/);
    assert.match(src, /txBanderas\.sinBanderasCon\(resumen\)/);
    assert.match(src, /preguntasQueLevantanBandera\(\)/);
  });
  it("«Ninguna respuesta levanta…» solo sale sin nada marcado", () => {
    assert.match(src, /\) : otrosMarcados \? \(\s*<p[^>]*>\s*\{txBanderas\.sinBanderasCon\(resumen\)\}/);
  });
});
