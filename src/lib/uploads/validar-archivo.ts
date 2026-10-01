// Validador COMPARTIDO de subidas (WS1-T8 — seguridad de archivos).
//
// Punto único para «¿este archivo es de verdad lo que dice ser, y es seguro
// guardarlo?». Lo usan todas las rutas de subida del panel (expediente,
// radiografías, fotos, comprobantes, logos, adjuntos de soporte…) EXCEPTO el
// importador (src/lib/import/**, src/app/api/import/**), que tiene su propio
// validador de contenido en src/lib/validate-upload.ts (STL/DICOM/CBCT/XLSX)
// — este módulo lo reusa para no duplicar esa lógica, pero no lo reemplaza.
//
// Filosofía: FALLA CERRADO. Si no podemos determinar con certeza que el
// archivo es del tipo que dice ser, se rechaza — nunca se asume inocente un
// archivo que `file-type` no reconoce (ahí es donde se cuela un .svg o .html
// con <script>, que no tienen firma binaria).
//
// NO se valida por extensión ni por el Content-Type que manda el navegador
// (ambos los controla quien sube el archivo). Se valida por los BYTES.

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { inflateRawSync, inflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { detectDangerousExecutable } from "@/lib/validate-upload";
import { prisma } from "@/lib/prisma";
import { rateLimitKey } from "@/lib/rate-limit";

// ─────────────────────────── Perfiles de subida ───────────────────────────

export interface PerfilSubida {
  /** Identificador corto, solo para logs/reportes. */
  id: string;
  /** MIME reales aceptados (los que detecta file-type sobre los bytes). */
  mimesPermitidos: readonly string[];
  /** Tamaño máximo en bytes. */
  maxBytes: number;
  /** Exige decodificación real de la imagen (sharp) + límite de megapíxeles. */
  imagen?: boolean;
  /** Exige escaneo de JS/acciones/adjuntos/cifrado dentro del PDF. */
  pdfProfundo?: boolean;
  /** Descripción humana, para mensajes de error. */
  descripcion: string;
}

const MB = 1024 * 1024;

const IMAGENES_COMUNES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// HEIC/HEIF: fotos de iPhone. file-type sí las detecta (ftyp box), sharp NO
// siempre las puede decodificar según cómo se compiló libvips — por eso HEIC
// se acepta en el whitelist de tipo pero el perfil que las usa no debe exigir
// `imagen: true` salvo que se confirme soporte de sharp en el server real.
const IMAGENES_MOVIL = ["image/heic", "image/heif"] as const;

/**
 * Perfiles de subida del panel. Cada ruta declara el suyo; si hace falta uno
 * nuevo, se añade aquí (no se inventan whitelists sueltas en la ruta).
 */
export const PERFILES = {
  FOTO_CLINICA: {
    id: "FOTO_CLINICA",
    mimesPermitidos: [...IMAGENES_COMUNES, ...IMAGENES_MOVIL],
    maxBytes: 25 * MB,
    imagen: true,
    descripcion: "foto clínica",
  },
  DOCUMENTO_PACIENTE: {
    id: "DOCUMENTO_PACIENTE",
    mimesPermitidos: ["application/pdf", ...IMAGENES_COMUNES],
    maxBytes: 15 * MB,
    imagen: true,
    pdfProfundo: true,
    descripcion: "documento del paciente",
  },
  RADIOGRAFIA: {
    id: "RADIOGRAFIA",
    mimesPermitidos: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/tiff",
      "application/pdf",
    ],
    maxBytes: 50 * MB,
    imagen: true,
    pdfProfundo: true,
    descripcion: "radiografía o archivo clínico",
  },
  COMPROBANTE: {
    id: "COMPROBANTE",
    mimesPermitidos: ["application/pdf", ...IMAGENES_COMUNES],
    maxBytes: 15 * MB,
    imagen: true,
    pdfProfundo: true,
    descripcion: "comprobante de compra o pago",
  },
  LOGO_AVATAR: {
    id: "LOGO_AVATAR",
    mimesPermitidos: IMAGENES_COMUNES,
    maxBytes: 5 * MB,
    imagen: true,
    descripcion: "logo o foto de perfil",
  },
  ADJUNTO_SOPORTE: {
    id: "ADJUNTO_SOPORTE",
    mimesPermitidos: ["application/pdf", ...IMAGENES_COMUNES],
    maxBytes: 10 * MB,
    imagen: true,
    pdfProfundo: true,
    descripcion: "adjunto de soporte",
  },
  CONSENTIMIENTO: {
    id: "CONSENTIMIENTO",
    mimesPermitidos: [...IMAGENES_COMUNES, "application/pdf"],
    maxBytes: 8 * MB,
    imagen: true,
    pdfProfundo: true,
    descripcion: "consentimiento o firma",
  },
  AUDIO_DICTADO: {
    id: "AUDIO_DICTADO",
    mimesPermitidos: [
      "audio/webm",
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "audio/wav",
      "audio/x-wav",
      "audio/aac",
    ],
    maxBytes: 30 * MB,
    descripcion: "nota de voz",
  },
} as const satisfies Record<string, PerfilSubida>;

