// ═══════════════════════════════════════════════════════════════════════════
// Notas de voz al bot de WhatsApp (ws1-t5) — el núcleo, puro y testeable.
//
// El paciente manda un audio en vez de escribir. Antes el bot no lo entendía:
// el webhook lo dejaba en la bandeja como «🎤 Te mandaron una nota de voz» y le
// decía «en un momento te atiende una persona». Ahora, si el bot está trabajando
// y la clínica tiene cupo de IA, se transcribe con el MISMO transcriptor del
// dictado (lib/integrations/whisper.ts), se cobra con la MISMA tarifa y el texto
// sigue el camino de un mensaje escrito.
//
// Contrato con el webhook (acordado con ws1-t3, dueña de route.ts): el webhook
// llama a `entenderNotaDeVoz` (nota-de-voz.ts) dentro de su bloque de
// multimedia y hace lo que diga la respuesta:
//   - `texto`      → sigue como si el paciente lo hubiera escrito (recordatorio,
//                    bot…); el IN de la bandeja ya dice «🎤 Nota de voz: …».
//   - `avisar`     → manda `mensaje` al paciente y termina (audio dañado, Meta
//                    caído, demasiado largo). El equipo conserva el audio.
//   - `como_antes` → lo de siempre: el audio se queda para el equipo. Es lo que
//                    pasa con el bot apagado o en pausa, sin cupo de IA, con el
//                    dictado apagado o sin transcriptor configurado: ahí no se
//                    gasta nada y al paciente no se le promete nada nuevo.
//
// Privacidad: el audio NO se guarda en ningún lado nuestro (entra en memoria, se
// transcribe y se descarta; la bandeja lo sigue sirviendo desde Meta por media
// id, como hoy). El texto vive solo en el InboxMessage del hilo de la clínica,
// el mismo trato que un mensaje escrito. Nunca se escribe en un log.
// ═══════════════════════════════════════════════════════════════════════════

/** Más de esto no se transcribe: se le pide al paciente que lo resuma. */
export const LIMITE_SEGUNDOS = 180;

/**
 * Tope de bytes ANTES de descargar. Una nota de voz de WhatsApp (Opus a
 * ~16-32 kbps) de 3 min pesa < 1 MB; un mp3 reenviado a 128 kbps, ~2.9 MB. Con
 * 4 MB pasa cualquier audio de 3 min razonable y no se descarga un archivo de
 * media hora para luego tirarlo.
 */
export const MAX_BYTES = 4 * 1024 * 1024;

/** Notas de voz transcritas por remitente en la ventana (anti-spam / anti-drenaje del cupo). */
export const VOZ_POR_REMITENTE = 10;
export const VENTANA_VOZ_SEG = 10 * 60;

/** Lo que dice el paciente cuando no se pudo escuchar (lo pidió Rafael tal cual). */
export const MSG_NO_PUDE = "No pude escuchar tu audio, ¿me lo escribes? 🙏";

export const MSG_DEMASIADO_LARGO =
  "Tu audio es un poco largo para mí 🙏. ¿Me lo escribes o me mandas uno de menos de 3 minutos? " +
  "El equipo de la clínica también puede escucharlo y responderte.";

/** Pista de vocabulario para Whisper: sesga a lo que un paciente le dice a su clínica. */
export const PISTA_WHISPER =
  "Mensaje de voz de un paciente a su clínica dental en México: cita, agendar, " +
  "reagendar, confirmar, cancelar, mañana, la próxima semana, limpieza, resina, " +
  "ortodoncia, brackets, dolor de muela, ¿cuánto cuesta?";

export type ResultadoNotaDeVoz =
  | { accion: "texto"; texto: string }
  | { accion: "avisar"; mensaje: string; motivo: MotivoAviso }
  | { accion: "como_antes"; motivo: MotivoComoAntes };

