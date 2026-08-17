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
//
// EL TEMA "TODO EN UNO" es la excepción de forma, no de fondo: en vez de un
// titular con dos apoyos, lista las funciones del sistema con su ícono. Ahí la
// pastilla de plan no cabe diez veces, así que las dos funciones con tope
// (IA y sucursales) llevan asterisco y la pieza cierra con PLAN_FOOTNOTE en
// las imágenes o con PLAN_FOOTNOTE_PRINT en el papel, que sí tiene sitio para
// el detalle. La nota sigue saliendo de FALLBACK_PLAN_CONFIG, no de la mano.

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

/**
 * El tope de sedes, dicho en una frase. Sale de `maxClinics` y de ningún otro
 * sitio: es el mismo dato que alimenta la pastilla del tema suelto y la nota
 * al pie del tema "todo en uno", para que no puedan contradecirse.
 */
const SEDES_LIMIT =
  CLINIC_PLAN.maxClinics && CLINIC_PLAN.maxClinics > 1
    ? `plan ${CLINIC_PLAN.label}, hasta ${CLINIC_PLAN.maxClinics} sedes`
    : `solo en el plan ${CLINIC_PLAN.label}`;

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

/**
 * Nota al pie de una pieza que lista VARIAS funciones. Corta a propósito: en
 * un post con seis u ocho renglones, dos pastillas de plan tapan el mensaje, y
 * una nota que no se lee es igual que no ponerla.
 */
export const PLAN_FOOTNOTE = "* Algunas funciones según el plan contratado.";

/**
 * La misma nota en el papel, donde SÍ hay sitio para el detalle: un volante se
 * lee de cerca y se guarda, así que dice exactamente qué plan trae cada una.
 * Derivada de los mismos valores que PLAN_NOTES.
 */
export const PLAN_FOOTNOTE_PRINT =
  `* Asistente con IA: desde el plan ${PRO_PLAN.label}. Varias sucursales: ${SEDES_LIMIT}.`;

/* ── Funciones del sistema (para el tema "todo en uno") ───────────────────
   Cada función con su ícono y UNA línea cortísima. El texto está medido para
   la celda más angosta que existe en el kit —la portada de Facebook reparte
   167 px por columna—, por eso ninguno pasa de ~32 caracteres. Alargar uno
   aquí no rompe nada, pero le suma un renglón a las cuatro imágenes. */

export type FeatureIconId =
  | "agenda"
  | "recordatorios"
  | "bot"
  | "web"
  | "tomografias"
  | "cfdi"
  | "odontograma"
  | "portal"
  | "ia"
  | "sucursales";

/**
 * Trazos del ícono sobre un lienzo de 24 × 24, SIN relleno: cada cadena es un
 * `d` que se pinta como `<path>` con `fill="none"`.
 *
 * Viven aquí, en el catálogo, y no en cada superficie, porque los dibujan tres
 * motores distintos con la misma geometría: satori (`<svg><path>`),
 * @react-pdf (`<Svg><Path>`) y el navegador en la vista previa del panel. Si
 * el trazo estuviera copiado en los tres, el ícono de la imagen y el del
 * volante se irían separando solos.
 *
 * Sin arcos (`A`) ni relleno: solo M/L/H/V/C/Z, que es lo que los tres
 * renderizan igual sin normalizar nada.
 */