export type PerfilId = keyof typeof PERFILES;

// MIME real → extensión de archivo que se guarda (NUNCA la extensión que
// mandó el cliente).
const EXTENSION_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "audio/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
};

// ───────────────────── Extensiones y firmas peligrosas ─────────────────────

/**
 * Cualquier segmento de nombre que coincida con esto es un veto duro, pase lo
 * que pase con el contenido — defensa contra "informe.pdf.exe" o un nombre
 * que otra pantalla del panel decida mostrar/servir tal cual algún día.
 */
const EXTENSIONES_PELIGROSAS =
  /\.(exe|dll|com|bat|cmd|scr|msi|jar|js|jsx|mjs|cjs|vbs?|wsf|ps1|sh|bash|php\d?|phtml|py|pl|rb|html?|xhtml|hta|jse|lnk|reg|dmg|apk|ipa|app|dylib|so|deb|rpm|vbe|action|wsc|gadget|cpl|msc|scf)$/i;

/** Marcadores de texto/script — un archivo real de imagen/pdf nunca empieza así. */
const MARCADORES_SCRIPT = [
  "<script",
  "<?php",
  "#!/",
  "<html",
  "<svg",
  "<iframe",
  "<!doctype html",
  "javascript:",
  "<?xml",
  // NOTA: "<%" (ASP/JSP clásico) se quitó — 2 bytes coinciden por azar en
  // ~6% de binarios comprimidos reales (JPEG/PNG/STL), y este stack no
  // ejecuta .asp/.jsp de todos modos. Medido en revisión ws1-t8.
];

/** Exportado: rutas con validación a medida (dental-labs, models-3d) también lo usan. */
export function pareceScriptOMarcado(buf: Buffer): string | null {
  // Solo mira el arranque: un binario real (jpg/png/pdf) no es texto ahí.
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString("latin1").toLowerCase();
  for (const marcador of MARCADORES_SCRIPT) {
    if (head.includes(marcador)) return marcador;
  }
  return null;
}

/**
 * Revisa CADA segmento del nombre declarado (no solo el último) contra la
 * lista de extensiones peligrosas. Cubre "factura.pdf.exe" y variantes con
 * mayúsculas/espacios. Exportado para rutas con validación a medida.
 */
export function tieneExtensionPeligrosa(nombre: string): boolean {
  const partes = nombre.split(".");
  if (partes.length < 2) return false;
  for (let i = 1; i < partes.length; i++) {
    if (EXTENSIONES_PELIGROSAS.test("." + partes[i])) return true;
  }
  return false;
}

// ───────────────────────────── PDF profundo ─────────────────────────────

const MARCADORES_PDF_PELIGROSOS: Array<[RegExp, string]> = [
  [/\/JavaScript\b/, "JavaScript embebido"],
  [/\/JS\b/, "JavaScript embebido"],
  [/\/AA\b/, "acción automática (AA)"],
  [/\/OpenAction\b/, "acción automática al abrir (OpenAction)"],
  [/\/Launch\b/, "acción de lanzar programa externo (Launch)"],
  [/\/EmbeddedFile\b/, "archivo incrustado (EmbeddedFile)"],
  [/\/RichMedia\b/, "contenido RichMedia (Flash/3D embebido)"],
  [/\/SubmitForm\b/, "envío automático de formulario"],
  [/\/ImportData\b/, "importación automática de datos"],
];