export type MotivoAviso = "largo" | "meta_caido" | "caducado" | "audio_danado" | "vacio";
export type MotivoComoAntes =
  | "sin_audio"
  | "bot_en_pausa"
  | "bot_apagado"
  | "dictado_apagado"
  | "sin_cupo"
  | "limite_remitente"
  | "sin_token"
  | "sin_transcriptor"
  | "puerta_fallo";

export interface EntradaNotaDeVoz {
  clinicId: string;
  threadId: string;
  /** El IN ya creado en la bandeja: se le reescribe el cuerpo con la transcripción. */
  inMsgId: string;
  /** wa_id del remitente (para el tope por remitente). */
  from: string;
  /** `msg.audio` tal cual lo manda Meta: { id, mime_type, voice }. */
  audio: { id?: unknown; mime_type?: unknown; voice?: unknown } | null | undefined;
  /** `thread.botActive` del hilo (false = un humano lo tiene). */
  botActive: boolean | null;
  /** Token de la clínica (cifrado o en claro; lo descifra quien descarga). */
  accessToken: string | null;
}

/** Todo lo que toca el mundo de fuera, para poder probar sin Meta, OpenAI ni base. */
export interface DepsNotaDeVoz {
  botEncendido(clinicId: string): Promise<boolean>;
  dictadoApagado(clinicId: string): Promise<boolean>;
  /** true = la clínica agotó su cupo de IA del plan (o su plan no lo trae). */
  sinCupo(clinicId: string): Promise<boolean>;
  /** true = puede pasar (consume uno). */
  permitirRemitente(clave: string): Promise<boolean>;
  transcriptorConfigurado(): boolean;
  /** null = el archivo ya no existe en Meta. Lanza si Meta falla. */
  metaDelAudio(accessToken: string, mediaId: string): Promise<{ url: string; mimeType: string; fileSize: number } | null>;
  /** Descarga el binario. Lanza si falla. */
  descargar(accessToken: string, url: string, maxBytes: number): Promise<Buffer>;
  transcribir(args: { audio: Buffer; filename: string; mime: string }): Promise<{
    text: string;
    duration?: number;
    mock?: boolean;
    error?: string;
  }>;
  cobrar(clinicId: string, segundos: number): Promise<void>;
  reescribirEntrada(clinicId: string, inMsgId: string, body: string): Promise<void>;
  log(evento: string, datos: Record<string, unknown>): void;
}

/** Cómo queda el mensaje en la bandeja una vez transcrito. */
export function cuerpoTranscrito(texto: string, esNotaDeVoz: boolean): string {
  return `${esNotaDeVoz ? "🎤 Nota de voz" : "🎵 Audio"}: ${texto}`;
}

/** Cómo queda en la bandeja cuando el bot no pudo con él (el equipo lo escucha). */
export function cuerpoSinTranscribir(esNotaDeVoz: boolean, motivo: MotivoAviso): string {
  const base = esNotaDeVoz ? "🎤 Te mandaron una nota de voz" : "🎵 Te mandaron un audio";
  return motivo === "largo"
    ? `${base} (dura más de ${LIMITE_SEGUNDOS / 60} min: el bot no la transcribió)`
    : `${base} (el bot no pudo escucharla)`;
}

/** Extensión que Whisper reconoce para el mime que da Meta. */
export function nombreDeArchivo(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m === "audio/ogg" || m === "audio/opus") return "nota.ogg";
  if (m === "audio/mpeg" || m === "audio/mp3") return "nota.mp3";
  if (m === "audio/mp4" || m === "audio/m4a" || m === "audio/x-m4a" || m === "audio/aac") return "nota.m4a";
  if (m === "audio/wav" || m === "audio/x-wav") return "nota.wav";
  if (m === "audio/webm") return "nota.webm";
  if (m === "audio/amr") return "nota.amr";
  return "nota.ogg";
}

/**
 * Duración de un OGG (Opus o Vorbis) leyendo el último `granule_position`, sin
 * decodificar nada. null si no es OGG o no se entiende: entonces decide el
 * tope de bytes y la duración que devuelva Whisper.
 */
