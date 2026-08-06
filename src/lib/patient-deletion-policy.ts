// Política del borrado DEFINITIVO de un paciente — CRITERIO INVERTIDO.
//
// ── Por qué existe este archivo ──────────────────────────────────────────────
// Hasta 2026-08-06 el precheck de borrado era una LISTA DE LO QUE BLOQUEA: siete
// familias clínicas contadas a mano. `Patient` tiene 61 relaciones
// `onDelete: Cascade`, así que todo lo que nadie se acordó de escribir en esa
// lista —Ortodoncia (17 tablas), Pediatría (11), Periodoncia (8), `PatientCredit`
// (saldo a favor del paciente)— se borraba EN SILENCIO al eliminar la ficha.
// Peor: cada modelo nuevo del schema nacía borrándose, porque nadie vuelve a
// tocar el precheck cuando agrega una tabla de especialidad.
//
// Aquí se invierte: la lista es de LO QUE PUEDE MORIR con el paciente
// (`CASCADE_ALLOWED`). Todo lo demás BLOQUEA por default, y la enumeración sale
// del DMMF de Prisma en runtime — no de una lista escrita a mano. Consecuencia
// buscada: **una relación nueva en el schema nace bloqueando**. Si es operativa
// y debe poder borrarse, hay que decirlo explícitamente aquí, y ese es
// justamente el momento en que alguien piensa la decisión.
//
// Este módulo es PURO a propósito (no importa `@/lib/prisma`): así se puede
// probar sin base de datos. El acceso a la BD vive en `@/lib/patient-deletion`.

/** Tipos de bloqueo que la UI sabe traducir (`patients.deleteModal.reasons.*`). */
export type PatientDeleteBlockerType =
  | "invoices"
  | "payments"
  | "cfdi"
  | "clinical"
  | "endodontics"
  | "implants"
  | "specialty"
  | "credit"
  // Comodín: un modelo que bloquea pero no está clasificado (relación nueva sin
  // pasar por aquí), o un fallo de FK que el precheck no anticipó. La UI lo
  // traduce a "Tiene información ligada que debe conservarse".
  | "related";

export interface PatientDeleteBlocker {
  type: PatientDeleteBlockerType;
  count: number;
}

/**
 * Lo ÚNICO que puede desaparecer con el paciente. La clave es el nombre del
 * modelo Prisma; el valor es el PORQUÉ, que es la parte importante: cada
 * entrada es una decisión de negocio, no un olvido.
 *
 * El criterio: **dato operativo o de conveniencia, no expediente clínico ni
 * dinero**. Si al borrarlo la clínica pierde algo que la NOM-024 obliga a
 * conservar, o que representa un saldo/derecho del paciente, NO va aquí.
 */
export const CASCADE_ALLOWED: Record<string, string> = {
  // ── Agenda y operación diaria ──────────────────────────────────────────
  Appointment:
    "Citas. Dato operativo: una ficha creada por error con una cita cancelada debe poder borrarse. La nota clínica de la cita es MedicalRecord y esa SÍ bloquea.",
  AppointmentChangeRequest:
    "Solicitud de cambio de cita hecha desde el portal. Cuelga de la cita, que ya se permite.",
  WaitlistEntry:
    "Lista de espera. Cola de trabajo, se resuelve o caduca; no es expediente.",
  PatientFlow:
    "Estado de sala (esperando / en sillón / salió). Efímero, del día.",

  // ── Comercial sin cobro ────────────────────────────────────────────────
  Quote:
    "Presupuesto. Una propuesta no aceptada no es un documento a conservar; si se cobró existe Invoice y esa bloquea.",
  TreatmentPlan:
    "Plan de tratamiento y sus sesiones. Criterio heredado del precheck original: es planeación, no el registro clínico del acto. Lo ejecutado vive en MedicalRecord.",
  PaymentPlan:
    "Plan de pagos (mensualidades) SIN mensualidades pagadas. Un calendario vacío no es dinero. Ojo: sus `PlanPayment` cobrados SÍ bloquean — cuelgan del plan, no del paciente, así que se cuentan aparte (ver TRANSITIVE_MONEY).",

  // ── Portal del paciente y avisos ───────────────────────────────────────
  PatientAccountLink:
    "Vínculo ficha ↔ cuenta del portal. Si la ficha desaparece el vínculo DEBE desaparecer: dejarlo sería acceso a un expediente inexistente.",
  PatientShareLink:
    "Liga temporal para compartir un módulo. Caduca sola; borrarla revoca el acceso, que es lo correcto.",
  PatientNotification:
    "Avisos del portal (recordatorio, cambio de cita). Mensajería, no expediente.",
  ClinicalReminder:
    "Recordatorio programado (control, seguimiento). Es un pendiente de agenda, no el registro del acto clínico.",

  // ── Marketing ──────────────────────────────────────────────────────────
  OrthoNpsSchedule:
    "Encuesta NPS programada de ortodoncia. Marketing.",
  OrthoReferralCode:
    "Código de referidos del paciente. Marketing; los referidos ya convertidos son fichas propias e independientes.",
};

