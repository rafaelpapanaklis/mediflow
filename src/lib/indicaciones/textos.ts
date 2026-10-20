// Textos de pantalla de «Indicaciones y constancia» (ws1-t10), en español e inglés.
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que
// reviews/textos-resena.ts): es.json/en.json los tocan a la vez otras pantallas
// y un commit de esos archivos arrastraría sus líneas.
//
// Los textos de FÁBRICA de las hojas (lo que lee el paciente) están en
// fabrica.ts y van solo en español: son para pacientes de clínicas en México.

import { useLocale } from "@/i18n/i18n-provider";
import type { MarcadorClave } from "./marcadores";
import type { CodigoHoja } from "./tipos";
import type { MotivoSinWhatsApp } from "./envio";

const es = {
  /** Para formatear horas en pantalla (Intl). */
  localeIntl: "es-MX",
  // Administración → Plantillas
  tabIndicaciones: "Indicaciones",
  tabConstancia: "Constancia de asistencia",
  ayudaIndicaciones:
    "Lo que se le da al paciente después de un procedimiento: por WhatsApp o impreso, desde la cita. Liga cada hoja a los procedimientos de tu catálogo para que se proponga sola.",
  ayudaConstancia:
    "El texto de la constancia que se imprime desde la cita (paciente, fecha, hora, doctor con cédula y clínica). Se usa la tuya más reciente en uso; si no tienes, la de fábrica.",
  deFabrica: "De fábrica",
  versionDeClinica: "Versión de tu clínica",
  volverAFabrica: "Volver a la de fábrica",
  confirmarVolverTitulo: "¿Volver a la plantilla de fábrica «{nombre}»?",
  confirmarVolverTexto: "La plantilla vuelve a su texto de fábrica. Tu versión no se borra: queda guardada y archivada.",
  toastVolvioAFabrica: "La plantilla volvió a la de fábrica",
  propia: "Propia",
  enUso: "En uso",
  inactiva: "Inactiva",
  ligadaA: "Se propone con: {lista}",
  sinLiga: "Sin procedimientos ligados (se puede elegir a mano en la cita)",
  nueva: "Nueva plantilla",
  ver: "Ver",
  editar: "Editar",
  copiar: "Copiar y editar",
  activar: "Activar",
  desactivar: "Desactivar",
  deshacer: "Deshacer",
  buscar: "Buscar por nombre…",
  sinResultados: "Ninguna plantilla coincide con la búsqueda.",
  vacio: "Todavía no hay plantillas de este tipo.",
  creada: "Creada el {fecha}",
  actualizada: "editada el {fecha}",
  toastCreada: "Plantilla creada",
  toastGuardada: "Cambios guardados",
  toastActivada: "Plantilla en uso",
  toastDesactivada: "Plantilla desactivada",
  // Editor
  tituloNueva: "Nueva plantilla",
  tituloEditar: "Editar plantilla",
  tituloVer: "Plantilla de fábrica",
  tituloCopia: "Copiar y editar",
  tipoIndicaciones: "Indicaciones de cuidado",
  tipoConstancia: "Constancia de asistencia",
  campoNombre: "Nombre",
  campoTexto: "Texto",
  ayudaTexto: "Texto simple. Empieza una línea con «- » para hacer una viñeta; deja una línea en blanco entre párrafos.",
  campoProcedimientos: "Se propone en las citas con estos procedimientos",
  buscarProcedimiento: "Buscar en tu catálogo…",
  sinCatalogo: "Tu catálogo de procedimientos está vacío.",
  procedimientoInactivo: "inactivo",
  marcadoresTitulo: "Datos que se rellenan solos",
  marcadoresAyuda: "Pulsa uno para insertarlo donde está el cursor. Si falta el dato (una cédula sin capturar), sale una raya para llenarla a mano.",
  marcadorDesconocido: "Estos marcadores no existen y saldrán tal cual: {lista}",
  avisoFabrica:
    "Este texto es de fábrica y es el mismo para todas las clínicas: no se edita. Puedes ligarlo a tus procedimientos, apagarlo o copiarlo para adaptarlo.",
  avisoFabricaEditable:
    "Esta plantilla viene de fábrica. Al guardar, tu cambio se aplica solo en tu clínica: las demás clínicas siguen con la de fábrica, y tú puedes volver a ella cuando quieras. El nombre no se cambia.",
  avisoCopia: "Se crea una plantilla tuya con este texto; la original queda igual.",
  avisoRevisa: "Revisa que el texto sea correcto para tu clínica: lo recibe el paciente tal cual.",
  guardar: "Guardar",
  guardando: "Guardando…",
  cancelar: "Cancelar",
  cerrar: "Cerrar",
  guardarLiga: "Guardar procedimientos",
  sufijoCopia: "copia",
  marcadores: {
    nombrePaciente: "Nombre del paciente",
    nombreClinica: "Nombre de la clínica",
    telefonoClinica: "Teléfono de la clínica",
    nombreDoctor: "Doctor que atendió",
    cedulaDoctor: "Cédula profesional del doctor",
    fechaCita: "Fecha de la cita",
    horaInicio: "Hora de llegada (o de la cita)",
    horaFin: "Hora de salida (o de fin de la cita)",
    procedimiento: "Procedimiento de la cita",
    lugar: "Ciudad de la clínica",
    fecha: "Fecha de hoy",
  } as Record<MarcadorClave, string>,
  errores: {
    SIN_TABLA: "Esta función todavía no está activada en tu cuenta.",
    TIPO_INVALIDO: "Tipo de plantilla inválido.",
    NOMBRE_REQUERIDO: "Escribe un nombre.",
    NOMBRE_LARGO: "El nombre es demasiado largo.",
    CUERPO_REQUERIDO: "El texto está vacío.",
    CUERPO_LARGO: "El texto es demasiado largo.",
    NOMBRE_OCUPADO: "Ya hay una plantilla de este tipo con ese nombre.",
    NO_ENCONTRADA: "La plantilla ya no existe.",
    FABRICA_NO_SE_EDITA: "El nombre de una plantilla de fábrica no se cambia: edita el texto o usa «Copiar y editar».",
    NO_ES_DE_FABRICA: "Esa plantilla no es de fábrica.",
    VERSIONES_NO_DISPONIBLES: "Esta función todavía no está activada en tu cuenta.",
    generico: "No se pudo guardar. Inténtalo de nuevo.",
  } as Record<CodigoHoja | "generico", string>,

  // La cita
  ranuraTitulo: "Después de la consulta",
  botonIndicaciones: "Indicaciones",
  botonConstancia: "Constancia de asistencia",
  ofrecerTitulo: "Consulta terminada",
  ofrecerTexto: "¿Le das al paciente las indicaciones de cuidado de «{nombre}»?",
  ofrecerTextoVarias: "¿Le das al paciente las indicaciones de cuidado ({n} propuestas)?",
  ofrecerSi: "Ver indicaciones",
  ofrecerNo: "Ahora no",
  dialogoTitulo: "Indicaciones de cuidado",
  dialogoPara: "Para {paciente}",
  cargando: "Cargando…",
  errorCarga: "No se pudieron cargar las indicaciones.",
  reintentar: "Reintentar",
  propuestas: "Propuestas por los procedimientos de la cita",
  otras: "Otras de tu biblioteca",
  // C-72 (auditoría de uso): DaleControl no trae hojas de ortodoncia (textos clínicos: los decide la clínica);
  // se dice cómo hacer que salgan propuestas en vez de solo «elige a mano».
  sinPropuestas:
    "Ningún procedimiento de esta cita está ligado a una hoja. Elige a mano, o crea la tuya en Administración → Plantillas → Indicaciones y lígala al procedimiento (por ejemplo «Control de ortodoncia»). En citas de ortodoncia también se proponen solas las hojas tuyas con «ortodoncia», «brackets» o «elásticos» en el nombre.",
  sinHojas: "No hay hojas de indicaciones en uso. Créalas en Administración → Plantillas → Indicaciones.",
  vistaPrevia: "Lo que recibe el paciente",
  eligeUna: "Elige al menos una hoja.",
  enviarWhatsapp: "Enviar por WhatsApp",
  enviando: "Enviando…",
  verPdf: "Ver PDF / imprimir",
  descargarPdf: "Descargar PDF",
  enviadas: "Indicaciones enviadas a {destino}.",
  enviadasConPdf: "Indicaciones enviadas en PDF a {destino}.",
  enviadoAviso:
    "Fuera de la ventana de 24 h solo salió el aviso con plantilla, sin el texto. Cuando el paciente responda, vuelve a enviarlas o entrégaselas impresas.",
  yaEnviadasTitulo: "Ya se enviaron hace poco",
  yaEnviadasTexto: "Las indicaciones de esta cita salieron por WhatsApp a las {hora}. ¿Enviarlas otra vez?",
  yaEnviadasSi: "Enviar otra vez",
  noWhatsapp: {
    WA_SIN_CONECTAR: "WhatsApp no está conectado en esta clínica (Configuración → WhatsApp). Imprímelas o descarga el PDF.",
    SIN_TELEFONO: "El paciente no tiene teléfono registrado. Imprímelas o descarga el PDF.",
    FUERA_DE_VENTANA:
      "El paciente no ha escrito a la clínica en las últimas 24 h y WhatsApp solo permite mensajes con una plantilla aprobada por Meta; la de indicaciones todavía no está disponible. Imprímelas o descarga el PDF y entrégaselas.",
    PLANTILLA_EN_REVISION:
      "El paciente no ha escrito en las últimas 24 h y Meta todavía revisa la plantilla de indicaciones. Imprímelas o descarga el PDF.",
    PLANTILLA_RECHAZADA:
      "El paciente no ha escrito en las últimas 24 h y Meta rechazó la plantilla de indicaciones. Imprímelas o descarga el PDF.",
  } as Record<MotivoSinWhatsApp, string>,
  avisoPlantilla:
    "Fuera de la ventana de 24 h saldrá solo el aviso con plantilla (sin el texto); el paciente las recibe completas cuando responda.",
  errorEnvio: "No se envió. WhatsApp no aceptó el mensaje; inténtalo de nuevo o imprímelas.",
  errorEstado: "Esta cita todavía no se atiende: las indicaciones se dan durante o después de la consulta.",
  constanciaElegir: "Plantilla de la constancia",
  constanciaAbrir: "Abrir constancia",
  constanciaAyuda: "Se abre en PDF para imprimir o guardar. Lleva la hora real de llegada (o de inicio) y de fin de la consulta; se emite cuando la consulta ya empezó o terminó.",
  // C-60: sin cédula, se avisa ANTES de imprimir (no se descubre en el papel).
  sinCedulaTitulo: "{doctor} no tiene cédula profesional en «Mi perfil».",
  sinCedulaTexto: "La constancia saldrá con la línea de la cédula en blanco para llenarla a mano.",
  sinCedulaPoner: "Poner la cédula",
  sinCedulaImprimir: "Abrir así",
  sinCedulaCancelar: "Cancelar",
};

