/**
 * DaleControl INSTITUCIONAL — LA IA DEL VERTICAL, Y QUIÉN LA PAGA.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin process.env
 * en el camino de la pantalla): decide en UN solo sitio si el dictado y el
 * análisis radiográfico están disponibles, y —cuando no lo están— POR QUÉ.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL PROBLEMA QUE ESTE ARCHIVO EXISTE PARA NO ESCONDER
 *
 * Las dos funciones de IA de esta ola cuestan dinero de verdad (Whisper de
 * OpenAI por minuto de audio; Claude con visión por imagen analizada). En
 * el producto DENTAL ese gasto tiene dueño y tiene techo:
 *
 *   · el techo   → Clinic.aiTokensLimit / Clinic.aiTokensUsed, con reset
 *                  mensual (src/lib/ai-tokens.ts)
 *   · la cuenta  → addAiTokens(clinicId, …) y recordUsageNoCharge({clinicId})
 *                  (src/lib/ai-billing/record-usage.ts)
 *   · la sesión  → getAuthContext(), que EXIGE una fila User de clínica
 *
 * Un usuario de INSTITUTO no tiene fila de clínica. Las tres piezas de
 * arriba piden un `clinicId` que aquí no existe:
 *
 *   · llamar a /api/ai/transcribe con sesión de instituto → 401
 *   · llamar a /api/xrays/[id]/analyze con sesión de instituto → 401
 *
 * Y forzarlo —inventarle una Clinic al instituto, o pasarle el clinicId de
 * cualquiera— sería cobrarle la IA de una escuela a una clínica que no
 * tiene nada que ver.
 *
 * ── LO QUE SÍ SE PUDO REUSAR, Y LO QUE NO ──────────────────────────────
 *
 * DICTADO · la lógica está SEPARADA del cobro. `transcribeAudio()` vive en
 * src/lib/integrations/whisper.ts y es un envoltorio puro sobre la API de
 * OpenAI: no toca prisma, no sabe de sesiones y no cobra nada. Todo el
 * acoplamiento (getAuthContext + aiTokenLimitError + addAiTokens) está en
 * el route handler src/app/api/ai/transcribe/route.ts, no en la función.
 * ⇒ El vertical trae su PROPIO endpoint (/api/instituto/ai/dictado) que
 *   reusa esa función con getEduContext. Cero líneas del dental tocadas.
 *
 * ANÁLISIS RADIOGRÁFICO · a medias. Lo que está separado es la
 * CONFIGURACIÓN del modelo: src/lib/xray/analysis-modes.ts exporta el
 * system prompt y el esquema de la herramienta, y es puro. Lo que NO está
 * separado es todo lo demás — la llamada a Anthropic, el parseo, el conteo
 * de tokens y la persistencia viven DENTRO de
 * src/app/api/xrays/[id]/analyze/route.ts, pegados a `prisma.clinic`,
 * `addAiTokens(ctx.clinicId, …)`, `recordUsageNoCharge({clinicId})` y a
 * `prisma.xrayAnalysis`, cuyo modelo tiene clinicId y patientId NOT NULL
 * con llave foránea a las tablas del dental.
 * ⇒ El vertical reusa el PROMPT y el ESQUEMA (importados, no copiados) y
 *   escribe su propia llamada y su propia tabla (EduStudyAnalysis).
 *
 * ── Y ENTONCES, ¿QUIÉN PAGA? ───────────────────────────────────────────
 *
 * Nadie todavía, y por eso las dos funciones nacen APAGADAS detrás de una
 * bandera (EDU_IA_ENABLED). No es timidez: es la única respuesta honesta.
 *
 * Las alternativas eran dos, y las dos se descartaron a propósito:
 *
 *   ✗ Inventar una cartera de IA del instituto (EduAiWallet + EduAiUsage +
 *     pantalla de cupo + precio por token). Eso NO es infraestructura: es
 *     decidir cuánto le cuesta la IA a una escuela, cuántos minutos de
 *     dictado trae su contrato y qué pasa cuando se acaban. Es una
 *     decisión COMERCIAL que nadie ha tomado, y escribir la tabla es la
 *     forma más rápida de que quede tomada por accidente.
 *
 *   ✗ Dejarlas encendidas sin techo. Un instituto con 120 alumnos dictando
 *     nota tras nota gasta crédito real de OpenAI y de Anthropic sin
 *     límite, sin factura y sin que nadie pueda contestar cuánto se gastó.
 *     Eso no es "funciona": es una fuga.
 *
 * Lo que SÍ queda hecho, probado y listo para encender el día que exista
 * esa decisión: los dos endpoints, las dos pantallas, la tabla que registra
 * CADA análisis con su modelo, sus tokens y su costo estimado, y este
 * archivo, que es el único interruptor. Encenderlo es poner una variable
 * de entorno; el gasto entonces va a la MISMA cuenta de API que el dental,
 * sin repartir, y eso hay que saberlo antes de encenderlo — por eso el
 * texto de abajo lo dice con todas sus letras.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Las dos funciones de IA que trae esta ola. */
