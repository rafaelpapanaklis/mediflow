/**
 * WS1-T4 ronda 6 — la ficha general sabe que el paciente tiene un caso de ortodoncia.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/resumen-para-ficha.test.ts
 *
 * Un paciente en el mes 2 de 18 salía en la portada como «Sin tratamiento
 * activo» y en «Plan» como «Sin planes de tratamiento». `resumenOrtoParaFicha`
 * saca de lo que la ficha YA trae cargado lo que hay que decir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeT, type Dictionary } from "@/i18n/t";
import { PHASE_LABELS } from "@/components/specialties/orthodontics/redesign/types";
import { ESTADOS_QUE_CUENTAN_COMO_CASO } from "../pestana-ficha";
import {
  ETIQUETA_FASE_CASO,
  lineaDelCasoTraducida,
  resumenOrtoParaFicha,
  textoDelMes,
  type CasoOrtoCargado,
} from "../resumen-para-ficha";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const diccionario = (idioma: "es" | "en") =>
  JSON.parse(readFileSync(join(RAIZ, "src/i18n/dictionaries", `${idioma}.json`), "utf8")) as Dictionary;

const FASES = [
  { status: "IN_PROGRESS", phaseKey: "ALIGNMENT" },
  { status: "NOT_STARTED", phaseKey: "LEVELING" },
  { status: "NOT_STARTED", phaseKey: "SPACE_CLOSURE" },
];

const caso = (status: string, extra: Partial<CasoOrtoCargado> = {}): CasoOrtoCargado => ({
  plan: { status, estimatedDurationMonths: 18 },
  phases: FASES,
  monthInTreatment: 2,
  ...extra,
});

// ── Los siete casos ──────────────────────────────────────────────────────

test("caso en curso: «Mes 2 de 18 · Alineación»", () => {
  const r = resumenOrtoParaFicha(caso("IN_PROGRESS"));
  assert.ok(r);
  assert.equal(r.estado, "en-curso");
  assert.equal(r.etiquetaEstado, "En curso");
  assert.equal(r.mesActual, 2);
  assert.equal(r.mesesTotales, 18);
  assert.equal(r.fase, "Alineación");
  assert.equal(r.enCurso, true);
  assert.equal(r.abierto, true);
  assert.equal(r.linea, "Mes 2 de 18 · Alineación");
  assert.equal(r.lineaCorta, "Mes 2 de 18");
});

test("caso planeado sin colocar: «Por colocar», y cuenta como abierto", () => {
  const r = resumenOrtoParaFicha(
    caso("PLANNED", { monthInTreatment: 0, phases: FASES.map((f) => ({ ...f, status: "NOT_STARTED" })) }),
  );
  assert.ok(r);
  assert.equal(r.estado, "planeado");
  assert.equal(r.etiquetaEstado, "Por colocar");
  assert.equal(r.mesActual, 0);
  assert.equal(r.fase, null);
  assert.equal(r.enCurso, false);
  assert.equal(r.abierto, true);
  assert.equal(r.linea, "Por colocar");
});

test("en retención: «En retención», abierto pero no en curso", () => {
  const r = resumenOrtoParaFicha(
    caso("RETENTION", { monthInTreatment: 19, phases: [{ status: "IN_PROGRESS", phaseKey: "RETENTION" }] }),
  );
  assert.ok(r);
  assert.equal(r.estado, "retencion");
  assert.equal(r.linea, "En retención");
  assert.equal(r.enCurso, false);
  assert.equal(r.abierto, true);
});

test("pausado: «Pausado», sin decir un mes que ya no avanza", () => {
  const r = resumenOrtoParaFicha(caso("ON_HOLD", { monthInTreatment: 9 }));
  assert.ok(r);
  assert.equal(r.estado, "pausado");
  assert.equal(r.linea, "Pausado");
  assert.doesNotMatch(r.linea, /Mes/);
  assert.equal(r.enCurso, false);
  assert.equal(r.abierto, true);
  // Los datos siguen ahí para quien los quiera.
  assert.equal(r.mesActual, 9);
  assert.equal(r.mesesTotales, 18);
});

test("terminado: no cuenta como tratamiento activo", () => {
  const r = resumenOrtoParaFicha(caso("COMPLETED", { monthInTreatment: 20 }));
  assert.ok(r);
  assert.equal(r.estado, "terminado");
  assert.equal(r.etiquetaEstado, "Terminado");
  assert.equal(r.enCurso, false);
  assert.equal(r.abierto, false);
});

test("abandonado: no cuenta como tratamiento activo", () => {
  const r = resumenOrtoParaFicha(caso("DROPPED_OUT", { monthInTreatment: 7 }));
  assert.ok(r);
  assert.equal(r.estado, "abandonado");
  assert.equal(r.etiquetaEstado, "Abandonado");
  assert.equal(r.enCurso, false);
  assert.equal(r.abierto, false);
});

test("sin caso: null", () => {
  assert.equal(resumenOrtoParaFicha(null), null);
  assert.equal(resumenOrtoParaFicha(undefined), null);
  // Módulo activo y paciente solo valorado: hay datos de ortodoncia, pero no plan.
  assert.equal(resumenOrtoParaFicha({ plan: null, phases: [], monthInTreatment: 0 }), null);
});

// ── Bordes ───────────────────────────────────────────────────────────────

test("un estado desconocido no se anuncia como tratamiento", () => {
  assert.equal(resumenOrtoParaFicha(caso("ALGO_NUEVO")), null);
});

test("en curso sin duración capturada: «Mes 2 · Alineación»", () => {
  const r = resumenOrtoParaFicha({
    plan: { status: "IN_PROGRESS", estimatedDurationMonths: null },
    phases: FASES,
    monthInTreatment: 2,
  });
  assert.equal(r?.linea, "Mes 2 · Alineación");
});

test("en curso sin colocación ni duración: dice «En curso», no «Mes 0»", () => {
  const r = resumenOrtoParaFicha({
    plan: { status: "IN_PROGRESS", estimatedDurationMonths: null },
    phases: [],
    monthInTreatment: 0,
  });
  assert.equal(r?.linea, "En curso");
});

test("en curso sin fase marcada: solo el mes", () => {
  const r = resumenOrtoParaFicha(caso("IN_PROGRESS", { phases: [] }));
  assert.equal(r?.linea, "Mes 2 de 18");
  assert.equal(r?.fase, null);
});

test("dice lo mismo que el resumen del caso (SectionHero): el mes no se recorta", () => {
  // La pestaña Ortodoncia pinta `Mes {monthCurrent} de {monthTotal}` tal cual;
  // un caso atrasado se lee «Mes 20 de 18» en los dos sitios.
  assert.equal(resumenOrtoParaFicha(caso("IN_PROGRESS", { monthInTreatment: 20 }))?.linea, "Mes 20 de 18 · Alineación");
  assert.equal(textoDelMes(0, 18), "Mes 0 de 18");
});

test("números raros no rompen: negativos, NaN y decimales", () => {
  const r = resumenOrtoParaFicha({
    plan: { status: "IN_PROGRESS", estimatedDurationMonths: Number.NaN },
    phases: null,
    monthInTreatment: -3,
  });
  assert.equal(r?.mesActual, 0);
  assert.equal(r?.mesesTotales, 0);
  assert.equal(r?.linea, "En curso");
});

test("todos los estados de un caso están contemplados", () => {
  for (const status of ESTADOS_QUE_CUENTAN_COMO_CASO) {
    assert.ok(resumenOrtoParaFicha(caso(status)), `falta el estado ${status}`);
  }
  const abiertos = ESTADOS_QUE_CUENTAN_COMO_CASO.filter((s) => resumenOrtoParaFicha(caso(s))?.abierto);
  assert.deepEqual([...abiertos].sort(), ["IN_PROGRESS", "ON_HOLD", "PLANNED", "RETENTION"]);
});

// ── Candados: las palabras son las mismas en todas partes ────────────────

test("las fases se llaman igual que en la pestaña Ortodoncia", () => {
  assert.deepEqual(ETIQUETA_FASE_CASO, PHASE_LABELS);
});

test("es.json dice exactamente lo que dice `linea`", () => {
  const t = makeT(diccionario("es"));
  for (const status of ESTADOS_QUE_CUENTAN_COMO_CASO) {
    for (const extra of [{}, { phases: [] }, { monthInTreatment: 0 }] as Partial<CasoOrtoCargado>[]) {
      const r = resumenOrtoParaFicha(caso(status, extra));
      assert.ok(r);
      assert.equal(lineaDelCasoTraducida(r, t), r.linea, `${status} ${JSON.stringify(extra)}`);
      assert.equal(lineaDelCasoTraducida(r, t, { conFase: false }), r.lineaCorta, `corta ${status}`);
    }
  }
  const sinDuracion = resumenOrtoParaFicha({
    plan: { status: "IN_PROGRESS", estimatedDurationMonths: null },
    phases: FASES,
    monthInTreatment: 2,
  });
  assert.ok(sinDuracion);
  assert.equal(lineaDelCasoTraducida(sinDuracion, t), "Mes 2 · Alineación");
});

test("es.json y en.json traen todas las claves del caso", () => {
  const claves = [
    "titulo", "abrir", "mesDe", "mes", "enCurso", "porColocar", "pausado", "enRetencion",
    "terminado", "abandonado", "sinPlanesGenerales",
    ...Object.keys(ETIQUETA_FASE_CASO).map((f) => `fase.${f}`),
  ];
  for (const idioma of ["es", "en"] as const) {
    const t = makeT(diccionario(idioma));
    for (const c of claves) {
      const clave = `pacientesRediseno.casoOrto.${c}`;
      // `t` devuelve la propia clave cuando falta.
      assert.notEqual(t(clave, { mes: 2, total: 18 }), clave, `${idioma}.json no trae ${clave}`);
    }
  }
  const en = makeT(diccionario("en"));
  const r = resumenOrtoParaFicha(caso("IN_PROGRESS"));
  assert.ok(r);
  assert.equal(lineaDelCasoTraducida(r, en), "Month 2 of 18 · Alignment");
});
