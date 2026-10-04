/**
 * Lógica PURA del panel de auditoría (sin Prisma → testeable en aislamiento).
 * `audit.ts` reexporta todo esto y añade la consulta a BD (`queryAuditLogs`).
 *
 * Solo `import type` de @prisma/client (se borra en runtime, no instancia el
 * cliente), así este módulo corre bajo `tsx --test` sin tocar la base.
 */

import type { Prisma } from "@prisma/client";

// ───────────────────────── Tipos públicos ─────────────────────────

export interface AuditQueryFilters {
  clinicId?: string;
  userId?: string;
  role?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** ISO o `yyyy-mm-dd` (se interpreta como inicio del día). */
  dateFrom?: string;
  /** ISO o `yyyy-mm-dd` (se interpreta como fin del día, 23:59:59.999). */
  dateTo?: string;
  /** Búsqueda libre: match en entityId / ipAddress / userAgent. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogRow {
  id: string;
  clinicId: string;
  clinicName: string | null;
  userId: string;
  userName: string;
  userEmail: string | null;
  userRole: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string; // ISO
  /**
   * Nombres de las personas del equipo que `changes` menciona por id (hoy, el
   * doctor tratante de un caso de ortodoncia): id → nombre. Lo rellena
   * `queryAuditLogs`, siempre con gente de la MISMA clínica que la fila. Sin
   * él, el id se pinta tal cual, como antes.
   */
  personas?: Record<string, string>;
}

export interface AuditQueryResult {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const AUDIT_PAGE_SIZE_DEFAULT = 50;
export const AUDIT_PAGE_SIZE_MAX = 200;

// ───────────────────────── Catálogos para filtros ─────────────────────────

/** Roles válidos (espejo del enum Role de Prisma). */
export const ROLE_OPTIONS = [
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "READONLY",
] as const;

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Dueño",
  ADMIN: "Admin",
  DOCTOR: "Doctor",
  RECEPTIONIST: "Recepción",
  READONLY: "Solo lectura",
};

/** Acciones conocidas (espejo de AuditAction en src/lib/audit.ts). */
export const AUDIT_ACTION_OPTIONS = [
  "create",
  "update",
  "delete",
  "void",
  "soft_delete",
  "archive",
  "view",
  "password_reset",
  "password_set",
  "XRAY_NOTES_UPDATED",
  "FILE_NOTES_UPDATED",
] as const;

/** Entidades conocidas (espejo de AuditEntityType en src/lib/audit.ts). */
export const AUDIT_ENTITY_OPTIONS = [
  "patient",
  "appointment",
  "invoice",
  "record",
  "consent",
  "inventory",
  "treatment",
  "periodontal",
  "body-map",
  "xray-analysis",
  "patient-file",
  "prescription",
  "user",
  "clinic",
  "subscription",
  "quote",
  "payment-plan",
  "pediatric-record",
  // C-115 (ws1-t8): entidades que la bitácora ya registraba y el filtro no ofrecía.
  "expense",
  "payment",
  "procedure",
  "cash-register",
  "agenda-block",
  "import",
] as const;

export type AuditTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

/** Etiqueta + color por acción. Las no listadas caen a neutral con su string. */
export const ACTION_META: Record<string, { label: string; tone: AuditTone }> = {
  create: { label: "Creación", tone: "success" },
  update: { label: "Edición", tone: "info" },
  delete: { label: "Borrado", tone: "danger" },
  void: { label: "Anulación", tone: "danger" },
  soft_delete: { label: "Borrado lógico", tone: "warning" },
  archive: { label: "Archivado", tone: "warning" },
  view: { label: "Lectura", tone: "neutral" },
  password_reset: { label: "Reset contraseña", tone: "warning" },
  password_set: { label: "Contraseña nueva", tone: "warning" },
  XRAY_NOTES_UPDATED: { label: "Notas radiografía", tone: "info" },
  FILE_NOTES_UPDATED: { label: "Notas archivo", tone: "info" },
  // C-115 (ws1-t8): acciones que se guardaban con nombre de programa.
  reject: { label: "Rechazo", tone: "warning" },
  "abrir-plan-de-pago": { label: "Abrió un plan de pagos", tone: "success" },
  "cambiar-plan-de-pago": { label: "Cambió un plan de pagos", tone: "info" },
  "crear-plan-al-abrir-caso": { label: "Plan creado al abrir el caso", tone: "success" },
  "cobrar-procedimiento-de-hoja": { label: "Cobro desde la hoja de control", tone: "success" },
  "registrar-extra-cobrado": { label: "Extra cobrado", tone: "success" },
  "registrar-promesa-de-pago": { label: "Promesa de pago", tone: "info" },
  "resolver-promesa-de-pago": { label: "Promesa de pago resuelta", tone: "info" },
  odontogram_write: { label: "Odontograma editado", tone: "info" },
  odontogram_sync: { label: "Odontograma actualizado", tone: "info" },
  odontogram_delete: { label: "Odontograma: marca borrada", tone: "danger" },
  sabina_proponer: { label: "Sabina propuso una acción", tone: "neutral" },
  sabina_confirmar: { label: "Acción de Sabina confirmada", tone: "info" },
  sabina_descartar: { label: "Acción de Sabina descartada", tone: "neutral" },
  sabina_resultado: { label: "Resultado de Sabina", tone: "neutral" },
  reserva: { label: "Reserva", tone: "info" },
  libre: { label: "Movimiento", tone: "neutral" },
};