export const FEATURE_ICONS: Record<FeatureIconId, string[]> = {
  // Calendario
  agenda: ["M4 6.5 H20 V20.5 H4 Z", "M4 11 H20", "M8.5 3.5 V9", "M15.5 3.5 V9"],
  // Campana
  recordatorios: [
    "M6 17 V10.5 C6 7.2 8.7 4.5 12 4.5 C15.3 4.5 18 7.2 18 10.5 V17",
    "M3.8 17 H20.2",
    "M9.8 19.6 C10.4 21.1 13.6 21.1 14.2 19.6",
  ],
  // Globo de mensaje
  bot: ["M3.5 5 H20.5 V16 H12.5 L8 20 V16 H3.5 Z", "M7.5 9 H16.5", "M7.5 12.3 H13"],
  // Monitor
  web: ["M3 5.5 H21 V17 H3 Z", "M3 9.2 H21", "M12 17 V20.5", "M8 20.5 H16"],
  // Cubo (volumen 3D)
  tomografias: [
    "M12 3 L20.5 7.5 L12 12 L3.5 7.5 Z",
    "M3.5 7.5 V16.5 L12 21 L20.5 16.5 V7.5",
    "M12 12 V21",
  ],
  // Documento con esquina doblada
  cfdi: ["M6 2.8 H14.8 L18 6.2 V21.2 H6 Z", "M14.6 3 V6.4 H18", "M9 12 H15", "M9 16 H13"],
  // Diente
  odontograma: [
    "M7.6 3.2 C5 3.2 3.7 5.4 4 8 C4.4 11.4 6 12.6 6.6 16 C7 18.4 7.2 21 8.6 21 C10 21 10.2 18.4 10.8 16.6 C11.1 15.6 11.4 15 12 15 C12.6 15 12.9 15.6 13.2 16.6 C13.8 18.4 14 21 15.4 21 C16.8 21 17 18.4 17.4 16 C18 12.6 19.6 11.4 20 8 C20.3 5.4 19 3.2 16.4 3.2 C14.4 3.2 13.4 4.2 12 4.2 C10.6 4.2 9.6 3.2 7.6 3.2 Z",
  ],
  // Persona
  portal: [
    "M12 4 C14.2 4 16 5.8 16 8 C16 10.2 14.2 12 12 12 C9.8 12 8 10.2 8 8 C8 5.8 9.8 4 12 4 Z",
    "M4.5 20.5 C4.5 16.4 7.9 13.8 12 13.8 C16.1 13.8 19.5 16.4 19.5 20.5",
  ],
  // Destello
  ia: [
    "M11 3 L12.8 8.4 L18.2 10.2 L12.8 12 L11 17.4 L9.2 12 L3.8 10.2 L9.2 8.4 Z",
    "M17.6 15 L18.4 17.4 L20.8 18.2 L18.4 19 L17.6 21.4 L16.8 19 L14.4 18.2 L16.8 17.4 Z",
  ],
  // Dos edificios
  sucursales: [
    "M3 21 H21",
    "M4.5 21 V8.5 H12 V21",
    "M12 12.5 H19.5 V21",
    "M7 11.5 H9.5",
    "M7 15.5 H9.5",
    "M15 16 H17",
  ],
};

export interface VariantFeature {
  icon: FeatureIconId;
  /** Una línea cortísima. Ver arriba: ~32 caracteres es el techo real. */
  text: string;
  /**
   * Tiene tope de plan. Se pinta con asterisco y OBLIGA a la nota al pie de la
   * pieza; `featureLabel` pone el asterisco para que las tres superficies no
   * puedan discrepar.
   */
  capped?: boolean;
}

/** "Asistente con IA" → "Asistente con IA *". El asterisco no se escribe a mano. */
export function featureLabel(f: VariantFeature): string {
  return f.capped ? `${f.text} *` : f.text;
}

/* ── Mensajes ─────────────────────────────────────────────────────────── */

export type SocialVariantId =
  | "todo"
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
  /**
   * Dos apoyos como máximo: en 1080 px de ancho, tres ya no respiran.
   *
   * OPCIONAL porque el tema "todo en uno" no los tiene: en su lugar lleva
   * `features`, que es otra forma de pieza (una lista, no un argumento). Un
   * tema trae lo uno o lo otro, nunca los dos.
   */
  lines?: string[];
  /**
   * Solo el tema "todo en uno": las funciones del sistema, en orden de fuerza.
   * Cada formato se queda con las primeras N (ver COMBO_LAYOUT) — por eso el
   * orden importa: lo que se recorta es siempre la cola.
   */
  features?: VariantFeature[];
  /**
   * El que se ofrece por defecto y se marca en el selector. Uno solo: es el
   * que un afiliado usa para presentar el sistema a quien no lo conoce.
   */
  recommended?: boolean;
  /**
   * Qué plan lo incluye. Obligatoria en todo mensaje que hable de algo con
   * tope de plan; se pinta pequeña pero legible en las cuatro imágenes y en
   * las piezas de papel que llevan el tema.
   */
  planNote?: string;
  /** Frase de una línea para el encabezado del volante y del díptico. */
  printIntro: string;
}

