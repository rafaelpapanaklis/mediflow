// Catálogo del material VISUAL del kit de marketing del afiliado: qué formatos
// de imagen existen, qué mensajes se pueden pintar en ellos y qué piezas
// imprimibles hay. Fuente ÚNICA para las tres superficies que lo consumen —
// la ruta que genera las imágenes (/api/afiliados/marketing/imagen), la que
// genera los PDF (/api/afiliados/marketing/imprimible) y el panel, que pinta
// la vista previa. Si un formato solo estuviera en dos de los tres, el panel
// ofrecería descargas que la ruta rechaza.
//
// PURO A PROPÓSITO: sin prisma, sin `server-only`, sin node:crypto. El
// componente cliente del panel lo importa tal cual.
//
// ⚠️ TODO LO QUE SE ESCRIBA AQUÍ LO LEE UN DENTISTA CON LA MARCA DALECONTROL
// ENCIMA. Cada afirmación describe algo que el sistema hace HOY (agenda,
// expediente, odontograma, recordatorios por WhatsApp, CFDI 4.0, portal del
// paciente). Prohibido: cumplimiento NOM-024 "certificado", especialidades
// inventadas, "prueba gratis" (el registro cobra desde el primer mes),
// precios escritos a mano (cambian y el papel no) y garantías de resultado
// ("baja 40% las inasistencias" no se puede probar).

/* ── Imágenes para redes ──────────────────────────────────────────────── */

export type SocialFormatId = "post" | "historia" | "portada" | "banner";

/**
 * `square`/`vertical` apilan (logo arriba, mensaje en medio, QR abajo);
 * `wide` reparte en dos columnas (mensaje | QR).
 */
export type SocialLayout = "square" | "vertical" | "wide";

export interface SocialFormat {
  id: SocialFormatId;
  label: string;
  /** Dónde se usa, en cristiano: el afiliado no sabe qué es "1640×624". */
  where: string;
  hint: string;
  width: number;
  height: number;
  layout: SocialLayout;
}

export const SOCIAL_FORMATS: SocialFormat[] = [
  {
    id: "post",
    label: "Post cuadrado",
    where: "Instagram y Facebook",
    hint: "El formato de todos los días: súbelo al feed o mándalo por WhatsApp.",
    width: 1080,
    height: 1080,
    layout: "square",
  },
  {
    id: "historia",
    label: "Historia",
    where: "Instagram y Facebook",
    hint: "Pantalla completa del celular. Dura 24 horas y el QR se escanea desde otro teléfono.",
    width: 1080,
    height: 1920,
    layout: "vertical",
  },
  {
    id: "portada",
    label: "Portada de Facebook",
    where: "Tu perfil o página",
    hint: "La banda de arriba de tu perfil. Todo va al centro para que no se corte en el celular.",
    width: 1640,
    height: 624,
    layout: "wide",
  },
  {
    id: "banner",
    label: "Banner horizontal",
    where: "WhatsApp, correo y web",
    hint: "Para mandar por WhatsApp, firmar un correo o pegar en un anuncio.",
    width: 1200,
    height: 630,
    layout: "wide",
  },
];

export function findSocialFormat(id: string | null | undefined): SocialFormat | null {
  return SOCIAL_FORMATS.find((f) => f.id === id) ?? null;
}

export type SocialVariantId = "agenda" | "whatsapp" | "cfdi" | "mexico";

export interface SocialVariant {
  id: SocialVariantId;
  /** Nombre del ángulo en el selector del panel. */
  label: string;
  eyebrow: string;
  headline: string;
  /** Dos apoyos como máximo: en 1080 px de ancho, tres ya no respiran. */
  lines: string[];
}

