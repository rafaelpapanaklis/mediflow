// Contenido ESTÁTICO del kit de marketing del afiliado (copys, pitch de
// objeciones y plantillas de prospección). Español neutro con tú, vendedor
// pero sobrio. PROHIBIDO: promesas falsas, "prueba gratis", precios
// concretos, "garantizado", spam de emojis (máx 1-2 por copy de WhatsApp).
// Variables soportadas en los textos: {tu_link} y {nombre_clinica}.

export type MarketingVertical = "general" | "dental" | "medico" | "spa";

export type MarketingCopy = {
  id: string;
  vertical: MarketingVertical;
  title: string; // ej. "Para grupos de WhatsApp"
  text: string; // incluye {tu_link}
};

export type ObjectionPitch = {
  id: string;
  objection: string; // ej. "Ya uso Excel y me funciona"
  answer: string; // respuesta corta y honesta (2-3 frases)
};

export type ProspectTemplate = {
  id: string;
  channel: "email" | "whatsapp";
  title: string; // ej. "Primer contacto en frío"
  subject?: string; // solo email; puede usar {nombre_clinica}
  body: string; // usa {nombre_clinica} y {tu_link}
};

export const VERTICAL_LABELS: Record<MarketingVertical, string> = {
  general: "General",
  dental: "Dental",
  medico: "Médico",
  spa: "Spa y estética",
};

// Copys listos para compartir (2 por vertical) — tono: colega recomendando
// una herramienta que le funciona, no anuncio. Cada uno termina con {tu_link}.
export const MARKETING_COPYS: MarketingCopy[] = [
  {
    id: "general-estado-whatsapp",
    vertical: "general",
    title: "Para tu estado de WhatsApp",
    text: "¿Tienes clínica o consultorio? Te recomiendo DaleControl: agenda, expediente y recordatorios por WhatsApp en un solo sistema, hecho en México. Menos tiempo en papeleo y menos citas perdidas. Échale un ojo aquí: {tu_link}",
  },
  {
    id: "general-post-facebook",
    vertical: "general",
    title: "Post para Facebook",
    text: "Si llevas tu clínica entre la agenda de papel, un Excel y la facturación a mano, esto te puede regresar varias horas a la semana. DaleControl junta agenda, expediente clínico, recordatorios por WhatsApp y facturación CFDI en un solo lugar. Lo recomiendo porque he visto cómo ordena la operación diaria. Conócelo aquí: {tu_link}",
  },
  {
    id: "dental-grupos-dentistas",
    vertical: "dental",
    title: "Para grupos de dentistas",
    text: "Colegas, ¿cuántas citas se les caen a la semana porque el paciente no llegó? DaleControl manda recordatorios por WhatsApp en automático y eso ayuda a bajar las inasistencias. Además trae odontograma digital y el expediente de cada paciente en un solo lugar. Aquí lo pueden ver: {tu_link}",
  },
  {
    id: "dental-mensaje-colega",
    vertical: "dental",
    title: "Para enviar a un colega dentista",
    text: "Oye, ¿sigues con los expedientes en carpetas? Te paso DaleControl: odontograma digital, historial de tratamientos y recordatorios de cita por WhatsApp para que los pacientes sí lleguen. El expediente completo queda en un solo lugar, sin papeles sueltos. Míralo aquí: {tu_link}",
  },
  {
    id: "medico-grupos-doctores",
    vertical: "medico",
    title: "Para grupos de doctores",
    text: "Para quienes llevan consultorio: DaleControl mantiene expediente clínico, notas de consulta y recetas en orden y en un solo lugar, con agenda y recordatorios por WhatsApp para los pacientes. Menos tiempo administrativo y todo a la mano en cada consulta. Lo pueden conocer aquí: {tu_link}",
  },
  {
    id: "medico-mensaje-colega",
    vertical: "medico",
    title: "Para enviar a un colega médico",
    text: "Oye, ¿cómo llevas el expediente de tus pacientes? Te recomiendo DaleControl: historial, recetas y notas de cada consulta quedan ordenados y se consultan en segundos, y la agenda manda los recordatorios por WhatsApp sola. Échale un vistazo: {tu_link}",
  },
  {
    id: "spa-historias-instagram",
    vertical: "spa",
    title: "Para historias de Instagram",
    text: "Si tienes spa o cabina de estética: de poco sirve una agenda llena si las clientas no llegan ✨ DaleControl confirma y recuerda las citas por WhatsApp en automático, y guarda el historial de cada clienta para invitarla a su siguiente sesión. Conócelo aquí: {tu_link}",
  },
  {
    id: "spa-grupos-estetica",
    vertical: "spa",
    title: "Para grupos de spa y estética",
    text: "¿Se les pierden clientas entre una cita y la siguiente? Con DaleControl la agenda trabaja sola: recordatorios por WhatsApp para que sí lleguen, historial de tratamientos de cada clienta y seguimiento para que regrese. Lo recomiendo porque ordena el negocio sin complicarlo. Aquí está: {tu_link}",
  },
];