export function actionMeta(action: string): { label: string; tone: AuditTone } {
  return ACTION_META[action] ?? ORTHO_ACTION_META[action] ?? { label: action, tone: "neutral" };
}

const ENTITY_LABELS: Record<string, string> = {
  patient: "Paciente",
  appointment: "Cita",
  invoice: "Factura",
  record: "Expediente",
  consent: "Consentimiento",
  inventory: "Inventario",
  treatment: "Tratamiento",
  periodontal: "Periodoncia",
  "body-map": "Mapa corporal",
  "xray-analysis": "Análisis RX",
  "patient-file": "Archivo paciente",
  prescription: "Receta",
  user: "Usuario",
  clinic: "Clínica",
  subscription: "Suscripción",
  quote: "Presupuesto",
  "payment-plan": "Plan de pagos",
  // C-115 (ws1-t8): sin nombre salían en crudo («expense», «cash-register»…).
  expense: "Gasto",
  payment: "Pago",
  cfdi: "CFDI",
  procedure: "Procedimiento",
  ProcedureCatalog: "Procedimiento",
  import: "Importación",
  "agenda-block": "Bloqueo de agenda",
  "cash-register": "Caja",
  "clinical-photo": "Foto clínica",
  photo: "Foto clínica",
  "sabina-propuesta": "Propuesta de Sabina",
  "upload-rejected": "Archivo rechazado",
  aviso_cobro: "Aviso de cobro",
  orthodontic_cobro: "Cobro de ortodoncia",
  "orthodontic-case": "Caso de ortodoncia",
  "orthodontic-plan": "Plan de ortodoncia",
  "clinical-evolution-template": "Plantilla de nota",
  "handout-template": "Plantilla de indicaciones",
  "ai-consult": "Consulta a la IA",
  "doctor-contact": "Contacto de un doctor",
  PeriodontalRecord: "Periodontograma",
  PeriodontalTreatmentPlan: "Plan de periodoncia",
  odontogram: "Odontograma",
  "model-3d": "Modelo 3D",
  questionnaire: "Cuestionario de salud",
  "patient-guardian": "Responsable del paciente",
  referral: "Referencia",
  "package-redemption": "Uso de paquete",
};

export function entityLabel(entityType: string): string {
  if (ENTITY_LABELS[entityType]) return ENTITY_LABELS[entityType];
  if (entityType === AUDIT_ENTITY_GROUP_ORTHO) return "Ortodoncia (todo)";
  if (entityType === AUDIT_ENTITY_GROUP_CFDI) return "CFDI y datos fiscales";
  if (ORTHO_ENTITY_LABELS[entityType]) return ORTHO_ENTITY_LABELS[entityType];
  if (esEntidadDeOrtodoncia(entityType)) return "Ortodoncia";
  if (entityType.indexOf("ped-") === 0 || entityType.indexOf("pediatric") === 0) return "Pediatría";
  return entityType;
}