export function duracionOgg(buf: Uint8Array): number | null {
  if (buf.length < 28 || !esOggS(buf, 0)) return null;
  // Primera página: cabecera de identificación del códec.
  const nSeg = buf[26];
  const datos = 27 + nSeg;
  if (datos + 19 > buf.length) return null;
  let tasa: number;
  let preSkip = 0;
  if (ascii(buf, datos, 8) === "OpusHead") {
    tasa = 48000; // Opus siempre cuenta a 48 kHz, sea cual sea la tasa de entrada.
    preSkip = buf[datos + 10] | (buf[datos + 11] << 8);
  } else if (buf[datos] === 1 && ascii(buf, datos + 1, 6) === "vorbis") {
    const r = buf[datos + 12] | (buf[datos + 13] << 8) | (buf[datos + 14] << 16) | (buf[datos + 15] << 24);
    tasa = r >>> 0;
    if (!tasa) return null;
  } else {
    return null;
  }
  // Última página con granule válido (−1 = ningún paquete termina en ella).
  for (let i = buf.length - 27; i >= 0; i--) {
    if (!esOggS(buf, i)) continue;
    const lo = (buf[i + 6] | (buf[i + 7] << 8) | (buf[i + 8] << 16) | (buf[i + 9] << 24)) >>> 0;
    const hi = (buf[i + 10] | (buf[i + 11] << 8) | (buf[i + 12] << 16) | (buf[i + 13] << 24)) >>> 0;
    if (hi === 0xffffffff && lo === 0xffffffff) continue;
    const granulo = hi * 2 ** 32 + lo;
    const seg = (granulo - preSkip) / tasa;
    return Number.isFinite(seg) && seg >= 0 ? seg : null;
  }
  return null;
}

function esOggS(b: Uint8Array, i: number): boolean {
  return b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53;
}
function ascii(b: Uint8Array, i: number, n: number): string {
  let s = "";
  for (let k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k]);
  return s;
}

/**
 * El flujo entero. NUNCA lanza: cualquier sorpresa termina en `avisar` (si ya
 * se intentó escuchar) o en `como_antes` (si ni se empezó).
 */
