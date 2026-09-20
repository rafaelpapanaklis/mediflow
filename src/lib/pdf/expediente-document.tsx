import type { ReactNode } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image as PdfImage,
} from "@react-pdf/renderer";
import { ClinicLetterhead, type ClinicLetterheadClinic } from "@/lib/pdf/clinic-letterhead";
import { formatConsentDate, formatConsentDateTime } from "@/lib/consent/dates";

/**
 * ExpedienteDocument — EL EXPEDIENTE CLÍNICO ENTERO DE UN PACIENTE, EN UN PDF.
 *
 * POR QUÉ EXISTE. Hasta hoy cada pieza del expediente se imprimía por su
 * cuenta: la nota, la carta de consentimiento, la receta. Quien pedía su
 * expediente —y la NOM-004-SSA3-2012 (numerales 5.5 y 5.11) dice que la
 * información **es del paciente** y que puede pedir copia— se llevaba quince
 * descargas sueltas y nadie podía afirmar que eso fuera "el expediente". Si
 * algún día hay una reclamación, lo que se entrega es UN documento paginado,
 * foliado y fechado, no una carpeta de archivos.
 *
 * DE QUÉ CASA ES. Del mismo membrete (`ClinicLetterhead`), el mismo acento
 * morado y el mismo criterio de pie que `clinical-note-document` y
 * `consent-document`: cabecera solo en la portada (el logo es un mapa de bits y
 * repetirlo engorda el archivo y se come ~90 pt por página) y pie `fixed` en
 * TODAS, porque una hoja suelta de un expediente de 40 páginas tiene que decir
 * por sí sola de quién es.
 *
 * ── LAS TRES REGLAS QUE MANDAN AQUÍ ────────────────────────────────────────
 *
 * 1. NUNCA UN HUECO MUDO. Lo que la clínica no capturó se imprime con la
 *    palabra **«No capturado»**, nunca con una raya, un espacio en blanco o el
 *    renglón omitido. Un expediente que calla parece completo y no lo está;
 *    uno que dice «No capturado» es honesto y se puede arreglar. Vale igual
 *    para los datos que el panel todavía no captura (antecedentes heredo-
 *    familiares, aparatos y sistemas, exploración física, pronóstico): se leen
 *    por su nombre y, si no están, se dicen ausentes. Ver `noCapturado`.
 *
 * 2. LAS NOTAS NO SE TOCAN, Y SUS ADENDAS VAN DEBAJO. Una nota firmada es
 *    inalterable (NOM-024); la corrección posterior vive aparte, fechada y
 *    firmada. Se imprimen igual que en `clinical-note-document`: la nota tal
 *    cual, aviso arriba, adendas al final del bloque de esa nota. Ver
 *    `NotaBloque`.
 *
 * 3. LAS DOS CASILLAS VIENEN APAGADAS y el documento lo DICE. Con las imágenes
 *    apagadas los estudios salen LISTADOS con su tipo, su fecha y quién los
 *    subió — y el papel avisa de que las imágenes no se incrustaron, para que
 *    nadie crea que el paciente no tiene placas. Con lo administrativo apagado
 *    no aparece ni una factura: la NOM-004 no lo pide, el expediente es
 *    clínico, y mezclar dinero con historia clínica se lee mal en una
 *    reclamación.
 *
 * ── PURO ───────────────────────────────────────────────────────────────────
 * Sin Prisma, sin red y sin `next/*`: todo llega ya resuelto en las props
 * (fechas en ISO, imágenes en data URL). Así la ruta decide QUÉ se imprime y
 * este archivo solo decide CÓMO, y las pruebas pueden renderizarlo entero sin
 * base de datos.
 */

// ═══════════════════════════════════════════════════════════════════════════
// La palabra
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo que se escribe donde el panel no capturó nada. Es una CONSTANTE y no un
 * literal suelto a propósito: la prueba del expediente vacío la busca con estas
 * palabras exactas, y el día que alguien quiera cambiar el texto lo cambia en
 * un sitio y no en cuarenta.
 */
export const NO_CAPTURADO = "No capturado";

/** Un valor imprimible, o la palabra. Nunca devuelve cadena vacía. */
export function noCapturado(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : NO_CAPTURADO;
}

/**
 * Un sí/no CAPTURADO, distinguido de uno ausente.
 *
 * `false` es un dato (el paciente contestó que no); `undefined` o `null` es un
 * hueco. Confundirlos es justo la mentira que este documento no puede contar:
 * «Diabetes: No» dice que se preguntó, «Diabetes: No capturado» dice que no.
 */
export function siNo(v: unknown): string {
  if (v === true) return "Sí";
  if (v === false) return "No";
  return NO_CAPTURADO;
}

/** Fecha ISO → fecha larga en la zona de la clínica, o la palabra. */
function fecha(iso: string | null | undefined, tz: string): string {
  if (!iso) return NO_CAPTURADO;
  const s = formatConsentDate(iso, tz);
  return s === "—" ? NO_CAPTURADO : s;
}

/**
 * Una fecha de CALENDARIO (la de nacimiento), o la palabra.
 *
 * 🔴 NO usa la zona de la clínica, y eso NO es un descuido. `Patient.dob` no es
 * un instante: es un día. Se guarda como la medianoche UTC de esa fecha (el
 * alta hace `new Date("1990-05-03")`, que es 1990-05-03T00:00:00Z), así que
 * leerla en America/Mexico_City la devuelve seis horas antes — el 2 de mayo —
 * y el expediente le cambia el cumpleaños al paciente. Medido al abrir el PDF
 * de muestra: con `formatConsentDate` salía «02 de mayo de 1990» para una
 * fecha de nacimiento guardada como el 3.
 *
 * Lo contrario también es cierto y por eso hay dos funciones: la visita, la
 * firma y la cita SÍ son instantes y SÍ van en la zona de la clínica
 * (`fecha`/`fechaHora`), porque ahí la hora es parte del dato.
 */