/**
 * Modelo → tipo de bloqueo, para poder explicarlo en español sin nombrar tablas.
 * Lo que bloquea y NO está aquí cae en `related` (mensaje genérico): se prefiere
 * un bloqueo con texto vago a un borrado silencioso.
 *
 * `Invoice` NO aparece: la facturación se cuenta aparte en
 * `getPatientDeleteBlockers` porque tiene una regla propia (una factura
 * CANCELADA no bloquea, pero su timbre y sus pagos sí) y porque `Payment` y
 * `CfdiRecord` no cuelgan del paciente — se llega a ellos por `invoiceId`.
 */
export const BLOCKER_TYPE_BY_MODEL: Record<string, PatientDeleteBlockerType> = {
  // ── Historia clínica núcleo (NOM-024) ──────────────────────────────────
  MedicalRecord: "clinical",
  Prescription: "clinical",
  ConsentForm: "clinical",
  PatientFile: "clinical",
  XrayAnalysis: "clinical",
  OdontogramEntry: "clinical",
  OdontogramSnapshot: "clinical",
  ClinicalPhoto: "clinical",
  BeforeAfterPhoto: "clinical",
  PeriodontalRecord: "clinical",
  BodyMapAnnotation: "clinical",
  FormulaRecord: "clinical",
  PatientUpload: "clinical",
  LabOrder: "clinical",
  // Referencia / contrarreferencia: lleva resumen clínico y diagnósticos, y la
  // NOM-004 la cuenta como parte del expediente.
  Referral: "clinical",
  ReferralLetter: "clinical",

  // ── Endodoncia (las 3 con onDelete: Restrict) ──────────────────────────
  EndodonticDiagnosis: "endodontics",
  VitalityTest: "endodontics",
  EndodonticTreatment: "endodontics",

  // ── Implantes (las 2 con onDelete: Restrict) ───────────────────────────
  Implant: "implants",
  ImplantConsent: "implants",

  // ── Ortodoncia ─────────────────────────────────────────────────────────
  OrthodonticDiagnosis: "specialty",
  OrthodonticTreatmentPlan: "specialty",
  OrthoPaymentPlan: "specialty",
  OrthoPhotoSet: "specialty",
  OrthodonticControlAppointment: "specialty",
  OrthodonticDigitalRecord: "specialty",
  OrthodonticConsent: "specialty",
  OrthoTreatmentCard: "specialty",
  OrthoTAD: "specialty",
  OrthoSignAtHomePackage: "specialty",

  // ── Pediatría ──────────────────────────────────────────────────────────
  PediatricRecord: "specialty",
  Guardian: "specialty",
  BehaviorAssessment: "specialty",
  CariesRiskAssessment: "specialty",
  OralHabit: "specialty",
  EruptionRecord: "specialty",
  SpaceMaintainer: "specialty",
  Sealant: "specialty",
  FluorideApplication: "specialty",
  PediatricEndodonticTreatment: "specialty",
  PediatricConsent: "specialty",

  // ── Periodoncia ────────────────────────────────────────────────────────
  PeriodontalClassification: "specialty",
  GingivalRecession: "specialty",
  PeriodontalTreatmentPlan: "specialty",
  SRPSession: "specialty",
  PeriodontalReevaluation: "specialty",
  PeriodontalRiskAssessment: "specialty",
  PeriodontalSurgery: "specialty",
  PeriImplantAssessment: "specialty",

  // ── Dinero del paciente ────────────────────────────────────────────────
  // Saldo a favor y sesiones prepagadas: valor que la clínica le DEBE. Borrar
  // la ficha sin más lo desaparece de la contabilidad sin dejar rastro.
  PatientCredit: "credit",
  PackageRedemption: "credit",
};