export type EduIaFeature = "dictado" | "analisis";

export const EDU_IA_FEATURES: EduIaFeature[] = ["dictado", "analisis"];

export const EDU_IA_FEATURE_LABELS: Record<EduIaFeature, string> = {
  dictado: "Dictado por voz",
  analisis: "Análisis radiográfico con IA",
};

/**
 * Por qué una función de IA no está disponible. Es un conjunto CERRADO
 * para que la pantalla no tenga que adivinar con un `if (mensaje.includes)`.
 */
export type EduIaMotivo =
  /** Está disponible. */
  | "ok"
  /** EDU_IA_ENABLED apagada: falta decidir quién paga la IA del instituto. */
  | "sin_cobro"
  /** Falta la llave del proveedor en este entorno. */
  | "sin_llave";

export interface EduIaEstado {
  feature: EduIaFeature;
  disponible: boolean;
  motivo: EduIaMotivo;
  /** Una línea, para el botón deshabilitado o el `title`. */
  titulo: string;
  /** El párrafo honesto, para el panel que lo explica. */
  detalle: string;
}

/**
 * Lo que hay que saber del ENTORNO para decidir. Se pasa como dato (no se
 * lee `process.env` aquí) porque este módulo lo importa una pantalla
 * "use client": en el navegador `process.env.EDU_IA_ENABLED` no existe, y
 * una función que lo consultara devolvería "apagado" siempre — que es peor
 * que devolver un error, porque parece un dato.
 */
export interface EduIaEntorno {
  /** EDU_IA_ENABLED: ¿alguien aceptó ya que el gasto va a la cuenta común? */
  habilitada: boolean;
  /** OPENAI_API_KEY presente (Whisper, el dictado). */
  openaiConfigurado: boolean;
  /** ANTHROPIC_API_KEY presente (Claude con visión, el análisis). */
  anthropicConfigurado: boolean;
}

const DETALLE_SIN_COBRO =
  "Esta función está construida y probada, pero apagada. Consume tokens de IA " +
  "que cuestan dinero, y en el instituto todavía no hay a qué cartera cargarlos: " +
  "el panel dental los cobra contra el cupo mensual de cada clínica, y una " +
  "escuela no tiene fila de clínica. Encenderla (variable de entorno " +
  "EDU_IA_ENABLED) manda el gasto a la MISMA cuenta de API que usa el dental, " +
  "sin repartir y sin techo por instituto. Es una decisión de quien administra " +
  "DaleControl, no de esta pantalla.";

const DETALLE_SIN_LLAVE: Record<EduIaFeature, string> = {
  dictado:
    "El dictado usa Whisper (OpenAI) y este entorno no tiene OPENAI_API_KEY. " +
    "Sin esa llave no hay transcripción que hacer; escribe la nota a mano " +
    "mientras tanto.",
  analisis:
    "El análisis usa Claude con visión (Anthropic) y este entorno no tiene " +
    "ANTHROPIC_API_KEY. Sin esa llave no hay análisis que pedir.",
};

const TITULO: Record<EduIaMotivo, string> = {
  ok: "Disponible",
  sin_cobro: "Apagado: falta conectar el cobro de IA del instituto",
  sin_llave: "Apagado: falta la llave del proveedor en este entorno",
};

/**
 * El estado de UNA función.
 *
 * El orden de las comprobaciones importa: primero el cobro y después la
 * llave. Si fuera al revés, un entorno sin llave diría "falta la llave" y
 * alguien la pondría creyendo que con eso queda encendido — y seguiría
 * apagado, sin explicación. Lo primero que hay que resolver es quién paga.
 */
