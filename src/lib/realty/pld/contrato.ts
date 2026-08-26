// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · CUMPLIMIENTO ANTILAVADO (PLD) — el contrato.
//
// Módulo PURO y client-safe: no importa prisma, no importa "server-only".
// Los enums van como union types (espejo 1:1 de los de Prisma) para poder
// importarlos desde componentes "use client" sin arrastrar el runtime.
//
// ── 🔴 LO QUE ESTE MÓDULO ES, Y LO QUE NO ES ──────────────────────────
// ES: un EXPEDIENTE y unas ALERTAS. Junta los papeles del cliente, compara
// el monto de la operación contra el umbral VIGENTE y arma el archivo del
// aviso para que el cliente lo suba él mismo en el portal del SAT.
//
// NO ES: un despacho. DaleControl **no presenta avisos**, no dictamina, no
// firma y no responde por el cumplimiento de nadie. Si el cliente incumple,
// las multas son suyas. Ningún texto de estas pantallas puede sugerir otra
// cosa — por eso las leyendas viven AQUÍ, en constantes, y no sueltas en el
// JSX de cada componente: así no hay forma de pintar un botón de "aviso"
// sin su advertencia al lado.
//
// ── 🔴 CERO NÚMEROS DE LA LEY EN EL CÓDIGO ────────────────────────────
// Ni la UMA, ni 8 025, ni 16 000, ni el día 17, ni las 24 horas, ni los 10
// años están escritos en este archivo ni en ningún otro de src/. Todos
// salen de realty_calc_params (kind = UMA, stateCode = "MX") y se editan en
// /admin/inmobiliarias/parametros. Si falta el parámetro del año, la
// pantalla DEGRADA y dice qué capturar; jamás inventa un número.
// ═══════════════════════════════════════════════════════════════════════

// ── Espejo de los enums Prisma ─────────────────────────────────────────

export type PldPersonKind = "FISICA" | "MORAL" | "FIDEICOMISO";
export type PldPepKind = "NO" | "PEP" | "FAMILIAR" | "ASOCIADO";
export type PldRisk = "BAJO" | "MEDIO" | "ALTO";
export type PldDocKind =
  | "IDENTIFICACION"
  | "COMPROBANTE_DOMICILIO"
  | "CONSTANCIA_FISCAL"
  | "CURP"
  | "ACTA_CONSTITUTIVA"
  | "PODER"
  | "BENEFICIARIO_CONTROLADOR"
  | "OTRO";
export type PldNoticeKind = "NORMAL" | "EN_CEROS";
export type PldNoticeStatus = "PENDIENTE" | "PRESENTADO";
export type PldAccessAction =
  | "VER_EXPEDIENTE"
  | "ABRIR_DOCUMENTO"
  | "DESCARGAR_AVISO"
  | "ARCHIVAR_DOCUMENTO";

/**
 * Estado del expediente. NO es columna: se calcula con estadoDeExpediente()
 * a partir de los papeles que hay y de sus vigencias. Guardarlo sería tener
 * dos verdades y que una envejeciera.
 */
export type EstadoExpediente = "INCOMPLETO" | "COMPLETO" | "VENCIDO";

/** Contra qué umbral cayó una operación. */
export type NivelUmbral = "NINGUNO" | "IDENTIFICACION" | "AVISO";

// ── Etiquetas en español de México ─────────────────────────────────────

export const PLD_PERSON_KIND_LABELS: Record<PldPersonKind, string> = {
  FISICA: "Persona física",
  MORAL: "Persona moral",
  FIDEICOMISO: "Fideicomiso",
};

export const PLD_PEP_LABELS: Record<PldPepKind, string> = {
  NO: "No es persona políticamente expuesta",
  PEP: "Es persona políticamente expuesta",
  FAMILIAR: "Familiar de una persona políticamente expuesta",
  ASOCIADO: "Asociado cercano de una persona políticamente expuesta",
};

export const PLD_DOC_KIND_LABELS: Record<PldDocKind, string> = {
  IDENTIFICACION: "Identificación oficial",
  COMPROBANTE_DOMICILIO: "Comprobante de domicilio",
  CONSTANCIA_FISCAL: "Constancia de situación fiscal (RFC)",
  CURP: "CURP",
  ACTA_CONSTITUTIVA: "Acta constitutiva",
  PODER: "Poder del representante legal",
  BENEFICIARIO_CONTROLADOR: "Declaración de beneficiario controlador",
  OTRO: "Otro documento",
};

export const PLD_RISK_LABELS: Record<PldRisk, string> = {
  BAJO: "Riesgo bajo",
  MEDIO: "Riesgo medio",
  ALTO: "Riesgo alto",
};