/**
 * Escaneo best-effort de un PDF: busca los marcadores peligrosos tanto en el
 * texto plano del archivo como dentro de cada stream comprimido con Flate
 * (lo habitual). No es un parser PDF completo — un PDF adversarial con
 * ofuscación fuerte podría evadirlo — pero atrapa el caso común (payload de
 * JS/acción declarado en claro o en un stream Flate estándar), que es la
 * inmensa mayoría de PDFs maliciosos "de verdad" que circulan por email/web.
 *
 * Devuelve el motivo de rechazo, o null si no encontró nada peligroso.
 */
/**
 * Versión exportada de `pdfPeligroso` para rutas que NO pasan por
 * `validarArchivo` (validación de contenido a medida, p. ej. dental-labs que
 * mezcla PDF/imagen con STL/PLY/DCM). Devuelve el motivo de rechazo o null.
 */
export function verificarPdfPeligroso(buf: Buffer): string | null {
  return pdfPeligroso(buf);
}

// Tope por stream individual al descomprimir (defensa contra bomba zlib: un
// stream de pocos KB muy compresible puede "inflar" a gigabytes). 20 MB es
// generoso para cualquier payload de JS/acción real — ninguno pesa eso.
const MAX_INFLATE_BYTES = 20 * 1024 * 1024;
// Tope ACUMULADO entre todos los streams de un mismo PDF: sin esto, muchos
// streams pequeños que individualmente caben en MAX_INFLATE_BYTES podrían
// sumar una cantidad absurda de memoria.
const MAX_INFLATE_TOTAL_BYTES = 80 * 1024 * 1024;

/**
 * Revisión superficial de dictionary/keys de un PDF, SIN el contenido binario
 * de sus streams (imágenes JPEG embebidas, fuentes, etc. pueden contener por
 * azar la secuencia de bytes "/JS" o "/AA" y disparar un falso positivo — ver
 * revisión ws1-t8). Los streams se revisan aparte, descomprimidos, más abajo.
 */
function quitarCuerposDeStream(texto: string): string {
  return texto.replace(/stream\r?\n[\s\S]*?endstream/g, "stream\nendstream");
}

function pdfPeligroso(buf: Buffer): string | null {
  const texto = buf.toString("latin1");
  const textoSinStreams = quitarCuerposDeStream(texto);

  if (/\/Encrypt\b/.test(textoSinStreams)) {
    return "el PDF está cifrado/protegido y no se puede revisar su contenido con seguridad";
  }

  for (const [patron, motivo] of MARCADORES_PDF_PELIGROSOS) {
    if (patron.test(textoSinStreams)) return motivo;
  }

  // Streams Flate: "stream\r?\n...bytes...\r?\nendstream". Se descomprimen los
  // primeros N para no gastar CPU en un PDF gigante con miles de streams, con
  // un tope de bytes de salida por stream y en total (bomba zlib).
  const MAX_STREAMS = 60;
  let vistos = 0;
  let totalInflado = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while (vistos < MAX_STREAMS && (m = re.exec(texto))) {
    vistos++;
    const inicio = m.index + m[0].length;
    const fin = texto.indexOf("endstream", inicio);
    if (fin < 0) continue;
    const crudo = buf.subarray(inicio, fin);
    if (totalInflado >= MAX_INFLATE_TOTAL_BYTES) break;
    const restante = MAX_INFLATE_TOTAL_BYTES - totalInflado;
    const limite = Math.min(MAX_INFLATE_BYTES, restante);
    for (const inflar of [inflateSync, inflateRawSync]) {
      try {
        const plano = inflar(crudo, { maxOutputLength: limite });
        totalInflado += plano.length;
        const planoTexto = plano.toString("latin1");
        for (const [patron, motivo] of MARCADORES_PDF_PELIGROSOS) {
          if (patron.test(planoTexto)) return motivo;
        }
        break; // se pudo inflar con este método, no probar el otro
      } catch {
        // no es Flate válido con este método, no es Flate, o excedió el
        // tope de salida (bomba zlib) — en cualquier caso, se ignora y
        // sigue con el siguiente stream.
      }
    }
  }

  return null;
}

// ─────────────────────────── Nombre y llave ───────────────────────────

