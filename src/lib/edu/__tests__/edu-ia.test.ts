/**
 * DaleControl INSTITUCIONAL — Ola 3B · el DICTADO y el APOYO DE IA.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ia.test.ts
 *
 * (No hay `npm run test:edu-ia`: package.json es del producto dental y esta
 * ola no lo toca.)
 *
 * Lo que fija, todo sin base de datos y sin llamar a ningún proveedor:
 *  1. 🔴 LA BANDERA: las dos funciones nacen APAGADAS, y el motivo que se
 *     enseña es "falta conectar el cobro", no "falta la llave";
 *  2. los topes y formatos que el servidor exige antes de gastar un peso;
 *  3. la NORMALIZACIÓN de lo que devuelve el modelo — que una respuesta con
 *     otra forma no deje la pantalla en blanco ni invente hallazgos;
 *  4. el costo, en enteros;
 *  5. que el texto para copiar lleve SIEMPRE el aviso de que no es un
 *     diagnóstico;
 *  6. el permiso `estudios.analyze` y quién lo tiene.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_ANALISIS_AVISO,
  EDU_ANALISIS_MAX_IMAGE_BYTES,
  EDU_DICTADO_MAX_BYTES,
  EDU_DICTADO_MAX_SECONDS,
  EDU_IA_FEATURES,
  EDU_IA_FEATURE_LABELS,
  eduAnalisisComoTexto,
  eduAnalisisHallazgos,
  eduAnalisisMimeOk,
  eduAnalisisRecomendaciones,
  eduConfianzaLabel,
  eduDictadoMimeOk,
  eduIaCostoLabel,
  eduIaCostoUsdMicros,
  eduIaEstado,
  eduSeveridadLabel,
  eduSeveridadTag,
  type EduAnalisisRow,
  type EduIaEntorno,
} from "../ia-core";
import { eduClinicalScope } from "../expediente-core";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  hasEduPermission,
} from "../permissions";

const TODO_PUESTO: EduIaEntorno = {
  habilitada: true,
  openaiConfigurado: true,
  anthropicConfigurado: true,
};

// ─────────────────────────────────────────────────────────────────────
// 1 · 🔴 LA BANDERA
// ─────────────────────────────────────────────────────────────────────

test("🔴 con la bandera apagada, las DOS funciones están apagadas", () => {
  const apagada: EduIaEntorno = { ...TODO_PUESTO, habilitada: false };
  for (const f of EDU_IA_FEATURES) {
    const e = eduIaEstado(f, apagada);
    assert.equal(e.disponible, false, `${f} debería estar apagada`);
    assert.equal(e.motivo, "sin_cobro");
  }
});

test("🔴 el motivo es 'falta el cobro' AUNQUE falten también las llaves", () => {
  // El ORDEN de las comprobaciones importa. Si fuera al revés, un entorno
  // sin llave diría "falta la llave", alguien la pondría creyendo que con
  // eso queda encendido, y seguiría apagado sin explicación. Lo primero
  // que hay que resolver es quién paga.
  const nada: EduIaEntorno = {
    habilitada: false,
    openaiConfigurado: false,
    anthropicConfigurado: false,
  };
  assert.equal(eduIaEstado("dictado", nada).motivo, "sin_cobro");
  assert.equal(eduIaEstado("analisis", nada).motivo, "sin_cobro");
});

test("con la bandera encendida y sin llave, el motivo cambia a 'sin_llave'", () => {
  const sinOpenai: EduIaEntorno = { ...TODO_PUESTO, openaiConfigurado: false };
  assert.equal(eduIaEstado("dictado", sinOpenai).motivo, "sin_llave");
  // Y el análisis, que usa OTRA llave, sigue disponible: las funciones no
  // se apagan en bloque por una llave que no es la suya.
  assert.equal(eduIaEstado("analisis", sinOpenai).disponible, true);

  const sinAnthropic: EduIaEntorno = { ...TODO_PUESTO, anthropicConfigurado: false };
  assert.equal(eduIaEstado("analisis", sinAnthropic).motivo, "sin_llave");
  assert.equal(eduIaEstado("dictado", sinAnthropic).disponible, true);
});

test("con todo puesto, las dos están disponibles", () => {
  for (const f of EDU_IA_FEATURES) {
    const e = eduIaEstado(f, TODO_PUESTO);
    assert.equal(e.disponible, true, `${f} debería estar disponible`);
    assert.equal(e.motivo, "ok");
  }
});

test("un entorno basura deja la IA apagada (lo ambiguo se interpreta como 'no')", () => {
  assert.equal(eduIaEstado("dictado", null as never).disponible, false);
  assert.equal(eduIaEstado("dictado", undefined as never).motivo, "sin_cobro");
});

test("todo estado apagado trae un motivo ESCRITO, no un código", () => {
  const apagada: EduIaEntorno = { ...TODO_PUESTO, habilitada: false };
  for (const f of EDU_IA_FEATURES) {
    const e = eduIaEstado(f, apagada);
    assert.ok(e.titulo.length > 10, `${f} sin título legible`);
    assert.ok(e.detalle.length > 100, `${f} sin explicación de por qué`);
    // El texto tiene que nombrar la variable, porque quien lo lee para
    // encenderla necesita saber cuál es.
    assert.ok(e.detalle.includes("EDU_IA_ENABLED"), `${f} no dice qué bandera falta`);
  }
});

test("las dos funciones tienen etiqueta en español", () => {
  for (const f of EDU_IA_FEATURES) {
    assert.ok(EDU_IA_FEATURE_LABELS[f], `falta etiqueta de ${f}`);
    assert.notEqual(EDU_IA_FEATURE_LABELS[f], f);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 2 · Topes y formatos
// ─────────────────────────────────────────────────────────────────────

test("el dictado acepta lo que graban los navegadores y nada más", () => {
  for (const m of ["audio/webm", "audio/webm;codecs=opus", "audio/mp4", "video/mp4", "audio/wav"]) {
    assert.equal(eduDictadoMimeOk(m), true, `${m} debería aceptarse`);
  }
  // "" está en la lista: algunos navegadores no reportan tipo.
  assert.equal(eduDictadoMimeOk(""), true);
  assert.equal(eduDictadoMimeOk(null), true);
  // Y lo que NO es audio, no entra.
  assert.equal(eduDictadoMimeOk("application/zip"), false);
  assert.equal(eduDictadoMimeOk("image/png"), false);
  assert.equal(eduDictadoMimeOk("text/html"), false);
});

test("el audio cabe por debajo del corte de Vercel", () => {
  // El cuerpo de una petición se corta en ~4.5 MB. Un tope por encima de
  // eso convertiría un rechazo explicable en un 413 del proxy.
  assert.ok(EDU_DICTADO_MAX_BYTES < 4.5 * 1024 * 1024);
  assert.equal(EDU_DICTADO_MAX_SECONDS, 60);
});

test("el análisis solo acepta imágenes que la API de visión sabe leer", () => {
  for (const m of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(eduAnalisisMimeOk(m), true, `${m} debería aceptarse`);
  }
  // Una tomografía en .zip, un DICOM suelto y un PDF NO: enseñárselos al
  // modelo produce un error de API, no un análisis.
  assert.equal(eduAnalisisMimeOk("application/zip"), false);
  assert.equal(eduAnalisisMimeOk("application/dicom"), false);
  assert.equal(eduAnalisisMimeOk("application/pdf"), false);
  assert.equal(eduAnalisisMimeOk("model/stl"), false);
  assert.equal(eduAnalisisMimeOk(null), false);
});

test("el tope de la imagen es el de la API, no uno inventado", () => {
  assert.equal(EDU_ANALISIS_MAX_IMAGE_BYTES, 5 * 1024 * 1024);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · Normalización de lo que devuelve el modelo
// ─────────────────────────────────────────────────────────────────────

test("los hallazgos se normalizan y los que no tienen título se descartan", () => {
  const out = eduAnalisisHallazgos([
    { id: 1, title: "Caries oclusal", description: "  visible  ", tooth: "36", severity: "HIGH", confidence: 0.92 },
    { id: "2", title: "   ", description: "sin título" },
    { title: "Sin id", severity: "medium" },
    "no soy un objeto",
    null,
  ]);
  assert.equal(out.length, 2, "solo dos hallazgos tenían título");
  assert.equal(out[0].id, "1", "el id numérico se pasa a texto");
  assert.equal(out[0].description, "visible", "la descripción va con trim");
  assert.equal(out[0].severity, "high", "la severidad baja a minúsculas");
  assert.equal(out[0].tooth, "36");
  assert.equal(out[1].id, "3", "sin id, se usa la posición");
  assert.equal(out[1].confidence, null, "sin confianza numérica, null y no 0");
  assert.equal(out[1].tooth, null);
});

test("una respuesta con otra forma devuelve lista vacía, no revienta", () => {
  assert.deepEqual(eduAnalisisHallazgos(null), []);
  assert.deepEqual(eduAnalisisHallazgos("texto libre"), []);
  assert.deepEqual(eduAnalisisHallazgos({ findings: [] }), []);
});

test("las recomendaciones aceptan array Y string suelto", () => {
  // El dental persistió las dos formas a lo largo del tiempo, y el modelo
  // puede devolver cualquiera. Si esto solo aceptara array, media pantalla
  // saldría en blanco sin decir por qué.
  assert.deepEqual(eduAnalisisRecomendaciones(["uno", "  dos  ", "", 42]), ["uno", "dos"]);
  assert.deepEqual(eduAnalisisRecomendaciones("una sola"), ["una sola"]);
  assert.deepEqual(eduAnalisisRecomendaciones(""), []);
  assert.deepEqual(eduAnalisisRecomendaciones(null), []);
});

test("las severidades se pintan en español y con su píldora", () => {
  assert.equal(eduSeveridadLabel("critical"), "Crítico");
  assert.equal(eduSeveridadLabel("high"), "Alto");
  // Los alias en español vienen de respuestas viejas del dental.
  assert.equal(eduSeveridadLabel("alta"), "Alto");
  assert.equal(eduSeveridadLabel("informativo"), "Informativo");
  assert.equal(eduSeveridadLabel("lo-que-sea"), "Sin clasificar");
  assert.equal(eduSeveridadTag("critical"), "edu-tag--danger");
  assert.equal(eduSeveridadTag("medium"), "edu-tag--warn");
  assert.equal(eduSeveridadTag(null), "edu-tag--muted");
});

test("la confianza se lee tanto en 0-1 como en 0-100", () => {
  assert.equal(eduConfianzaLabel(0.92), "92 %");
  assert.equal(eduConfianzaLabel(92), "92 %");
  assert.equal(eduConfianzaLabel(1), "100 %");
  assert.equal(eduConfianzaLabel(250), "100 %", "se acota, no se pinta 250 %");
  assert.equal(eduConfianzaLabel(null), "—");
  assert.equal(eduConfianzaLabel(NaN), "—");
});

// ─────────────────────────────────────────────────────────────────────
// 4 · El costo
// ─────────────────────────────────────────────────────────────────────

test("el costo sale en millonésimas ENTERAS de dólar", () => {
  // Un millón de tokens de entrada de claude-opus-5 son 5 USD = 5 000 000
  // micro-USD.
  assert.equal(eduIaCostoUsdMicros("claude-opus-5", 1_000_000, 0), 5_000_000);
  assert.equal(eduIaCostoUsdMicros("claude-opus-5", 0, 1_000_000), 25_000_000);
  const mixto = eduIaCostoUsdMicros("claude-opus-5", 3_500, 1_200);
  assert.ok(Number.isInteger(mixto), `el costo no es entero: ${mixto}`);
});

test("un modelo que no está en la tabla devuelve null, no un número inventado", () => {
  assert.equal(eduIaCostoUsdMicros("modelo-que-no-existe", 1000, 100), null);
  assert.equal(eduIaCostoLabel(null), "—");
});

test("los tokens negativos o basura no producen un costo negativo", () => {
  assert.equal(eduIaCostoUsdMicros("claude-opus-5", -5, -5), 0);
  assert.equal(eduIaCostoUsdMicros("claude-opus-5", NaN, NaN), 0);
});

test("el costo se pinta en dólares con cuatro decimales", () => {
  assert.equal(eduIaCostoLabel(18_400), "0.0184 USD");
});

// ─────────────────────────────────────────────────────────────────────
// 5 · 🔴 El texto que se copia
// ─────────────────────────────────────────────────────────────────────

const ANALISIS: EduAnalisisRow = {
  id: "a1",
  studyId: "s1",
  summary: "Se observan dos zonas radiolúcidas.",
  hallazgos: [
    {
      id: "1",
      title: "Caries oclusal",
      description: "Pérdida de esmalte clara.",
      tooth: "36",
      severity: "high",
      confidence: 0.92,
      confidenceRationale: null,
    },
  ],
  recomendaciones: ["Confirmar clínicamente antes de tratar."],
  severity: "high",
  confidence: 0.92,
  modelUsed: "claude-opus-5",
  tokensUsed: 4210,
  costUsdMicros: 18400,
  requestedByName: "Sofía Ibarra",
  createdAt: "2026-09-01T12:00:00.000Z",
  createdLabel: "mar 1 sep 12:00",
};

test("🔴 el texto para copiar LLEVA el aviso de que no es un diagnóstico", () => {
  // Es la única forma en que el resultado de la IA llega a una nota
  // clínica: por el portapapeles y por la persona. Si el texto copiado
  // perdiera el aviso, en la nota quedaría un párrafo que parece escrito
  // por quien la firma.
  const t = eduAnalisisComoTexto(ANALISIS);
  assert.ok(t.includes("NO es un diagnóstico"), `el texto copiado no avisa:\n${t}`);
  assert.ok(t.includes("Apoyo de IA"), "no dice que lo escribió una IA");
  assert.ok(t.includes("claude-opus-5"), "no dice qué modelo lo escribió");
});

test("el texto para copiar trae los hallazgos con su pieza, severidad y confianza", () => {
  const t = eduAnalisisComoTexto(ANALISIS);
  assert.ok(t.includes("Caries oclusal"));
  assert.ok(t.includes("pieza 36"));
  assert.ok(t.includes("Alto"));
  assert.ok(t.includes("92 %"));
  assert.ok(t.includes("Confirmar clínicamente antes de tratar."));
});

test("un análisis vacío produce un texto corto, no una excepción", () => {
  const t = eduAnalisisComoTexto({
    ...ANALISIS,
    summary: "",
    hallazgos: [],
    recomendaciones: [],
  });
  assert.ok(t.length > 0);
  assert.ok(t.includes("NO es un diagnóstico"));
});

test("el aviso de la pantalla dice las tres cosas que tiene que decir", () => {
  assert.ok(EDU_ANALISIS_AVISO.includes("APOYO"));
  assert.ok(EDU_ANALISIS_AVISO.includes("puede equivocarse"));
  // Y la regla: nunca entra solo a una nota.
  assert.ok(EDU_ANALISIS_AVISO.includes("no se guarda dentro de ninguna nota"));
});

// ─────────────────────────────────────────────────────────────────────
// 6 · El permiso
// ─────────────────────────────────────────────────────────────────────

test("estudios.analyze está en el catálogo y en el grupo del expediente", () => {
  assert.ok("estudios.analyze" in EDU_ALL_PERMISSIONS);
  const grupo = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("estudios.analyze"))[0];
  assert.ok(grupo, "estudios.analyze no está en ningún grupo");
  assert.ok(
    grupo.keys.includes("estudios.view"),
    "va con el expediente: quien apaga el expediente quiere apagar también la IA que lo lee",
  );
  assert.equal(
    EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("estudios.analyze")).length,
    1,
  );
});

test("analizan ALUMNO, DOCENTE y DIRECCION; CAJA no", () => {
  for (const rol of ["ALUMNO", "DOCENTE", "DIRECCION"] as const) {
    assert.equal(hasEduPermission({ role: rol }, "estudios.analyze"), true, `${rol} sin el permiso`);
  }
  assert.equal(hasEduPermission({ role: "CAJA" }, "estudios.analyze"), false);
});

test("🔴 y aunque a CAJA se lo encendieran, no encontraría un estudio que analizar", () => {
  // Doble candado: el permiso (arriba) y el ALCANCE. El análisis se lee
  // con el alcance del expediente, que para caja es "none".
  assert.equal(
    hasEduPermission(
      { role: "CAJA", permissionsOverride: ["inicio.view", "estudios.analyze"] },
      "estudios.analyze",
    ),
    true,
    "el override sí puede encender la casilla",
  );
  assert.equal(eduClinicalScope({ role: "CAJA", eduUserId: "u" }).kind, "none");
});

test("⚠️ el DICTADO no tiene key propia: reusa expediente.write", () => {
  // Un permiso propio sería un interruptor que no cierra nada — quien lo
  // tenga apagado escribe exactamente la misma nota a mano.
  assert.equal("dictado.use" in EDU_ALL_PERMISSIONS, false);
  for (const rol of ["ALUMNO", "DOCENTE", "DIRECCION"] as const) {
    assert.equal(hasEduPermission({ role: rol }, "expediente.write"), true);
  }
  assert.equal(hasEduPermission({ role: "CAJA" }, "expediente.write"), false);
});
