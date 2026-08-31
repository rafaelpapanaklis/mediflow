/**
 * DaleControl INSTITUCIONAL — el DICTADO y el APOYO DE IA.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ia.test.ts
 *
 * (No hay `npm run test:edu-ia`: package.json es del producto dental y este
 * vertical no lo toca.)
 *
 * Lo que fija, todo sin base de datos y sin llamar a ningún proveedor:
 *  1. 🔴 EL INTERRUPTOR: qué apaga cada función y en qué ORDEN se
 *     comprueba. Desde la Ola 8 no es una bandera de entorno sino el CUPO
 *     del instituto, y el motivo que se enseña tiene que ser el que se
 *     puede arreglar primero;
 *  2. los topes y formatos que el servidor exige antes de gastar un peso;
 *  3. la NORMALIZACIÓN de lo que devuelve el modelo — que una respuesta con
 *     otra forma no deje la pantalla en blanco ni invente hallazgos;
 *  4. el costo, en enteros y SIEMPRE con una tarifa de la base: sin tarifa
 *     no hay número, y sin número no hay llamada;
 *  5. que el texto para copiar lleve SIEMPRE el aviso de que no es un
 *     diagnóstico;
 *  6. el permiso `estudios.analyze` y quién lo tiene.
 *
 * El CUPO en sí (la aritmética, el periodo, las reglas del excedente y los
 * permisos de la Ola 8) vive en edu-ia-cupo.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EduAiFeature as PrismaEduAiFeature, EduAiUnit as PrismaEduAiUnit } from "@prisma/client";
import {
  EDU_ANALISIS_AVISO,
  EDU_ANALISIS_MAX_IMAGE_BYTES,
  EDU_DICTADO_MAX_BYTES,
  EDU_DICTADO_MAX_SECONDS,
  eduAnalisisComoTexto,
  eduAnalisisHallazgos,
  eduAnalisisMimeOk,
  eduAnalisisRecomendaciones,
  eduConfianzaLabel,
  eduDictadoMimeOk,
  eduIaCosto,
  eduIaCostoLabel,
  eduIaEstado,
  eduSeveridadLabel,
  eduSeveridadTag,
  type EduAnalisisRow,
  type EduIaCupo,
  type EduIaPrecio,
  type EduIaSituacion,
} from "../ia-core";
import { EDU_AI_FEATURES, EDU_AI_FEATURE_LABELS, EDU_AI_UNITS } from "../types";
import type { EduAiFeature, EduAiUnit } from "../types";
import { eduClinicalScope } from "../expediente-core";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  hasEduPermission,
} from "../permissions";

// ─────────────────────────────────────────────────────────────────────
// 0 · Los enums de la Ola 8 son ESPEJO 1:1 de los de Prisma
//     (no corre nada: lo verifica `tsc --noEmit`, igual que EduRole)
// ─────────────────────────────────────────────────────────────────────

// El MISMO candado que usa edu-permissions.test.ts para EduRole: si una
// ola agrega un valor al enum del schema y no lo agrega a types.ts (o al
// revés), `tsc --noEmit` falla aquí. En runtime esto no existe.
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _featuresCoinciden: Exacto<EduAiFeature, PrismaEduAiFeature> = true;
const _unidadesCoinciden: Exacto<EduAiUnit, PrismaEduAiUnit> = true;
void _featuresCoinciden;
void _unidadesCoinciden;

// ─────────────────────────────────────────────────────────────────────
// 1 · 🔴 EL INTERRUPTOR
// ─────────────────────────────────────────────────────────────────────

const PRECIO_DICTADO: EduIaPrecio = {
  feature: "DICTADO",
  model: "whisper-1",
  unit: "SECOND",
  // 0,006 USD por minuto = 100 millonésimas por segundo.
  inUsdMicrosPerMillion: 100_000_000,
  outUsdMicrosPerMillion: 0,
  source: "Tarifa pública de OpenAI",
};

const PRECIO_ANALISIS: EduIaPrecio = {
  feature: "ANALISIS",
  model: "claude-opus-5",
  unit: "TOKEN",
  inUsdMicrosPerMillion: 5_000_000,
  outUsdMicrosPerMillion: 25_000_000,
  source: "Tarifa pública de Anthropic",
};

function cupo(over: Partial<EduIaCupo> = {}): EduIaCupo {
  return {
    periodo: "2026-08",
    periodoLabel: "agosto de 2026",
    incluidoUsdCents: 5_000, // 50 USD
    permiteExcedente: false,
    topeUsdCents: null,
    encendido: true,
    contacto: null,
    consumidoUsdMicros: 0,
    actualizadoPor: null,
    actualizadoLabel: null,
    ...over,
  };
}

function situacion(over: Partial<EduIaSituacion> = {}): EduIaSituacion {
  return {
    global: true,
    openaiConfigurado: true,
    anthropicConfigurado: true,
    cupo: cupo(),
    precios: { DICTADO: PRECIO_DICTADO, ANALISIS: PRECIO_ANALISIS },
    ...over,
  };
}

test("con todo puesto y cupo por gastar, las dos funciones están disponibles", () => {
  for (const f of EDU_AI_FEATURES) {
    const e = eduIaEstado(f, situacion());
    assert.equal(e.disponible, true, `${f} debería estar disponible`);
    assert.equal(e.motivo, "ok");
  }
});

test("🔴 SIN FILA DE CUPO, las dos funciones están apagadas", () => {
  // Es el reemplazo de la bandera EDU_IA_ENABLED de la Ola 3B: lo que
  // enciende la IA de un instituto es tener cupo, no una variable de
  // entorno que no sabe distinguir escuelas.
  for (const f of EDU_AI_FEATURES) {
    const e = eduIaEstado(f, situacion({ cupo: null }));
    assert.equal(e.disponible, false, `${f} debería estar apagada`);
    assert.equal(e.motivo, "sin_cupo");
  }
});

test("🔴 el motivo es 'sin cupo' AUNQUE falten también las llaves y la tarifa", () => {
  // El ORDEN de las comprobaciones importa. Si fuera al revés, una escuela
  // sin contrato de IA diría "falta la llave del proveedor" y mandaría a su
  // director a buscar a un ingeniero por algo que se arregla firmando un
  // renglón del contrato.
  const nada = situacion({
    cupo: null,
    openaiConfigurado: false,
    anthropicConfigurado: false,
    precios: { DICTADO: null, ANALISIS: null },
  });
  assert.equal(eduIaEstado("DICTADO", nada).motivo, "sin_cupo");
  assert.equal(eduIaEstado("ANALISIS", nada).motivo, "sin_cupo");
});

test("🔴 SIN TARIFA no se corre, aunque haya cupo y llave", () => {
  // Correr sin poder cobrar dejaría el cupo diciendo que no se ha gastado
  // nada mientras la factura del proveedor sube. Es el error caro.
  const sinPrecio = situacion({ precios: { DICTADO: null, ANALISIS: null } });
  for (const f of EDU_AI_FEATURES) {
    const e = eduIaEstado(f, sinPrecio);
    assert.equal(e.disponible, false, `${f} sin tarifa no debería correr`);
    assert.equal(e.motivo, "sin_precio");
  }
});

test("la tarifa de una función no enciende ni apaga a la otra", () => {
  const soloAnalisis = situacion({ precios: { DICTADO: null, ANALISIS: PRECIO_ANALISIS } });
  assert.equal(eduIaEstado("DICTADO", soloAnalisis).motivo, "sin_precio");
  assert.equal(eduIaEstado("ANALISIS", soloAnalisis).disponible, true);
});

test("la escuela puede APAGARLA sin perder el cupo", () => {
  const apagada = situacion({ cupo: cupo({ encendido: false }) });
  for (const f of EDU_AI_FEATURES) {
    const e = eduIaEstado(f, apagada);
    assert.equal(e.disponible, false);
    assert.equal(e.motivo, "apagada");
    // Y el mensaje dice que el cupo sigue ahí: si dijera "no tienes cupo",
    // la dirección iría a pedirle a DaleControl algo que ya tiene.
    assert.ok(e.detalle.includes("no lo borra"), `no dice que el cupo sigue: ${e.detalle}`);
  }
});

test("el freno GLOBAL de DaleControl apaga las dos por encima de todo", () => {
  const frenada = eduIaEstado("DICTADO", situacion({ global: false }));
  assert.equal(frenada.motivo, "suspendida");
  // Incluso con cupo, tarifa y llave: es un freno de emergencia.
  assert.equal(eduIaEstado("ANALISIS", situacion({ global: false })).disponible, false);
});

test("con cupo y sin llave, el motivo cambia a 'sin_llave' — y solo para esa función", () => {
  const sinOpenai = situacion({ openaiConfigurado: false });
  assert.equal(eduIaEstado("DICTADO", sinOpenai).motivo, "sin_llave");
  assert.equal(eduIaEstado("ANALISIS", sinOpenai).disponible, true);

  const sinAnthropic = situacion({ anthropicConfigurado: false });
  assert.equal(eduIaEstado("ANALISIS", sinAnthropic).motivo, "sin_llave");
  assert.equal(eduIaEstado("DICTADO", sinAnthropic).disponible, true);
});

test("🔴 CUPO AGOTADO: se apaga, y el mensaje dice cuánto, de cuánto y a quién pedirle", () => {
  const agotado = situacion({
    cupo: cupo({
      consumidoUsdMicros: 50_000_000, // los 50 USD enteros
      contacto: "Coordinación académica, ext. 214",
    }),
  });
  for (const f of EDU_AI_FEATURES) {
    const e = eduIaEstado(f, agotado);
    assert.equal(e.disponible, false, `${f} debería estar sin cupo`);
    assert.equal(e.motivo, "cupo_agotado");
    // Las tres cosas que hacen falta para hacer algo con el mensaje. Sin
    // ellas, un alumno con el micrófono muerto abre un ticket — y ese
    // ticket cuesta más que el cupo que se acabó.
    assert.ok(e.detalle.includes("50.00 USD"), `no dice cuánto: ${e.detalle}`);
    assert.ok(e.detalle.includes("agosto de 2026"), `no dice de qué mes: ${e.detalle}`);
    assert.ok(
      e.detalle.includes("Coordinación académica, ext. 214"),
      `no dice a quién pedirle: ${e.detalle}`,
    );
  }
});

test("sin contacto escrito, el mensaje de cupo agotado manda a la dirección", () => {
  const e = eduIaEstado("DICTADO", situacion({ cupo: cupo({ consumidoUsdMicros: 50_000_000 }) }));
  assert.equal(e.motivo, "cupo_agotado");
  assert.ok(e.detalle.includes("dirección del instituto"), e.detalle);
});

test("con excedente autorizado, el cupo agotado se corre hasta el TOPE", () => {
  const base = cupo({ consumidoUsdMicros: 60_000_000 }); // 60 USD de 50
  assert.equal(eduIaEstado("DICTADO", situacion({ cupo: base })).motivo, "cupo_agotado");

  const conTope = cupo({
    consumidoUsdMicros: 60_000_000,
    permiteExcedente: true,
    topeUsdCents: 12_000, // 120 USD
  });
  assert.equal(eduIaEstado("DICTADO", situacion({ cupo: conTope })).disponible, true);
});

test("un estado apagado trae SIEMPRE un motivo escrito, no un código", () => {
  const casos: EduIaSituacion[] = [
    situacion({ global: false }),
    situacion({ cupo: null }),
    situacion({ cupo: cupo({ encendido: false }) }),
    situacion({ precios: { DICTADO: null, ANALISIS: null } }),
    situacion({ openaiConfigurado: false, anthropicConfigurado: false }),
    situacion({ cupo: cupo({ consumidoUsdMicros: 99_000_000 }) }),
  ];
  for (const s of casos) {
    for (const f of EDU_AI_FEATURES) {
      const e = eduIaEstado(f, s);
      if (e.disponible) continue;
      assert.ok(e.titulo.length > 10, `${f}/${e.motivo} sin título legible`);
      assert.ok(e.detalle.length > 100, `${f}/${e.motivo} sin explicación de por qué`);
    }
  }
});

test("una situación basura deja la IA apagada (lo ambiguo se interpreta como 'no')", () => {
  assert.equal(eduIaEstado("DICTADO", null as never).disponible, false);
  assert.equal(eduIaEstado("DICTADO", undefined as never).motivo, "sin_cupo");
});

test("las dos funciones tienen etiqueta en español", () => {
  for (const f of EDU_AI_FEATURES) {
    assert.ok(EDU_AI_FEATURE_LABELS[f], `falta etiqueta de ${f}`);
    assert.notEqual(EDU_AI_FEATURE_LABELS[f], f);
  }
  assert.deepEqual(EDU_AI_UNITS, ["TOKEN", "SECOND"]);
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
// 4 · El costo — SIEMPRE con una tarifa de la base
// ─────────────────────────────────────────────────────────────────────

test("el costo sale en millonésimas ENTERAS de dólar, con la tarifa de la BASE", () => {
  // Un millón de tokens de entrada de claude-opus-5 son 5 USD = 5 000 000
  // micro-USD. El número NO está en el código: sale de la fila de precio.
  assert.equal(eduIaCosto(PRECIO_ANALISIS, 1_000_000, 0), 5_000_000);
  assert.equal(eduIaCosto(PRECIO_ANALISIS, 0, 1_000_000), 25_000_000);
  const mixto = eduIaCosto(PRECIO_ANALISIS, 3_500, 1_200);
  assert.ok(Number.isInteger(mixto), `el costo no es entero: ${mixto}`);
  assert.equal(mixto, 47_500);
});

test("el dictado se cobra por SEGUNDO, no por token", () => {
  // 60 segundos de Whisper a 0,006 USD/min = 0,006 USD = 6 000 micro-USD.
  assert.equal(eduIaCosto(PRECIO_DICTADO, 60, 0), 6_000);
  assert.equal(eduIaCosto(PRECIO_DICTADO, 30, 0), 3_000);
});

test("🔴 SIN TARIFA el costo es null, NO cero", () => {
  // Un 0 se sumaría al cupo como "esta llamada fue gratis", que es
  // exactamente lo contrario de lo que pasó. Quien llama tiene que tratar
  // el null como "esto no se puede cobrar, así que no se hace".
  assert.equal(eduIaCosto(null, 1000, 100), null);
  assert.equal(eduIaCosto(undefined, 1000, 100), null);
  assert.equal(eduIaCostoLabel(null), "—");
});

test("los tokens negativos o basura no producen un costo negativo", () => {
  assert.equal(eduIaCosto(PRECIO_ANALISIS, -5, -5), 0);
  assert.equal(eduIaCosto(PRECIO_ANALISIS, NaN, NaN), 0);
});

test("el costo de UNA llamada se pinta en dólares con cuatro decimales", () => {
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

test("⚠️ tener CUPO tampoco es un permiso: usar la IA no exige ia.view", () => {
  // La Ola 8 añadió dos keys y ninguna gatea el uso de la IA. Un alumno
  // dicta y analiza sin ver el presupuesto de su escuela — y sin poder
  // tocarlo. Si `ia.view` gateara el dictado, encender el cupo obligaría a
  // repartirle a 120 alumnos el permiso de ver en qué se gasta el dinero.
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "ia.view"), false);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "expediente.write"), true);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "estudios.analyze"), true);
});