// Cuatro ángulos distintos para que el afiliado no publique siempre lo mismo.
export const SOCIAL_VARIANTS: SocialVariant[] = [
  {
    id: "agenda",
    label: "Agenda y expediente",
    eyebrow: "AGENDA Y EXPEDIENTE",
    headline: "Toda tu clínica en una sola pantalla",
    lines: [
      "La agenda del día y el expediente de cada paciente, en el mismo lugar",
      "Odontograma digital e historial de tratamientos, sin carpetas sueltas",
    ],
  },
  {
    id: "whatsapp",
    label: "Recordatorios por WhatsApp",
    eyebrow: "RECORDATORIOS",
    headline: "El recordatorio de la cita llega por WhatsApp",
    lines: [
      "Confirmación y recordatorio en automático, para que no se le olvide al paciente",
      "Sin que recepción tenga que llamar uno por uno",
    ],
  },
  {
    id: "cfdi",
    label: "Facturación CFDI",
    eyebrow: "FACTURACIÓN",
    headline: "Factura CFDI 4.0 sin salir del sistema",
    lines: [
      "Timbras desde la misma pantalla donde registras el cobro",
      "Sin capturar los mismos datos otra vez en otro portal",
    ],
  },
  {
    id: "mexico",
    label: "En español y en pesos",
    eyebrow: "HECHO EN MÉXICO",
    headline: "Software para clínicas, en español y en pesos",
    lines: [
      "Pensado para cómo se trabaja y se factura aquí",
      "Agenda, expediente, cobros y CFDI en un solo sistema",
    ],
  },
];

export function findSocialVariant(id: string | null | undefined): SocialVariant | null {
  return SOCIAL_VARIANTS.find((v) => v.id === id) ?? null;
}

/* ── Piezas imprimibles ───────────────────────────────────────────────── */

export type PrintPieceId = "tarjetas" | "volante" | "diptico";

export interface PrintPiece {
  id: PrintPieceId;
  label: string;
  /** Medidas reales, para llevarlas a la imprenta sin adivinar. */
  size: string;
  hint: string;
  /** Nombre del archivo, sin extensión. */
  file: string;
}

export const PRINT_PIECES: PrintPiece[] = [
  {
    id: "tarjetas",
    label: "Tarjetas de presentación",
    size: "Hoja carta · 10 tarjetas de 90 × 50 mm",
    hint: "Imprime la hoja, recorta por las marcas de las esquinas y deja una tarjeta en cada mostrador que visites.",
    file: "dalecontrol-tarjetas",
  },
  {
    id: "volante",
    label: "Volante de una plana",
    size: "Hoja carta · 21.6 × 27.9 cm",
    hint: "Una plana que explica DaleControl a la clínica. Para entregar en mano o dejar en recepción.",
    file: "dalecontrol-volante",
  },
  {
    id: "diptico",
    label: "Díptico de expo",
    size: "Carta horizontal · doblado a la mitad · 2 caras",
    hint: "Imprime por los dos lados, dobla a la mitad y déjalo de pie en tu stand.",
    file: "dalecontrol-diptico",
  },
];

export function findPrintPiece(id: string | null | undefined): PrintPiece | null {
  return PRINT_PIECES.find((p) => p.id === id) ?? null;
}

/* ── Datos del afiliado en la pieza ───────────────────────────────────── */

/**
 * "Martín Rodríguez Salas" → "Martín R.". Nombre de pila completo + inicial
 * del primer apellido: es como se presenta un vendedor, y evita que un nombre
 * largo se coma el ancho de una tarjeta de 90 mm.
 *
 * Devuelve null si no hay nombre utilizable — la cuenta puede tenerlo vacío o
 * en blancos. Quien lo pinta OMITE la línea; ninguna pieza revienta por eso.
 */
export function affiliateShortName(raw: string | null | undefined): string | null {
  const clean = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const parts = clean.split(" ").filter(Boolean);
  const first = parts[0].slice(0, 22);
  if (parts.length === 1) return first;
  const initial = parts[1].charAt(0).toUpperCase();
  // Un apellido que empieza con un carácter raro (comillas, guion) no aporta
  // inicial: mejor el nombre solo que "Martín ..".
  return /[A-ZÁÉÍÓÚÑÜ]/.test(initial) ? `${first} ${initial}.` : first;
}

/** `https://www.dalecontrol.com/r/AB12CD34` → `dalecontrol.com/r/AB12CD34`. */
export function displayShortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}
