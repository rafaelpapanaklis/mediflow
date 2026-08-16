// Catálogo del material VISUAL del kit de marketing del afiliado: qué formatos
// de imagen existen, qué mensajes se pueden pintar en ellos, con qué estilo
// visual y qué piezas imprimibles hay. Fuente ÚNICA para las tres superficies
// que lo consumen — la ruta que genera las imágenes
// (/api/afiliados/marketing/imagen), la que genera los PDF
// (/api/afiliados/marketing/imprimible) y el panel, que pinta la vista previa.
// Si un formato solo estuviera en dos de los tres, el panel ofrecería
// descargas que la ruta rechaza.
//
// PURO A PROPÓSITO: sin prisma, sin `server-only`, sin node:crypto. El
// componente cliente del panel lo importa tal cual. `plan-shared` es la única
// dependencia y también es client-safe (solo importa un `type`).
//
// ⚠️ TODO LO QUE SE ESCRIBA AQUÍ LO LEE UN DENTISTA CON LA MARCA DALECONTROL
// ENCIMA. Cada afirmación describe algo que el sistema hace HOY (agenda,
// expediente, odontograma, recordatorios y bot de WhatsApp, mini-web con
// reserva en línea, visor de CBCT/3D, CFDI 4.0, portal del paciente,
// multi-sucursal y asistente de IA). Prohibido:
//  · cumplimiento NOM-024 "certificado" (el cumplimiento real va al ~44%);
//  · lenguaje de DIAGNÓSTICO sobre las tomografías — el visor lleva su
//    DiagnosticDisclaimer justamente porque no es de grado diagnóstico: se
//    "abre y revisa", nunca "diagnostica" ni "detecta patologías";
//  · especialidades que no existen (solo dental);
//  · "prueba gratis"/"trial" (el registro cobra desde el primer mes);
//  · garantías de resultado ("baja 40% las inasistencias" no se puede probar);
//  · precios escritos a mano (cambian y el papel no);
//  · prometer IA, usuarios ilimitados o multi-sucursal SIN decir el plan que
//    los incluye (ver PLAN_NOTES abajo).

import { FALLBACK_PLAN_CONFIG } from "@/lib/plan-shared";

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

/* ── Estilos visuales ─────────────────────────────────────────────────────
   El mismo mensaje en tres tratamientos, para que el afiliado elija el que
   pega con su feed (o con su impresora). NO son inversiones perezosas uno del
   otro: cada uno tiene su paleta medida en src/lib/og/affiliate-marketing-
   artwork.tsx (redes) y src/lib/pdf/affiliate-marketing-print.tsx (papel). */

export type SocialStyleId = "oscuro" | "claro" | "color";

export interface SocialStyle {
  id: SocialStyleId;
  label: string;
  /** Para qué sirve, en cristiano. */
  hint: string;
  /**
   * El que conviene mandar a la imprenta: fondo blanco, tinta solo donde hay
   * texto. Los otros dos salen igual de bien, pero cubren la hoja de tóner.
   */
  printRecommended?: boolean;
}

export const SOCIAL_STYLES: SocialStyle[] = [
  {
    id: "oscuro",
    label: "Oscuro",
    hint: "Fondo casi negro con acento morado. Destaca en un feed lleno de fotos claras.",
  },
  {
    id: "claro",
    label: "Claro",
    hint: "Fondo blanco y tinta oscura. El más sobrio, y el que mejor sale en una impresora láser.",
    printRecommended: true,
  },
  {
    id: "color",
    label: "Color",
    hint: "Morado de la marca a toda página. El más llamativo de los tres.",
  },
];

export function findSocialStyle(id: string | null | undefined): SocialStyle | null {
  return SOCIAL_STYLES.find((s) => s.id === id) ?? null;
}

/** El que se ofrece por defecto para papel (ahorra tinta y se lee en láser). */
export const PRINT_DEFAULT_STYLE: SocialStyleId =
  SOCIAL_STYLES.find((s) => s.printRecommended)?.id ?? "claro";

/* ── Notas de plan ────────────────────────────────────────────────────────
   Tres funciones del producto NO vienen en todos los planes. Un dentista que
   compre el Básico creyendo que trae IA y sedes ilimitadas tiene razón en
   sentirse engañado, y el papel impreso no se corrige: el mensaje que las
   menciona lleva SIEMPRE su nota, en los tres estilos y también en el PDF.

   Los números y las etiquetas salen de FALLBACK_PLAN_CONFIG, no de la mano:
   si mañana el plan Clínica incluye 5 sedes, la nota lo dice sola. (El valor
   VIVO está en plan_configs y lo puede editar el admin; un papel ya impreso no
   puede seguir esa edición, pero el material que se genere desde aquí sí
   arranca del mismo sitio que las tarjetas de precio.) */