export async function procesarNotaDeVoz(
  e: EntradaNotaDeVoz,
  deps: DepsNotaDeVoz,
): Promise<ResultadoNotaDeVoz> {
  const mediaId = typeof e.audio?.id === "string" && e.audio.id ? e.audio.id : null;
  if (!mediaId) return { accion: "como_antes", motivo: "sin_audio" };
  const esNotaDeVoz = e.audio?.voice === true;

  // ── Puertas: lo barato primero, y nada se gasta si alguna cierra ──
  let puerta: MotivoComoAntes | null = null;
  try {
    if (e.botActive === false) puerta = "bot_en_pausa";
    else if (!(await deps.botEncendido(e.clinicId))) puerta = "bot_apagado";
    else if (await deps.dictadoApagado(e.clinicId)) puerta = "dictado_apagado";
    else if (await deps.sinCupo(e.clinicId)) puerta = "sin_cupo";
    else if (!e.accessToken) puerta = "sin_token";
    else if (!deps.transcriptorConfigurado()) puerta = "sin_transcriptor";
    // El tope por remitente va al final: solo consume cupo de la ventana un
    // audio que de verdad se va a transcribir.
    else if (!(await deps.permitirRemitente(`wa-voz:${e.clinicId}:${e.from}`))) puerta = "limite_remitente";
  } catch (err) {
    deps.log("puerta_fallo", { clinicId: e.clinicId, err: msgDeError(err) });
    return { accion: "como_antes", motivo: "puerta_fallo" };
  }
  if (puerta) {
    deps.log("no_se_transcribe", { clinicId: e.clinicId, motivo: puerta });
    return { accion: "como_antes", motivo: puerta };
  }
  const token = e.accessToken!;

  const avisar = async (motivo: MotivoAviso): Promise<ResultadoNotaDeVoz> => {
    deps.log("no_se_pudo", { clinicId: e.clinicId, motivo });
    try {
      await deps.reescribirEntrada(e.clinicId, e.inMsgId, cuerpoSinTranscribir(esNotaDeVoz, motivo));
    } catch (err) {
      deps.log("reescribir_fallo", { clinicId: e.clinicId, err: msgDeError(err) });
    }
    return { accion: "avisar", mensaje: motivo === "largo" ? MSG_DEMASIADO_LARGO : MSG_NO_PUDE, motivo };
  };

  // ── De Meta: media id → URL (con el token de la clínica) → binario ──
  let meta: Awaited<ReturnType<DepsNotaDeVoz["metaDelAudio"]>>;
  try {
    meta = await deps.metaDelAudio(token, mediaId);
  } catch (err) {
    deps.log("meta_fallo", { clinicId: e.clinicId, err: msgDeError(err) });
    return avisar("meta_caido");
  }
  if (!meta) return avisar("caducado");
  if (meta.fileSize > MAX_BYTES) return avisar("largo");

  let audio: Buffer;
  try {
    audio = await deps.descargar(token, meta.url, MAX_BYTES);
  } catch (err) {
    deps.log("descarga_fallo", { clinicId: e.clinicId, err: msgDeError(err) });
    return msgDeError(err) === "demasiado_grande" ? avisar("largo") : avisar("meta_caido");
  }
  if (audio.length === 0) return avisar("audio_danado");

  // Duración ANTES de pagar: en una nota de voz (OGG) sale del propio archivo.
  const mime = (typeof e.audio?.mime_type === "string" && e.audio.mime_type) || meta.mimeType || "audio/ogg";
  const durOgg = duracionOgg(audio);
  if (durOgg !== null && durOgg > LIMITE_SEGUNDOS) return avisar("largo");

  // ── Transcribir (el MISMO transcriptor del dictado) ──
  let r: Awaited<ReturnType<DepsNotaDeVoz["transcribir"]>>;
  try {
    r = await deps.transcribir({ audio, filename: nombreDeArchivo(mime), mime: mime.split(";")[0].trim() });
  } catch (err) {
    r = { text: "", error: msgDeError(err) };
  }
  // Sin clave de OpenAI: no es culpa del audio ni del paciente, y no se cobra.
  if (r.mock) return { accion: "como_antes", motivo: "sin_transcriptor" };
  if (r.error) {
    deps.log("whisper_fallo", { clinicId: e.clinicId, err: r.error.slice(0, 120) });
    return avisar("audio_danado");
  }

  // Se cobra lo que Whisper sí escuchó (aunque saliera vacío: el costo existió).
  // Duración: la de Whisper; si no vino, la del OGG; si tampoco, una estimación
  // por tamaño a 32 kbps (lo alto de una nota de voz), acotada al límite.
  const segundos =
    typeof r.duration === "number" && Number.isFinite(r.duration) && r.duration > 0
      ? r.duration
      : durOgg ?? Math.min(LIMITE_SEGUNDOS, audio.length / 4096);
  try {
    await deps.cobrar(e.clinicId, Math.max(1, segundos));
  } catch (err) {
    // FAIL-OPEN como el dictado: la transcripción ya ocurrió.
    deps.log("cobro_fallo", { clinicId: e.clinicId, err: msgDeError(err) });
  }

  const texto = (r.text ?? "").replace(/\s+/g, " ").trim();
  if (!texto) return avisar("vacio");

  try {
    await deps.reescribirEntrada(e.clinicId, e.inMsgId, cuerpoTranscrito(texto, esNotaDeVoz));
  } catch (err) {
    // La bandeja se queda con «Te mandaron una nota de voz» y el audio; el bot
    // contesta igual.
    deps.log("reescribir_fallo", { clinicId: e.clinicId, err: msgDeError(err) });
  }
  deps.log("transcrita", { clinicId: e.clinicId, segundos: Math.round(segundos) });
  return { accion: "texto", texto };
}

function msgDeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