/**
 * `Invoice` se cuenta en el bloque fiscal de `getPatientDeleteBlockers`, con su
 * regla propia. Excluirlo del recorrido genérico evita contarlo dos veces y
 * evita que una factura CANCELADA —que a propósito NO bloquea— vuelva a
 * bloquear por la puerta de atrás.
 */
export const HANDLED_SEPARATELY = new Set<string>(["Invoice"]);

/**
 * El punto ciego de enumerar SÓLO las relaciones directas a `Patient`: hay
 * tablas que no tienen `patientId` y aun así mueren con el paciente, porque
 * cuelgan de algo que SÍ está en la allowlist. Son invisibles para el recorrido
 * genérico y hay que contarlas a mano.
 *
 * Hoy la lista tiene una entrada y es dinero: `PlanPayment` (la mensualidad
 * cobrada) cuelga de `PaymentPlan` con `onDelete: Cascade`. Permitir el plan
 * —que es sólo un calendario— arrastraba los pagos ya recibidos, que es
 * exactamente lo que la política dice no permitir. Se cuentan como `credit`.
 *
 * `Payment` y `CfdiRecord` son el mismo caso (cuelgan de `Invoice`) pero ya
 * están cubiertos por el bloque fiscal, que los busca por `invoiceId`.
 *
 * Aceptado a propósito y NO listado: `TreatmentSession` / `TreatmentLink`, que
 * cuelgan de `TreatmentPlan`. Es comportamiento heredado —el precheck original
 * ya dejaba morir los planes de tratamiento y sus sesiones— y son planeación,
 * no dinero ni el registro del acto clínico (eso vive en MedicalRecord, que
 * bloquea). Si algún día cambia el criterio para TreatmentPlan, cambia con él.
 */
export const TRANSITIVE_MONEY: Array<{
  model: string;
  type: PatientDeleteBlockerType;
  /** Por qué es invisible al recorrido genérico. */
  reason: string;
}> = [
  {
    model: "PlanPayment",
    type: "credit",
    reason: "cuelga de PaymentPlan (allowlist) por planId, sin patientId propio",
  },
];

/** Una relación de otro modelo hacia `Patient`, como la ve el DMMF. */
export interface PatientRelationModel {
  /** Nombre del modelo Prisma (PascalCase), p.ej. "OrthoTreatmentCard". */
  model: string;
  /** Acción referencial declarada en el schema. */
  onDelete: "Cascade" | "Restrict" | "SetNull" | "NoAction" | "SetDefault" | null;
  /**
   * ¿La relación es obligatoria? Decide el DEFAULT cuando no hay `onDelete`
   * declarado (requerida → Restrict, opcional → SetNull). Con `onDelete`
   * explícito no participa: Postgres lo ejecuta igual sobre una FK opcional.
   */
  required: boolean;
  /** ¿El modelo tiene columna `clinicId` propia para scopear el conteo? */
  hasClinicId: boolean;
}

/** Un modelo que impide el borrado, ya con su tipo de mensaje resuelto. */
export interface BlockingModel {
  model: string;
  type: PatientDeleteBlockerType;
  hasClinicId: boolean;
}