export function eduIaEstado(feature: EduIaFeature, entorno: EduIaEntorno): EduIaEstado {
  const base = { feature, titulo: "", detalle: "" };

  if (!entorno || typeof entorno !== "object" || !entorno.habilitada) {
    return {
      ...base,
      disponible: false,
      motivo: "sin_cobro",
      titulo: TITULO.sin_cobro,
      detalle: DETALLE_SIN_COBRO,
    };
  }

  const configurado =
    feature === "dictado" ? entorno.openaiConfigurado : entorno.anthropicConfigurado;
  if (!configurado) {
    return {
      ...base,
      disponible: false,
      motivo: "sin_llave",
      titulo: TITULO.sin_llave,
      detalle: DETALLE_SIN_LLAVE[feature],
    };
  }

  return {
    ...base,
    disponible: true,
    motivo: "ok",
    titulo: TITULO.ok,
    detalle:
      "Consume tokens de IA. El gasto va a la cuenta de API compartida de " +
      "DaleControl: no hay cupo por instituto, así que úsala con cabeza.",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EL DICTADO
// ═══════════════════════════════════════════════════════════════════════

/** Tope por grabación, en segundos. El mismo que el dental. */
export const EDU_DICTADO_MAX_SECONDS = 60;

/**
 * Tope de bytes del audio. 4 MB, por debajo del corte de ~4.5 MB que
 * Vercel le hace al cuerpo de una petición. A 64 kbps, 60 segundos pesan
 * ~0.5 MB: el tope solo lo alcanza un cliente que mande otra cosa.
 */
export const EDU_DICTADO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * MIME normalizado (sin ";codecs=") que se acepta. "" está en la lista
 * porque algunos navegadores no reportan tipo, y "video/mp4" porque es la
 * etiqueta que iOS/Safari le pone al audio de MediaRecorder.
 */
export const EDU_DICTADO_MIMES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
  "video/mp4",
  "",
];

export function eduDictadoMimeOk(raw: string | null | undefined): boolean {
  const mime = String(raw ?? "").split(";")[0].trim().toLowerCase();
  return EDU_DICTADO_MIMES.includes(mime);
}

/**
 * Pista de vocabulario para Whisper. Es la del dental MÁS lo que se dicta
 * en una escuela: el residente nombra a su docente, su unidad y su
 * programa, y sin la pista salen transcritos como cualquier cosa.
 */
export const EDU_DICTADO_HINT =
  "Dictado clínico dental en español (México), en una clínica de enseñanza " +
  "universitaria: diagnóstico, plan de tratamiento, odontograma, profilaxis, " +
  "resina, endodoncia, corona, extracción, periodontitis, gingivitis, oclusión, " +
  "amoxicilina, ibuprofeno, radiografía periapical, tomografía, docente, " +
  "supervisor, residente, sillón, tamizaje, expediente.";

// ═══════════════════════════════════════════════════════════════════════
// EL ANÁLISIS RADIOGRÁFICO
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 ES APOYO, NO DIAGNÓSTICO. Esta constante la pinta la pantalla ENTERA
 * y sin poder cerrarse, y el texto vive aquí para que la pantalla y el
 * endpoint digan lo mismo.
 *
 * La regla que la acompaña es más importante que el aviso: el resultado de
 * la IA NUNCA se escribe solo dentro de una nota clínica. Queda como
 * anotación aparte, y si el alumno quiere usar algo, lo copia y lo escribe
 * él — con su nombre encima. Es el mismo criterio que el aiAssist del
 * dental, que no toca el S/O/A/P.
 */
export const EDU_ANALISIS_AVISO =
  "Esto es APOYO diagnóstico, no un diagnóstico. Lo que sigue lo escribió un " +
  "modelo de lenguaje mirando la imagen: puede equivocarse, puede ver lo que no " +
  "hay y puede callarse lo que sí. No sustituye tu lectura ni la de tu docente, " +
  "y no se guarda dentro de ninguna nota clínica: queda aquí, aparte, y tú " +
  "decides si algo de esto entra a tu nota escrito por ti.";

/**
 * Tope de la imagen que se le manda al modelo: 5 MB del objeto real.
 *
 * No es un capricho nuestro sino el techo práctico de la API de visión, y
 * comprobarlo ANTES de descargar 600 MB de una tomografía es la diferencia
 * entre un mensaje claro y un timeout.
 */
export const EDU_ANALISIS_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Los formatos que la API de visión acepta. */
export const EDU_ANALISIS_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function eduAnalisisMimeOk(raw: string | null | undefined): boolean {
  return EDU_ANALISIS_MIMES.includes(String(raw ?? "").trim().toLowerCase());
}

/** Techo de análisis que se listan de un estudio. */
export const EDU_ANALISIS_MAX_ROWS = 20;

/** Severidad tal como la devuelve el modelo, normalizada a español. */
export const EDU_SEVERIDAD_LABELS: Record<string, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo",
  informational: "Informativo",
  // Aliases en español que el dental todavía acepta de respuestas viejas.
  alta: "Alto",
  media: "Medio",
  baja: "Bajo",
  informativo: "Informativo",
};