// Objeciones reales de clínicas mexicanas con respuestas honestas: sin
// descalificar lo que ya usan y sin prometer milagros.
export const OBJECTION_PITCHES: ObjectionPitch[] = [
  {
    id: "objecion-excel-papel",
    objection: "Ya uso Excel o papel y me funciona",
    answer: "Y está bien: si hoy te funciona, no hay urgencia. La pregunta es cuánto tiempo se te va cada semana buscando datos, cuadrando la agenda y persiguiendo confirmaciones. DaleControl hace ese trabajo en automático y deja el expediente de cada paciente a un clic, no repartido en diez archivos.",
  },
  {
    id: "objecion-sin-tiempo-migrar",
    objection: "No tengo tiempo para migrar",
    answer: "Justo por eso la migración es acompañada: se importa tu base de pacientes y puedes empezar usando solo la agenda, sumando el resto a tu ritmo. La mayoría arranca sin frenar la operación de la clínica.",
  },
  {
    id: "objecion-precio",
    objection: "Se ve caro",
    answer: "Compáralo contra lo que ya te cuesta una sola cita perdida a la semana. Los recordatorios por WhatsApp reducen inasistencias, así que el sistema tiende a pagarse con las citas que recupera, además de las horas administrativas que te regresa.",
  },
  {
    id: "objecion-recepcionista",
    objection: "Mi recepcionista no es muy técnica",
    answer: "No necesita serlo: la interfaz está en español y pensada para recepción, con agenda y recordatorios en pantallas simples. Si maneja WhatsApp, puede manejar esto; y el soporte la acompaña mientras se acomoda.",
  },
  {
    id: "objecion-otro-sistema",
    objection: "Ya tengo otro sistema",
    answer: "Si te está funcionando, adelante. Aun así vale la pena comparar: muchas clínicas pagan varias herramientas sueltas para tener lo que DaleControl junta en un solo lugar (agenda, expediente, recordatorios por WhatsApp y facturación CFDI). Verlo no te compromete a nada.",
  },
  {
    id: "objecion-seguridad-datos",
    objection: "¿Y la seguridad de los datos de mis pacientes?",
    answer: "Es la pregunta correcta. Los datos viajan y se guardan cifrados, con respaldos automáticos, y cada clínica solo puede ver su propia información. Suele ser bastante más seguro que expedientes en carpetas o un Excel en una computadora sin respaldo.",
  },
];

// Plantillas de prospección: 3 email (formal-cálido, con asunto) y 3 WhatsApp
// (cercanas, cortas). Usan {nombre_clinica} y {tu_link}.
export const PROSPECT_TEMPLATES: ProspectTemplate[] = [
  {
    id: "email-frio",
    channel: "email",
    title: "Primer contacto en frío",
    subject: "Agenda, expediente y recordatorios en un solo lugar para {nombre_clinica}",
    body: "Estimado equipo de {nombre_clinica}:\n\nLes escribo para presentarles DaleControl, un software mexicano de gestión de clínicas que recomiendo: agenda, expediente clínico, recordatorios automáticos por WhatsApp y facturación CFDI, todo en un solo lugar.\n\nLas clínicas que lo usan destacan dos cosas: el tiempo administrativo que se ahorran cada semana y la baja en citas perdidas gracias a los recordatorios.\n\nPueden conocerlo sin compromiso aquí: {tu_link}\n\nSi les interesa, con gusto les muestro cómo funciona o resuelvo cualquier duda.\n\nSaludos cordiales.",
  },
  {
    id: "email-seguimiento",
    channel: "email",
    title: "Seguimiento (sin respuesta)",
    subject: "¿Tuvieron oportunidad de revisar DaleControl?",
    body: "Estimado equipo de {nombre_clinica}:\n\nHace unos días les compartí información sobre DaleControl. Sé que la operación diaria de una clínica deja poco espacio, así que seré breve.\n\nSi el papeleo, las confirmaciones de cita o la facturación les están quitando horas, vale la pena darle un vistazo de cinco minutos: {tu_link}\n\nSi no es el momento, no hay ningún problema; quedo atento por si más adelante les hace sentido.\n\nSaludos cordiales.",
  },
  {
    id: "email-post-demo",
    channel: "email",
    title: "Después de una visita/demo",
    subject: "Gracias por su tiempo — siguientes pasos para {nombre_clinica}",
    body: "Estimado equipo de {nombre_clinica}:\n\nGracias por el espacio para platicar sobre DaleControl. Como vimos, la agenda con recordatorios por WhatsApp, el expediente clínico unificado y la facturación CFDI cubrirían justo lo que hoy les consume más tiempo.\n\nPueden retomar la información y crear su cuenta desde este enlace: {tu_link}\n\nQuedo al pendiente para acompañarlos en la puesta en marcha y resolver cualquier duda del equipo.\n\nSaludos cordiales.",
  },
  {
    id: "wa-frio",
    channel: "whatsapp",
    title: "Primer mensaje en frío",
    body: "Hola 👋 ¿es este el WhatsApp de {nombre_clinica}?\nLes comparto algo que puede servirles: DaleControl, un sistema mexicano para clínicas con agenda, expediente y recordatorios por WhatsApp que ayudan a que los pacientes sí lleguen.\nPueden verlo aquí: {tu_link}\n¿Les interesa que les cuente más?",
  },
  {
    id: "wa-seguimiento",
    channel: "whatsapp",
    title: "Seguimiento amable",
    body: "Hola de nuevo 🙂\nHace unos días les compartí DaleControl para {nombre_clinica}, el sistema de agenda, expediente y recordatorios por WhatsApp.\nPor si quedó pendiente, aquí está el enlace: {tu_link}\nSi no es para ustedes no pasa nada; cualquier duda, con gusto la resuelvo.",
  },
  {
    id: "wa-recomendado",
    channel: "whatsapp",
    title: "Conocido/recomendado",
    body: "Hola, ¿cómo estás? Me acordé de {nombre_clinica} por algo que ando recomendando.\nSe llama DaleControl: junta agenda, expediente y facturación CFDI de la clínica en un solo lugar, y manda los recordatorios de cita por WhatsApp en automático.\nMíralo cuando tengas oportunidad: {tu_link}\nSi te interesa, te cuento cómo lo están usando otras clínicas.",
  },
];

// Reemplaza {var} por su valor; las no provistas se quedan tal cual.
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, key) => (vars[key] != null && vars[key] !== "" ? vars[key] : m));
}