export const PLD_ESTADO_LABELS: Record<EstadoExpediente, string> = {
  INCOMPLETO: "Incompleto",
  COMPLETO: "Completo",
  VENCIDO: "Vencido",
};

export const PLD_NIVEL_LABELS: Record<NivelUmbral, string> = {
  NINGUNO: "No rebasa umbral",
  IDENTIFICACION: "Rebasa el umbral de identificación",
  AVISO: "Rebasa el umbral de aviso",
};

export const PLD_ACCESS_ACTION_LABELS: Record<PldAccessAction, string> = {
  VER_EXPEDIENTE: "Abrió el expediente",
  ABRIR_DOCUMENTO: "Abrió un documento",
  DESCARGAR_AVISO: "Descargó un archivo de aviso",
  ARCHIVAR_DOCUMENTO: "Archivó un documento",
};

// ── 🔴 LOS TEXTOS QUE NO SE PUEDEN CAMBIAR SIN UN ABOGADO ──────────────
//
// Viven aquí y no en el JSX ni en el diccionario porque son la frontera
// legal del producto, no una etiqueta de UI: si alguien traduce mal
// "DaleControl no presenta avisos por ti", el producto empieza a prometer
// algo que no hace. El diccionario traduce lo demás; esto va en duro, en
// español, y con esta advertencia encima.

/**
 * VA PEGADA AL BOTÓN DE DESCARGA, siempre visible, nunca detrás de un
 * tooltip ni de un acordeón. Es la frase que separa "te ordeno el papeleo"
 * de "cumplo por ti".
 */
export const LEYENDA_DESCARGA_AVISO =
  "Este archivo lo presentas tú en el portal del SAT. DaleControl no presenta avisos por ti.";

/** Encabezado de la pantalla. Dice exactamente qué compra el cliente. */
export const LEYENDA_ALCANCE =
  "Tu expediente y tus alertas, ordenadas. DaleControl no es un despacho: no presenta avisos, no dictamina y no sustituye a tu oficial de cumplimiento ni a tu abogado.";

/** Acompaña a TODO umbral pintado en pantalla. */
export const LEYENDA_UMBRALES =
  "Los umbrales se comparan contra el valor de la UMA vigente el día de la operación. Esto es una alerta, no un dictamen: confírmalo con tu oficial de cumplimiento.";

/** La bandera roja del efectivo. Es prohibición legal, no una sugerencia. */
export const LEYENDA_EFECTIVO_PROHIBIDO =
  "La ley prohíbe liquidar en efectivo una operación de inmuebles por este monto. No es una recomendación: es una prohibición, y quien la incumple responde por ella.";

/** El informe en ceros: el error más caro y más fácil de cometer. */
export const LEYENDA_EN_CEROS =
  "Un mes sin operaciones que avisar TAMBIÉN se reporta. No presentar el informe en ceros se sanciona igual que no presentar un aviso.";

/** La bóveda. Explica por qué el botón dice "archivar" y no "borrar". */
export const LEYENDA_BOVEDA =
  "Los documentos del expediente se conservan por el plazo que marca la ley. Dentro de ese plazo no se borran: se archivan, y queda registro de quién los consultó.";

// ── Formas de los datos (las que viajan a la pantalla) ─────────────────

/** Un beneficiario controlador declarado (viven en un Json del expediente). */
export interface BeneficiarioControlador {
  name: string;
  rfc?: string | null;
  curp?: string | null;
  /** Porcentaje de participación, 0–100. */
  pct?: number | null;
  pep?: PldPepKind | null;
}

/** Un papel del expediente, ya listo para pintar. */
export interface DocumentoRow {
  id: string;
  kind: PldDocKind;
  name: string;
  bytes: number;
  issuedAt: string | null;
  expiresAt: string | null;
  retainUntil: string;
  archivedAt: string | null;
  uploadedByName: string | null;
  createdAt: string;
  /** ¿Ya pasó su vigencia? Calculado contra la fecha de hoy. */
  vencido: boolean;
  /** ¿Se puede borrar de verdad, o solo archivar? */
  puedeBorrarse: boolean;
}

/** El expediente completo tal como lo consume la pantalla. */
export interface ExpedienteRow {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  personKind: PldPersonKind;
  rfc: string | null;
  curp: string | null;
  birthDate: string | null;
  nationality: string | null;
  occupation: string | null;
  address: string | null;
  pep: PldPepKind;
  pepDetail: string | null;
  pepAskedAt: string | null;
  beneficialOwners: BeneficiarioControlador[];
  risk: PldRisk;
  riskNote: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  notes: string | null;
  updatedAt: string;
  documents: DocumentoRow[];
  /** Calculado, nunca leído de una columna. */
  estado: EstadoExpediente;
  faltantes: PldDocKind[];
  vencidos: PldDocKind[];
  /** Por qué el riesgo es el que es, en palabras. */
  motivosRiesgo: string[];
}