// Once ángulos. El PRIMERO enseña el sistema entero —es el que sirve para
// promocionar en frío, a alguien que no ha oído hablar de DaleControl— y los
// diez siguientes toman una función cada uno, para publicar variado sin
// repetir la misma pieza. Ninguno promete algo que el sistema no haga hoy.
export const SOCIAL_VARIANTS: SocialVariant[] = [
  {
    id: "todo",
    label: "Todo en uno · el sistema completo",
    recommended: true,
    eyebrow: "TODO EN UNO",
    headline: "Todo lo que tu clínica necesita, en un sistema",
    // Orden de fuerza: los formatos angostos se quedan con las primeras. Las
    // dos con tope de plan van al final a propósito — así solo aparecen donde
    // hay sitio para la nota al pie que las acompaña.
    features: [
      { icon: "agenda", text: "Agenda y expediente clínico" },
      { icon: "recordatorios", text: "Recordatorios por WhatsApp" },
      { icon: "bot", text: "Bot de WhatsApp que agenda solo" },
      { icon: "web", text: "Tu página web con citas en línea" },
      // "Abre" y "revisa", nunca "diagnostica": aquí ni siquiera se afirma
      // nada, solo dónde se ven.
      { icon: "tomografias", text: "Tomografías y 3D en el navegador" },
      { icon: "cfdi", text: "Facturación CFDI 4.0" },
      { icon: "odontograma", text: "Odontograma digital" },
      { icon: "portal", text: "Portal del paciente" },
      { icon: "ia", text: "Asistente con IA", capped: true },
      { icon: "sucursales", text: "Varias sucursales", capped: true },
    ],
    printIntro:
      "Agenda, expediente, WhatsApp, facturación y tu página web dejan de ser cinco programas sueltos: es un solo sistema donde todo vive junto.",
  },
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

/* ── Cuántas funciones entra en cada formato ──────────────────────────────
   No es un capricho de diseño: es dónde se lee y dónde no. Un post cuadrado
   con las diez funciones obliga a bajar el cuerpo a ~18 px, que en un celular
   son 6 px reales — ilegible. Antes que achicar la letra se quitan funciones,
   así que cada formato se queda con las primeras N del catálogo:

     · post     6 en dos columnas   — cuerpo de 29 px, dos renglones por celda
     · historia 10 en una columna   — el formato con más aire (1920 px de alto)
     · portada  4 en una fila       — es una banda de 624 px, la mitad se recorta
     · banner   6 en dos filas      — 1200 × 630 con el QR comiéndose un tercio

   `count` tiene que ser múltiplo de `cols` o la última fila queda coja. */

export const COMBO_LAYOUT: Record<SocialFormatId, { count: number; cols: number }> = {
  post: { count: 6, cols: 2 },
  historia: { count: 10, cols: 1 },
  portada: { count: 4, cols: 4 },
  banner: { count: 6, cols: 3 },
};

/** Las funciones que caben en ese formato. Vacío si el tema no lista funciones. */
export function featuresForFormat(v: SocialVariant, formatId: SocialFormatId): VariantFeature[] {
  return (v.features ?? []).slice(0, COMBO_LAYOUT[formatId].count);
}

/**
 * ¿Hay que poner la nota al pie? Solo si en ESTA pieza aparece alguna función
 * con tope. Se pregunta por la lista ya recortada, nunca por el tema entero:
 * la portada muestra cuatro funciones sin tope y no tiene por qué arrastrar una
 * nota que no le toca.
 */
export function needsPlanFootnote(features: VariantFeature[]): boolean {
  return features.some((f) => f.capped);
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