function fechaDeCalendario(iso: string | null | undefined): string {
  if (!iso) return NO_CAPTURADO;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return NO_CAPTURADO;
  return d.toLocaleDateString("es-MX", {
    timeZone: "UTC",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Fecha y hora ISO en la zona de la clínica, o la palabra. */
function fechaHora(iso: string | null | undefined, tz: string): string {
  if (!iso) return NO_CAPTURADO;
  const s = formatConsentDateTime(iso, tz);
  return s === "—" ? NO_CAPTURADO : s;
}

/** Bytes → "12,4 MB" / "840 kB". Para el aviso de peso de las imágenes. */
export function pesoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 kB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Lo que el panel TODAVÍA no captura (ws1-t5 lo está añadiendo en paralelo)
//
// Estos cuatro bloques viven en dos columnas JSON que ya existen:
// `health_questionnaires.answers` y `medical_records.specialtyData`. Los
// nombres los fijó el gerente y son IDÉNTICOS en los dos trabajos de esta ola:
// la pantalla que los captura escribe contra estos mismos. No se cambian.
//
// Los lectores son TOLERANTES por diseño: si la clave no está todavía —que es
// el caso de hoy en las 15 clínicas— devuelven `null` y el documento escribe
// «No capturado». Si está a medias, cada campo se resuelve por su cuenta.
// ═══════════════════════════════════════════════════════════════════════════

export interface HeredoFamiliares {
  diabetes?: boolean;
  hipertension?: boolean;
  cardiopatias?: boolean;
  cancer?: boolean;
  otros?: string;
}

export interface AparatosSistemas {
  cardiovascular?: string;
  respiratorio?: string;
  digestivo?: string;
  genitourinario?: string;
  endocrino?: string;
  nervioso?: string;
  musculoesqueletico?: string;
  notas?: string;
}

export interface ExploracionFisica {
  habitus?: string;
  cabezaCuello?: string;
  cavidadOral?: string;
  atm?: string;
  ganglios?: string;
  notas?: string;
}

export type Pronostico = "bueno" | "reservado" | "malo" | "";

function objeto(raw: unknown, clave: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>)[clave];
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** `answers.heredoFamiliares`, o null si el cuestionario todavía no lo trae. */
export function leerHeredoFamiliares(answers: unknown): HeredoFamiliares | null {
  const o = objeto(answers, "heredoFamiliares");
  if (!o) return null;
  return {
    diabetes: typeof o.diabetes === "boolean" ? o.diabetes : undefined,
    hipertension: typeof o.hipertension === "boolean" ? o.hipertension : undefined,
    cardiopatias: typeof o.cardiopatias === "boolean" ? o.cardiopatias : undefined,
    cancer: typeof o.cancer === "boolean" ? o.cancer : undefined,
    otros: typeof o.otros === "string" ? o.otros : undefined,
  };
}

/** `answers.aparatosSistemas`, o null. Cada renglón es texto libre. */
export function leerAparatosSistemas(answers: unknown): AparatosSistemas | null {
  const o = objeto(answers, "aparatosSistemas");
  if (!o) return null;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return {
    cardiovascular: s("cardiovascular"),
    respiratorio: s("respiratorio"),
    digestivo: s("digestivo"),
    genitourinario: s("genitourinario"),
    endocrino: s("endocrino"),
    nervioso: s("nervioso"),
    musculoesqueletico: s("musculoesqueletico"),
    notas: s("notas"),
  };
}

/** `specialtyData.exploracionFisica` de UNA nota, o null. */
export function leerExploracionFisica(specialtyData: unknown): ExploracionFisica | null {
  const o = objeto(specialtyData, "exploracionFisica");
  if (!o) return null;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return {
    habitus: s("habitus"),
    cabezaCuello: s("cabezaCuello"),
    cavidadOral: s("cavidadOral"),
    atm: s("atm"),
    ganglios: s("ganglios"),
    notas: s("notas"),
  };
}

const PRONOSTICO_ETIQUETA: Record<string, string> = {
  bueno: "Bueno",
  reservado: "Reservado",
  malo: "Malo",
};

/**
 * `specialtyData.pronostico` como etiqueta legible, o null si no se capturó.
 *
 * La cadena vacía cuenta como NO capturado (es el valor inicial del desplegable
 * de ws1-t5), y un valor que no esté en el catálogo se devuelve tal cual en vez
 * de descartarse: un dato raro se enseña, no se esconde.
 */
export function leerPronostico(specialtyData: unknown): string | null {
  if (!specialtyData || typeof specialtyData !== "object") return null;
  const v = (specialtyData as Record<string, unknown>).pronostico;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return PRONOSTICO_ETIQUETA[s] ?? s;
}

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface ExpedientePaciente {
  nombre: string;
  /** `Patient.patientNumber` — el FOLIO. Nunca el id interno. */
  folio: string;
  curp: string | null;
  dob: string | null; // ISO
  genero: string | null;
  tipoSangre: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  contactoEmergencia: { nombre: string | null; telefono: string | null; parentesco: string | null } | null;
  alergias: string[];
  padecimientos: string[];
  medicamentos: string[];
  /** `Patient.familyHistory` — el campo viejo de texto libre. */
  antecedentesFamiliares: string | null;
  /** `Patient.personalNonPathologicalHistory`. */
  antecedentesNoPatologicos: string | null;
  doctorDeCabecera: string | null;
  altaEnLaClinica: string | null; // ISO
}

export interface ExpedienteEmisor {
  nombre: string;
  /** `User.cedulaProfesional`. */
  cedula: string | null;
  rol: string | null;
}

export interface ExpedienteAntecedentes {
  /** Cuándo se llenó el cuestionario (ISO) y quién lo capturó. */
  llenadoEl: string;
  llenadoPor: string | null;
  padecimientos: Array<{ etiqueta: string; valor: string }>;
  alergias: Array<{ etiqueta: string; valor: string }>;
  habitos: Array<{ etiqueta: string; valor: string }>;
  medicamentos: string[];
  avisosDeRiesgo: string[];
  notas: string | null;
  heredoFamiliares: HeredoFamiliares | null;
  aparatosSistemas: AparatosSistemas | null;
}

export interface ExpedienteAdenda {
  texto: string;
  autor: string | null;
  fecha: string; // ISO
}

export interface ExpedienteNota {
  id: string;
  fecha: string; // ISO — fecha y hora de la visita
  doctor: string | null;
  doctorCedula: string | null;
  estado: "DRAFT" | "SIGNED";
  firmadaEl: string | null; // ISO
  subjetivo: string | null;
  objetivo: string | null;
  analisis: string | null;
  plan: string | null;
  diagnosticos: Array<{ code: string; description: string }>;
  procedimientos: string[];
  signosVitales: Array<{ etiqueta: string; valor: string }>;
  exploracionFisica: ExploracionFisica | null;
  pronostico: string | null;
  adendas: ExpedienteAdenda[];
}

export interface ExpedienteHallazgoDental {
  diente: number;
  cara: string | null;
  hallazgo: string;
  notas: string | null;
  /** ISO — última vez que se tocó ese hallazgo. */
  actualizado: string | null;
}

export interface ExpedientePlan {
  nombre: string;
  descripcion: string | null;
  estado: string;
  inicio: string | null; // ISO
  fin: string | null; // ISO
  doctor: string | null;
  sesionesTotales: number;
  sesiones: Array<{ numero: number; completadaEl: string | null; notas: string | null }>;
}

export interface ExpedienteReceta {
  folio: string;
  emitidaEl: string; // ISO
  venceEl: string | null; // ISO
  doctor: string | null;
  doctorCedula: string | null;
  diagnostico: string | null;
  indicaciones: string | null;
  estado: string;
  anuladaEl: string | null; // ISO
  motivoAnulacion: string | null;
  medicamentos: Array<{ nombre: string; dosis: string | null; duracion: string | null; cantidad: string | null; notas: string | null }>;
}

export interface ExpedienteFirma {
  rol: string;
  nombre: string;
  firmadoEl: string | null; // ISO
  /** Imagen de la firma ya resuelta a data URL. null = no hay imagen. */
  imagen: string | null;
}

export interface ExpedienteConsentimiento {
  procedimiento: string;
  creadoEl: string; // ISO
  firmadoEl: string | null; // ISO
  revocadoEl: string | null; // ISO
  motivoRevocacion: string | null;
  texto: string;
  firmas: ExpedienteFirma[];
  hashDelTexto: string | null;
}

export interface ExpedienteEstudio {
  nombre: string;
  tipo: string;
  fecha: string; // ISO
  subidoPor: string | null;
  diente: number | null;
  notas: string | null;
  /** Tamaño en bytes del archivo original, si la fila lo guarda. */
  bytes: number | null;
  /**
   * La imagen ya descargada y convertida a data URL, SOLO cuando la casilla
   * está encendida y el archivo es un PNG/JPEG que @react-pdf sabe pintar.
   * null con la casilla encendida = se intentó y no se pudo; el documento lo
   * dice en vez de dejar el hueco.
   */
  imagen: string | null;
  /** Por qué no se incrustó, cuando la casilla estaba encendida. */
  motivoSinImagen: string | null;
}

export interface ExpedienteCita {
  fecha: string; // ISO
  tipo: string;
  estado: string;
  doctor: string | null;
  consultorio: string | null;
  notas: string | null;
}

export interface ExpedienteAdministrativo {
  facturas: Array<{ folio: string; fecha: string; concepto: string | null; total: string; pagado: string; estado: string }>;
  presupuestos: Array<{ folio: string; fecha: string; concepto: string | null; total: string; estado: string }>;
}

export interface ExpedienteDocumentProps extends ClinicLetterheadClinic {
  clinicName: string;
  /** `Clinic.clues` — la Clave Única de Establecimientos de Salud. */
  clinicClues?: string | null;
  /** Zona horaria de la clínica. Obligatoria: el servidor corre en UTC. */
  timeZone: string;

  paciente: ExpedientePaciente;
  emisor: ExpedienteEmisor;
  /** ISO — el momento en que se pulsó el botón. */
  generadoEl: string;
  /** Periodo que cubre el documento: del dato más viejo al más nuevo. */
  periodo: { desde: string | null; hasta: string | null };

  antecedentes: ExpedienteAntecedentes | null;
  notas: ExpedienteNota[];
  /** Notas privadas de OTRO profesional que quedaron fuera (no se ocultan: se cuentan). */
  notasPrivadasOmitidas: number;
  odontograma: ExpedienteHallazgoDental[];
  /** ISO — última vez que alguien tocó el odontograma. */
  odontogramaActualizado: string | null;
  planes: ExpedientePlan[];
  recetas: ExpedienteReceta[];
  consentimientos: ExpedienteConsentimiento[];
  /**
   * Cuántas imágenes de firma no se pudieron traer. No se esconde: una carta
   * firmada que se imprime con la línea en blanco y sin explicar por qué haría
   * pensar que nadie la firmó.
   */
  firmasOmitidas: number;
  estudios: ExpedienteEstudio[];
  citas: ExpedienteCita[];
  /** null cuando la casilla de administrativo está apagada (el caso por default). */
  administrativo: ExpedienteAdministrativo | null;

  opciones: {
    incluirImagenes: boolean;
    incluirAdministrativo: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Estilos
// ═══════════════════════════════════════════════════════════════════════════

const ACCENT = "#7c3aed";
const TINTA = "#14101f";
const GRIS = "#6b6b78";
const GRIS_CLARO = "#9b9aa8";
const LINEA = "#e5e5ed";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingHorizontal: 40,
    // Colchón para el pie fijo de tres renglones. Sin él, en las páginas llenas
    // el filete del pie TACHA el último renglón del cuerpo (le pasó al
    // comprobante; ver `separacionCuerpoPie` en las pruebas).
    paddingBottom: 78,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: TINTA,
    lineHeight: 1.45,
  },

  // ── Portada ──────────────────────────────────────────────────────────
  portadaKind: { fontSize: 8, color: GRIS, textTransform: "uppercase", letterSpacing: 1, lineHeight: 1.2 },
  portadaTitulo: { fontSize: 22, fontFamily: "Helvetica-Bold", lineHeight: 1.15, marginTop: 2 },
  portadaSub: { fontSize: 9.5, color: GRIS, marginTop: 4 },
  portadaRule: { borderBottomWidth: 0.7, borderBottomColor: LINEA, marginTop: 14, marginBottom: 16 },

  metaLabel: { fontSize: 7.5, color: GRIS, textTransform: "uppercase", letterSpacing: 0.8, textAlign: "right", lineHeight: 1.2 },
  metaValue: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right", marginTop: 2, lineHeight: 1.25 },

  // Tarjeta de bloque en la portada (clínica / paciente / emisión).
  tarjeta: {
    borderWidth: 0.7,
    borderColor: LINEA,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  tarjetaTitulo: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
    lineHeight: 1.2,
  },

  // ── Rejilla etiqueta/valor ───────────────────────────────────────────
  rejilla: { flexDirection: "row", flexWrap: "wrap" },
  celda: { width: "50%", paddingRight: 10, marginBottom: 5 },
  celdaAncha: { width: "100%", paddingRight: 10, marginBottom: 5 },
  celdaTercio: { width: "33.33%", paddingRight: 10, marginBottom: 5 },
  etiqueta: { fontSize: 7, color: GRIS, textTransform: "uppercase", letterSpacing: 0.6, lineHeight: 1.2 },
  valor: { fontSize: 9.5, marginTop: 1, lineHeight: 1.3 },
  // Lo no capturado se pinta en gris y en cursiva: se LEE que falta sin tener
  // que comparar renglón con renglón, y aun así está escrito con todas sus
  // letras para quien imprima en blanco y negro.
  valorAusente: { fontSize: 9.5, marginTop: 1, color: GRIS_CLARO, fontStyle: "italic", lineHeight: 1.3 },

  // ── Secciones ────────────────────────────────────────────────────────
  seccionBanda: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: "#f4f2f8",
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginTop: 18,
    marginBottom: 8,
  },
  seccionNumero: { fontSize: 12, fontFamily: "Helvetica-Bold", color: ACCENT, marginRight: 7, lineHeight: 1.2 },
  seccionTitulo: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: TINTA, lineHeight: 1.2, flex: 1 },
  seccionNota: { fontSize: 8, color: GRIS, marginTop: 2, marginBottom: 6, lineHeight: 1.3 },

  subTitulo: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 9,
    marginBottom: 3,
    paddingBottom: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: LINEA,
    lineHeight: 1.2,
  },

  parrafo: { fontSize: 9.5, marginBottom: 4, lineHeight: 1.45 },
  vacio: { fontSize: 9, color: GRIS_CLARO, fontStyle: "italic", marginBottom: 4, lineHeight: 1.35 },

  // ── Tablas ───────────────────────────────────────────────────────────
  thead: {
    flexDirection: "row",
    borderBottomWidth: 0.7,
    borderBottomColor: "#d4d4dc",
    paddingBottom: 3,
    marginBottom: 2,
  },
  // `paddingRight` NO es decorativo: sin él una celda que llena su ancho pega
  // con la siguiente y se lee «11 de febrero de 2026Radiografía panorámica».
  // Medido en la tabla de estudios del PDF de muestra.
  th: { fontSize: 7, color: GRIS, textTransform: "uppercase", letterSpacing: 0.6, fontFamily: "Helvetica-Bold", lineHeight: 1.2, paddingRight: 6 },
  tr: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.4, borderBottomColor: "#f0f0f5" },
  td: { fontSize: 9, lineHeight: 1.3, paddingRight: 6 },

  // ── Nota de evolución ────────────────────────────────────────────────
  notaBloque: {
    borderWidth: 0.7,
    borderColor: LINEA,
    borderRadius: 5,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 10,
  },
  notaCabecera: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  notaFecha: { fontSize: 10.5, fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  notaDoctor: { fontSize: 8.5, color: GRIS, marginTop: 1, lineHeight: 1.3 },
  selloFirmada: { fontSize: 7.5, color: "#15803d", backgroundColor: "#dcfce7", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3, fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  selloBorrador: { fontSize: 7.5, color: "#a16207", backgroundColor: "#fef3c7", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3, fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  soapEtiqueta: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 5, lineHeight: 1.2 },

  // ── Adendas (mismo ámbar que el PDF de nota: una corrección firmada no
  //    es una sección más) ──────────────────────────────────────────────
  adendaAviso: {
    backgroundColor: "#fef3c7",
    borderLeftWidth: 3,
    borderLeftColor: "#a16207",
    borderRadius: 3,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 6,
    marginBottom: 2,
  },
  adendaAvisoTexto: { fontSize: 8.5, color: "#78350f", fontFamily: "Helvetica-Bold", lineHeight: 1.3 },
  adendaBloque: {
    marginTop: 7,
    borderLeftWidth: 3,
    borderLeftColor: "#a16207",
    backgroundColor: "#fdfaf3",
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  adendaCabeza: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#78350f", lineHeight: 1.25 },
  adendaMeta: { fontSize: 8, color: GRIS, marginTop: 1, marginBottom: 3, lineHeight: 1.3 },
  adendaFin: { fontSize: 7.5, color: "#92400e", fontStyle: "italic", marginTop: 3, lineHeight: 1.25 },

  // ── Consentimientos ──────────────────────────────────────────────────
  consentTexto: { fontSize: 8.5, color: TINTA, marginTop: 4, lineHeight: 1.45 },
  firmasFila: { flexDirection: "row", gap: 14, marginTop: 8 },
  firmaCelda: { flex: 1 },
  firmaImg: { height: 30, objectFit: "contain", objectPositionX: 0, marginBottom: 2 },
  firmaLinea: { borderBottomWidth: 0.7, borderBottomColor: "#b9b8c4", height: 30, marginBottom: 2 },
  firmaRol: { fontSize: 7, color: GRIS, textTransform: "uppercase", letterSpacing: 0.6, lineHeight: 1.2 },
  firmaNombre: { fontSize: 9, fontFamily: "Helvetica-Bold", lineHeight: 1.25 },
  firmaFecha: { fontSize: 7.5, color: GRIS, lineHeight: 1.25 },

  // ── Estudios ─────────────────────────────────────────────────────────
  estudioImg: { width: 240, objectFit: "contain", objectPositionX: 0, marginTop: 5, marginBottom: 3 },

  // ── Avisos ───────────────────────────────────────────────────────────
  aviso: {
    backgroundColor: "#f4f2f8",
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginTop: 6,
    marginBottom: 4,
  },
  avisoTexto: { fontSize: 8.5, color: "#3f3a52", lineHeight: 1.35 },

  // ── Pie ──────────────────────────────────────────────────────────────
  pie: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: LINEA,
    paddingTop: 6,
  },
  pieLinea: { fontSize: 7.5, color: GRIS_CLARO, textAlign: "center", lineHeight: 1.3 },
  // `lineHeight: ""` NO es decorativo y se copia tal cual del PDF de nota:
  // @react-pdf 4.x vuelve a resolver los estilos al pintar un `render`, y en una
  // página con `lineHeight` heredado multiplica otra vez el interlineado hasta
  // sacar el renglón FUERA del papel. Con "" el nodo no hereda nada que se
  // pueda multiplicar. Medido con `_texto-del-pdf.ts`.
  piePagina: { fontSize: 7.5, color: GRIS_CLARO, textAlign: "center", marginTop: 1, lineHeight: "" },
});