export function eduSeveridadLabel(raw: string | null | undefined): string {
  const k = String(raw ?? "").trim().toLowerCase();
  return EDU_SEVERIDAD_LABELS[k] ?? "Sin clasificar";
}

/** Clase de la píldora de severidad (las del tema del vertical). */
export function eduSeveridadTag(raw: string | null | undefined): string {
  const k = String(raw ?? "").trim().toLowerCase();
  if (k === "critical") return "edu-tag--danger";
  if (k === "high" || k === "alta") return "edu-tag--danger";
  if (k === "medium" || k === "media") return "edu-tag--warn";
  if (k === "low" || k === "baja") return "edu-tag--info";
  return "edu-tag--muted";
}

/** 0–1 → "87 %". Un hallazgo sin confianza legible sale como raya. */
export function eduConfianzaLabel(raw: number | null | undefined): string {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return "—";
  // El dental guardó en algún momento la confianza en 0–100 y en otro en
  // 0–1. Se acepta lo que venga: por encima de 1 se asume porcentaje.
  const pct = raw > 1 ? raw : raw * 100;
  return `${Math.round(Math.min(100, pct))} %`;
}

// ═══════════════════════════════════════════════════════════════════════
// LA FORMA QUE VIAJA A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

export interface EduAnalisisHallazgo {
  id: string;
  title: string;
  description: string;
  tooth: string | null;
  severity: string;
  confidence: number | null;
  confidenceRationale: string | null;
}

export interface EduAnalisisRow {
  id: string;
  studyId: string;
  summary: string;
  hallazgos: EduAnalisisHallazgo[];
  recomendaciones: string[];
  severity: string;
  confidence: number | null;
  modelUsed: string;
  tokensUsed: number;
  /** Costo estimado en millonésimas de dólar. null = no se pudo calcular. */
  costUsdMicros: number | null;
  requestedByName: string;
  createdAt: string;
  createdLabel: string;
}

/**
 * Normaliza lo que devolvió el modelo a la forma de la pantalla.
 *
 * Vive aquí (módulo puro) y no en el servidor porque lo usan los dos: el
 * endpoint al guardar y la pantalla al leer una fila vieja. Un modelo que
 * un día devuelva `recommendations` como string en vez de array no puede
 * dejar la pestaña en blanco.
 */
export function eduAnalisisHallazgos(raw: unknown): EduAnalisisHallazgo[] {
  if (!Array.isArray(raw)) return [];
  const out: EduAnalisisHallazgo[] = [];
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;
    out.push({
      id: typeof o.id === "string" || typeof o.id === "number" ? String(o.id) : String(i + 1),
      title: title.slice(0, 200),
      description: typeof o.description === "string" ? o.description.trim().slice(0, 2000) : "",
      tooth: typeof o.tooth === "string" && o.tooth.trim() ? o.tooth.trim().slice(0, 12) : null,
      severity: typeof o.severity === "string" ? o.severity.trim().toLowerCase() : "informational",
      confidence: typeof o.confidence === "number" && Number.isFinite(o.confidence) ? o.confidence : null,
      confidenceRationale:
        typeof o.confidenceRationale === "string" && o.confidenceRationale.trim()
          ? o.confidenceRationale.trim().slice(0, 500)
          : null,
    });
  }
  return out;
}

/** `recommendations` puede llegar como array o como un solo string. */
export function eduAnalisisRecomendaciones(raw: unknown): string[] {
  if (typeof raw === "string") {
    const v = raw.trim();
    return v ? [v.slice(0, 1000)] : [];
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const v = r.trim();
    if (v) out.push(v.slice(0, 1000));
  }
  return out;
}

/**
 * El análisis, en texto plano, para que el alumno lo COPIE y decida qué
 * escribir en su nota.
 *
 * 🔴 Esta función es la única forma en que el resultado de la IA llega a
 * una nota clínica: pasando por el portapapeles y por la persona. No hay
 * ningún camino en el producto que escriba esto dentro de un EduRecord.
 */
