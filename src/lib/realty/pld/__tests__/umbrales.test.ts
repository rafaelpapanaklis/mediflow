// ═══════════════════════════════════════════════════════════════════════
// ARITMÉTICA DE LOS UMBRALES ANTILAVADO.
//
// Pruebas PURAS: sin Postgres, sin sesión, sin navegador.
//
//   npx tsx --test src/lib/realty/pld/__tests__/umbrales.test.ts
//
// (Sin script en package.json a propósito: el guardia del vertical marca
// package.json como PROHIBIDO.)
//
// 🔴 POR QUÉ ESTA PRUEBA IMPORTA MÁS QUE LA MEDIA. Un umbral mal calculado
// no se ve como un error: se ve como una pantalla tranquila. La inmobiliaria
// se entera de que le faltaba integrar el expediente cuando le llega la
// multa, dos años después. La red tiene que estar aquí.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";

import type { RawCalcParamRow } from "../../calc/catalog";
import { toCents } from "../../calc/money";
import {
  diasEntre,
  fechaDeCalendario,
  documentosRequeridos,
  estadoDeExpediente,
  etiquetaPeriodo,
  evaluarOperacion,
  fechaLocalISO,
  periodoDeFecha,
  periodosRecientes,
  resolvePldParams,
  riesgoDeExpediente,
  sumarAnios,
  sumarHoras,
  umbralesEnPesos,
  vencimientoDelPeriodo,
  type PldParams,
} from "../umbrales";
import { PLD_BLOQUE_SEMILLA, PLD_SEED_UMA_DIARIA } from "../seed";

// ── Utilidades de la prueba ────────────────────────────────────────────