// ───────────────────────── Ortodoncia ─────────────────────────
//
// ws1-t5, 28-sep-2026 (revisión de lógica de uso, fila 18 del mapa). El módulo
// guarda sus acciones con nombres de programa («ortho.card.signed» sobre
// «OrthoTreatmentCard») y el dueño las leía así, en crudo; no había forma de
// ver solo lo de ortodoncia; y una reasignación de doctor no decía de quién a
// quién. Aquí van los nombres que se leen, el filtro y el resumen del cambio.
// No cambia qué se registra ni en qué orden: solo cómo se dice.

/** Valor del filtro «Entidad» que trae TODO lo de ortodoncia. No es un entityType real. */
export const AUDIT_ENTITY_GROUP_ORTHO = "grupo:ortodoncia";

/**
 * C-115 (ws1-t8): valor del filtro «Entidad» que trae lo fiscal. El timbrado,
 * la cancelación y el envío de un CFDI se guardan sobre la FACTURA (entityType
 * «invoice»), así que no basta con `entityType = "cfdi"`: se busca también por
 * el texto del movimiento («Timbró el CFDI…», «Subió el certificado de sello…»).
 */
export const AUDIT_ENTITY_GROUP_CFDI = "grupo:cfdi";
const TEXTOS_FISCALES = ["CFDI", "certificado de sello digital", "retención de ISR"];

/** Los entityType del módulo empiezan por «Ortho…» u «Orthodontic…». */
const PREFIJO_ENTIDAD_ORTO = "Ortho";
/** Y sus acciones, por «ortho.». */
const PREFIJO_ACCION_ORTO = "ortho.";

export function esEntidadDeOrtodoncia(entityType: string): boolean {
  return entityType.indexOf(PREFIJO_ENTIDAD_ORTO) === 0;
}

/** ¿La fila es del módulo de ortodoncia? Por su entidad o por su acción. */
export function esFilaDeOrtodoncia(row: { action: string; entityType: string }): boolean {
  return esEntidadDeOrtodoncia(row.entityType) || row.action.indexOf(PREFIJO_ACCION_ORTO) === 0;
}

/**
 * Las opciones del filtro «Entidad». Con el módulo de ortodoncia en la sede
 * (o en /admin, que ve todas) se añade «Ortodoncia (todo)» al principio; sin
 * él, las de siempre.
 */
export function entityOptionsFor(e: { ortodoncia: boolean }): string[] {
  const base: string[] = [AUDIT_ENTITY_GROUP_CFDI, ...AUDIT_ENTITY_OPTIONS];
  return e.ortodoncia ? [AUDIT_ENTITY_GROUP_ORTHO, ...base] : base;
}

const ORTHO_ENTITY_LABELS: Record<string, string> = {
  OrthodonticTreatmentPlan: "Caso de ortodoncia",
  OrthodonticDiagnosis: "Diagnóstico de ortodoncia",
  OrthoTreatmentCard: "Hoja de control",
  OrthodonticControlAppointment: "Control de ortodoncia",
  OrthoPaymentPlan: "Plan de pago de ortodoncia",
  OrthoInstallment: "Mensualidad de ortodoncia",
  OrthoWireStep: "Arco del caso",
  OrthoTAD: "Microimplante",
  OrthoPhotoSet: "Fotos de ortodoncia",
  OrthodonticMonitoringPhoto: "Foto enviada por el paciente",
  OrthodonticElasticsLog: "Uso de elásticos",
  OrthodonticAligner: "Alineadores",
  OrthodonticAlignerEvent: "Cambio de alineador",
  OrthodonticConsent: "Consentimiento de ortodoncia",
  OrthodonticDigitalRecord: "Registro digital de ortodoncia",
  OrthodonticCephalometryAnalysis: "Cefalometría",
  OrthodonticFacialAnalysis: "Análisis facial",
  OrthoRetentionRegimen: "Retención",
  OrthoNpsSchedule: "Encuesta de satisfacción",
  OrthoQuoteScenario: "Opción de presupuesto de ortodoncia",
  OrthoReferralCode: "Código de recomendación",
  OrthoSignAtHomePackage: "Firma en casa",
  OrthodonticsClinicSettings: "Configuración de Ortodoncia",
};