// ═══════════════════════════════════════════════════════════════════════════
// Piezas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Etiqueta arriba, valor abajo. El valor NUNCA va vacío: si no hay dato se
 * escribe «No capturado», y además en gris y cursiva para que se vea de un
 * vistazo cuánto le falta al expediente.
 */
function Dato({
  etiqueta,
  valor,
  ancho = "mitad",
}: {
  etiqueta: string;
  valor: string | null | undefined;
  ancho?: "mitad" | "entero" | "tercio";
}) {
  const texto = noCapturado(valor);
  const ausente = texto === NO_CAPTURADO;
  const caja = ancho === "entero" ? styles.celdaAncha : ancho === "tercio" ? styles.celdaTercio : styles.celda;
  return (
    <View style={caja}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <Text style={ausente ? styles.valorAusente : styles.valor}>{texto}</Text>
    </View>
  );
}

function Seccion({ n, titulo, nota }: { n: string; titulo: string; nota?: string }) {
  return (
    <View wrap={false} minPresenceAhead={60}>
      <View style={styles.seccionBanda}>
        <Text style={styles.seccionNumero}>{n}</Text>
        <Text style={styles.seccionTitulo}>{titulo}</Text>
      </View>
      {nota ? <Text style={styles.seccionNota}>{nota}</Text> : null}
    </View>
  );
}