export function eduAnalisisComoTexto(a: EduAnalisisRow): string {
  const lineas: string[] = [];
  lineas.push(`Apoyo de IA (${a.modelUsed}) — ${a.createdLabel}`);
  lineas.push("NO es un diagnóstico. Revisar antes de usar.");
  lineas.push("");
  if (a.summary) {
    lineas.push(a.summary);
    lineas.push("");
  }
  if (a.hallazgos.length > 0) {
    lineas.push("Hallazgos:");
    for (const h of a.hallazgos) {
      const diente = h.tooth ? ` (pieza ${h.tooth})` : "";
      lineas.push(
        `• ${h.title}${diente} — ${eduSeveridadLabel(h.severity)}, confianza ${eduConfianzaLabel(h.confidence)}`,
      );
      if (h.description) lineas.push(`  ${h.description}`);
    }
    lineas.push("");
  }
  if (a.recomendaciones.length > 0) {
    lineas.push("Recomendaciones:");
    for (const r of a.recomendaciones) lineas.push(`• ${r}`);
  }
  return lineas.join("\n").trim();
}

// ═══════════════════════════════════════════════════════════════════════
// EL PRECIO, PARA PODER CONTESTAR CUÁNTO COSTÓ
// ═══════════════════════════════════════════════════════════════════════

/**
 * Precio del modelo, en dólares por millón de tokens.
 *
 * ── POR QUÉ NO SE REUSA src/lib/ai-billing/pricing.ts ──────────────────
 * `getPricingConfig()` de ese módulo LEE DE LA BASE la configuración de
 * precios del producto DENTAL (y trae además el tipo de cambio y el fee
 * comercial que se le carga a una clínica). Aplicarle al instituto la
 * configuración comercial del dental sería mezclar dos contabilidades que
 * no tienen nada que ver, y encima haría que el costo registrado aquí
 * cambiara cuando alguien ajuste el margen de allá.
 *
 * Aquí el número solo sirve para UNA cosa: poder contestar cuánto costó
 * esta lectura. Son constantes locales, explicables, y se cambian en un
 * sitio. Si mañana el instituto tiene cartera propia, ESTE es el archivo
 * al que hay que volver.
 *
 * Fuente: tarifa pública de la API de Anthropic para el modelo que usa
 * src/lib/edu/ia.ts.
 */
export const EDU_IA_PRECIO_USD_POR_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

/**
 * Costo en MILLONÉSIMAS de dólar, entero.
 *
 * Enteros y no coma flotante por lo mismo que la Ola 5 guarda centavos:
 * sumar dinero en `float` acumula error, y un reporte de gasto que no
 * cuadra por céntimos es un reporte en el que nadie confía. Devuelve null
 * si el modelo no está en la tabla — mejor un hueco honesto que un número
 * inventado.
 */
export function eduIaCostoUsdMicros(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const p = EDU_IA_PRECIO_USD_POR_MTOK[model];
  if (!p) return null;
  const inTok = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const outTok = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
  return Math.max(0, Math.round(inTok * p.input + outTok * p.output));
}

/** "0.0184 USD" — para la tarjeta del análisis. null → raya. */
export function eduIaCostoLabel(micros: number | null | undefined): string {
  if (typeof micros !== "number" || !Number.isFinite(micros) || micros < 0) return "—";
  return `${(micros / 1_000_000).toFixed(4)} USD`;
}

/**
 * Lo que el instituto le agrega al prompt del dental.
 *
 * 🔴 Se CONCATENA, no se edita: el prompt base y el esquema de la
 * herramienta se importan de src/lib/xray/analysis-modes.ts (módulo puro
 * del dental) para que la calibración de confianza y la lista de hallazgos
 * sean LAS MISMAS en los dos productos. Si la escuela tuviera su propia
 * copia, la corrección que el dental le haga mañana a esa calibración no
 * llegaría aquí, y la lectura de la escuela sería peor sin que nadie se
 * enterara.
 *
 * Lo que cambia es el LECTOR: allá lo revisa un doctor titulado, aquí un
 * alumno en formación al que un modelo demasiado seguro puede convencer.
 */
export const EDU_ANALISIS_SYSTEM_EXTRA = `
CONTEXTO INSTITUCIONAL — LÉELO ANTES DE RESPONDER.
Quien va a leer tu respuesta es un ALUMNO de una especialidad odontológica, en formación, dentro de una clínica universitaria, y su docente responsable la revisará después. No es el diagnóstico: es apoyo para que el alumno mire mejor la imagen.
Por eso:
- No des por cerrado nada. Cuando un hallazgo admita más de una explicación, dilo en la descripción.
- Cuando la proyección, el encuadre o el contraste no permitan sostener un hallazgo, dilo y recomiéndale la proyección que sí lo permitiría, en vez de bajar la confianza sin explicar.
- Recomienda SIEMPRE confirmar clínicamente y consultarlo con el docente antes de tratar.
- No propongas dosis de medicamentos ni indicaciones de receta.`.trim();