/** Las acciones del módulo (src/app/actions/orthodontics/audit-actions.ts), dichas para el dueño. */
const ORTHO_ACTION_META: Record<string, { label: string; tone: AuditTone }> = {
  "ortho.diagnosis.created": { label: "Diagnóstico de ortodoncia registrado", tone: "success" },
  "ortho.diagnosis.updated": { label: "Diagnóstico de ortodoncia editado", tone: "info" },
  "ortho.treatmentPlan.created": { label: "Caso de ortodoncia abierto", tone: "success" },
  "ortho.treatmentPlan.updated": { label: "Caso de ortodoncia editado", tone: "info" },
  "ortho.treatmentPlan.statusChanged": { label: "Cambio de estado del caso", tone: "warning" },
  "ortho.phase.advanced": { label: "Cambio de fase del caso", tone: "info" },
  "ortho.paymentPlan.created": { label: "Plan de pago abierto", tone: "success" },
  "ortho.financialPlan.updated": { label: "Plan de pago editado", tone: "info" },
  "ortho.installment.paid": { label: "Mensualidad cobrada", tone: "success" },
  "ortho.installment.waived": { label: "Mensualidad condonada", tone: "warning" },
  "ortho.paymentStatus.recalculated": { label: "Estado de pago recalculado", tone: "neutral" },
  "ortho.collect.recorded": { label: "Cobro de ortodoncia registrado", tone: "success" },
  "ortho.cfdi.timbrado.requested": { label: "Factura fiscal solicitada", tone: "info" },
  "ortho.control.created": { label: "Control de ortodoncia registrado", tone: "success" },
  "ortho.card.draftSaved": { label: "Hoja de control guardada en borrador", tone: "info" },
  "ortho.card.signed": { label: "Hoja de control firmada", tone: "success" },
  "ortho.wireStep.added": { label: "Arco agregado al caso", tone: "success" },
  "ortho.wireStep.updated": { label: "Arco del caso editado", tone: "info" },
  "ortho.tad.created": { label: "Microimplante registrado", tone: "success" },
  "ortho.auxDevice.added": { label: "Mecánica auxiliar colocada", tone: "success" },
  "ortho.auxDevice.removed": { label: "Mecánica auxiliar retirada", tone: "info" },
  "ortho.photoSet.created": { label: "Juego de fotos creado", tone: "success" },
  "ortho.photoSet.photoUploaded": { label: "Foto de ortodoncia subida", tone: "success" },
  // Las tres siguientes se registraban (fotosDelJuego.ts) sin nombre: se leían en crudo.
  "ortho.photoSet.photoRemoved": { label: "Foto de ortodoncia quitada", tone: "danger" },
  "ortho.photoSet.extraAdded": { label: "Foto extra de ortodoncia subida", tone: "success" },
  "ortho.photoSet.extraRemoved": { label: "Foto extra de ortodoncia quitada", tone: "danger" },
  "ortho.elastics.compliance.recorded": { label: "Uso de elásticos registrado", tone: "info" },
  "ortho.digitalRecord.linked": { label: "Registro digital ligado al caso", tone: "info" },
  "ortho.consent.signed": { label: "Consentimiento de ortodoncia firmado", tone: "success" },
  "ortho.signAtHome.sent": { label: "Firma en casa enviada", tone: "info" },
  "ortho.quoteScenario.selected": { label: "Opción de presupuesto elegida", tone: "info" },
  "ortho.labOrder.created": { label: "Orden de laboratorio de ortodoncia", tone: "success" },
  "ortho.referralLetter.created": { label: "Carta de referencia creada", tone: "success" },
  "ortho.referralCode.created": { label: "Código de recomendación creado", tone: "success" },
  "ortho.retention.preSurvey.toggled": { label: "Encuesta previa a la retención", tone: "info" },
  "ortho.retention.regimen.configured": { label: "Retención configurada", tone: "info" },
  "ortho.retention.checkups.scheduled": { label: "Revisiones de retención programadas", tone: "info" },
  "ortho.nps.scheduled": { label: "Encuesta de satisfacción programada", tone: "info" },
  "ortho.nps.response.recorded": { label: "Respuesta de la encuesta registrada", tone: "info" },
  "ortho.googleReview.triggered": { label: "Invitación a reseña enviada", tone: "info" },
  "ortho.g15.checkpoint.scheduled": { label: "Revisión del caso programada", tone: "info" },
  "ortho.report.treatmentPlan.pdf": { label: "PDF del plan de ortodoncia", tone: "neutral" },
  "ortho.report.financialAgreement.pdf": { label: "PDF del convenio de pago", tone: "neutral" },
  "ortho.report.progress.pdf": { label: "PDF de avance del caso", tone: "neutral" },
  "ortho.report.beforeAfter.pdf": { label: "PDF de antes y después", tone: "neutral" },
  "ortho.clinicSettings.updated": { label: "Configuración de Ortodoncia editada", tone: "info" },
};