/**
 * Lo que se escribe donde una sección entera está vacía. Nunca un hueco.
 *
 * `ReactNode` y no `string`: el texto de algunos avisos se compone de varios
 * trozos (una constante interpolada en medio de la frase), y eso en JSX llega
 * como array. Tipado como `string` no compilaba.
 */
function Vacio({ children }: { children: ReactNode }) {
  return <Text style={styles.vacio}>{children}</Text>;
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <View style={styles.aviso} wrap={false}>
      <Text style={styles.avisoTexto}>{children}</Text>
    </View>
  );
}

function Tabla({
  columnas,
  filas,
}: {
  columnas: Array<{ titulo: string; ancho: string }>;
  filas: string[][];
}) {
  return (
    <View>
      <View style={styles.thead} fixed>
        {columnas.map((c, i) => (
          <Text key={i} style={[styles.th, { width: c.ancho }]}>
            {c.titulo}
          </Text>
        ))}
      </View>
      {filas.map((fila, i) => (
        <View key={i} style={styles.tr} wrap={false}>
          {fila.map((celda, j) => (
            <Text key={j} style={[styles.td, { width: columnas[j]?.ancho ?? "auto" }]}>
              {celda}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// El documento
// ═══════════════════════════════════════════════════════════════════════════

export function ExpedienteDocument(props: ExpedienteDocumentProps) {
  const tz = props.timeZone;
  const p = props.paciente;
  const folio = noCapturado(p.folio);

  // Los estudios con imagen pedida y sin imagen resuelta: se cuentan para
  // decirlo en el papel, no para esconderlo.
  const imagenesFallidas = props.opciones.incluirImagenes
    ? props.estudios.filter((e) => !e.imagen && e.motivoSinImagen).length
    : 0;

  return (
    <Document
      title={`Expediente clínico — ${p.nombre}`}
      author={props.clinicName}
      subject="Expediente clínico electrónico (NOM-004-SSA3-2012)"
      creator="DaleControl"
    >
      <Page size="LETTER" style={styles.page} wrap>
        {/* ── PORTADA ─────────────────────────────────────────────────── */}
        <ClinicLetterhead
          {...props}
          accent={ACCENT}
          subtitle="Expediente clínico electrónico"
          right={
            <View>
              <Text style={styles.metaLabel}>Folio del paciente</Text>
              <Text style={styles.metaValue}>{folio}</Text>
              <Text style={[styles.metaLabel, { marginTop: 6 }]}>Fecha de emisión</Text>
              <Text style={styles.metaValue}>{fecha(props.generadoEl, tz)}</Text>
            </View>
          }
        />

        <Text style={styles.portadaKind}>Documento clínico confidencial</Text>
        <Text style={styles.portadaTitulo}>Expediente clínico</Text>
        <Text style={styles.portadaSub}>
          {p.nombre} · Folio {folio}
        </Text>
        <View style={styles.portadaRule} />

        {/* Clínica. La dirección y la CLUES salen SIEMPRE, con «No capturado»
            si faltan: hoy ninguna de las clínicas tiene dirección cargada y la
            portada tiene que verse digna igualmente, no vacía y sin explicar. */}
        <View style={styles.tarjeta} wrap={false}>
          <Text style={styles.tarjetaTitulo}>Establecimiento</Text>
          <View style={styles.rejilla}>
            <Dato etiqueta="Clínica" valor={props.clinicName} ancho="entero" />
            <Dato etiqueta="Dirección" valor={direccionDeLaClinica(props)} ancho="entero" />
            <Dato etiqueta="Teléfono" valor={props.clinicPhone} ancho="tercio" />
            <Dato etiqueta="Correo" valor={props.clinicEmail} ancho="tercio" />
            <Dato etiqueta="RFC" valor={props.clinicTaxId} ancho="tercio" />
            <Dato etiqueta="CLUES (registro sanitario)" valor={props.clinicClues} ancho="entero" />
          </View>
        </View>

        {/* Paciente. */}
        <View style={styles.tarjeta} wrap={false}>
          <Text style={styles.tarjetaTitulo}>Paciente</Text>
          <View style={styles.rejilla}>
            <Dato etiqueta="Nombre" valor={p.nombre} />
            <Dato etiqueta="Folio" valor={p.folio} />
            <Dato etiqueta="CURP" valor={p.curp} />
            <Dato etiqueta="Fecha de nacimiento" valor={fechaDeCalendario(p.dob)} />
          </View>
        </View>

        {/* Emisión: quién, cuándo y qué periodo cubre. Es lo que convierte una
            impresión en un documento entregable. */}
        <View style={styles.tarjeta} wrap={false}>
          <Text style={styles.tarjetaTitulo}>Emisión</Text>
          <View style={styles.rejilla}>
            <Dato etiqueta="Emitido el" valor={fechaHora(props.generadoEl, tz)} />
            <Dato
              etiqueta="Emitido por"
              valor={
                props.emisor.cedula
                  ? `${props.emisor.nombre} · Cédula profesional ${props.emisor.cedula}`
                  : props.emisor.nombre
              }
            />
            <Dato
              etiqueta="Periodo que cubre"
              valor={periodoLegible(props.periodo, tz)}
              ancho="entero"
            />
          </View>
        </View>

        <Aviso>
          {`Este documento reúne la información clínica que la clínica tiene registrada de ${p.nombre} a la fecha de emisión. Donde dice «${NO_CAPTURADO}», el dato no está capturado en el sistema: el expediente no lo omite, lo declara. Contiene datos personales sensibles (LFPDPPP art. 3 fracc. VI) y se entrega al titular o a quien él autorice por escrito.`}
        </Aviso>

        <ContenidoDelExpediente {...props} imagenesFallidas={imagenesFallidas} />

        {/* ── PIE, EN TODAS LAS PÁGINAS ───────────────────────────────── */}
        <View style={styles.pie} fixed>
          <Text style={styles.pieLinea}>
            Expediente clínico · {p.nombre} · Folio {folio} · {props.clinicName}
          </Text>
          <Text style={styles.pieLinea}>
            Documento clínico confidencial — contiene datos personales sensibles. NOM-004-SSA3-2012
            y NOM-024-SSA3-2012. Prohibida su reproducción o difusión sin autorización del titular.
          </Text>
          <Text
            style={styles.piePagina}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/** La dirección de la clínica en un renglón, o null si no hay nada de nada. */
function direccionDeLaClinica(props: ExpedienteDocumentProps): string | null {
  const partes = [props.clinicAddress, props.clinicCity, props.clinicState].filter(
    (x) => typeof x === "string" && x.trim().length > 0,
  );
  return partes.length > 0 ? partes.join(", ") : null;
}

/** "del 3 de enero de 2025 al 19 de septiembre de 2026", o la palabra. */
function periodoLegible(periodo: { desde: string | null; hasta: string | null }, tz: string): string | null {
  if (!periodo.desde && !periodo.hasta) return null;
  const desde = periodo.desde ? formatConsentDate(periodo.desde, tz) : null;
  const hasta = periodo.hasta ? formatConsentDate(periodo.hasta, tz) : null;
  if (desde && hasta) return desde === hasta ? desde : `Del ${desde} al ${hasta}`;
  return desde ?? hasta;
}

// ═══════════════════════════════════════════════════════════════════════════
// Las nueve secciones (más el anexo administrativo, si se pidió)
// ═══════════════════════════════════════════════════════════════════════════

function ContenidoDelExpediente(
  props: ExpedienteDocumentProps & { imagenesFallidas: number },
) {
  const tz = props.timeZone;
  const p = props.paciente;

  return (
    <View>
      {/* ── 1 · FICHA DE IDENTIFICACIÓN ─────────────────────────────── */}
      <Seccion n="1" titulo="Ficha de identificación" />
      <View style={styles.rejilla}>
        <Dato etiqueta="Nombre completo" valor={p.nombre} />
        <Dato etiqueta="Folio del paciente" valor={p.folio} />
        <Dato etiqueta="CURP" valor={p.curp} />
        <Dato etiqueta="Fecha de nacimiento" valor={fechaDeCalendario(p.dob)} />
        <Dato etiqueta="Sexo" valor={p.genero} />
        <Dato etiqueta="Tipo de sangre" valor={p.tipoSangre} />
        <Dato etiqueta="Teléfono" valor={p.telefono} />
        <Dato etiqueta="Correo electrónico" valor={p.correo} />
        <Dato etiqueta="Domicilio" valor={p.direccion} ancho="entero" />
        <Dato
          etiqueta="Contacto de emergencia"
          valor={contactoLegible(p.contactoEmergencia)}
          ancho="entero"
        />
        <Dato etiqueta="Médico de cabecera" valor={p.doctorDeCabecera} />
        <Dato
          etiqueta="Alta en la clínica"
          valor={p.altaEnLaClinica ? fecha(p.altaEnLaClinica, tz) : null}
        />
      </View>

      {/* ── 2 · ANTECEDENTES DE SALUD ───────────────────────────────── */}
      <Seccion
        n="2"
        titulo="Antecedentes de salud"
        nota="Del cuestionario de salud que llena el paciente o el personal de la clínica."
      />
      <Antecedentes antecedentes={props.antecedentes} paciente={p} tz={tz} />

      {/* ── 3 · NOTAS DE EVOLUCIÓN ──────────────────────────────────── */}
      <Seccion
        n="3"
        titulo="Notas de evolución"
        nota="De la más antigua a la más reciente. Las notas firmadas son inalterables: las correcciones posteriores se imprimen como adendas debajo de su nota, nunca encima."
      />
      {props.notasPrivadasOmitidas > 0 && (
        <Aviso>
          {props.notasPrivadasOmitidas === 1
            ? "1 nota marcada como privada por otro profesional no se incluye en este documento. Una nota privada solo la lee su autor; consta que existe."
            : `${props.notasPrivadasOmitidas} notas marcadas como privadas por otros profesionales no se incluyen en este documento. Una nota privada solo la lee su autor; consta que existen.`}
        </Aviso>
      )}
      {props.notas.length === 0 ? (
        <Vacio>Sin notas de evolución registradas.</Vacio>
      ) : (
        props.notas.map((n, i) => (
          <NotaBloque key={n.id} nota={n} indice={i + 1} total={props.notas.length} tz={tz} />
        ))
      )}

      {/* ── 4 · ODONTOGRAMA ─────────────────────────────────────────── */}
      <Seccion
        n="4"
        titulo="Odontograma"
        nota={
          props.odontogramaActualizado
            ? `Hallazgos registrados por diente y cara. Última actualización: ${fecha(props.odontogramaActualizado, tz)}.`
            : "Hallazgos registrados por diente y cara."
        }
      />
      {props.odontograma.length === 0 ? (
        <Vacio>Sin hallazgos registrados en el odontograma.</Vacio>
      ) : (
        <Tabla
          columnas={[
            { titulo: "Diente", ancho: "12%" },
            { titulo: "Cara", ancho: "18%" },
            { titulo: "Hallazgo", ancho: "32%" },
            { titulo: "Notas", ancho: "38%" },
          ]}
          filas={props.odontograma.map((h) => [
            String(h.diente),
            h.cara ?? "Diente completo",
            h.hallazgo,
            noCapturado(h.notas) === NO_CAPTURADO ? "—" : (h.notas as string),
          ])}
        />
      )}

      {/* ── 5 · PLANES DE TRATAMIENTO ───────────────────────────────── */}
      <Seccion n="5" titulo="Planes de tratamiento" nota="Con sus fases y el registro de cada sesión." />
      {props.planes.length === 0 ? (
        <Vacio>Sin planes de tratamiento registrados.</Vacio>
      ) : (
        props.planes.map((pl, i) => <PlanBloque key={i} plan={pl} tz={tz} />)
      )}

      {/* ── 6 · RECETAS ─────────────────────────────────────────────── */}
      <Seccion n="6" titulo="Recetas" />
      {props.recetas.length === 0 ? (
        <Vacio>Sin recetas emitidas.</Vacio>
      ) : (
        props.recetas.map((r, i) => <RecetaBloque key={i} receta={r} tz={tz} />)
      )}

      {/* ── 7 · CONSENTIMIENTOS INFORMADOS ──────────────────────────── */}
      <Seccion
        n="7"
        titulo="Consentimientos informados"
        nota="Texto íntegro de cada carta, tal como se le presentó al paciente, con sus firmas."
      />
      {props.firmasOmitidas > 0 && (
        <Aviso>
          {props.firmasOmitidas === 1
            ? "1 imagen de firma no se pudo traer al generar este documento, así que su línea sale en blanco. La firma sigue guardada en el sistema: la línea vacía NO significa que la carta no se firmara — mira la fecha de firma de cada bloque."
            : `${props.firmasOmitidas} imágenes de firma no se pudieron traer al generar este documento, así que sus líneas salen en blanco. Las firmas siguen guardadas en el sistema: una línea vacía NO significa que la carta no se firmara — mira la fecha de firma de cada bloque.`}
        </Aviso>
      )}
      {props.consentimientos.length === 0 ? (
        <Vacio>Sin consentimientos informados registrados.</Vacio>
      ) : (
        props.consentimientos.map((c, i) => <ConsentimientoBloque key={i} consentimiento={c} tz={tz} />)
      )}

      {/* ── 8 · ESTUDIOS ────────────────────────────────────────────── */}
      <Seccion
        n="8"
        titulo="Estudios: radiografías y fotografías"
        nota={
          props.opciones.incluirImagenes
            ? "Las imágenes se incrustan en este documento."
            : "Se listan con sus datos. Las imágenes NO se incrustan en esta copia."
        }
      />
      {!props.opciones.incluirImagenes && props.estudios.length > 0 && (
        <Aviso>
          {`Este documento lista ${props.estudios.length === 1 ? "el estudio" : `los ${props.estudios.length} estudios`} del paciente con su tipo, su fecha y quién lo subió, pero NO incluye las imágenes: se generó con la casilla «Incluir imágenes de radiografías y fotos» apagada. Las imágenes forman parte del expediente y se pueden entregar volviendo a generarlo con esa casilla encendida.`}
        </Aviso>
      )}
      {props.imagenesFallidas > 0 && (
        <Aviso>
          {props.imagenesFallidas === 1
            ? "1 imagen no pudo incrustarse (se indica el motivo junto al estudio). El estudio sigue formando parte del expediente y el archivo original está en el sistema."
            : `${props.imagenesFallidas} imágenes no pudieron incrustarse (se indica el motivo junto a cada estudio). Los estudios siguen formando parte del expediente y los archivos originales están en el sistema.`}
        </Aviso>
      )}
      {props.estudios.length === 0 ? (
        <Vacio>Sin radiografías ni fotografías registradas.</Vacio>
      ) : props.opciones.incluirImagenes ? (
        props.estudios.map((e, i) => <EstudioConImagen key={i} estudio={e} tz={tz} />)
      ) : (
        <Tabla
          columnas={[
            { titulo: "Fecha", ancho: "21%" },
            { titulo: "Tipo", ancho: "22%" },
            { titulo: "Archivo", ancho: "25%" },
            { titulo: "Diente", ancho: "9%" },
            { titulo: "Subido por", ancho: "23%" },
          ]}
          filas={props.estudios.map((e) => [
            fecha(e.fecha, tz),
            e.tipo,
            e.nombre,
            e.diente != null ? String(e.diente) : "—",
            noCapturado(e.subidoPor),
          ])}
        />
      )}

      {/* ── 9 · HISTORIAL DE CITAS ──────────────────────────────────── */}
      <Seccion n="9" titulo="Historial de citas" />
      {props.citas.length === 0 ? (
        <Vacio>Sin citas registradas.</Vacio>
      ) : (
        <Tabla
          columnas={[
            { titulo: "Fecha y hora", ancho: "24%" },
            { titulo: "Motivo", ancho: "24%" },
            { titulo: "Estado", ancho: "16%" },
            { titulo: "Profesional", ancho: "24%" },
            { titulo: "Consultorio", ancho: "12%" },
          ]}
          filas={props.citas.map((c) => [
            fechaHora(c.fecha, tz),
            noCapturado(c.tipo),
            c.estado,
            noCapturado(c.doctor),
            noCapturado(c.consultorio) === NO_CAPTURADO ? "—" : (c.consultorio as string),
          ])}
        />
      )}

      {/* ── ANEXO A · ADMINISTRATIVO (solo si se pidió) ─────────────── */}
      {props.administrativo && (
        <>
          <Seccion
            n="A"
            titulo="Anexo administrativo"
            nota="Facturación y presupuestos. NO forma parte del expediente clínico según la NOM-004-SSA3-2012: se incluye porque quien generó el documento marcó la casilla «Incluir facturas y presupuestos»."
          />
          <Text style={styles.subTitulo}>Facturas</Text>
          {props.administrativo.facturas.length === 0 ? (
            <Vacio>Sin facturas registradas.</Vacio>
          ) : (
            <Tabla
              columnas={[
                { titulo: "Folio", ancho: "14%" },
                { titulo: "Fecha", ancho: "18%" },
                { titulo: "Concepto", ancho: "30%" },
                { titulo: "Total", ancho: "14%" },
                { titulo: "Pagado", ancho: "12%" },
                { titulo: "Estado", ancho: "12%" },
              ]}
              filas={props.administrativo.facturas.map((f) => [
                f.folio,
                fecha(f.fecha, tz),
                noCapturado(f.concepto) === NO_CAPTURADO ? "—" : (f.concepto as string),
                f.total,
                f.pagado,
                f.estado,
              ])}
            />
          )}
          <Text style={styles.subTitulo}>Presupuestos</Text>
          {props.administrativo.presupuestos.length === 0 ? (
            <Vacio>Sin presupuestos registrados.</Vacio>
          ) : (
            <Tabla
              columnas={[
                { titulo: "Folio", ancho: "16%" },
                { titulo: "Fecha", ancho: "20%" },
                { titulo: "Concepto", ancho: "38%" },
                { titulo: "Total", ancho: "14%" },
                { titulo: "Estado", ancho: "12%" },
              ]}
              filas={props.administrativo.presupuestos.map((q) => [
                q.folio,
                fecha(q.fecha, tz),
                noCapturado(q.concepto) === NO_CAPTURADO ? "—" : (q.concepto as string),
                q.total,
                q.estado,
              ])}
            />
          )}
        </>
      )}

      {/* Cierre: que se vea dónde acaba el expediente. Un documento que
          termina sin decirlo invita a pensar que faltan páginas. */}
      <View style={styles.aviso} wrap={false} minPresenceAhead={40}>
        <Text style={styles.avisoTexto}>
          — Fin del expediente clínico de {p.nombre} (folio {noCapturado(p.folio)}), emitido el{" "}
          {fechaHora(props.generadoEl, tz)} por {props.emisor.nombre}. —
        </Text>
      </View>
    </View>
  );
}

function contactoLegible(
  c: { nombre: string | null; telefono: string | null; parentesco: string | null } | null,
): string | null {
  if (!c) return null;
  const partes = [c.nombre, c.parentesco ? `(${c.parentesco})` : null, c.telefono].filter(
    (x) => typeof x === "string" && x.trim().length > 0,
  );
  return partes.length > 0 ? partes.join(" ") : null;
}

// ── 2 · Antecedentes ───────────────────────────────────────────────────

function Antecedentes({
  antecedentes,
  paciente,
  tz,
}: {
  antecedentes: ExpedienteAntecedentes | null;
  paciente: ExpedientePaciente;
  tz: string;
}) {
  return (
    <View>
      {/* Cuándo y quién: sin esto, un antecedente de hace cuatro años parece
          de hoy. La NOM-004 pide que el antecedente esté fechado. */}
      <View style={styles.rejilla}>
        <Dato
          etiqueta="Cuestionario llenado el"
          valor={antecedentes ? fechaHora(antecedentes.llenadoEl, tz) : null}
        />
        <Dato etiqueta="Llenado por" valor={antecedentes?.llenadoPor ?? null} />
      </View>
      {!antecedentes && (
        <Vacio>
          No hay cuestionario de salud contestado para este paciente. Los antecedentes que siguen
          salen de la ficha, y lo que no esté ahí se declara como «{NO_CAPTURADO}».
        </Vacio>
      )}

      <Text style={styles.subTitulo}>Antecedentes heredo-familiares</Text>
      {antecedentes?.heredoFamiliares ? (
        <View style={styles.rejilla}>
          <Dato etiqueta="Diabetes" valor={siNo(antecedentes.heredoFamiliares.diabetes)} ancho="tercio" />
          <Dato etiqueta="Hipertensión" valor={siNo(antecedentes.heredoFamiliares.hipertension)} ancho="tercio" />
          <Dato etiqueta="Cardiopatías" valor={siNo(antecedentes.heredoFamiliares.cardiopatias)} ancho="tercio" />
          <Dato etiqueta="Cáncer" valor={siNo(antecedentes.heredoFamiliares.cancer)} ancho="tercio" />
          <Dato etiqueta="Otros" valor={antecedentes.heredoFamiliares.otros} ancho="entero" />
        </View>
      ) : (
        <View style={styles.rejilla}>
          <Dato etiqueta="Diabetes" valor={null} ancho="tercio" />
          <Dato etiqueta="Hipertensión" valor={null} ancho="tercio" />
          <Dato etiqueta="Cardiopatías" valor={null} ancho="tercio" />
          <Dato etiqueta="Cáncer" valor={null} ancho="tercio" />
          <Dato
            etiqueta="Otros"
            valor={paciente.antecedentesFamiliares}
            ancho="entero"
          />
        </View>
      )}

      <Text style={styles.subTitulo}>Antecedentes personales no patológicos</Text>
      <View style={styles.rejilla}>
        <Dato etiqueta="Registro" valor={paciente.antecedentesNoPatologicos} ancho="entero" />
      </View>

      <Text style={styles.subTitulo}>Padecimientos</Text>
      {antecedentes && antecedentes.padecimientos.length > 0 ? (
        <View style={styles.rejilla}>
          {antecedentes.padecimientos.map((x, i) => (
            <Dato key={i} etiqueta={x.etiqueta} valor={x.valor} />
          ))}
        </View>
      ) : paciente.padecimientos.length > 0 ? (
        <Text style={styles.parrafo}>{paciente.padecimientos.join(" · ")}</Text>
      ) : (
        <Vacio>{NO_CAPTURADO}</Vacio>
      )}

      <Text style={styles.subTitulo}>Alergias</Text>
      {antecedentes && antecedentes.alergias.length > 0 ? (
        <View style={styles.rejilla}>
          {antecedentes.alergias.map((x, i) => (
            <Dato key={i} etiqueta={x.etiqueta} valor={x.valor} />
          ))}
        </View>
      ) : paciente.alergias.length > 0 ? (
        <Text style={styles.parrafo}>{paciente.alergias.join(" · ")}</Text>
      ) : (
        <Vacio>{NO_CAPTURADO}</Vacio>
      )}

      <Text style={styles.subTitulo}>Hábitos</Text>
      {antecedentes && antecedentes.habitos.length > 0 ? (
        <View style={styles.rejilla}>
          {antecedentes.habitos.map((x, i) => (
            <Dato key={i} etiqueta={x.etiqueta} valor={x.valor} />
          ))}
        </View>
      ) : (
        <Vacio>{NO_CAPTURADO}</Vacio>
      )}

      <Text style={styles.subTitulo}>Medicamentos en uso</Text>
      {(antecedentes?.medicamentos.length ?? 0) > 0 ? (
        <Text style={styles.parrafo}>{antecedentes!.medicamentos.join(" · ")}</Text>
      ) : paciente.medicamentos.length > 0 ? (
        <Text style={styles.parrafo}>{paciente.medicamentos.join(" · ")}</Text>
      ) : (
        <Vacio>{NO_CAPTURADO}</Vacio>
      )}

      <Text style={styles.subTitulo}>Interrogatorio por aparatos y sistemas</Text>
      {antecedentes?.aparatosSistemas ? (
        <View style={styles.rejilla}>
          <Dato etiqueta="Cardiovascular" valor={antecedentes.aparatosSistemas.cardiovascular} />
          <Dato etiqueta="Respiratorio" valor={antecedentes.aparatosSistemas.respiratorio} />
          <Dato etiqueta="Digestivo" valor={antecedentes.aparatosSistemas.digestivo} />
          <Dato etiqueta="Genitourinario" valor={antecedentes.aparatosSistemas.genitourinario} />
          <Dato etiqueta="Endocrino" valor={antecedentes.aparatosSistemas.endocrino} />
          <Dato etiqueta="Nervioso" valor={antecedentes.aparatosSistemas.nervioso} />
          <Dato etiqueta="Musculoesquelético" valor={antecedentes.aparatosSistemas.musculoesqueletico} />
          <Dato etiqueta="Notas" valor={antecedentes.aparatosSistemas.notas} ancho="entero" />
        </View>
      ) : (
        <View style={styles.rejilla}>
          <Dato etiqueta="Cardiovascular" valor={null} />
          <Dato etiqueta="Respiratorio" valor={null} />
          <Dato etiqueta="Digestivo" valor={null} />
          <Dato etiqueta="Genitourinario" valor={null} />
          <Dato etiqueta="Endocrino" valor={null} />
          <Dato etiqueta="Nervioso" valor={null} />
          <Dato etiqueta="Musculoesquelético" valor={null} />
          <Dato etiqueta="Notas" valor={null} ancho="entero" />
        </View>
      )}

      <Text style={styles.subTitulo}>Avisos de riesgo</Text>
      {(antecedentes?.avisosDeRiesgo.length ?? 0) > 0 ? (
        <Text style={styles.parrafo}>{antecedentes!.avisosDeRiesgo.join(" · ")}</Text>
      ) : (
        <Vacio>Sin avisos de riesgo calculados.</Vacio>
      )}

      {antecedentes?.notas ? (
        <>
          <Text style={styles.subTitulo}>Notas del cuestionario</Text>
          <Text style={styles.parrafo}>{antecedentes.notas}</Text>
        </>
      ) : null}
    </View>
  );
}

// ── 3 · Nota de evolución ──────────────────────────────────────────────

/**
 * Una nota con TODO lo suyo: fecha y hora, doctor y su cédula, SOAP,
 * diagnósticos CIE-10, procedimientos, signos vitales, exploración física,
 * pronóstico… y sus adendas debajo.
 *
 * No lleva `wrap={false}`: una nota puede ocupar más de una página y recortarla
 * sería perder texto clínico. Lo que sí se impide es que la cabecera quede
 * huérfana al pie (`minPresenceAhead`), igual que en el PDF de nota suelta.
 */
function NotaBloque({
  nota,
  indice,
  total,
  tz,
}: {
  nota: ExpedienteNota;
  indice: number;
  total: number;
  tz: string;
}) {
  const conAdendas = nota.adendas.length > 0;
  return (
    <View style={styles.notaBloque} minPresenceAhead={90}>
      {/* `fixed` DENTRO del bloque: si la nota se parte, la página siguiente
          vuelve a decir de qué nota, de qué fecha y de qué doctor es, en vez de
          empezar con texto suelto. Lo repite react-pdf solo para este bloque.

          TIENE UN COSTE, y se paga a sabiendas: medido con 9 notas largas, el
          `fixed` hace que la nota SIGUIENTE a una que se partió empiece en
          página nueva, y el documento sale en 14 páginas en vez de 13. Se deja
          porque una hoja suelta de un expediente que no dice de qué nota es no
          sirve para lo que sirve un expediente — y lo que se pierde es papel en
          blanco, no información. Mismo criterio que las adendas de
          `clinical-note-document`. */}
      <View style={styles.notaCabecera} fixed>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.notaFecha}>
            Nota {indice} de {total} · {fechaHora(nota.fecha, tz)}
          </Text>
          <Text style={styles.notaDoctor}>
            {noCapturado(nota.doctor)} · Cédula profesional {noCapturado(nota.doctorCedula)}
          </Text>
        </View>
        <Text style={nota.estado === "SIGNED" ? styles.selloFirmada : styles.selloBorrador}>
          {nota.estado === "SIGNED" ? "FIRMADA" : "BORRADOR"}
        </Text>
      </View>

      {nota.estado === "SIGNED" && nota.firmadaEl ? (
        <Text style={styles.adendaMeta}>Firmada el {fechaHora(nota.firmadaEl, tz)}</Text>
      ) : null}

      {conAdendas && (
        <View style={styles.adendaAviso} wrap={false}>
          <Text style={styles.adendaAvisoTexto}>
            Esta nota tiene {nota.adendas.length === 1 ? "1 adenda" : `${nota.adendas.length} adendas`}{" "}
            posteriores a la firma. La nota original se reproduce sin cambios; las correcciones van
            al final de esta nota y se leen junto con ella.
          </Text>
        </View>
      )}

      <Soap etiqueta="Subjetivo (S)" cuerpo={nota.subjetivo} />
      <Soap etiqueta="Objetivo (O)" cuerpo={nota.objetivo} />
      <Soap etiqueta="Análisis (A)" cuerpo={nota.analisis} />
      <Soap etiqueta="Plan (P)" cuerpo={nota.plan} />

      <Text style={styles.soapEtiqueta}>Diagnósticos CIE-10</Text>
      {nota.diagnosticos.length > 0 ? (
        nota.diagnosticos.map((d, i) => (
          <Text key={i} style={styles.parrafo} wrap={false}>
            {d.code} — {d.description || NO_CAPTURADO}
          </Text>
        ))
      ) : (
        <Text style={styles.vacio}>{NO_CAPTURADO}</Text>
      )}

      <Text style={styles.soapEtiqueta}>Procedimientos</Text>
      {nota.procedimientos.length > 0 ? (
        nota.procedimientos.map((x, i) => (
          <Text key={i} style={styles.parrafo} wrap={false}>
            · {x}
          </Text>
        ))
      ) : (
        <Text style={styles.vacio}>{NO_CAPTURADO}</Text>
      )}

      <Text style={styles.soapEtiqueta}>Signos vitales</Text>
      {nota.signosVitales.length > 0 ? (
        <View style={styles.rejilla}>
          {nota.signosVitales.map((v, i) => (
            <Dato key={i} etiqueta={v.etiqueta} valor={v.valor} ancho="tercio" />
          ))}
        </View>
      ) : (
        <Text style={styles.vacio}>{NO_CAPTURADO}</Text>
      )}

      {/* Exploración física y pronóstico — campos NOM-004 que el panel está
          empezando a capturar (ws1-t5). Se leen por su nombre; si no están,
          se dicen ausentes en vez de desaparecer del papel. */}
      <Text style={styles.soapEtiqueta}>Exploración física</Text>
      <View style={styles.rejilla}>
        <Dato etiqueta="Habitus exterior" valor={nota.exploracionFisica?.habitus} />
        <Dato etiqueta="Cabeza y cuello" valor={nota.exploracionFisica?.cabezaCuello} />
        <Dato etiqueta="Cavidad oral" valor={nota.exploracionFisica?.cavidadOral} />
        <Dato etiqueta="ATM" valor={nota.exploracionFisica?.atm} />
        <Dato etiqueta="Ganglios" valor={nota.exploracionFisica?.ganglios} />
        <Dato etiqueta="Notas" valor={nota.exploracionFisica?.notas} />
      </View>

      <Text style={styles.soapEtiqueta}>Pronóstico</Text>
      <Text style={nota.pronostico ? styles.parrafo : styles.vacio}>
        {noCapturado(nota.pronostico)}
      </Text>

      {conAdendas &&
        nota.adendas.map((a, i) => (
          <View key={i} style={styles.adendaBloque} minPresenceAhead={50}>
            <View fixed>
              <Text style={styles.adendaCabeza}>
                Adenda {i + 1} de {nota.adendas.length}
              </Text>
              <Text style={styles.adendaMeta}>
                {fechaHora(a.fecha, tz)} · Firmada por {a.autor ?? "autor no registrado"}
              </Text>
            </View>
            <Text style={styles.parrafo}>{a.texto}</Text>
            <Text style={styles.adendaFin}>
              — fin de la adenda {i + 1} de {nota.adendas.length} —
            </Text>
          </View>
        ))}
    </View>
  );
}

function Soap({ etiqueta, cuerpo }: { etiqueta: string; cuerpo: string | null }) {
  const hay = !!cuerpo && cuerpo.trim().length > 0;
  return (
    <View>
      <Text style={styles.soapEtiqueta}>{etiqueta}</Text>
      <Text style={hay ? styles.parrafo : styles.vacio}>{hay ? cuerpo : NO_CAPTURADO}</Text>
    </View>
  );
}

// ── 5 · Plan de tratamiento ────────────────────────────────────────────

function PlanBloque({ plan, tz }: { plan: ExpedientePlan; tz: string }) {
  return (
    <View style={styles.notaBloque} minPresenceAhead={70}>
      <Text style={styles.notaFecha}>{plan.nombre}</Text>
      <Text style={styles.notaDoctor}>
        {plan.estado} · {noCapturado(plan.doctor)}
      </Text>
      <View style={[styles.rejilla, { marginTop: 5 }]}>
        <Dato etiqueta="Inicio" valor={plan.inicio ? fecha(plan.inicio, tz) : null} ancho="tercio" />
        <Dato etiqueta="Fin previsto" valor={plan.fin ? fecha(plan.fin, tz) : null} ancho="tercio" />
        <Dato etiqueta="Sesiones previstas" valor={String(plan.sesionesTotales)} ancho="tercio" />
        <Dato etiqueta="Descripción" valor={plan.descripcion} ancho="entero" />
      </View>
      <Text style={styles.subTitulo}>Sesiones</Text>
      {plan.sesiones.length === 0 ? (
        <Text style={styles.vacio}>Sin sesiones registradas.</Text>
      ) : (
        <Tabla
          columnas={[
            { titulo: "Sesión", ancho: "12%" },
            { titulo: "Realizada el", ancho: "26%" },
            { titulo: "Notas", ancho: "62%" },
          ]}
          filas={plan.sesiones.map((s) => [
            String(s.numero),
            s.completadaEl ? fecha(s.completadaEl, tz) : "Pendiente",
            noCapturado(s.notas) === NO_CAPTURADO ? "—" : (s.notas as string),
          ])}
        />
      )}
    </View>
  );
}

// ── 6 · Receta ─────────────────────────────────────────────────────────

function RecetaBloque({ receta, tz }: { receta: ExpedienteReceta; tz: string }) {
  const anulada = receta.estado !== "ACTIVE";
  return (
    <View style={styles.notaBloque} minPresenceAhead={70}>
      <Text style={styles.notaFecha}>
        Receta {receta.folio} · {fechaHora(receta.emitidaEl, tz)}
      </Text>
      <Text style={styles.notaDoctor}>
        {noCapturado(receta.doctor)} · Cédula profesional {noCapturado(receta.doctorCedula)}
      </Text>
      {anulada && (
        <View style={styles.adendaAviso} wrap={false}>
          <Text style={styles.adendaAvisoTexto}>
            Receta {receta.estado === "VOIDED" ? "ANULADA" : receta.estado}
            {receta.anuladaEl ? ` el ${fechaHora(receta.anuladaEl, tz)}` : ""}.
            {receta.motivoAnulacion ? ` Motivo: ${receta.motivoAnulacion}` : ""} Se conserva en el
            expediente porque la anulación no borra lo que se prescribió.
          </Text>
        </View>
      )}
      <View style={[styles.rejilla, { marginTop: 5 }]}>
        <Dato etiqueta="Vigencia" valor={receta.venceEl ? fecha(receta.venceEl, tz) : null} />
        <Dato etiqueta="Diagnóstico" valor={receta.diagnostico} />
        <Dato etiqueta="Indicaciones" valor={receta.indicaciones} ancho="entero" />
      </View>
      <Text style={styles.subTitulo}>Medicamentos</Text>
      {receta.medicamentos.length === 0 ? (
        <Text style={styles.vacio}>{NO_CAPTURADO}</Text>
      ) : (
        <Tabla
          columnas={[
            { titulo: "Medicamento", ancho: "34%" },
            { titulo: "Dosis", ancho: "24%" },
            { titulo: "Duración", ancho: "16%" },
            { titulo: "Cantidad", ancho: "12%" },
            { titulo: "Notas", ancho: "14%" },
          ]}
          filas={receta.medicamentos.map((m) => [
            m.nombre,
            noCapturado(m.dosis),
            noCapturado(m.duracion) === NO_CAPTURADO ? "—" : (m.duracion as string),
            noCapturado(m.cantidad) === NO_CAPTURADO ? "—" : (m.cantidad as string),
            noCapturado(m.notas) === NO_CAPTURADO ? "—" : (m.notas as string),
          ])}
        />
      )}
    </View>
  );
}

// ── 7 · Consentimiento ─────────────────────────────────────────────────

function ConsentimientoBloque({
  consentimiento,
  tz,
}: {
  consentimiento: ExpedienteConsentimiento;
  tz: string;
}) {
  const c = consentimiento;
  return (
    <View style={styles.notaBloque} minPresenceAhead={80}>
      <View fixed>
        <Text style={styles.notaFecha}>{c.procedimiento}</Text>
        <Text style={styles.notaDoctor}>
          Creada el {fecha(c.creadoEl, tz)} ·{" "}
          {c.firmadoEl ? `Firmada el ${fechaHora(c.firmadoEl, tz)}` : "SIN FIRMAR"}
        </Text>
      </View>
      {c.revocadoEl && (
        <View style={styles.adendaAviso} wrap={false}>
          <Text style={styles.adendaAvisoTexto}>
            REVOCADA el {fechaHora(c.revocadoEl, tz)}.
            {c.motivoRevocacion ? ` Motivo: ${c.motivoRevocacion}` : ""} El texto original se
            conserva: la revocación no borra lo que se consintió, lo deja sin efecto desde su fecha.
          </Text>
        </View>
      )}

      {/* Renglón a renglón, para que el salto de página caiga entre renglones
          y no parta una frase. Mismo criterio que `consent-document`. */}
      {c.texto
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l, i) => (
          <Text key={i} style={styles.consentTexto}>
            {l}
          </Text>
        ))}

      <Text style={styles.subTitulo}>Firmas</Text>
      {c.firmas.length === 0 ? (
        <Text style={styles.vacio}>{NO_CAPTURADO}</Text>
      ) : (
        parEnPar(c.firmas).map((fila, i) => (
          <View key={i} style={styles.firmasFila} wrap={false}>
            {fila.map((f, j) => (
              <View key={j} style={styles.firmaCelda}>
                {f.imagen ? (
                  <PdfImage style={styles.firmaImg} src={f.imagen} />
                ) : (
                  <View style={styles.firmaLinea} />
                )}
                <Text style={styles.firmaRol}>{f.rol}</Text>
                <Text style={styles.firmaNombre}>{noCapturado(f.nombre)}</Text>
                <Text style={styles.firmaFecha}>
                  {f.firmadoEl ? fechaHora(f.firmadoEl, tz) : "Sin firmar"}
                </Text>
              </View>
            ))}
            {/* Relleno para que una fila impar no estire la única firma que
                lleva a todo el ancho y parezca otra cosa. */}
            {fila.length === 1 ? <View style={styles.firmaCelda} /> : null}
          </View>
        ))
      )}
      {c.hashDelTexto ? (
        <Text style={[styles.adendaMeta, { marginTop: 5 }]}>
          Huella del texto firmado (SHA-256): {c.hashDelTexto}
        </Text>
      ) : null}
    </View>
  );
}

function parEnPar<T>(xs: T[]): T[][] {
  const filas: T[][] = [];
  for (let i = 0; i < xs.length; i += 2) filas.push(xs.slice(i, i + 2));
  return filas;
}

// ── 8 · Estudio con imagen ─────────────────────────────────────────────

function EstudioConImagen({ estudio, tz }: { estudio: ExpedienteEstudio; tz: string }) {
  return (
    <View style={styles.notaBloque} minPresenceAhead={80}>
      <Text style={styles.notaFecha}>{estudio.nombre}</Text>
      <Text style={styles.notaDoctor}>
        {estudio.tipo} · {fecha(estudio.fecha, tz)} · Subido por {noCapturado(estudio.subidoPor)}
        {estudio.diente != null ? ` · Diente ${estudio.diente}` : ""}
      </Text>
      {estudio.imagen ? (
        <PdfImage style={styles.estudioImg} src={estudio.imagen} />
      ) : (
        <Text style={styles.vacio}>
          {estudio.motivoSinImagen
            ? `Imagen no incrustada: ${estudio.motivoSinImagen}. El archivo original está en el sistema.`
            : "Imagen no incrustada. El archivo original está en el sistema."}
        </Text>
      )}
      {estudio.notas ? <Text style={styles.parrafo}>{estudio.notas}</Text> : null}
    </View>
  );
}