/** Una operación vista desde cumplimiento. */
export interface OperacionRow {
  dealId: string;
  propertyId: string;
  propertyTitle: string;
  contactId: string | null;
  contactName: string | null;
  kind: "VENTA" | "RENTA";
  status: "EN_PROCESO" | "CERRADO" | "CANCELADO";
  closedAt: string | null;
  /** En PESOS con decimales, como el resto del vertical pinta dinero. */
  amount: number;
  efectivo: number;
  /** El periodo "AAAA-MM" al que cae por su fecha de cierre. */
  periodMonth: string | null;
  nivel: NivelUmbral;
  requiereExpediente: boolean;
  requiereAviso: boolean;
  efectivoProhibido: boolean;
  /** Estado del expediente del cliente de esta operación. */
  estadoExpediente: EstadoExpediente | null;
  expedienteId: string | null;
  /** Decisiones ya tomadas (tabla realty_pld_operations). */
  cashAckAt: string | null;
  cashAckNote: string | null;
  urgentFlaggedAt: string | null;
  urgentReason: string | null;
  urgentDueAt: string | null;
  urgentDoneAt: string | null;
  noticeId: string | null;
  /** ¿Ya se marcó como presentada en su aviso mensual? */
  presentada: boolean;
}

/** Un mes del calendario del día 17. */
export interface PeriodoRow {
  periodMonth: string;
  /** "marzo de 2026" */
  etiqueta: string;
  /** ISO date del vencimiento (día 17 del mes siguiente, o el que diga el parámetro). */
  dueDate: string;
  /** Operaciones que caen en el aviso de este mes. */
  operaciones: number;
  /** De esas, cuántas todavía no tienen expediente completo. */
  sinExpediente: number;
  kind: PldNoticeKind;
  status: PldNoticeStatus;
  noticeId: string | null;
  presentedAt: string | null;
  presentedByName: string | null;
  acuse: string | null;
  /** Días que faltan (negativo = ya venció). */
  diasRestantes: number;
  vencido: boolean;
}

/** Lo que el tablero necesita, ya contado. */
export interface TableroPld {
  expedientesIncompletos: number;
  expedientesVencidos: number;
  operacionesSinExpediente: number;
  pepDetectados: number;
  documentosPorVencer: number;
  efectivoEnBandera: number;
  alertas24h: number;
  /** El corte más próximo que sigue pendiente. */
  proximoCorte: PeriodoRow | null;
}

// ── La pantalla completa ───────────────────────────────────────────────

/** Un contacto al que todavía se le puede abrir expediente. */
export interface ContactoLite {
  id: string;
  name: string;
  phone: string | null;
  /** ¿Ya tiene expediente? */
  conExpediente: boolean;
}

/** Un parámetro que falta capturar, en la forma que ya pinta el kit de UI. */
export interface FaltantePld {
  kind: string;
  stateCode: string;
  etiqueta: string;
  comoResolver: string;
}

/**
 * Los umbrales del día, YA en pesos, para que la pantalla los enseñe sin
 * volver a multiplicar nada en el navegador.
 */
export interface UmbralesVigentes {
  year: number;
  umaDiaria: number;
  identificacionUma: number;
  avisoUma: number;
  efectivoUma: number;
  identificacion: number;
  aviso: number;
  efectivo: number;
  diaLimiteAviso: number;
  horasAvisoUrgente: number;
  aniosConservacion: number;
  porVerificar: boolean;
  fuente: string;
  nota: string;
}

/**
 * TODO lo que el servidor le baja a la pantalla de cumplimiento.
 *
 * 🔴 `umbrales` puede venir null. Eso NO es un error: es que nadie ha
 * capturado el parámetro del año. La pantalla enseña `faltantes` y sigue
 * dejando integrar expedientes —eso no depende de ningún número— pero no
 * pinta un solo umbral ni una sola fecha de corte.
 */
export interface PantallaCumplimiento {
  umbrales: UmbralesVigentes | null;
  faltantes: FaltantePld[];
  avisos: string[];
  tablero: TableroPld;
  expedientes: ExpedienteRow[];
  operaciones: OperacionRow[];
  periodos: PeriodoRow[];
  contactos: ContactoLite[];
  /** ¿Puede escribir, o solo mirar? (permiso pld.manage) */
  puedeGestionar: boolean;
  /** Zona horaria de la cuenta, para formatear fechas igual que el servidor. */
  timeZone: string;
}