/** Todas las acciones de ortodoncia con nombre propio (para los tests y el filtro). */
export const ORTHO_ACTIONS_CONOCIDAS: readonly string[] = Object.keys(ORTHO_ACTION_META);

const ESTADOS_DEL_CASO: Record<string, string> = {
  PLANNED: "Planeado",
  IN_PROGRESS: "En tratamiento",
  ON_HOLD: "En pausa",
  RETENTION: "En retención",
  COMPLETED: "Terminado",
  DROPPED_OUT: "Abandonó",
};

/** Los campos de un caso de ortodoncia que el dueño lee en la bitácora. */
const CAMPOS_DE_ORTODONCIA: Record<string, string> = {
  status: "Estado del caso",
  totalCostMxn: "Precio total",
  treatingDoctorId: "Doctor tratante",
  responsibleGuardianId: "Responsable del pago",
  estimatedDurationMonths: "Duración estimada (meses)",
  technique: "Aparatología",
  billingMode: "Modo de cobro",
  defaultTreatingDoctorId: "Doctor tratante por defecto",
};

/**
 * C-115 (ws1-t8): los campos que salen en casi todas las entidades, dichos en
 * español. Lo que no esté aquí se enseña como se guardó.
 */
const CAMPOS_COMUNES: Record<string, string> = {
  monto: "Monto", amount: "Monto", total: "Total", subtotal: "Subtotal", paid: "Pagado",
  discount: "Descuento", price: "Precio", basePrice: "Precio", cost: "Gasto",
  fecha: "Fecha", date: "Fecha", startsAt: "Inicio", endsAt: "Fin", dueDate: "Vence",
  nota: "Nota", notes: "Notas", reason: "Motivo", motivo: "Motivo",
  categoria: "Categoría", category: "Categoría", status: "Estado", method: "Método",
  name: "Nombre", firstName: "Nombre", lastName: "Apellidos", phone: "Teléfono", email: "Correo",
  isActive: "Activo", duration: "Duración (min)", description: "Descripción",
};

/** Campos de dinero (se enseñan en pesos) y de fecha (en fecha legible). */
const CAMPOS_DE_DINERO = new Set(["monto", "amount", "total", "subtotal", "paid", "discount", "price", "basePrice", "cost", "totalCostMxn"]);
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const ZONA_BITACORA = "America/Mexico_City";

/** El nombre del campo como lo lee el dueño. */
export function fieldLabel(field: string, entityType: string): string {
  if (esEntidadDeOrtodoncia(entityType) && CAMPOS_DE_ORTODONCIA[field]) return CAMPOS_DE_ORTODONCIA[field];
  return CAMPOS_COMUNES[field] ?? field;
}

/**
 * Una fecha guardada en ISO («2026-10-03T06:00:00.000Z») como la lee una
 * persona, en la hora de la clínica: «3 oct 2026» si cae a medianoche (un día
 * sin hora, como la fecha de un gasto) o «3 oct 2026, 11:12» si lleva hora.
 */
