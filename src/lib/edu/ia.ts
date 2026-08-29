/**
 * DaleControl INSTITUCIONAL — la IA del vertical contra los proveedores y
 * contra la base de datos.
 *
 * SERVIDOR: importa prisma, Storage y las llaves de API. Lo puro (la
 * bandera, los topes, los textos y la forma que viaja a la pantalla) vive
 * en ia-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ SE REUSA DEL DENTAL Y QUÉ SE ESCRIBE AQUÍ — el detalle largo está en
 * la cabecera de ia-core.ts; en corto:
 *
 *   · `transcribeAudio` (src/lib/integrations/whisper.ts) → SE REUSA TAL
 *     CUAL. Es un envoltorio puro sobre la API de OpenAI: sin sesión, sin
 *     prisma, sin cobro. Lo que estaba pegado al dental era el route
 *     handler, no la función.
 *   · `getModeConfig` (src/lib/xray/analysis-modes.ts) → SE REUSA el
 *     system prompt y el esquema de la herramienta, importados. La
 *     calibración de confianza que el dental afinó vale igual aquí, y
 *     copiarla habría creado dos copias que divergen.
 *   · la LLAMADA y la PERSISTENCIA del análisis → se escriben aquí. En el
 *     dental viven dentro del route handler, atadas a `prisma.clinic`,
 *     `addAiTokens(clinicId)` y `prisma.xrayAnalysis` (clinicId NOT NULL).
 *     No hay nada que importar.
 *
 * 🔴 LAS DOS FUNCIONES ESTÁN APAGADAS POR DEFECTO. `eduIaEntornoActual()`
 * lee EDU_IA_ENABLED y, mientras no esté encendida, los dos endpoints
 * contestan 503 con el motivo escrito para una persona. No un 401, no un
 * 500: un "esto todavía no está conectado y aquí está por qué".
 *
 * ── POR QUÉ `fetch` Y NO EL SDK DE ANTHROPIC ───────────────────────────
 * Los ocho sitios del repo que llaman a la API de mensajes lo hacen con
 * `fetch` (src/app/api/xrays/[id]/analyze/route.ts entre ellos), y el
 * `@anthropic-ai/sdk` instalado es la 0.91, anterior a los parámetros que
 * esta llamada usa. Seguir la convención del repo mantiene la forma de la
 * petición idéntica a la que ya funciona en producción y no ata esta ola a
 * una versión del SDK que nadie ha subido.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { transcribeAudio } from "@/lib/integrations/whisper";
import { getModeConfig } from "@/lib/xray/analysis-modes";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { eduClinicalScope } from "@/lib/edu/expediente-core";
import {
  EDU_ANALISIS_MAX_IMAGE_BYTES,
  EDU_ANALISIS_SYSTEM_EXTRA,
  EDU_ANALISIS_MAX_ROWS,
  EDU_DICTADO_HINT,
  EDU_DICTADO_MAX_BYTES,
  eduAnalisisHallazgos,
  eduAnalisisRecomendaciones,
  eduAnalisisMimeOk,
  eduDictadoMimeOk,
  eduIaCostoUsdMicros,
  eduIaEstado,
  type EduAnalisisRow,
  type EduIaEntorno,
  type EduIaEstado,
  type EduIaFeature,
} from "@/lib/edu/ia-core";
import { eduStorageConfigured, eduStorageDownload } from "@/lib/edu/storage";
import { eduPatientScopeWhere, eduScopeIsEmpty, type EduClinicaContext } from "@/lib/edu/visibility";

export { EduPadronError as EduIaError };

/**
 * El modelo que lee las imágenes.
 *
 * Una constante y no un parámetro: qué modelo mira una imagen clínica no
 * es una opción de la pantalla. Se guarda en cada fila
 * (`EduStudyAnalysis.modelUsed`) para poder contestar dentro de un año con
 * qué se generó una lectura concreta, cuando esta constante ya sea otra.
 *
 * ⚠️ El dental usa `claude-sonnet-4-6` en su ruta de radiografías. Aquí se
 * usa el modelo más capaz disponible a propósito: quien lee esta respuesta
 * es un alumno en formación, que tiene menos criterio para detectar un
 * hallazgo inventado que un doctor con veinte años de placas. Si algún día
 * hay que igualarlos, se cambia esta línea y el precio de ia-core.ts.
 */