/**
 * Nombre visible saneado: sin ruta, sin caracteres raros, sin puntos dobles
 * (path traversal), recortado. Se usa SOLO para mostrar/guardar como
 * metadata — nunca como parte de la llave de almacenamiento real.
 */
export function sanitizarNombreArchivo(nombre: string): string {
  const base = (nombre || "archivo").split(/[\\/]/).pop() || "archivo";
  const limpio = base
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ ()-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120)
    .trim();
  return limpio || "archivo";
}

/**
 * Llave de almacenamiento generada ENTERAMENTE por el servidor: los
 * `segmentos` son ids de confianza (clinicId, patientId…) que el caller ya
 * validó contra la sesión — nunca texto libre del cliente. El nombre
 * original del archivo NO forma parte de la llave (solo su extensión real,
 * derivada del MIME detectado por bytes).
 */
export function generarLlaveAlmacenamiento(segmentos: string[], extensionReal: string): string {
  const limpios = segmentos.map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60)).filter(Boolean);
  return [...limpios, `${Date.now()}_${randomUUID()}.${extensionReal}`].join("/");
}

// ─────────────────────────── Resultado / API ───────────────────────────

export type ResultadoValidacion =
  | { ok: true; mimeReal: string; extensionReal: string; nombreSaneado: string }
  | { ok: false; motivo: string; codigo: CodigoRechazo };

export type CodigoRechazo =
  | "vacio"
  | "demasiado_grande"
  | "ejecutable"
  | "script_o_marcado"
  | "extension_peligrosa"
  | "tipo_no_reconocido"
  | "tipo_no_permitido"
  | "imagen_corrupta"
  | "imagen_excesiva"
  | "pdf_peligroso"
  | "antivirus";

const MEGAPIXELES_MAXIMOS = 60_000_000; // ~60MP — cubre fotos de cámara reales, corta bombas de descompresión

/** MIME de imagen que sharp/libvips de este repo NO puede decodificar de verdad. */
const SIN_DECODE_FORZADO = new Set(["image/heic", "image/heif", "image/bmp"]);

export interface ValidarArchivoArgs {
  bytes: ArrayBuffer | Buffer | Uint8Array;
  nombreOriginal: string;
  perfil: PerfilSubida;
}

/**
 * Valida un archivo subido contra un perfil. Ve SOLO los bytes: no confía en
 * `file.type` (Content-Type del navegador) ni en la extensión del nombre.
 */