function filaUma(overrides: Partial<RawCalcParamRow> = {}): RawCalcParamRow {
  return {
    kind: "UMA",
    stateCode: "MX",
    year: 2026,
    value: PLD_SEED_UMA_DIARIA,
    meta: { mensual: 3566.22, anual: 42794.64, pld: { ...PLD_BLOQUE_SEMILLA } },
    effectiveFrom: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

const HOY = new Date("2026-08-25T12:00:00.000Z");

function params(): PldParams {
  const r = resolvePldParams([filaUma()], HOY);
  assert.equal(r.ok, true, "la fila de prueba debería resolver");
  return r.params as PldParams;
}

// ── 1. Resolución de parámetros ────────────────────────────────────────

test("sin ninguna fila UMA, degrada con la lista de lo que falta — no revienta", () => {
  const r = resolvePldParams([], HOY);
  assert.equal(r.ok, false);
  assert.equal(r.params, undefined);
  assert.ok(r.faltantes.length >= 1);
  assert.match(r.faltantes[0].etiqueta, /UMA/);
  // El texto tiene que decir DÓNDE se arregla, o el aviso no sirve de nada.
  assert.match(r.faltantes[0].comoResolver, /Par[áa]metros/);
});

test("con la fila UMA pero SIN el bloque pld, dice que faltan los umbrales", () => {
  const r = resolvePldParams([filaUma({ meta: { mensual: 3566.22 } })], HOY);
  assert.equal(r.ok, false);
  assert.equal(r.faltantes.length, 1);
  assert.match(r.faltantes[0].etiqueta, /[Uu]mbrales antilavado/);
});

test("un umbral fuera de rango se trata como faltante, no se cuela", () => {
  // Día de corte 31: no existe en febrero. El editor de /admin acepta JSON
  // crudo, así que la cordura se comprueba al LEER.
  const roto = { ...PLD_BLOQUE_SEMILLA, diaLimiteAviso: 31 };
  const r = resolvePldParams([filaUma({ meta: { pld: roto } })], HOY);
  assert.equal(r.ok, false);
  assert.ok(r.faltantes.some((f) => /[Dd][íi]a del mes siguiente/.test(f.etiqueta)));
});

test("una UMA en cero no produce umbrales de cero: se reporta como faltante", () => {
  const r = resolvePldParams([filaUma({ value: 0 })], HOY);
  assert.equal(r.ok, false);
  assert.match(r.faltantes[0].etiqueta, /cero o negativa/);
});

test("porVerificar enciende un aviso visible, no se traga en silencio", () => {
  const r = resolvePldParams([filaUma()], HOY);
  assert.equal(r.ok, true);
  assert.ok(r.avisos.some((a) => /NO VERIFICADOS/.test(a)));
});

test("una UMA de un año viejo avisa que hay que capturar la nueva", () => {
  const vieja = filaUma({ year: 2025, effectiveFrom: "2025-02-01T00:00:00.000Z" });
  const r = resolvePldParams([vieja], HOY);
  assert.equal(r.ok, true);
  assert.ok(r.avisos.some((a) => /2025/.test(a) && /2026/.test(a)));
});

test("pickVigente elige la fila vigente ESE día, no la más nueva", () => {
  const y2025 = filaUma({ year: 2025, value: 113.14, effectiveFrom: "2025-02-01T00:00:00.000Z" });
  const y2026 = filaUma();
  // Una operación de enero de 2026 todavía se mide con la UMA de 2025:
  // la nueva entra en vigor el 1 de febrero.
  const r = resolvePldParams([y2025, y2026], new Date("2026-01-15T12:00:00.000Z"));
  assert.equal(r.ok, true);
  assert.equal((r.params as PldParams).year, 2025);
  assert.equal((r.params as PldParams).umaDiariaCents, 11314);
});

// ── 2. Los umbrales en pesos ───────────────────────────────────────────

test("los umbrales se derivan de la UMA con multiplicación EXACTA de enteros", () => {
  const p = params();
  assert.equal(p.umaDiariaCents, 11731, "117.31 pesos = 11 731 centavos");

  const u = umbralesEnPesos(p);
  // 11 731 × 8 025 = 94 141 275 centavos = $941 412.75
  assert.equal(u.identificacionCents, 94_141_275);
  assert.equal(u.identificacionCents, toCents(941_412.75));
  // 11 731 × 16 000 = 187 696 000 centavos = $1 876 960.00
  assert.equal(u.avisoCents, 187_696_000);
  assert.equal(u.avisoCents, toCents(1_876_960));
  // El tope de efectivo comparte el umbral de identificación.
  assert.equal(u.efectivoCents, u.identificacionCents);
});

test("si cambia la UMA, los tres umbrales se mueven solos", () => {
  // La UMA de 2025 valía 113.14. Nadie tuvo que corregir tres números.
  const r = resolvePldParams(
    [filaUma({ year: 2025, value: 113.14, effectiveFrom: "2025-02-01T00:00:00.000Z" })],
    HOY,
  );
  const u = umbralesEnPesos(r.params as PldParams);
  assert.equal(u.identificacionCents, 11_314 * 8_025);
  assert.equal(u.avisoCents, 11_314 * 16_000);
});

// ── 3. LOS TRES CASOS DEL ENCARGO ──────────────────────────────────────

test("$900,000 NO rebasa ningún umbral", () => {
  const e = evaluarOperacion({ montoCents: toCents(900_000), efectivoCents: 0 }, params());
  assert.equal(e.nivel, "NINGUNO");
  assert.equal(e.requiereExpediente, false);
  assert.equal(e.requiereAviso, false);
  // Y dice cuánto le falta, que es lo accionable.
  assert.equal(e.faltaIdentificacionCents, 94_141_275 - 90_000_000);
});

test("$1,000,000 rebasa el umbral de IDENTIFICACIÓN pero no el de aviso", () => {
  const e = evaluarOperacion({ montoCents: toCents(1_000_000), efectivoCents: 0 }, params());
  assert.equal(e.nivel, "IDENTIFICACION");
  assert.equal(e.requiereExpediente, true);
  assert.equal(e.requiereAviso, false);
  assert.equal(e.faltaIdentificacionCents, 0);
  assert.equal(e.faltaAvisoCents, 187_696_000 - 100_000_000);
});

test("$2,000,000 rebasa el umbral de AVISO", () => {
  const e = evaluarOperacion({ montoCents: toCents(2_000_000), efectivoCents: 0 }, params());
  assert.equal(e.nivel, "AVISO");
  assert.equal(e.requiereAviso, true);
  // Quien tiene que avisar tuvo que identificar antes: nunca sale en false.
  assert.equal(e.requiereExpediente, true);
  assert.equal(e.faltaAvisoCents, 0);
});

// ── 4. El borde exacto: "igual o superior", no "mayor que" ─────────────

test("EXACTAMENTE en el umbral de identificación: SÍ obliga", () => {
  const p = params();
  const e = evaluarOperacion({ montoCents: 94_141_275, efectivoCents: 0 }, p);
  assert.equal(e.nivel, "IDENTIFICACION");
  assert.equal(e.requiereExpediente, true);
});

test("UN CENTAVO por debajo del umbral de identificación: no obliga", () => {
  const e = evaluarOperacion({ montoCents: 94_141_274, efectivoCents: 0 }, params());
  assert.equal(e.nivel, "NINGUNO");
  assert.equal(e.requiereExpediente, false);
  assert.equal(e.faltaIdentificacionCents, 1);
});

test("EXACTAMENTE en el umbral de aviso: SÍ obliga", () => {
  const e = evaluarOperacion({ montoCents: 187_696_000, efectivoCents: 0 }, params());
  assert.equal(e.nivel, "AVISO");
  assert.equal(e.requiereAviso, true);
});

test("UN CENTAVO por debajo del umbral de aviso: se queda en identificación", () => {
  const e = evaluarOperacion({ montoCents: 187_695_999, efectivoCents: 0 }, params());
  assert.equal(e.nivel, "IDENTIFICACION");
  assert.equal(e.requiereAviso, false);
  assert.equal(e.faltaAvisoCents, 1);
});

// ── 5. Efectivo prohibido ──────────────────────────────────────────────

test("efectivo EXACTAMENTE en el tope: bandera roja", () => {
  const e = evaluarOperacion(
    { montoCents: toCents(3_000_000), efectivoCents: 94_141_275 },
    params(),
  );
  assert.equal(e.efectivoProhibido, true);
  assert.equal(e.excedenteEfectivoCents, 0);
});

test("efectivo un centavo por debajo del tope: sin bandera", () => {
  const e = evaluarOperacion(
    { montoCents: toCents(3_000_000), efectivoCents: 94_141_274 },
    params(),
  );
  assert.equal(e.efectivoProhibido, false);
  assert.equal(e.excedenteEfectivoCents, 0);
});

test("el excedente de efectivo se reporta con su monto", () => {
  const e = evaluarOperacion(
    { montoCents: toCents(3_000_000), efectivoCents: 94_141_275 + 50_000 },
    params(),
  );
  assert.equal(e.efectivoProhibido, true);
  assert.equal(e.excedenteEfectivoCents, 50_000);
});

test("una operación chica pagada TODA en efectivo no dispara la bandera", () => {
  // El tope es del efectivo, no del monto. $500 000 en efectivo es legal.
  const e = evaluarOperacion(
    { montoCents: toCents(500_000), efectivoCents: toCents(500_000) },
    params(),
  );
  assert.equal(e.nivel, "NINGUNO");
  assert.equal(e.efectivoProhibido, false);
});

test("montos negativos o basura no producen niveles ni NaN", () => {
  const e = evaluarOperacion({ montoCents: -1, efectivoCents: NaN }, params());
  assert.equal(e.nivel, "NINGUNO");
  assert.equal(e.montoCents, 0);
  assert.equal(e.efectivoCents, 0);
  assert.equal(Number.isFinite(e.faltaAvisoCents), true);
});

// ── 6. Calendario del corte ────────────────────────────────────────────

test("el aviso de un mes vence el día de corte del mes SIGUIENTE", () => {
  const d = vencimientoDelPeriodo("2026-03", 17);
  assert.equal(d.toISOString().slice(0, 10), "2026-04-17");
});

test("diciembre vence en enero del año siguiente", () => {
  const d = vencimientoDelPeriodo("2026-12", 17);
  assert.equal(d.toISOString().slice(0, 10), "2027-01-17");
});

test("enero vence en febrero, sin desbordar el año", () => {
  assert.equal(vencimientoDelPeriodo("2026-01", 17).toISOString().slice(0, 10), "2026-02-17");
});

test("el periodo se calcula en la zona horaria de la cuenta, no en UTC", () => {
  // 31 de marzo, 19:00 en México = 1 de abril 01:00 UTC. Si se usara UTC,
  // esta venta caería en el aviso del mes equivocado.
  const cierre = new Date("2026-04-01T01:00:00.000Z");
  assert.equal(periodoDeFecha(cierre, "America/Mexico_City"), "2026-03");
  assert.equal(periodoDeFecha(cierre, "UTC"), "2026-04");
  assert.equal(fechaLocalISO(cierre, "America/Mexico_City"), "2026-03-31");
});

test("una zona horaria inválida cae a UTC en vez de reventar", () => {
  assert.equal(fechaLocalISO(new Date("2026-03-15T12:00:00.000Z"), "Marte/Olimpo"), "2026-03-15");
});

test("los periodos recientes salen del más nuevo al más viejo y cruzan el año", () => {
  const p = periodosRecientes(new Date("2026-02-10T12:00:00.000Z"), 4, "UTC");
  assert.deepEqual(p, ["2026-02", "2026-01", "2025-12", "2025-11"]);
});

test("la etiqueta del periodo se lee en español", () => {
  assert.equal(etiquetaPeriodo("2026-03"), "marzo de 2026");
  assert.equal(etiquetaPeriodo("2026-12"), "diciembre de 2026");
});

test("los días que faltan para el corte se cuentan por calendario", () => {
  const hoy = new Date("2026-04-10T23:30:00.000Z");
  assert.equal(diasEntre(hoy, vencimientoDelPeriodo("2026-03", 17)), 7);
  // Ya vencido → negativo.
  assert.equal(diasEntre(new Date("2026-04-20T00:00:00.000Z"), vencimientoDelPeriodo("2026-03", 17)), -3);
});

test("el plazo urgente y la bóveda se calculan con el parámetro, no con constantes", () => {
  const p = params();
  const flag = new Date("2026-08-25T10:00:00.000Z");
  assert.equal(
    sumarHoras(flag, p.horasAvisoUrgente).toISOString(),
    "2026-08-26T10:00:00.000Z",
  );
  assert.equal(
    sumarAnios(flag, p.aniosConservacion).toISOString().slice(0, 10),
    "2036-08-25",
  );
});

// ── 7. Expediente ──────────────────────────────────────────────────────

const FISICA_LLENA = {
  personKind: "FISICA" as const,
  rfc: "XAXX010101000",
  curp: "XAXX010101HDFAAA01",
  occupation: "Comerciante",
  address: "Calle 1, Guadalajara",
  pep: "NO" as const,
  pepAskedAt: new Date("2026-08-01T00:00:00.000Z"),
  beneficialOwnersCount: 0,
};

const DOCS_FISICA = [
  { kind: "IDENTIFICACION" as const, expiresAt: null, archivedAt: null },
  {
    kind: "COMPROBANTE_DOMICILIO" as const,
    expiresAt: new Date("2026-11-01T00:00:00.000Z"),
    archivedAt: null,
  },
  { kind: "CONSTANCIA_FISCAL" as const, expiresAt: null, archivedAt: null },
];

test("una persona moral pide más papeles que una física, incluido el beneficiario", () => {
  const fisica = documentosRequeridos("FISICA");
  const moral = documentosRequeridos("MORAL");
  assert.ok(!fisica.includes("BENEFICIARIO_CONTROLADOR"));
  assert.ok(moral.includes("BENEFICIARIO_CONTROLADOR"));
  assert.ok(moral.includes("ACTA_CONSTITUTIVA"));
  assert.equal(documentosRequeridos("FIDEICOMISO").length, moral.length);
});

test("expediente con todo: COMPLETO", () => {
  const r = estadoDeExpediente(FISICA_LLENA, DOCS_FISICA, HOY);
  assert.equal(r.estado, "COMPLETO");
  assert.equal(r.faltantes.length, 0);
  assert.equal(r.datosFaltantes.length, 0);
});

test("falta un papel: INCOMPLETO, y dice CUÁL", () => {
  const r = estadoDeExpediente(FISICA_LLENA, DOCS_FISICA.slice(1), HOY);
  assert.equal(r.estado, "INCOMPLETO");
  assert.deepEqual(r.faltantes, ["IDENTIFICACION"]);
});

test("un papel archivado ya no cuenta como presente", () => {
  const docs = DOCS_FISICA.map((d) =>
    d.kind === "CONSTANCIA_FISCAL" ? { ...d, archivedAt: HOY } : d,
  );
  const r = estadoDeExpediente(FISICA_LLENA, docs, HOY);
  assert.equal(r.estado, "INCOMPLETO");
  assert.deepEqual(r.faltantes, ["CONSTANCIA_FISCAL"]);
});

test("todo presente pero un comprobante caducado: VENCIDO", () => {
  const docs = DOCS_FISICA.map((d) =>
    d.kind === "COMPROBANTE_DOMICILIO"
      ? { ...d, expiresAt: new Date("2026-01-01T00:00:00.000Z") }
      : d,
  );
  const r = estadoDeExpediente(FISICA_LLENA, docs, HOY);
  assert.equal(r.estado, "VENCIDO");
  assert.deepEqual(r.vencidos, ["COMPROBANTE_DOMICILIO"]);
});

test("un comprobante nuevo encima de uno caducado deja el expediente COMPLETO", () => {
  const docs = [
    ...DOCS_FISICA,
    {
      kind: "COMPROBANTE_DOMICILIO" as const,
      expiresAt: new Date("2025-01-01T00:00:00.000Z"),
      archivedAt: null,
    },
  ];
  const r = estadoDeExpediente(FISICA_LLENA, docs, HOY);
  assert.equal(r.estado, "COMPLETO");
});

test("INCOMPLETO gana a VENCIDO: nunca estuvo completo", () => {
  const docs = [
    {
      kind: "COMPROBANTE_DOMICILIO" as const,
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      archivedAt: null,
    },
    { kind: "CONSTANCIA_FISCAL" as const, expiresAt: null, archivedAt: null },
  ];
  const r = estadoDeExpediente(FISICA_LLENA, docs, HOY);
  assert.equal(r.estado, "INCOMPLETO");
  assert.deepEqual(r.faltantes, ["IDENTIFICACION"]);
  assert.deepEqual(r.vencidos, ["COMPROBANTE_DOMICILIO"]);
});

test("🔴 'NO' por omisión NO es 'NO' declarado: sin pepAskedAt el expediente no cierra", () => {
  const r = estadoDeExpediente({ ...FISICA_LLENA, pepAskedAt: null }, DOCS_FISICA, HOY);
  assert.equal(r.estado, "INCOMPLETO");
  assert.ok(r.datosFaltantes.includes("pepAskedAt"));
});

test("una moral sin beneficiario controlador declarado no está integrada", () => {
  const moral = {
    ...FISICA_LLENA,
    personKind: "MORAL" as const,
    curp: null,
    beneficialOwnersCount: 0,
  };
  const docs = documentosRequeridos("MORAL").map((kind) => ({
    kind,
    expiresAt: null,
    archivedAt: null,
  }));
  const r = estadoDeExpediente(moral, docs, HOY);
  assert.equal(r.estado, "INCOMPLETO");
  assert.ok(r.datosFaltantes.includes("beneficialOwners"));
  // La CURP no se le pide a una persona moral.
  assert.ok(!r.datosFaltantes.includes("curp"));
});

// ── 8. Semáforo de riesgo ──────────────────────────────────────────────

test("sin señales, riesgo BAJO y lo dice", () => {
  const r = riesgoDeExpediente({
    pep: "NO",
    estado: "COMPLETO",
    rebasaUmbral: true,
    efectivoProhibido: false,
  });
  assert.equal(r.risk, "BAJO");
  assert.deepEqual(r.motivos, ["Sin señales de alerta."]);
});

test("PEP → riesgo ALTO, aunque el expediente esté completo", () => {
  const r = riesgoDeExpediente({
    pep: "PEP",
    estado: "COMPLETO",
    rebasaUmbral: false,
    efectivoProhibido: false,
  });
  assert.equal(r.risk, "ALTO");
  assert.match(r.motivos[0], /pol[íi]ticamente expuesta/);
});

test("familiar y asociado de un PEP suben igual a ALTO", () => {
  for (const pep of ["FAMILIAR", "ASOCIADO"] as const) {
    const r = riesgoDeExpediente({
      pep,
      estado: "COMPLETO",
      rebasaUmbral: false,
      efectivoProhibido: false,
    });
    assert.equal(r.risk, "ALTO", `${pep} debería ser ALTO`);
  }
});

test("efectivo prohibido → ALTO", () => {
  const r = riesgoDeExpediente({
    pep: "NO",
    estado: "COMPLETO",
    rebasaUmbral: true,
    efectivoProhibido: true,
  });
  assert.equal(r.risk, "ALTO");
  assert.ok(r.motivos.some((m) => /efectivo/.test(m)));
});

test("rebasa el umbral con expediente incompleto → MEDIO", () => {
  const r = riesgoDeExpediente({
    pep: "NO",
    estado: "INCOMPLETO",
    rebasaUmbral: true,
    efectivoProhibido: false,
  });
  assert.equal(r.risk, "MEDIO");
});

test("expediente incompleto SIN operación que rebase no sube el riesgo", () => {
  const r = riesgoDeExpediente({
    pep: "NO",
    estado: "INCOMPLETO",
    rebasaUmbral: false,
    efectivoProhibido: false,
  });
  assert.equal(r.risk, "BAJO");
});

test("un riesgo ALTO nunca se degrada a MEDIO por acumular motivos", () => {
  const r = riesgoDeExpediente({
    pep: "PEP",
    estado: "INCOMPLETO",
    rebasaUmbral: true,
    efectivoProhibido: false,
  });
  assert.equal(r.risk, "ALTO");
  assert.equal(r.motivos.length, 2);
});

// ── 10. La convención del MEDIODÍA ─────────────────────────────────────
//
// Una fecha de calendario guardada a medianoche UTC se pinta un día ANTES
// en toda la República. Esta sección es la red de esa regla: es un bug que
// no truena nada — solo enseña el 16 donde la ley dice 17.

test("una fecha de <input type=date> se guarda al mediodía UTC, no a medianoche", () => {
  const d = fechaDeCalendario("2026-04-17");
  assert.ok(d);
  assert.equal(d.toISOString(), "2026-04-17T12:00:00.000Z");
});

test("🔴 a medianoche UTC el día RETROCEDE en México; al mediodía no", () => {
  // Lo que pasaba antes: el corte del 17 se pintaba como 16.
  assert.equal(
    fechaLocalISO(new Date("2026-04-17T00:00:00.000Z"), "America/Mexico_City"),
    "2026-04-16",
  );
  // Lo que pasa ahora, en las tres zonas mexicanas (UTC-6, -7 y -8).
  const d = fechaDeCalendario("2026-04-17") as Date;
  assert.equal(fechaLocalISO(d, "America/Mexico_City"), "2026-04-17");
  assert.equal(fechaLocalISO(d, "America/Chihuahua"), "2026-04-17");
  assert.equal(fechaLocalISO(d, "America/Tijuana"), "2026-04-17");
});

test("el vencimiento del periodo cae en el día de corte también en la zona de la cuenta", () => {
  const d = vencimientoDelPeriodo("2026-03", 17);
  assert.equal(fechaLocalISO(d, "America/Mexico_City"), "2026-04-17");
  assert.equal(fechaLocalISO(d, "America/Tijuana"), "2026-04-17");
});

test("una fecha con hora se respeta tal cual; lo que no se entiende da null", () => {
  const conHora = fechaDeCalendario("2026-04-17T23:30:00.000Z");
  assert.equal(conHora?.toISOString(), "2026-04-17T23:30:00.000Z");
  assert.equal(fechaDeCalendario(""), null);
  assert.equal(fechaDeCalendario("   "), null);
  assert.equal(fechaDeCalendario("ayer"), null);
  assert.equal(fechaDeCalendario(null), null);
  assert.equal(fechaDeCalendario(undefined), null);
  assert.equal(fechaDeCalendario(20260417), null);
});