const PRO_PLAN = FALLBACK_PLAN_CONFIG.PRO;
const CLINIC_PLAN = FALLBACK_PLAN_CONFIG.CLINIC;

export const PLAN_NOTES = {
  /** BASIC tiene aiTokensDefault 0 y "ai-assistant" apagado: NO es "para todos". */
  ia: `Disponible desde el plan ${PRO_PLAN.label}`,
  /**
   * `maxClinics` es 3 en el plan Clínica: "sucursales ilimitadas" sería
   * mentira. Si algún día pasara a null (sin tope), la nota deja de prometer
   * un número en vez de prometer uno equivocado.
   */
  sucursales:
    CLINIC_PLAN.maxClinics && CLINIC_PLAN.maxClinics > 1
      ? `Plan ${CLINIC_PLAN.label} · hasta ${CLINIC_PLAN.maxClinics} sedes`
      : `Solo en el plan ${CLINIC_PLAN.label}`,
} as const;

/* ── Mensajes ─────────────────────────────────────────────────────────── */

export type SocialVariantId =
  | "agenda"
  | "recordatorios"
  | "bot"
  | "web"
  | "tomografias"
  | "cfdi"
  | "odontograma"
  | "portal"
  | "sucursales"
  | "ia";

export interface SocialVariant {
  id: SocialVariantId;
  /** Nombre del ángulo en el selector del panel. */
  label: string;
  eyebrow: string;
  headline: string;
  /** Dos apoyos como máximo: en 1080 px de ancho, tres ya no respiran. */
  lines: string[];
  /**
   * Qué plan lo incluye. Obligatoria en todo mensaje que hable de algo con
   * tope de plan; se pinta pequeña pero legible en las cuatro imágenes y en
   * las piezas de papel que llevan el tema.
   */
  planNote?: string;
  /** Frase de una línea para el encabezado del volante y del díptico. */
  printIntro: string;
}