export async function validarArchivo(args: ValidarArchivoArgs): Promise<ResultadoValidacion> {
  const buf = Buffer.isBuffer(args.bytes)
    ? args.bytes
    : Buffer.from(args.bytes instanceof ArrayBuffer ? args.bytes : args.bytes.buffer, (args.bytes as Uint8Array).byteOffset ?? 0, (args.bytes as Uint8Array).byteLength ?? (args.bytes as ArrayBuffer).byteLength);

  if (buf.length === 0) {
    return { ok: false, motivo: "El archivo está vacío", codigo: "vacio" };
  }
  if (buf.length > args.perfil.maxBytes) {
    const maxMb = Math.round(args.perfil.maxBytes / MB);
    return { ok: false, motivo: `Archivo demasiado grande (máx ${maxMb} MB)`, codigo: "demasiado_grande" };
  }

  // Veto duro de ejecutable, sin importar el perfil.
  const ejecutable = detectDangerousExecutable(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  if (ejecutable) {
    return { ok: false, motivo: `El contenido es un ${ejecutable}, no un ${args.perfil.descripcion}`, codigo: "ejecutable" };
  }

  // Nombre declarado: extensión peligrosa en cualquier segmento (aunque el
  // contenido sea válido — defensa en profundidad sobre el nombre mostrado).
  if (tieneExtensionPeligrosa(args.nombreOriginal)) {
    return { ok: false, motivo: "El nombre del archivo tiene una extensión no permitida", codigo: "extension_peligrosa" };
  }

  // Texto/script/HTML/SVG disfrazado — file-type no siempre lo detecta
  // porque estos formatos no tienen firma binaria.
  const marcador = pareceScriptOMarcado(buf);
  if (marcador) {
    return {
      ok: false,
      motivo: `El contenido parece un script o marcado (${marcador.trim()}), no un ${args.perfil.descripcion}`,
      codigo: "script_o_marcado",
    };
  }

  const detectado = await fileTypeFromBuffer(buf);
  if (!detectado) {
    // Falla CERRADO: si no se puede determinar el tipo real, se rechaza.
    return { ok: false, motivo: "No se pudo determinar el tipo real del archivo", codigo: "tipo_no_reconocido" };
  }
  if (!args.perfil.mimesPermitidos.includes(detectado.mime)) {
    return {
      ok: false,
      motivo: `El tipo real del archivo (${detectado.mime}) no está permitido para ${args.perfil.descripcion}`,
      codigo: "tipo_no_permitido",
    };
  }

  // AVIF: sharp ya no lo abre (src/lib/uploads/sharp-bloqueos.ts apaga el
  // cargador HEIF de libvips por los avisos de libheif). Sin este corte, el
  // perfil que lo admite (fotos de ortodoncia) diría «corrupta».
  if (detectado.mime === "image/avif") {
    return {
      ok: false,
      motivo: "Las imágenes AVIF no se aceptan. Guárdala como JPG, PNG o WebP y vuelve a subirla.",
      codigo: "tipo_no_permitido",
    };
  }

  // HEIC/HEIF (fotos de iPhone) y BMP quedan FUERA de la decodificación
  // forzada: el libheif que trae sharp empaquetado decodifica AVIF (AV1)
  // pero NO HEIC real (HEVC/x265, con licencia aparte), y sharp/libvips de
  // este repo NO tiene soporte de BMP en absoluto (ni con fallback a
  // ImageMagick) — forzar sharp() en cualquiera de los dos rechazaría
  // archivos legítimos siempre (medido en revisión ws1-t8). Para estos nos
  // quedamos con la detección de firma real (file-type ya distingue el
  // contenedor) + el resto de defensas (ejecutable, script, extensión
  // peligrosa) — ya validadas arriba.
  const exigeDecodificacion = args.perfil.imagen && detectado.mime.startsWith("image/") && !SIN_DECODE_FORZADO.has(detectado.mime);

  if (exigeDecodificacion) {
    try {
      const metadata = await sharp(buf, { limitInputPixels: MEGAPIXELES_MAXIMOS }).metadata();
      if (!metadata.width || !metadata.height) {
        return { ok: false, motivo: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)", codigo: "imagen_corrupta" };
      }
      if (metadata.width * metadata.height > MEGAPIXELES_MAXIMOS) {
        return { ok: false, motivo: "La imagen tiene dimensiones excesivas", codigo: "imagen_excesiva" };
      }
      // Fuerza la decodificación completa (metadata() solo lee el header).
      await sharp(buf, { limitInputPixels: MEGAPIXELES_MAXIMOS }).toBuffer();
    } catch {
      return { ok: false, motivo: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)", codigo: "imagen_corrupta" };
    }
  }

  if (args.perfil.pdfProfundo && detectado.mime === "application/pdf") {
    const motivo = pdfPeligroso(buf);
    if (motivo) {
      return { ok: false, motivo: `El PDF contiene ${motivo}, no se acepta`, codigo: "pdf_peligroso" };
    }
  }

  const av = await escanearAntivirus(buf, { nombre: args.nombreOriginal, mime: detectado.mime });
  if (!av.limpio) {
    return { ok: false, motivo: av.motivo ?? "El antivirus rechazó el archivo", codigo: "antivirus" };
  }

  const extensionReal = EXTENSION_POR_MIME[detectado.mime] ?? detectado.ext ?? "bin";
  return {
    ok: true,
    mimeReal: detectado.mime,
    extensionReal,
    nombreSaneado: sanitizarNombreArchivo(args.nombreOriginal),
  };
}

// ───────────────────────── Antivirus (punto de integración) ─────────────────────────

export interface ResultadoAntivirus {
  limpio: boolean;
  motivo?: string;
  proveedor: string;
}

/**
 * Punto de integración de antivirus. HOY es un passthrough — no hay ningún
 * motor conectado (ver REPORTE-ws1-t8.md §3 para la recomendación: ClamAV
 * como servicio propio en 108, con Vercel mandándole el archivo por HTTP
 * interno). validarArchivo() YA llama a esta función en cada subida, así que
 * conectar un motor real es cambiar SOLO este archivo — ninguna ruta necesita
 * tocarse de nuevo.
 *
 * ⛔ No mandar archivos de pacientes a un servicio externo de terceros sin
 * aviso de privacidad y acuerdo de encargado — por eso hoy no hay nada
 * conectado por defecto.
 */
export async function escanearAntivirus(
  _bytes: Buffer,
  _meta: { nombre: string; mime: string },
): Promise<ResultadoAntivirus> {
  return { limpio: true, proveedor: "ninguno (pendiente — ver REPORTE-ws1-t8.md)" };
}

// ───────────────────────── Cabeceras al servir ─────────────────────────

/**
 * Cabeceras seguras para SERVIR un archivo subido. Fuerza descarga
 * (attachment) para todo lo que no sea imagen o PDF, y siempre manda
 * X-Content-Type-Options: nosniff para que el navegador no intente
 * "adivinar" un tipo distinto al declarado (el vector clásico de XSS por
 * archivo subido).
 */
export function cabecerasDescargaSegura(opts: {
  mimeReal: string;
  nombreSaneado: string;
  forzarDescarga?: boolean;
}): Record<string, string> {
  const inlineSeguro = opts.mimeReal.startsWith("image/") || opts.mimeReal === "application/pdf";
  const disposicion = opts.forzarDescarga || !inlineSeguro ? "attachment" : "inline";
  const nombreEscapado = encodeURIComponent(opts.nombreSaneado);
  return {
    "Content-Type": opts.mimeReal,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${disposicion}; filename="${opts.nombreSaneado.replace(/["\\]/g, "_")}"; filename*=UTF-8''${nombreEscapado}`,
  };
}