/**
 * ¿Esta relación puede destruir o impedir el borrado del paciente?
 *
 * El `onDelete` EXPLÍCITO manda, sea la FK opcional u obligatoria: Postgres no
 * mira la nullability para ejecutarlo. `Cascade` borra la fila hija;
 * `Restrict`/`NoAction` rechazan el DELETE del paciente mientras existan filas
 * — hay que contarlas para explicarlo en español y no reventar con un P2003.
 * (La versión anterior descartaba toda relación opcional ANTES de mirar
 * `onDelete`: una FK opcional con `Cascade` explícito escapaba de la política
 * y del candado de cobertura del test, o sea que nacería borrando en silencio
 * — justo lo que el criterio invertido promete impedir. Hoy el schema no
 * declara ninguna, así que este cambio no altera el conjunto destructivo
 * actual; cierra el schema de mañana.)
 *
 * Sin `onDelete` declarado, Prisma resuelve el default por opcionalidad:
 * requerida → Restrict (bloquea), opcional → SetNull (la fila sobrevive con
 * `patientId = null`: inocua). `SetNull`/`SetDefault` explícitos tampoco
 * destruyen nada.
 */
export function isDestructiveRelation(rel: PatientRelationModel): boolean {
  if (rel.onDelete === "Cascade" || rel.onDelete === "Restrict" || rel.onDelete === "NoAction") {
    return true;
  }
  if (rel.onDelete === null) return rel.required;
  return false;
}

/**
 * Reparte las relaciones en "puede cascadear" y "bloquea". Puro: recibe la lista
 * (del DMMF en producción, inventada en los tests) y no toca la BD.
 *
 * La regla de oro está en la última línea: lo que no está en `CASCADE_ALLOWED`
 * BLOQUEA. Un modelo desconocido no rompe nada — bloquea con el mensaje
 * genérico `related`, que es exactamente el fallo seguro que se busca.
 */
export function classifyPatientRelations(relations: PatientRelationModel[]): {
  allowed: string[];
  blocking: BlockingModel[];
} {
  const allowed: string[] = [];
  const blocking: BlockingModel[] = [];
  const seen = new Set<string>();

  for (const rel of relations) {
    if (!isDestructiveRelation(rel)) continue;
    if (HANDLED_SEPARATELY.has(rel.model)) continue;
    // Un modelo puede declarar más de una FK a Patient (p.ej. titular y
    // acompañante). Con contarlo una vez basta.
    if (seen.has(rel.model)) continue;
    seen.add(rel.model);

    if (Object.prototype.hasOwnProperty.call(CASCADE_ALLOWED, rel.model)) {
      allowed.push(rel.model);
      continue;
    }
    blocking.push({
      model: rel.model,
      type: BLOCKER_TYPE_BY_MODEL[rel.model] ?? "related",
      hasClinicId: rel.hasClinicId,
    });
  }

  return { allowed, blocking };
}

/**
 * Agrupa los conteos por tipo para el mensaje de la UI. Los tipos van en un
 * orden fijo (lo fiscal primero, lo clínico después) para que el modal no
 * baraile las razones entre una apertura y otra.
 */
const TYPE_ORDER: PatientDeleteBlockerType[] = [
  "invoices",
  "payments",
  "cfdi",
  "credit",
  "clinical",
  "endodontics",
  "implants",
  "specialty",
  "related",
];

export function summarizeBlockers(
  counted: Array<{ type: PatientDeleteBlockerType; count: number }>,
): PatientDeleteBlocker[] {
  const totals = new Map<PatientDeleteBlockerType, number>();
  for (const { type, count } of counted) {
    if (count <= 0) continue;
    totals.set(type, (totals.get(type) ?? 0) + count);
  }
  return TYPE_ORDER.filter((t) => totals.has(t)).map((type) => ({
    type,
    count: totals.get(type)!,
  }));
}