export function fechaLegible(iso: string, timeZone: string = ZONA_BITACORA): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const partes = new Intl.DateTimeFormat("es-MX", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const dia = new Intl.DateTimeFormat("es-MX", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(d).replace(/\./g, "");
  return partes === "00:00" ? dia : `${dia}, ${partes}`;
}

/** Un valor suelto para la bitácora (sin saber el campo): fechas ISO legibles y objetos campo por campo. */
function valorLegible(v: unknown): string {
  if (typeof v === "string" && FECHA_ISO.test(v)) return fechaLegible(v);
  if (isPlainObject(v)) {
    const partes = Object.keys(v)
      .filter((k) => !k.startsWith("_"))
      .map((k) => `${CAMPOS_COMUNES[k] ?? k}: ${valorDeCampo(k, v[k])}`);
    return partes.length > 0 ? partes.join(" · ") : formatAuditValue(v);
  }
  return formatAuditValue(v);
}

function valorDeCampo(field: string, value: unknown): string {
  if (CAMPOS_DE_DINERO.has(field)) return pesosDe(value) ?? valorLegible(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return valorLegible(value);
}

const CAMPOS_DE_PERSONA = ["treatingDoctorId", "defaultTreatingDoctorId"];

/** Los ids de personas del equipo que menciona `changes` (para ponerles nombre). */
export function idsDePersonas(changes: unknown): string[] {
  const ids = new Set<string>();
  for (const f of normalizeChanges(changes).fields) {
    if (CAMPOS_DE_PERSONA.indexOf(f.field) < 0) continue;
    for (const v of [f.before, f.after]) if (typeof v === "string" && v) ids.add(v);
  }
  return Array.from(ids);
}

function pesosDe(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/**
 * El valor de un campo como lo lee el dueño. En ortodoncia: el doctor por su
 * nombre, el estado en español y el precio en pesos. En todo lo demás, y si
 * algo no se reconoce, `formatAuditValue` de siempre.
 */
export function formatAuditFieldValue(
  field: string,
  value: unknown,
  ctx: { entityType: string; personas?: Record<string, string> },
): string {
  if (!esEntidadDeOrtodoncia(ctx.entityType)) return valorDeCampo(field, value);
  if (CAMPOS_DE_PERSONA.indexOf(field) >= 0) {
    if (value === null || value === undefined || value === "") return "Sin asignar";
    if (typeof value === "string") {
      const nombre = ctx.personas && Object.prototype.hasOwnProperty.call(ctx.personas, value) ? ctx.personas[value] : null;
      return nombre || "Alguien que ya no está en el equipo";
    }
  }
  if (field === "status" && typeof value === "string" && ESTADOS_DEL_CASO[value]) return ESTADOS_DEL_CASO[value];
  if (field === "totalCostMxn") return pesosDe(value) ?? formatAuditValue(value);
  return valorLegible(value);
}

/** El texto que el propio movimiento guardó para la persona («Borró el gasto «Otro» de $100.00»). */
export function textoDelMovimiento(changes: unknown): string | null {
  if (!isPlainObject(changes) || !isPlainObject(changes._mov)) return null;
  const after = changes._mov.after;
  return isPlainObject(after) && typeof after.texto === "string" && after.texto.trim() ? after.texto.trim() : null;
}

/**
 * Lo que cambió, en una línea, para la lista: «Doctor tratante: Ana López →
 * Luis Gómez». Solo para filas de ortodoncia con campos que se leen; `null`
 * para las demás (la lista queda como estaba).
 */
export function resumenDeCambio(row: {
  entityType: string;
  changes: unknown;
  personas?: Record<string, string>;
}): string | null {
  // C-115 (ws1-t8): si el movimiento ya trae su frase, esa es la línea (cualquier entidad).
  const texto = textoDelMovimiento(row.changes);
  if (texto) return texto;
  if (!esEntidadDeOrtodoncia(row.entityType)) return null;
  const norm = normalizeChanges(row.changes);
  if (norm.kind !== "updated") return null;
  const partes = norm.fields
    .filter((f) => Object.prototype.hasOwnProperty.call(CAMPOS_DE_ORTODONCIA, f.field))
    .map((f) => {
      const ctx = { entityType: row.entityType, personas: row.personas };
      return `${fieldLabel(f.field, row.entityType)}: ${formatAuditFieldValue(f.field, f.before, ctx)} → ${formatAuditFieldValue(f.field, f.after, ctx)}`;
    });
  return partes.length > 0 ? partes.join(" · ") : null;
}

// ───────────────────────── Helpers puros ─────────────────────────

export function clampPage(page: number | undefined): number {
  const p = Math.floor(Number(page ?? 1));
  return Number.isFinite(p) && p > 0 ? p : 1;
}

export function clampPageSize(pageSize: number | undefined): number {
  const s = Math.floor(Number(pageSize ?? AUDIT_PAGE_SIZE_DEFAULT));
  if (!Number.isFinite(s) || s < 1) return AUDIT_PAGE_SIZE_DEFAULT;
  return Math.min(AUDIT_PAGE_SIZE_MAX, s);
}

/**
 * Convierte un valor de fecha (`yyyy-mm-dd` o ISO) a Date. Para `yyyy-mm-dd`
 * ancla al inicio o fin del día según `endOfDay`. Devuelve null si es inválida.
 */
export function parseAuditDate(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = isDateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Arma el filtro Prisma (PURO — no toca BD). Ignora silenciosamente filtros
 * vacíos o inválidos (p.ej. un `role` desconocido) para no romper la consulta.
 */
export function buildAuditWhere(filters: AuditQueryFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.clinicId) where.clinicId = filters.clinicId;
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.entityType === AUDIT_ENTITY_GROUP_ORTHO) {
    // «Ortodoncia (todo)»: cualquier entidad o acción del módulo. Va en AND
    // para no pisar el OR de la búsqueda libre de abajo.
    where.AND = [
      {
        OR: [
          { entityType: { startsWith: PREFIJO_ENTIDAD_ORTO } },
          { action: { startsWith: PREFIJO_ACCION_ORTO } },
        ],
      },
    ];
  } else if (filters.entityType === AUDIT_ENTITY_GROUP_CFDI) {
    where.AND = [
      {
        OR: [
          { entityType: "cfdi" },
          ...TEXTOS_FISCALES.map((texto) => ({ changes: { path: ["_mov", "after", "texto"], string_contains: texto } })),
        ],
      },
    ];
  } else if (filters.entityType) {
    where.entityType = filters.entityType;
  }
  if (filters.entityId) where.entityId = filters.entityId;

  // Rol: filtra sobre la relación user. SOLO si es un rol válido — pasar un
  // enum inválido a Prisma lanzaría en runtime.
  if (filters.role && (ROLE_OPTIONS as readonly string[]).indexOf(filters.role) >= 0) {
    // `as any`: el valor ya está validado contra ROLE_OPTIONS; evita TS2352
    // (string → enum Role) sin perder el filtro real sobre la relación.
    where.user = { role: filters.role as any };
  }

  // Rango de fechas.
  const from = parseAuditDate(filters.dateFrom, false);
  const to = parseAuditDate(filters.dateTo, true);
  if (from || to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;
    where.createdAt = createdAt;
  }

  // Búsqueda libre.
  const q = (filters.q ?? "").trim();
  if (q) {
    where.OR = [
      { entityId: { contains: q, mode: "insensitive" } },
      { ipAddress: { contains: q, mode: "insensitive" } },
      { userAgent: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

// ───────────────────────── Rangos rápidos de fecha (UI) ─────────────────────────

export type QuickRangeKey = "today" | "7d" | "30d" | "3m";

export const QUICK_RANGE_KEYS: readonly QuickRangeKey[] = ["today", "7d", "30d", "3m"];

/** Etiquetas en español neutro (fallback i18n). */
export const QUICK_RANGE_LABELS: Record<QuickRangeKey, string> = {
  today: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "3m": "Últimos 3 meses",
};

/** `yyyy-mm-dd` en hora LOCAL (no UTC → evita corrimiento de día en el <input type="date">). */
function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Devuelve {dateFrom, dateTo} (`yyyy-mm-dd` local) de un rango rápido. Ventanas
 * inclusivas que terminan HOY. `now` inyectable para tests deterministas.
 */
export function quickRangeValues(
  key: QuickRangeKey,
  now: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const to = new Date(now);
  const from = new Date(now);
  switch (key) {
    case "today": break;
    case "7d": from.setDate(from.getDate() - 6); break;   // hoy + 6 previos = 7 días
    case "30d": from.setDate(from.getDate() - 29); break; // hoy + 29 previos = 30 días
    case "3m": from.setMonth(from.getMonth() - 3); break;
  }
  return { dateFrom: toLocalYmd(from), dateTo: toLocalYmd(to) };
}

/** Qué rango rápido coincide EXACTAMENTE con (dateFrom, dateTo), o null si ninguno. */
export function matchQuickRange(
  dateFrom: string,
  dateTo: string,
  now: Date = new Date(),
): QuickRangeKey | null {
  if (!dateFrom || !dateTo) return null;
  for (const key of QUICK_RANGE_KEYS) {
    const r = quickRangeValues(key, now);
    if (r.dateFrom === dateFrom && r.dateTo === dateTo) return key;
  }
  return null;
}

// ───────────────────────── Lecturas del expediente ─────────────────────────

/**
 * Tipos de lectura que escribe `logRead` (src/lib/audit.ts) en
 * `changes._read.after.kind`, con su clave i18n y su respaldo. Lo comparten la
 * Bitácora de siempre y la del rediseño: las dos dicen lo mismo de la misma fila.
 */
export const READ_KIND_LABELS: Record<string, { key: string; fallback: string }> = {
  ficha: { key: "auditoria.readFicha", fallback: "Abrió la ficha" },
  nota_pdf: { key: "auditoria.readNotaPdf", fallback: "PDF de una nota" },
  export_cda: { key: "auditoria.readExportCda", fallback: "Exportó el expediente (CDA)" },
  export_arco: { key: "auditoria.readExportArco", fallback: "Exportó los datos (ARCO acceso)" },
  // WS1-T4. Sin esta entrada la fila saldría en la Bitácora con el string
  // crudo "expediente_pdf" — y justamente ésta es la que nadie puede tener que
  // descifrar: es la lectura más grande del panel.
  expediente_pdf: { key: "auditoria.readExpedientePdf", fallback: "Descargó el expediente completo (PDF)" },
  // ws1-t12: la lista «Movimientos Completo» del paciente, en CSV o PDF.
  movimientos_export: { key: "auditoria.readMovimientosExport", fallback: "Descargó los movimientos del paciente" },
};

/**
 * Si la fila es una lectura del expediente devuelve su tipo y, si aplica, el id
 * de la nota (solo ids: el rastro no guarda nombre ni dato clínico). null para
 * cualquier otra fila, incluidas las lecturas antiguas sin `_read`.
 */
export function readInfo(changes: unknown): { kind: string; recordId: string | null } | null {
  if (!isPlainObject(changes) || !isPlainObject(changes._read)) return null;
  const after = changes._read.after;
  if (!isPlainObject(after) || typeof after.kind !== "string") return null;
  return { kind: after.kind, recordId: typeof after.recordId === "string" ? after.recordId : null };
}

export function readKindLabel(kind: string, tr: (k: string, fb: string) => string): string {
  const meta = Object.prototype.hasOwnProperty.call(READ_KIND_LABELS, kind) ? READ_KIND_LABELS[kind] : null;
  return meta ? tr(meta.key, meta.fallback) : kind;
}

// ───────────────────────── Normalización de `changes` ─────────────────────────

export type AuditChangeKind = "created" | "deleted" | "updated" | "empty";

export interface AuditChangeField {
  field: string;
  before: unknown;
  after: unknown;
}

export interface NormalizedChanges {
  kind: AuditChangeKind;
  fields: AuditChangeField[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Interpreta el JSON `changes` escrito por logMutation:
 *   update      → { campo: { before, after }, ... }
 *   create      → { _created: { before: null, after: {...} } }
 *   delete/void → { _deleted: { before: {...}, after: {...} | null } }
 * Devuelve una lista plana de campos para render uniforme.
 */
export function normalizeChanges(changes: unknown): NormalizedChanges {
  if (!isPlainObject(changes)) return { kind: "empty", fields: [] };

  if ("_created" in changes && isPlainObject(changes._created)) {
    const after = changes._created.after;
    const obj = isPlainObject(after) ? after : {};
    return {
      kind: "created",
      fields: Object.keys(obj).map((field) => ({ field, before: null, after: obj[field] })),
    };
  }

  if ("_deleted" in changes && isPlainObject(changes._deleted)) {
    const before = changes._deleted.before;
    const after = changes._deleted.after;
    const beforeObj = isPlainObject(before) ? before : {};
    const afterObj = isPlainObject(after) ? after : {};
    const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
    return {
      kind: "deleted",
      fields: keys.map((field) => ({ field, before: beforeObj[field], after: afterObj[field] ?? null })),
    };
  }

  // Update genérico: cada valor debería ser { before, after }. Las llaves con
  // «_» (`_mov`, `_read`) son del registro, no campos de la entidad.
  const fields: AuditChangeField[] = Object.keys(changes).filter((field) => !field.startsWith("_")).map((field) => {
    const v = changes[field];
    if (isPlainObject(v) && ("before" in v || "after" in v)) {
      return { field, before: (v as Record<string, unknown>).before, after: (v as Record<string, unknown>).after };
    }
    return { field, before: undefined, after: v };
  });
  return { kind: fields.length ? "updated" : "empty", fields };
}

/** Formatea un valor de `changes` a string legible. */
export function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v === "" ? "(vacío)" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