// ───────────────────────── Bitácora y límite de frecuencia ─────────────────────────

/**
 * Bitácora de subida rechazada. Best-effort (nunca tira). Si no hay
 * clinicId+userId (rutas admin/plataforma sin sesión de clínica) escribe un
 * console.warn estructurado en vez de una fila de AuditLog, porque esa tabla
 * exige ambos NOT NULL.
 */
export async function registrarSubidaRechazada(opts: {
  /** userId de un STAFF User (FK de AuditLog). Un id de portal paciente/otra
   *  tabla NO sirve aquí — pásalo solo cuando sea de verdad un User. */
  clinicId?: string | null;
  userId?: string | null;
  ruta: string;
  motivo: string;
  codigo: CodigoRechazo;
  nombreOriginal: string;
  patientId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  // Rastro en logs SIEMPRE, incluso si el insert en AuditLog falla o no
  // aplica (rutas sin User de plataforma: portal del paciente, admin sin
  // clinicId). El log del servidor es el bitácora mínimo garantizado.
  console.warn("[uploads] subida rechazada:", {
    ruta: opts.ruta,
    motivo: opts.motivo,
    codigo: opts.codigo,
    nombre: opts.nombreOriginal,
    clinicId: opts.clinicId ?? null,
    patientId: opts.patientId ?? null,
  });
  if (!opts.clinicId || !opts.userId) return;
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: opts.clinicId,
        userId: opts.userId,
        entityType: "upload-rejected",
        entityId: opts.patientId ?? "n/a",
        action: "reject",
        changes: {
          _upload_rechazado: {
            before: null,
            after: {
              ruta: opts.ruta,
              motivo: opts.motivo,
              codigo: opts.codigo,
              nombre: opts.nombreOriginal,
            },
          },
        },
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
    });
  } catch (e) {
    // Frecuente para userId que no es un User de plataforma (p. ej. cuenta
    // del portal del paciente): el console.warn de arriba ya dejó rastro.
    console.error("[uploads] registrarSubidaRechazada — AuditLog falló (¿userId no es un User?):", e);
  }
}

/**
 * Límite de frecuencia por usuario para subidas: por defecto 30 en 10
 * minutos. Devuelve true si la subida cabe en la ventana, false si hay que
 * rechazarla con 429.
 */
export function limiteSubidasPorUsuario(userId: string, limite = 30, ventanaMs = 10 * 60 * 1000): boolean {
  return rateLimitKey(`uploads:${userId}`, limite, ventanaMs);
}