const EDU_ANALISIS_MODEL = "claude-opus-5";

/** Techo de salida. Con pensamiento adaptativo hace falta holgura. */
const EDU_ANALISIS_MAX_TOKENS = 6000;

// ═══════════════════════════════════════════════════════════════════════
// EL ENTORNO Y LA BANDERA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lee el entorno UNA vez por petición.
 *
 * `EDU_IA_ENABLED` se considera encendida con "1", "true" o "on" (sin
 * distinguir mayúsculas). Cualquier otra cosa —vacía, ausente, "false",
 * "no", un dedazo— deja la IA apagada: en una bandera que abre el grifo
 * del gasto, lo ambiguo se interpreta como "no".
 */
export function eduIaEntornoActual(): EduIaEntorno {
  const raw = String(process.env.EDU_IA_ENABLED ?? "").trim().toLowerCase();
  return {
    habilitada: raw === "1" || raw === "true" || raw === "on",
    openaiConfigurado: Boolean(process.env.OPENAI_API_KEY),
    anthropicConfigurado: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

/** El estado de una función, ya resuelto contra el entorno de este proceso. */
export function eduIaEstadoActual(feature: EduIaFeature): EduIaEstado {
  return eduIaEstado(feature, eduIaEntornoActual());
}

/** Lanza el 503 explicativo si la función no está disponible. */
function requireIa(feature: EduIaFeature): void {
  const estado = eduIaEstadoActual(feature);
  if (!estado.disponible) {
    throw new EduPadronError(`${estado.titulo}. ${estado.detalle}`, 503);
  }
}

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · DICTADO
// ═══════════════════════════════════════════════════════════════════════

export interface EduDictadoResult {
  text: string;
  duration: number | null;
}

/**
 * Transcribe una grabación corta.
 *
 * 🔴 EL AUDIO NO SE GUARDA EN NINGÚN SITIO. Entra, se transcribe y se
 * descarta: no toca Storage, no se asocia al paciente y no queda en una
 * fila. Es la misma decisión del dental, y en una escuela pesa más — un
 * archivo de audio con la voz de un paciente contando su motivo de
 * consulta es un dato personal sensible que nadie pidió conservar.
 *
 * Lo que sí se valida antes de gastar un centavo: la sesión (el endpoint),
 * el permiso (`expediente.write`, el endpoint), la bandera de IA, el
 * tamaño y el formato.
 */
export async function transcribeEduDictado(
  ctx: EduClinicaContext,
  audio: Blob & { name?: string },
): Promise<EduDictadoResult> {
  requireInstitution(ctx);
  requireIa("dictado");

  if (!audio || typeof audio !== "object" || typeof audio.size !== "number" || audio.size === 0) {
    throw new EduPadronError('Falta el audio de la grabación.', 400);
  }
  if (audio.size > EDU_DICTADO_MAX_BYTES) {
    throw new EduPadronError("La grabación pesa demasiado. Graba tramos más cortos.", 413);
  }
  if (!eduDictadoMimeOk(audio.type)) {
    throw new EduPadronError("Ese formato de audio no se puede transcribir.", 415);
  }

  const esMp4 = String(audio.type || "").startsWith("audio/mp4") ||
    String(audio.type || "").startsWith("video/mp4");

  const result = await transcribeAudio({
    audio,
    filename: audio.name || (esMp4 ? "voz.mp4" : "voz.webm"),
    mime: audio.type || "audio/webm",
    language: "es",
    prompt: EDU_DICTADO_HINT,
  });

  if (result.mock) {
    // No debería pasar: `requireIa` ya comprobó la llave. Se contesta
    // igual porque la llave puede desaparecer entre las dos líneas (un
    // despliegue a media petición) y un `text: ""` silencioso se vería
    // como "no te entendí nada".
    throw new EduPadronError("La transcripción no está configurada en este entorno.", 503);
  }
  if (result.error) {
    console.error("[instituto/ia] dictado:", result.error);
    throw new EduPadronError("No se pudo transcribir el audio. Intenta de nuevo.", 502);
  }

  return {
    text: (result.text || "").trim(),
    duration: typeof result.duration === "number" ? result.duration : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · ANÁLISIS RADIOGRÁFICO
// ═══════════════════════════════════════════════════════════════════════

const ANALISIS_SELECT = {
  id: true,
  studyId: true,
  summary: true,
  findings: true,
  recommendations: true,
  severity: true,
  confidence: true,
  modelUsed: true,
  tokensUsed: true,
  costUsdMicros: true,
  requestedByName: true,
  createdAt: true,
} satisfies Prisma.EduStudyAnalysisSelect;

type AnalisisPayload = Prisma.EduStudyAnalysisGetPayload<{ select: typeof ANALISIS_SELECT }>;

function toRow(a: AnalisisPayload, timeZone: string): EduAnalisisRow {
  return {
    id: a.id,
    studyId: a.studyId,
    summary: a.summary,
    hallazgos: eduAnalisisHallazgos(a.findings),
    recomendaciones: eduAnalisisRecomendaciones(a.recommendations),
    severity: a.severity,
    confidence: typeof a.confidence === "number" ? a.confidence : null,
    modelUsed: a.modelUsed,
    tokensUsed: a.tokensUsed,
    costUsdMicros: a.costUsdMicros,
    requestedByName: a.requestedByName,
    createdAt: a.createdAt.toISOString(),
    createdLabel: stampLabel(a.createdAt, timeZone),
  };
}

/**
 * El estudio, buscado DENTRO del alcance CLÍNICO.
 *
 * 🔴 Recurso "cases", igual que el resto del expediente y NO igual que los
 * consentimientos: una radiografía es expediente clínico, y caja no lo ve.
 * El recorte cuelga del PACIENTE porque de ahí cuelga el estudio, y se
 * arma con `eduClinicalScope` para que sea literalmente el mismo `where`
 * que usa la galería.
 */
async function getEstudioEnAlcance(
  ctx: EduClinicaContext,
  studyId: string,
  now: Date,
): Promise<{
  id: string;
  patientId: string;
  name: string;
  mimeType: string;
  sizeBytes: bigint;
  storagePath: string;
} | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(studyId);
  if (!id) return null;

  return prisma.eduStudy.findFirst({
    where: {
      id,
      institutionId,
      patient: eduPatientScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      patientId: true,
      name: true,
      mimeType: true,
      sizeBytes: true,
      storagePath: true,
    },
  });
}

/**
 * Los análisis que ya tiene un estudio, del más nuevo al más viejo.
 *
 * Se listan TODOS y no solo el último porque en una escuela el docente
 * necesita ver exactamente lo que su alumno vio cuando decidió, no la
 * versión que lo reemplazó después.
 */
export async function listEduStudyAnalyses(
  ctx: EduClinicaContext,
  studyId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduAnalisisRow[]> {
  const institutionId = requireInstitution(ctx);
  const estudio = await getEstudioEnAlcance(ctx, studyId, now);
  if (!estudio) return [];

  const rows = await prisma.eduStudyAnalysis.findMany({
    where: { institutionId, studyId: estudio.id },
    orderBy: [{ createdAt: "desc" }],
    take: EDU_ANALISIS_MAX_ROWS,
    select: ANALISIS_SELECT,
  });
  return rows.map((r) => toRow(r, timeZone));
}

/**
 * Ventana en la que un segundo POST sobre el mismo estudio devuelve el
 * análisis que acaba de crearse en vez de pedir otro.
 *
 * Existe por una razón muy concreta: el botón está en una pantalla que se
 * usa DE PIE, con el teléfono en una mano, y un doble toque no puede
 * costar dos llamadas de visión. No es una caché —a los dos minutos un
 * "Analizar otra vez" sí analiza otra vez, que es lo que la persona
 * espera— sino un freno contra el doble clic.
 */
const EDU_ANALISIS_DEDUPE_MS = 90 * 1000;

export interface EduAnalisisResult {
  row: EduAnalisisRow;
  /** true = se devolvió el que ya existía (doble clic), no se gastó nada. */
  reutilizado: boolean;
}

/**
 * Le pide al modelo que mire la imagen.
 *
 * El orden de las comprobaciones es de más barato a más caro, y no es
 * casualidad: primero la bandera (gratis), después el alcance (una
 * consulta), después el formato y el tamaño (columnas que ya tenemos),
 * después el freno de doble clic (una consulta) y solo al final la
 * descarga de los bytes y la llamada que cuesta dinero.
 *
 * 🔴 EL TAMAÑO SE LEE DE LA FILA, que es el que Storage midió cuando se
 * confirmó la subida (nunca el que declaró un cliente). Sin esa
 * comprobación previa, una tomografía de 600 MB se cargaría entera en la
 * memoria de la función antes de que nadie pudiera decir que no cabe.
 */
export async function analyzeEduStudy(
  ctx: EduClinicaContext,
  studyId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduAnalisisResult> {
  const institutionId = requireInstitution(ctx);
  requireIa("analisis");

  const estudio = await getEstudioEnAlcance(ctx, studyId, now);
  if (!estudio) throw new EduPadronError("Ese estudio no existe o no te toca.", 404);

  if (!eduAnalisisMimeOk(estudio.mimeType)) {
    throw new EduPadronError(
      "Solo se pueden analizar imágenes (jpg, png o webp). Una tomografía en .zip o un PDF no se le pueden enseñar al modelo: exporta la proyección que quieres que mire.",
      400,
    );
  }

  const bytes = Number(estudio.sizeBytes);
  if (bytes > EDU_ANALISIS_MAX_IMAGE_BYTES) {
    throw new EduPadronError(
      `Esa imagen pesa demasiado para analizarla (el máximo son ${Math.round(
        EDU_ANALISIS_MAX_IMAGE_BYTES / (1024 * 1024),
      )} MB). Exporta una versión más ligera de la misma placa.`,
      413,
    );
  }

  // Freno del doble clic. Se mira el último análisis del estudio, sin
  // importar quién lo pidió: dos alumnos tocando a la vez tampoco tienen
  // por qué pagar dos lecturas del mismo instante.
  const reciente = await prisma.eduStudyAnalysis.findFirst({
    where: {
      institutionId,
      studyId: estudio.id,
      createdAt: { gte: new Date(now.getTime() - EDU_ANALISIS_DEDUPE_MS) },
    },
    orderBy: [{ createdAt: "desc" }],
    select: ANALISIS_SELECT,
  });
  if (reciente) return { row: toRow(reciente, timeZone), reutilizado: true };

  if (!eduStorageConfigured()) {
    throw new EduPadronError(
      "El almacenamiento de archivos no está configurado en este entorno, así que no se puede leer la imagen.",
      503,
    );
  }
  const buffer = await eduStorageDownload(estudio.storagePath);
  if (!buffer) {
    throw new EduPadronError("No se pudo leer la imagen del almacenamiento.", 502);
  }

  const modeConfig = getModeConfig("GENERAL");
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let data: Record<string, unknown>;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": String(apiKey),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: EDU_ANALISIS_MODEL,
        max_tokens: EDU_ANALISIS_MAX_TOKENS,
        // `effort` medio: la lectura de una placa no es un problema de
        // razonamiento largo, y el techo caro no compra aquí lo que cuesta.
        output_config: { effort: "medium" },
        // El prompt del dental va primero y con `cache_control`: es lo
        // ESTABLE de la petición (lo que cambia es la imagen), así que
        // analizar dos placas seguidas paga el prefijo una sola vez.
        system: [
          {
            type: "text",
            text: `${modeConfig.systemPrompt}\n\n${EDU_ANALISIS_SYSTEM_EXTRA}`,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [{ ...modeConfig.tool, cache_control: { type: "ephemeral" } }],
        tool_choice: { type: "tool", name: modeConfig.tool.name },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: estudio.mimeType,
                  data: buffer.toString("base64"),
                },
              },
              {
                type: "text",
                // 🔴 NO se le manda el nombre del paciente, ni su edad, ni
                // sus alergias — a diferencia del dental, que sí arma un
                // "CONTEXTO DEL PACIENTE". Aquí quien pide la lectura es un
                // alumno y el destinatario es una API externa: mandarle
                // datos identificables de un paciente de la escuela no
                // mejora la lectura de una placa lo suficiente como para
                // pagarlo con eso. El nombre del archivo va porque lo puso
                // quien subió el estudio y suele decir qué proyección es.
                text: `Analiza esta imagen radiográfica dental. Archivo: "${estudio.name}".`,
              },
            ],
          },
        ],
      }),
    });

    data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      console.error("[instituto/ia] Anthropic respondió", res.status, data);
      throw new Error("api");
    }
  } catch (e) {
    if (e instanceof EduPadronError) throw e;
    console.error("[instituto/ia] análisis falló:", e);
    throw new EduPadronError("No se pudo analizar la imagen. Intenta de nuevo.", 502);
  }

  const usage = (data.usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const inputTokens = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens);
  const outputTokens = num(usage.output_tokens);
  const totalTokens = inputTokens + outputTokens;

  const bloques = Array.isArray(data.content) ? (data.content as Record<string, unknown>[]) : [];
  const toolUse = bloques.filter(
    (b) => b && b.type === "tool_use" && b.name === modeConfig.tool.name,
  )[0];

  // Si el modelo no usó la herramienta, NO se guarda una fila con texto
  // libre disfrazado de análisis: se rebota. Una fila con `summary:
  // "Respondió en otro formato"` y cero hallazgos se lee en la pantalla
  // como un análisis que no encontró nada, que es lo contrario de lo que
  // pasó.
  const input =
    toolUse && typeof toolUse.input === "object" && toolUse.input !== null
      ? (toolUse.input as Record<string, unknown>)
      : null;
  if (!input) {
    console.warn("[instituto/ia] el modelo no usó la herramienta; no se guarda nada");
    throw new EduPadronError(
      "El modelo respondió en un formato que no se pudo leer. Vuelve a intentarlo.",
      502,
    );
  }

  const hallazgos = eduAnalisisHallazgos(input.findings);
  const severity =
    typeof input.severity === "string" && input.severity.trim()
      ? input.severity.trim().toLowerCase().slice(0, 20)
      : peorSeveridad(hallazgos.map((h) => h.severity));
  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? input.confidence
      : promedio(hallazgos.map((h) => h.confidence));

  const created = await prisma.eduStudyAnalysis.create({
    data: {
      institutionId,
      studyId: estudio.id,
      summary: typeof input.summary === "string" ? input.summary.trim() : "",
      // Se guarda lo NORMALIZADO y no el JSON crudo del modelo: la fila es
      // lo que va a leer una pantalla dentro de un año, y un campo con
      // otra forma la dejaría en blanco sin explicación.
      findings: hallazgos as unknown as Prisma.InputJsonValue,
      recommendations: eduAnalisisRecomendaciones(
        input.recommendations,
      ) as unknown as Prisma.InputJsonValue,
      severity,
      confidence,
      modelUsed: EDU_ANALISIS_MODEL,
      tokensUsed: totalTokens,
      costUsdMicros: eduIaCostoUsdMicros(EDU_ANALISIS_MODEL, inputTokens, outputTokens),
      requestedByUserId: ctx.eduUserId,
      requestedByName: await nombreDeSesion(ctx),
    },
    select: ANALISIS_SELECT,
  });

  return { row: toRow(created, timeZone), reutilizado: false };
}

/** El peor hallazgo manda en la severidad general. */
function peorSeveridad(severidades: string[]): string {
  const orden = ["critical", "high", "medium", "low", "informational"];
  const alias: Record<string, string> = { alta: "high", media: "medium", baja: "low", informativo: "informational" };
  for (const nivel of orden) {
    if (severidades.some((s) => s === nivel || alias[s] === nivel)) return nivel;
  }
  return "informational";
}

/** Promedio de confianza. Sin hallazgos, cero — no null: la columna es Float. */
function promedio(valores: (number | null)[]): number {
  const nums = valores.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

/** El nombre de quien está en la sesión, congelado en la fila. */
async function nombreDeSesion(ctx: EduClinicaContext): Promise<string> {
  const u = await prisma.eduUser.findFirst({
    where: { id: ctx.eduUserId, institutionId: ctx.institutionId },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!u) return "Sin nombre";
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}