// Diez ángulos: uno por función que el dentista reconoce al leerla. Ninguno
// promete algo que el sistema no haga hoy.
export const SOCIAL_VARIANTS: SocialVariant[] = [
  {
    id: "agenda",
    label: "Agenda y expediente",
    eyebrow: "AGENDA Y EXPEDIENTE",
    headline: "Toda tu clínica en una sola pantalla",
    lines: [
      "La agenda del día y el expediente de cada paciente, en el mismo lugar",
      "Historial, notas y documentos sin carpetas sueltas ni libretas",
    ],
    printIntro:
      "La agenda del día y el expediente de cada paciente dejan de vivir en dos lugares distintos: se abren en la misma pantalla.",
  },
  {
    id: "recordatorios",
    label: "Recordatorios por WhatsApp",
    eyebrow: "RECORDATORIOS",
    headline: "El recordatorio de la cita llega por WhatsApp",
    lines: [
      "El aviso antes de la cita sale en automático, a la hora que tú decidas",
      "Sin que recepción tenga que llamar uno por uno",
    ],
    printIntro:
      "El aviso de la cita sale solo por WhatsApp, a la hora que tú decidas, y recepción deja de marcar teléfono por teléfono.",
  },
  {
    id: "bot",
    label: "Bot de WhatsApp",
    eyebrow: "BOT DE WHATSAPP",
    headline: "Un bot contesta el WhatsApp de tu clínica",
    lines: [
      "Responde las preguntas de siempre y agenda citas a cualquier hora",
      "Lo que se sale del guion se lo pasa a una persona del consultorio",
    ],
    printIntro:
      "El WhatsApp de la clínica deja de quedarse sin contestar de noche: el bot responde las preguntas de siempre, agenda la cita y deriva lo demás a una persona.",
  },
  {
    id: "web",
    label: "Tu página web, incluida",
    eyebrow: "TU PÁGINA WEB",
    headline: "Tu página web viene incluida",
    lines: [
      "Una mini-web con tus servicios, tus horarios y cómo llegar",
      "Tus pacientes agendan en línea desde ahí, sin llamar a recepción",
    ],
    printIntro:
      "Tu clínica estrena una mini-web propia, con tus servicios y tus horarios, donde el paciente agenda su cita en línea sin llamar.",
  },
  {
    id: "tomografias",
    label: "Tomografías y 3D",
    eyebrow: "TOMOGRAFÍAS Y 3D",
    // "Abre y revisa", NUNCA "diagnostica": el visor no es de grado
    // diagnóstico y lo dice su propio DiagnosticDisclaimer.
    headline: "Abre tus tomografías desde el navegador",
    lines: [
      "CBCT y modelos 3D del paciente, sin instalar nada en la computadora",
      "Los revisas y los enseñas desde el mismo expediente, en la consulta",
    ],
    printIntro:
      "Las tomografías y los modelos 3D del paciente se abren en el navegador, sin instalar programas, desde el mismo expediente donde está todo lo demás.",
  },
  {
    id: "cfdi",
    label: "Facturación CFDI",
    eyebrow: "FACTURACIÓN",
    // Sin prometer validez ante el SAT: el timbrado depende de la
    // configuración de facturación de cada clínica. Lo que se promete es
    // DÓNDE se hace, que es lo que el sistema controla.
    headline: "Timbra tus facturas desde el sistema",
    lines: [
      "Facturas CFDI 4.0 desde la misma pantalla donde registras el cobro",
      "Sin capturar los mismos datos otra vez en otro portal",
    ],
    printIntro:
      "La factura se timbra en la misma pantalla donde registras el cobro, sin volver a capturar los datos del paciente en otro portal.",
  },
  {
    id: "odontograma",
    label: "Odontograma digital",
    eyebrow: "ODONTOGRAMA DIGITAL",
    headline: "El odontograma de cada paciente, al día",
    lines: [
      "El estado de cada diente y cada superficie, registrado en su ficha",
      "Con el historial de tratamientos del paciente siempre a la mano",
    ],
    printIntro:
      "El estado de cada diente queda registrado en la ficha del paciente, con el historial de lo que se le ha hecho y de lo que falta.",
  },
  {
    id: "portal",
    label: "Portal del paciente",
    eyebrow: "PORTAL DEL PACIENTE",
    headline: "Tus pacientes consultan lo suyo sin llamar",
    lines: [
      "Sus citas y sus documentos, con un enlace seguro a su nombre",
      "Recepción deja de repetir la misma información por teléfono",
    ],
    printIntro:
      "Cada paciente entra con un enlace seguro a ver sus citas y sus documentos, y recepción deja de repetir la misma información por teléfono.",
  },
  {
    id: "sucursales",
    label: "Varias sucursales",
    eyebrow: "VARIAS SUCURSALES",
    headline: "Tus sedes, administradas desde una cuenta",
    lines: [
      "Cambias de sucursal sin volver a entrar ni duplicar la información",
      "Cada sede con su agenda y su equipo, bajo el mismo dueño",
    ],
    planNote: PLAN_NOTES.sucursales,
    printIntro:
      "Las sedes se administran desde una sola cuenta: cambias de sucursal sin volver a entrar, y cada una conserva su agenda y su equipo.",
  },
  {
    id: "ia",
    label: "Asistente con IA",
    eyebrow: "ASISTENTE CON IA",
    headline: "Un asistente con IA dentro de tu sistema",
    lines: [
      "Le preguntas por un paciente o un tratamiento y responde con lo del expediente",
      "Un apoyo para redactar y resumir; la decisión clínica sigue siendo tuya",
    ],
    planNote: PLAN_NOTES.ia,
    printIntro:
      "Un asistente con IA que responde con lo que ya está en el expediente y te ayuda a redactar y a resumir. La decisión clínica sigue siendo del dentista.",
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
  /**
   * Si la pieza encabeza con el tema elegido. La tarjeta NO: en 90 × 50 mm no
   * cabe un titular de campaña con su nota de plan, y una tarjeta de
   * presentación se entrega para presentarse, no para vender una función
   * suelta. El volante y el díptico sí lo llevan.
   */
  usesVariant?: boolean;
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
    usesVariant: true,
  },
  {
    id: "diptico",
    label: "Díptico de expo",
    size: "Carta horizontal · doblado a la mitad · 2 caras",
    hint: "Imprime por los dos lados, dobla a la mitad y déjalo de pie en tu stand.",
    file: "dalecontrol-diptico",
    usesVariant: true,
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