type Textos = typeof es;

const en: Textos = {
  localeIntl: "en-US",
  tabIndicaciones: "Aftercare",
  tabConstancia: "Attendance certificate",
  ayudaIndicaciones:
    "What the patient gets after a procedure: by WhatsApp or printed, from the appointment. Link each sheet to procedures in your catalog so it's suggested automatically.",
  ayudaConstancia:
    "The certificate text printed from the appointment (patient, date, time, doctor with license number and clinic). Your most recent active one is used; if you have none, the default.",
  deFabrica: "Default",
  versionDeClinica: "Your clinic's version",
  volverAFabrica: "Back to the default",
  confirmarVolverTitulo: "Go back to the default template “{nombre}”?",
  confirmarVolverTexto: "The template goes back to its default text. Your version isn't deleted: it stays saved, archived.",
  toastVolvioAFabrica: "The template is back to the default",
  propia: "Yours",
  enUso: "In use",
  inactiva: "Inactive",
  ligadaA: "Suggested with: {lista}",
  sinLiga: "No linked procedures (can be picked by hand in the appointment)",
  nueva: "New template",
  ver: "View",
  editar: "Edit",
  copiar: "Copy and edit",
  activar: "Activate",
  desactivar: "Deactivate",
  deshacer: "Undo",
  buscar: "Search by name…",
  sinResultados: "No template matches your search.",
  vacio: "There are no templates of this type yet.",
  creada: "Created {fecha}",
  actualizada: "edited {fecha}",
  toastCreada: "Template created",
  toastGuardada: "Changes saved",
  toastActivada: "Template in use",
  toastDesactivada: "Template deactivated",
  tituloNueva: "New template",
  tituloEditar: "Edit template",
  tituloVer: "Default template",
  tituloCopia: "Copy and edit",
  tipoIndicaciones: "Aftercare instructions",
  tipoConstancia: "Attendance certificate",
  campoNombre: "Name",
  campoTexto: "Text",
  ayudaTexto: "Plain text. Start a line with “- ” for a bullet; leave a blank line between paragraphs.",
  campoProcedimientos: "Suggested in appointments with these procedures",
  buscarProcedimiento: "Search your catalog…",
  sinCatalogo: "Your procedure catalog is empty.",
  procedimientoInactivo: "inactive",
  marcadoresTitulo: "Fields filled in automatically",
  marcadoresAyuda: "Click one to insert it at the cursor. Missing data (e.g. no license number) prints as a blank line to fill by hand.",
  marcadorDesconocido: "These markers don't exist and will print as-is: {lista}",
  avisoFabrica:
    "This is a default text shared by every clinic: it can't be edited. You can link it to your procedures, turn it off or copy it to adapt it.",
  avisoFabricaEditable:
    "This is a default template. Saving applies your change only to your clinic: other clinics keep the default, and you can go back to it anytime. The name can't be changed.",
  avisoCopia: "A template of your own is created with this text; the original stays the same.",
  avisoRevisa: "Make sure the text is right for your clinic: the patient receives it as written.",
  guardar: "Save",
  guardando: "Saving…",
  cancelar: "Cancel",
  cerrar: "Close",
  guardarLiga: "Save procedures",
  sufijoCopia: "copy",
  marcadores: {
    nombrePaciente: "Patient name",
    nombreClinica: "Clinic name",
    telefonoClinica: "Clinic phone",
    nombreDoctor: "Attending doctor",
    cedulaDoctor: "Doctor's license number",
    fechaCita: "Appointment date",
    horaInicio: "Arrival time (or appointment start)",
    horaFin: "Departure time (or appointment end)",
    procedimiento: "Appointment procedure",
    lugar: "Clinic city",
    fecha: "Today's date",
  },
  errores: {
    SIN_TABLA: "This feature isn't enabled on your account yet.",
    TIPO_INVALIDO: "Invalid template type.",
    NOMBRE_REQUERIDO: "Enter a name.",
    NOMBRE_LARGO: "The name is too long.",
    CUERPO_REQUERIDO: "The text is empty.",
    CUERPO_LARGO: "The text is too long.",
    NOMBRE_OCUPADO: "There's already a template of this type with that name.",
    NO_ENCONTRADA: "The template no longer exists.",
    FABRICA_NO_SE_EDITA: "A default template can't be renamed: edit its text or use “Copy and edit”.",
    NO_ES_DE_FABRICA: "That template isn't a default one.",
    VERSIONES_NO_DISPONIBLES: "This feature isn't enabled on your account yet.",
    generico: "Couldn't save. Please try again.",
  },
  ranuraTitulo: "After the visit",
  botonIndicaciones: "Aftercare",
  botonConstancia: "Attendance certificate",
  ofrecerTitulo: "Visit finished",
  ofrecerTexto: "Give the patient the aftercare instructions for “{nombre}”?",
  ofrecerTextoVarias: "Give the patient aftercare instructions ({n} suggested)?",
  ofrecerSi: "See instructions",
  ofrecerNo: "Not now",
  dialogoTitulo: "Aftercare instructions",
  dialogoPara: "For {paciente}",
  cargando: "Loading…",
  errorCarga: "Couldn't load the instructions.",
  reintentar: "Retry",
  propuestas: "Suggested by the appointment's procedures",
  otras: "More from your library",
  sinPropuestas:
    "No procedure in this appointment is linked to a sheet. Pick one by hand, or create yours in Administration → Templates → Aftercare and link it to the procedure (e.g. «Control de ortodoncia»). In orthodontic appointments, your sheets with «ortodoncia», «brackets» or «elásticos» in the name are suggested on their own.",
  sinHojas: "There are no active aftercare sheets. Create them in Administration → Templates → Aftercare.",
  vistaPrevia: "What the patient receives",
  eligeUna: "Pick at least one sheet.",
  enviarWhatsapp: "Send by WhatsApp",
  enviando: "Sending…",
  verPdf: "View PDF / print",
  descargarPdf: "Download PDF",
  enviadas: "Instructions sent to {destino}.",
  enviadasConPdf: "Instructions sent as a PDF to {destino}.",
  enviadoAviso:
    "Outside the 24-hour window only the template notice went out, without the text. When the patient replies, send them again or hand them a printed copy.",
  yaEnviadasTitulo: "Already sent recently",
  yaEnviadasTexto: "This appointment's instructions went out by WhatsApp at {hora}. Send them again?",
  yaEnviadasSi: "Send again",
  noWhatsapp: {
    WA_SIN_CONECTAR: "WhatsApp isn't connected for this clinic (Settings → WhatsApp). Print them or download the PDF.",
    SIN_TELEFONO: "The patient has no phone number. Print them or download the PDF.",
    FUERA_DE_VENTANA:
      "The patient hasn't messaged the clinic in the last 24 hours, and WhatsApp only allows messages with a Meta-approved template; the aftercare template isn't available yet. Print them or download the PDF and hand them over.",
    PLANTILLA_EN_REVISION:
      "The patient hasn't messaged in the last 24 hours and Meta is still reviewing the aftercare template. Print them or download the PDF.",
    PLANTILLA_RECHAZADA:
      "The patient hasn't messaged in the last 24 hours and Meta rejected the aftercare template. Print them or download the PDF.",
  },
  avisoPlantilla:
    "Outside the 24-hour window only the template notice goes out (without the text); the patient gets the full text once they reply.",
  errorEnvio: "Not sent. WhatsApp didn't accept the message; try again or print them.",
  errorEstado: "This appointment hasn't been seen yet: instructions are given during or after the visit.",
  constanciaElegir: "Certificate template",
  constanciaAbrir: "Open certificate",
  constanciaAyuda: "Opens as a PDF to print or save. Uses the actual arrival (or start) and end time of the visit; available once the visit has started or ended.",
  sinCedulaTitulo: "{doctor} has no professional license number in «My profile».",
  sinCedulaTexto: "The certificate will have the license line blank, to fill in by hand.",
  sinCedulaPoner: "Add the license number",
  sinCedulaImprimir: "Open anyway",
  sinCedulaCancelar: "Cancel",
};

export type TextosIndicaciones = Textos;

export function textosIndicaciones(locale: string | null | undefined): TextosIndicaciones {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosIndicaciones(): TextosIndicaciones {
  let locale = "es";
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- se llama siempre, una vez; el try solo cubre la falta de provider
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosIndicaciones(locale);
}

/** «Se propone con: {lista}» → con los valores puestos. */
export function conValores(plantilla: string, valores: Record<string, string | number>): string {
  return plantilla.replace(/\{(\w+)\}/g, (todo, k: string) => (k in valores ? String(valores[k]) : todo));
}
