/**
 * Movimientos del paciente — la parte PURA (sin Prisma, sin servidor): qué
 * categorías hay, cómo se cuenta cada fila de la bitácora en texto humano y
 * qué se le enseña a quien no tiene permiso de ver lo clínico o lo económico.
 *
 * La fuente única de los movimientos es `audit_logs`. Cada fila trae
 * `entityType` + `action` + `changes`; las escritas con
 * `registrarMovimientoDelPaciente` traen además `changes._mov.after.texto` con
 * la frase ya redactada. Las de antes (que no la traen) se redactan aquí a
 * partir de entidad + acción + NOMBRES de los campos tocados: nunca de sus
 * valores (un teléfono o un diagnóstico no salen en una lista de movimientos).
 */

export type CategoriaMovimiento = "citas" | "perfil" | "expediente" | "archivos" | "dinero" | "otros";

export const CATEGORIAS_MOVIMIENTO: readonly CategoriaMovimiento[] = [
  "citas",
  "perfil",
  "expediente",
  "archivos",
  "dinero",
  "otros",
];

/** Categoría de cada tipo de entidad de la bitácora. Lo que no está aquí es «otros». */
const CATEGORIA_POR_ENTIDAD: Record<string, CategoriaMovimiento> = {
  appointment: "citas",
  "agenda-block": "citas",
  "booking-request": "citas",
  waitlist: "citas",

  patient: "perfil",
  "patient-guardian": "perfil",
  "ped-guardian": "perfil",
  "patient-portal": "perfil",

  record: "expediente",
  consent: "expediente",
  prescription: "expediente",
  periodontal: "expediente",
  "body-map": "expediente",
  odontogram: "expediente",
  treatment: "expediente",
  referral: "expediente",
  questionnaire: "expediente",
  "ai-consult": "expediente",
  "xray-analysis": "expediente",
  "pediatric-record": "expediente",
  "ped-behavior": "expediente",
  "ped-cambra": "expediente",
  "ped-habit": "expediente",
  "ped-eruption": "expediente",
  "ped-sealant": "expediente",
  "ped-fluoride": "expediente",
  "ped-maintainer": "expediente",
  "ped-endodontic": "expediente",
  "ped-consent": "expediente",
  "orthodontic-case": "expediente",
  "orthodontic-plan": "expediente",
  "orthodontic-diagnosis": "expediente",
  "orthodontic-control": "expediente",
  "orthodontic-consent": "expediente",
  "orthodontic-photo": "archivos",
  "orthodontic-lab": "expediente",
  endodontic: "expediente",
  periodontics: "expediente",
  implant: "expediente",

  "patient-file": "archivos",
  photo: "archivos",
  "model-3d": "archivos",

  // Entidades con el nombre del modelo (los módulos clínicos las registran así).
  OrthodonticTreatmentPlan: "expediente",
  OrthodonticDiagnosis: "expediente",
  OrthodonticConsent: "expediente",
  OrthodonticDigitalRecord: "expediente",
  OrthodonticControlAppointment: "expediente",
  OrthodonticFacialAnalysis: "expediente",
  OrthodonticCephalometryAnalysis: "expediente",
  OrthodonticAligner: "expediente",
  OrthodonticAlignerEvent: "expediente",
  OrthodonticElasticsLog: "expediente",
  OrthoWireStep: "expediente",
  OrthoTAD: "expediente",
  OrthoTreatmentCard: "expediente",
  OrthoRetentionRegimen: "expediente",
  OrthoNpsSchedule: "expediente",
  OrthoReferralCode: "expediente",
  OrthoSignAtHomePackage: "expediente",
  LabOrder: "expediente",
  Referral: "expediente",
  OrthoPhotoSet: "archivos",
  OrthodonticMonitoringPhoto: "archivos",
  OrthoPaymentPlan: "dinero",
  OrthoInstallment: "dinero",
  OrthoQuoteScenario: "dinero",
  orthodontic_cobro: "dinero",

  invoice: "dinero",
  payment: "dinero",
  "payment-plan": "dinero",
  quote: "dinero",
  cfdi: "dinero",
  "orthodontic-payment": "dinero",
  "package-redemption": "dinero",
};

/** Entidades que nunca son un «movimiento» del paciente aunque lo mencionen. */
const ENTIDADES_QUE_NO_SON_MOVIMIENTO = ["upload-rejected"];
export const ENTIDADES_EXCLUIDAS: readonly string[] = ENTIDADES_QUE_NO_SON_MOVIMIENTO;

export function categoriaDeEntidad(entityType: string): CategoriaMovimiento {
  return CATEGORIA_POR_ENTIDAD[entityType] ?? "otros";
}

/**
 * Filas del propio paciente (`entityType='patient'`) que en realidad son de otra
 * cosa: el odontograma, el cuestionario de salud y las referencias se
 * registraron colgadas del paciente. Se reconocen por su acción o por la llave
 * que llevan en `changes`. Las filas nuevas dicen su categoría en
 * `changes._mov.after.categoria` y no dependen de esta lista.
 */
/**
 * Las acciones de los módulos clínicos llevan el módulo como prefijo
 * («ortho.paymentPlan.created», «perio.record.updated»): eso decide la categoría
 * antes que la entidad. El orden importa: la primera que coincide gana.
 */
export const REGLAS_CATEGORIA_POR_ACCION: ReadonlyArray<{ prefijos: readonly string[]; categoria: CategoriaMovimiento }> = [
  {
    prefijos: [
      "ortho.paymentPlan", "ortho.installment", "ortho.paymentStatus", "ortho.collect", "ortho.cfdi", "ortho.quoteScenario",
      // ws1-t8 (auditoría de ortodoncia): acciones de cobro y de plan financiero con nombre propio.
      "ortho.financialPlan", "abrir-plan-de-pago", "crear-plan-al-abrir-caso", "registrar-extra-cobrado",
      "cobrar-procedimiento-de-hoja", "registrar-promesa-de-pago", "resolver-promesa-de-pago", "cambiar-plan-de-pago",
      "elegir-descuento-del-caso",
    ],
    categoria: "dinero",
  },
  { prefijos: ["ortho.photoSet", "clinical-shared.photo", "monitoring_photo"], categoria: "archivos" },
  // Acciones de ortodoncia con nombre propio (sin el prefijo «ortho.»): alineadores, elásticos, análisis, controles.
  { prefijos: ["aligner_", "elastics_", "ceph_analysis", "facial_analysis", "mover-controles"], categoria: "expediente" },
  { prefijos: ["ortho.", "pediatrics.", "perio.", "endo.", "implant.", "clinical-shared."], categoria: "expediente" },
];

function categoriaPorPrefijoDeAccion(action: string): CategoriaMovimiento | null {
  for (const r of REGLAS_CATEGORIA_POR_ACCION) {
    if (r.prefijos.some((p) => action.indexOf(p) === 0)) return r.categoria;
  }
  return null;
}

/** Acciones que no son un cambio sino un documento generado o una lectura. */
export function esAccionQueNoEsMovimiento(action: string): boolean {
  // Un documento generado o descargado (PDF, exportación) no cambia nada del paciente.
  return action === "view" || /\.pdf$/.test(action) || /\.exported$/.test(action);
}

export const LLAVES_CLINICAS_EN_PACIENTE = ["_odontogram", "healthQuestionnaireId", "referralCreated"];
export const PREFIJO_ACCION_ODONTOGRAMA = "odontogram_";

function comoObjetoLocal(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function categoriaGuardada(changes: unknown): CategoriaMovimiento | null {
  const c = comoObjetoLocal(comoObjetoLocal(comoObjetoLocal(changes)?._mov)?.after)?.categoria;
  return typeof c === "string" && (CATEGORIAS_MOVIMIENTO as readonly string[]).indexOf(c) !== -1
    ? (c as CategoriaMovimiento)
    : null;
}

/** La categoría de UNA fila: la que dice ella misma, o la que se deduce de entidad / acción / llaves. */
export function clasificarFila(fila: FilaParaRedactar): CategoriaMovimiento {
  const propia = categoriaGuardada(fila.changes);
  if (propia) return propia;
  if (fila.entityType === "patient") {
    if (fila.action.indexOf(PREFIJO_ACCION_ODONTOGRAMA) === 0) return "expediente";
    const c = comoObjetoLocal(fila.changes);
    if (c && LLAVES_CLINICAS_EN_PACIENTE.some((k) => k in c)) return "expediente";
  }
  return categoriaPorPrefijoDeAccion(fila.action) ?? categoriaDeEntidad(fila.entityType);
}

/** Los entityType que caen en una categoría (para filtrar en SQL). */
export function entidadesDeCategoria(cat: CategoriaMovimiento): string[] {
  return Object.keys(CATEGORIA_POR_ENTIDAD).filter((k) => CATEGORIA_POR_ENTIDAD[k] === cat);
}

export function entidadesConocidas(): string[] {
  return Object.keys(CATEGORIA_POR_ENTIDAD);
}

/** ¿Es una entidad que pertenece a un paciente? (sirve para deducir el paciente de una fila.) */
export function esEntidadDePaciente(entityType: string): boolean {
  return entityType in CATEGORIA_POR_ENTIDAD;
}

// ───────────────────────────── Permisos ─────────────────────────────

export interface PermisosDeVista {
  /** «medicalRecord.view» — expediente, archivos clínicos, ortodoncia. */
  verClinico: boolean;
  /** «billing.view» — facturas, pagos, anticipos, presupuestos. */
  verDinero: boolean;
}

export const TEXTO_EXPEDIENTE_OCULTO = "Se actualizó el expediente";
export const TEXTO_DINERO_OCULTO = "Se actualizó la facturación";

export function esClinica(cat: CategoriaMovimiento): boolean {
  return cat === "expediente" || cat === "archivos";
}

/**
 * Lo que ve quien no puede ver el detalle: solo que se tocó el expediente (o la
 * facturación). Sin el qué. La fecha y quién lo hizo sí se conservan: eso no es
 * dato clínico y es justo lo que un auditor necesita.
 */
export function aplicarPermisos(
  cat: CategoriaMovimiento,
  texto: string,
  permisos: PermisosDeVista,
): { categoria: CategoriaMovimiento; texto: string; oculto: boolean } {
  if (esClinica(cat) && !permisos.verClinico) {
    return { categoria: "expediente", texto: TEXTO_EXPEDIENTE_OCULTO, oculto: true };
  }
  if (cat === "dinero" && !permisos.verDinero) {
    return { categoria: "dinero", texto: TEXTO_DINERO_OCULTO, oculto: true };
  }
  return { categoria: cat, texto, oculto: false };
}

// ───────────────────────────── Redacción ─────────────────────────────

/** Etiquetas en español de los campos que más se tocan. Lo que no esté aquí no se nombra. */
const ETIQUETA_CAMPO: Record<string, string> = {
  firstName: "nombre",
  lastName: "apellidos",
  secondLastName: "segundo apellido",
  phone: "teléfono",
  phone2: "teléfono 2",
  whatsapp: "WhatsApp",
  email: "correo",
  birthDate: "fecha de nacimiento",
  dateOfBirth: "fecha de nacimiento",
  gender: "sexo",
  sex: "sexo",
  curp: "CURP",
  rfc: "RFC",
  address: "domicilio",
  street: "calle",
  city: "ciudad",
  state: "estado",
  zipCode: "código postal",
  postalCode: "código postal",
  occupation: "ocupación",
  civilStatus: "estado civil",
  bloodType: "tipo de sangre",
  allergies: "alergias",
  medicalConditions: "antecedentes médicos",
  medications: "medicamentos",
  notes: "notas",
  status: "estado",
  doctorId: "doctor",
  assignedDoctorId: "doctor",
  branchId: "sede",
  clinicId: "sede",
  emergencyContactName: "contacto de emergencia",
  emergencyContactPhone: "teléfono de emergencia",
  insurance: "seguro",
  insuranceNumber: "número de seguro",
  referredBy: "cómo llegó",
  source: "cómo llegó",
  photoUrl: "foto de perfil",
  avatarUrl: "foto de perfil",
  archived: "archivado",
  isActive: "activo",
  startTime: "hora de inicio",
  endTime: "hora de fin",
  date: "fecha",
  startsAt: "hora de inicio",
  endsAt: "hora de fin",
  reason: "motivo",
  type: "tipo",
  duration: "duración",
  resourceId: "sillón",
  total: "total",
  totalCost: "costo total",
  amount: "monto",
  discount: "descuento",
  paymentMethod: "forma de pago",
  method: "forma de pago",
  name: "nombre",
  description: "descripción",
  // Patient (nombres reales de prisma/schema.prisma)
  dob: "fecha de nacimiento",
  insuranceProvider: "aseguradora",
  insurancePolicy: "póliza",
  primaryDoctorId: "doctor tratante",
  passportNo: "pasaporte",
  familyHistory: "antecedentes familiares",
  personalNonPathologicalHistory: "antecedentes personales",
  emergencyContactRelation: "parentesco del contacto de emergencia",
  rfcPaciente: "RFC",
  regimenFiscalPac: "régimen fiscal",
  cpPaciente: "código postal fiscal",
  razonSocialPac: "razón social",
  curpStatus: "estado de la CURP",
  lifecycleStage: "etapa del paciente",
  isChild: "menor de edad",
  chronicConditions: "padecimientos crónicos",
  currentMedications: "medicamentos",
};

/** Campos internos del sistema: cambian solos y no cuentan como «un dato que cambió». */
const CAMPOS_DEL_SISTEMA = [
  "portalToken",
  "portalTokenExpiry",
  "lastBirthdayMsgAt",
  "deletedAt",
  "anonymizedAt",
  "cancelledFutureAppointments",
  "hardDelete",
  "archived",
];

const MAX_CAMPOS_EN_TEXTO = 4;

/** «teléfono, correo y 2 datos más». Solo nombra los campos conocidos; los demás se cuentan. */
export function nombrarCampos(campos: readonly string[]): string {
  const vistos: string[] = [];
  let desconocidos = 0;
  for (const c of campos) {
    if (c.startsWith("_") || CAMPOS_DEL_SISTEMA.indexOf(c) !== -1) continue;
    const et = ETIQUETA_CAMPO[c];
    if (!et) {
      desconocidos++;
      continue;
    }
    if (vistos.indexOf(et) === -1) vistos.push(et);
  }
  const nombrados = vistos.slice(0, MAX_CAMPOS_EN_TEXTO);
  const resto = vistos.length - nombrados.length + desconocidos;
  const partes = nombrados.slice();
  if (resto > 0) partes.push(resto === 1 ? "1 dato más" : `${resto} datos más`);
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0]!;
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

interface Plantilla {
  create: string;
  update: string;
  delete: string;
}

const P = (create: string, update: string, del: string): Plantilla => ({ create, update, delete: del });

/** Cómo se cuenta cada entidad: [crear, actualizar, borrar]. */
const PLANTILLA: Record<string, Plantilla> = {
  appointment: P("Agendó una cita", "Modificó una cita", "Eliminó una cita"),
  "agenda-block": P("Bloqueó un horario de la agenda", "Cambió un bloqueo de la agenda", "Quitó un bloqueo de la agenda"),
  patient: P("Creó el perfil del paciente", "Actualizó los datos del paciente", "Eliminó al paciente"),
  "patient-guardian": P("Agregó un responsable o tutor", "Actualizó un responsable o tutor", "Quitó un responsable o tutor"),
  "ped-guardian": P("Agregó un responsable o tutor", "Actualizó un responsable o tutor", "Quitó un responsable o tutor"),
  record: P("Creó una nota de consulta", "Editó una nota de consulta", "Eliminó una nota de consulta"),
  consent: P("Generó un consentimiento", "Actualizó un consentimiento", "Eliminó un consentimiento"),
  prescription: P("Emitió una receta", "Actualizó una receta", "Eliminó una receta"),
  periodontal: P("Registró un periodontograma", "Actualizó un periodontograma", "Eliminó un periodontograma"),
  "body-map": P("Marcó el mapa corporal", "Actualizó el mapa corporal", "Quitó una marca del mapa corporal"),
  odontogram: P("Registró el odontograma", "Actualizó el odontograma", "Reinició el odontograma"),
  treatment: P("Abrió un plan de tratamiento", "Actualizó un plan de tratamiento", "Eliminó un plan de tratamiento"),
  referral: P("Creó una referencia", "Actualizó una referencia", "Eliminó una referencia"),
  "xray-analysis": P("Analizó una radiografía", "Actualizó el análisis de una radiografía", "Eliminó un análisis de radiografía"),
  "patient-file": P("Subió un archivo", "Actualizó un archivo", "Quitó un archivo"),
  photo: P("Subió una foto", "Actualizó una foto", "Quitó una foto"),
  "model-3d": P("Subió un modelo 3D", "Actualizó un modelo 3D", "Quitó un modelo 3D"),
  invoice: P("Creó una factura", "Actualizó una factura", "Eliminó una factura"),
  payment: P("Registró un pago", "Actualizó un pago", "Eliminó un pago"),
  "payment-plan": P("Creó un plan de pagos", "Actualizó un plan de pagos", "Eliminó un plan de pagos"),
  quote: P("Creó un presupuesto", "Actualizó un presupuesto", "Eliminó un presupuesto"),
  cfdi: P("Timbró un CFDI", "Actualizó un CFDI", "Canceló un CFDI"),
  "orthodontic-case": P("Abrió un caso de ortodoncia", "Actualizó el caso de ortodoncia", "Eliminó un caso de ortodoncia"),
  "orthodontic-plan": P("Creó el plan de ortodoncia", "Actualizó el plan de ortodoncia", "Eliminó el plan de ortodoncia"),
  "orthodontic-diagnosis": P("Registró el diagnóstico de ortodoncia", "Actualizó el diagnóstico de ortodoncia", "Eliminó el diagnóstico de ortodoncia"),
  "orthodontic-control": P("Registró un control de ortodoncia", "Actualizó un control de ortodoncia", "Eliminó un control de ortodoncia"),
  "orthodontic-consent": P("Generó un consentimiento de ortodoncia", "Actualizó un consentimiento de ortodoncia", "Eliminó un consentimiento de ortodoncia"),
  "orthodontic-photo": P("Subió una foto de ortodoncia", "Actualizó una foto de ortodoncia", "Quitó una foto de ortodoncia"),
  "package-redemption": P("Activó un paquete de servicios", "Usó una sesión de un paquete", "Quitó un paquete de servicios"),
  "orthodontic-payment": P("Registró un pago de ortodoncia", "Actualizó un pago de ortodoncia", "Eliminó un pago de ortodoncia"),
};

const VERBOS_ESPECIALES: Record<string, string> = {
  void: "Anuló",
  soft_delete: "Quitó",
  archive: "Archivó",
  approve: "Aprobó",
  reject: "Rechazó",
  send: "Envió",
};

const SUSTANTIVO_GENERICO: Record<string, string> = {
  appointment: "una cita",
  record: "una nota de consulta",
  consent: "un consentimiento",
  prescription: "una receta",
  invoice: "una factura",
  "payment-plan": "un plan de pagos",
  quote: "un presupuesto",
  "patient-file": "un archivo",
  patient: "los datos del paciente",
  treatment: "un plan de tratamiento",
};

/** Lo mínimo de una fila de la bitácora que hace falta para redactarla. */
export interface FilaParaRedactar {
  entityType: string;
  action: string;
  changes: unknown;
}

function comoObjeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** La frase guardada por `registrarMovimientoDelPaciente`, si la fila la trae. */
export function textoGuardado(changes: unknown): string | null {
  const mov = comoObjeto(comoObjeto(changes)?._mov);
  const after = comoObjeto(mov?.after);
  const t = after?.texto;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/** Nombres de los campos tocados (sin los `_algo` de metadatos). */
export function camposDeCambio(changes: unknown): string[] {
  const c = comoObjeto(changes);
  if (!c) return [];
  return Object.keys(c).filter((k) => !k.startsWith("_"));
}

const TEXTO_ODONTOGRAMA: Record<string, string> = {
  odontogram_write: "Registró un hallazgo en el odontograma",
  odontogram_delete: "Quitó un hallazgo del odontograma",
  odontogram_sync: "Guardó el odontograma completo",
  odontogram_reset: "Reinició el odontograma",
};

const TEXTO_POR_ACCION: Record<string, string> = {
  "ortho.diagnosis.created": "Registró el diagnóstico de ortodoncia",
  "ortho.diagnosis.updated": "Actualizó el diagnóstico de ortodoncia",
  "ortho.treatmentPlan.created": "Creó el plan de tratamiento de ortodoncia",
  "ortho.treatmentPlan.updated": "Actualizó el plan de tratamiento de ortodoncia",
  "ortho.treatmentPlan.statusChanged": "Cambió el estado del caso de ortodoncia",
  "ortho.phase.advanced": "Avanzó la fase del tratamiento de ortodoncia",
  "ortho.paymentPlan.created": "Creó el plan de pagos de ortodoncia",
  "ortho.installment.paid": "Registró el pago de una mensualidad de ortodoncia",
  "ortho.installment.waived": "Condonó una mensualidad de ortodoncia",
  "ortho.paymentStatus.recalculated": "Recalculó el estado de pagos de ortodoncia",
  "ortho.photoSet.created": "Creó un juego de fotos de ortodoncia",
  "ortho.photoSet.photoUploaded": "Subió una foto de ortodoncia",
  "ortho.photoSet.photoRemoved": "Quitó una foto de ortodoncia",
  "ortho.photoSet.extraAdded": "Subió una foto extra de ortodoncia",
  "ortho.photoSet.extraRemoved": "Quitó una foto extra de ortodoncia",
  "ortho.control.created": "Agendó un control de ortodoncia",
  "ortho.digitalRecord.linked": "Vinculó un registro digital de ortodoncia",
  "ortho.consent.signed": "Registró un consentimiento de ortodoncia",
  "ortho.wireStep.added": "Agregó un paso de arco",
  "ortho.wireStep.updated": "Actualizó un paso de arco",
  "ortho.tad.created": "Registró un microtornillo (TAD)",
  "ortho.card.draftSaved": "Guardó un borrador de la hoja de control",
  "ortho.card.signed": "Firmó la hoja de control",
  "ortho.quoteScenario.selected": "Eligió o actualizó un escenario de presupuesto de ortodoncia",
  "ortho.signAtHome.sent": "Envió el paquete para firmar en casa",
  "ortho.collect.recorded": "Registró un cobro de ortodoncia",
  "ortho.cfdi.timbrado.requested": "Pidió timbrar el CFDI de ortodoncia",
  "ortho.retention.preSurvey.toggled": "Cambió la encuesta previa de retención",
  "ortho.retention.regimen.configured": "Configuró el régimen de retención",
  "ortho.retention.checkups.scheduled": "Programó las revisiones de retención",
  "ortho.nps.scheduled": "Programó la encuesta de satisfacción",
  "ortho.nps.response.recorded": "Registró la respuesta de la encuesta de satisfacción",
  "ortho.googleReview.triggered": "Pidió una reseña de Google",
  "ortho.referralCode.created": "Creó un código de referidos",
  "ortho.labOrder.created": "Creó una orden de laboratorio de ortodoncia",
  "ortho.g15.checkpoint.scheduled": "Programó el chequeo del mes 15",
  "clinical-shared.photo.uploaded": "Subió una foto clínica",
  "clinical-shared.photo.deleted": "Quitó una foto clínica",
  "clinical-shared.photo.annotated": "Anotó una foto clínica",
  "clinical-shared.lab-order.created": "Creó una orden de laboratorio",
  "clinical-shared.lab-order.status": "Cambió el estado de una orden de laboratorio",
  "clinical-shared.referral.created": "Creó una carta de referencia",
  "clinical-shared.referral.sent": "Envió una carta de referencia",
  "clinical-shared.share-link.created": "Creó un enlace para compartir el expediente",
  "clinical-shared.share-link.revoked": "Revocó un enlace para compartir el expediente",
  "clinical-shared.reminder.created": "Creó un recordatorio clínico",
  "clinical-shared.reminder.cancelled": "Canceló un recordatorio clínico",
  "clinical-shared.treatment-link.created": "Vinculó un tratamiento",
  // ws1-t8 (auditoría de ortodoncia): acciones con nombre propio que caían en «Registró un cambio en ortodoncia».
  "ortho.bolton.saved": "Guardó el análisis de Bolton",
  "ortho.referralLetter.created": "Creó una carta de referencia de ortodoncia",
  "ortho.financialPlan.updated": "Actualizó el plan financiero de ortodoncia",
  "ortho.elastics.compliance.recorded": "Registró el uso de elásticos",
  "aligner_case_upserted": "Guardó el caso de alineadores",
  "aligner_event_logged": "Registró un evento del tratamiento con alineadores",
  "elastics_log_manual": "Registró el uso de elásticos del paciente",
  "monitoring_photo_reviewed": "Revisó una foto de monitoreo",
  "facial_analysis_saved": "Guardó el análisis facial",
  "ceph_analysis_created": "Registró un análisis cefalométrico",
  "ceph_analysis_updated": "Actualizó un análisis cefalométrico",
  "mover-controles-al-doctor-tratante": "Movió los controles futuros al doctor tratante",
  "abrir-plan-de-pago": "Abrió el plan de pago de ortodoncia",
  "abrir-plan-de-pago-duplicado": "Intentó abrir un plan de pago de ortodoncia que ya existía",
  "crear-plan-al-abrir-caso": "Armó el plan de pago al abrir el caso de ortodoncia",
  "registrar-extra-cobrado": "Cobró un extra de ortodoncia",
  "cobrar-procedimiento-de-hoja": "Cobró un procedimiento de la visita de ortodoncia",
  "registrar-promesa-de-pago": "Registró una promesa de pago de ortodoncia",
  "resolver-promesa-de-pago": "Resolvió una promesa de pago de ortodoncia",
  "cambiar-plan-de-pago": "Cambió las condiciones de pago de ortodoncia",
  "elegir-descuento-del-caso": "Eligió el descuento del caso de ortodoncia",
};

const MODULO_POR_PREFIJO: ReadonlyArray<[string, string]> = [
  ["ortho.", "ortodoncia"],
  ["pediatrics.", "pediatría"],
  ["perio.", "periodoncia"],
  ["endo.", "endodoncia"],
  ["implant.", "implantes"],
  ["clinical-shared.", "el expediente"],
];

const VERBO_FINAL: Record<string, string> = {
  created: "Registró",
  updated: "Actualizó",
  deleted: "Eliminó",
  signed: "Firmó",
  finalized: "Finalizó",
  recorded: "Registró",
  started: "Inició",
  added: "Agregó",
  removed: "Quitó",
  linked: "Vinculó",
  scheduled: "Programó",
  sent: "Envió",
};

/** Acciones de módulo sin frase propia: «Registró un cambio en ortodoncia». */
function redactarAccionDeModulo(action: string): string | null {
  const propia = TEXTO_POR_ACCION[action];
  if (propia) return propia;
  const modulo = MODULO_POR_PREFIJO.filter(([p]) => action.indexOf(p) === 0)[0];
  if (!modulo) return null;
  const verbo = VERBO_FINAL[action.split(".").pop() ?? ""];
  return verbo ? `${verbo} un dato en ${modulo[1]}` : `Registró un cambio en ${modulo[1]}`;
}

/** Filas del paciente que dicen otra cosa (odontograma, cuestionario, referencia, invitación al portal). */
function redactarEspecial(fila: FilaParaRedactar): string | null {
  if (fila.entityType !== "patient") return null;
  const propio = TEXTO_ODONTOGRAMA[fila.action];
  if (propio) return propio;
  const c = comoObjeto(fila.changes);
  if (!c) return null;
  if ("healthQuestionnaireId" in c) return "Llenó el cuestionario de salud";
  if ("referralCreated" in c) return "Creó una referencia";
  if ("portalInvite" in c) return "Invitó al paciente a su portal";
  return null;
}

/**
 * La frase de una fila. Si la fila trae su propia frase, esa; si no, se arma de
 * entidad + acción + nombres de campos. Nunca incluye valores.
 */
export function redactarMovimiento(fila: FilaParaRedactar): string {
  const propia = textoGuardado(fila.changes);
  if (propia) return propia;

  const especial = redactarEspecial(fila);
  if (especial) return especial;
  const deModulo = redactarAccionDeModulo(fila.action);
  if (deModulo) return deModulo;

  const pl = PLANTILLA[fila.entityType];
  const campos = camposDeCambio(fila.changes);

  if (fila.action === "create") return pl?.create ?? "Registró información";
  if (fila.action === "delete") return pl?.delete ?? "Eliminó información";
  if (fila.action === "update") {
    const base = pl?.update ?? "Actualizó información";
    const lista = nombrarCampos(campos);
    return lista ? `${base}: ${lista}` : base;
  }
  const verbo = VERBOS_ESPECIALES[fila.action];
  if (verbo) return `${verbo} ${SUSTANTIVO_GENERICO[fila.entityType] ?? "un registro"}`;
  // Acciones propias de un módulo (p. ej. las pediátricas): se dicen como «Registró un cambio».
  return pl?.update ?? "Registró un cambio";
}

// ───────────────────────────── Pertenencia legada ─────────────────────────────

/**
 * Filas viejas sin `patientId`: el paciente se deduce de la tabla de su entidad.
 * Solo las tablas cuya columna `patientId` está verificada en el esquema. Una
 * entidad ya borrada no se puede deducir y no se inventa.
 */
export const ENTIDADES_DEDUCIBLES: ReadonlyArray<{ entityType: string; tabla: string }> = [
  { entityType: "appointment", tabla: "appointments" },
  { entityType: "invoice", tabla: "invoices" },
  { entityType: "record", tabla: "medical_records" },
  { entityType: "prescription", tabla: "prescriptions" },
  { entityType: "quote", tabla: "quotes" },
  { entityType: "patient-file", tabla: "patient_files" },
  { entityType: "payment-plan", tabla: "payment_plans" },
  { entityType: "treatment", tabla: "treatment_plans" },
  { entityType: "consent", tabla: "consent_forms" },
  { entityType: "periodontal", tabla: "periodontal_records" },
  { entityType: "body-map", tabla: "body_map_annotations" },
];

/**
 * El paciente al que pertenece una fila que se está por escribir, si se puede
 * saber sin consultar: es el propio paciente, o el cambio lleva `patientId`
 * (los `logMutation` de creación lo llevan casi todos en `after`).
 */
export function patientIdEnCambios(changes: unknown): string | null {
  const c = comoObjeto(changes);
  if (!c) return null;
  const candidatos: unknown[] = [
    comoObjeto(comoObjeto(c._created)?.after)?.patientId,
    comoObjeto(comoObjeto(c._deleted)?.before)?.patientId,
    comoObjeto(comoObjeto(c._deleted)?.after)?.patientId,
    comoObjeto(c.patientId)?.after,
    comoObjeto(c.patientId)?.before,
    comoObjeto(comoObjeto(c._mov)?.after)?.patientId,
    comoObjeto(c._meta)?.patientId,
  ];
  for (const v of candidatos) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export function deducirPatientId(args: {
  entityType: string;
  entityId: string;
  changes?: unknown;
}): string | null {
  if (args.entityType === "patient") return args.entityId || null;
  if (!esEntidadDePaciente(args.entityType)) return null;
  return patientIdEnCambios(args.changes);
}

// ───────────────────────────── Actores externos ─────────────────────────────

/** Quién no es del equipo pero deja movimientos: `audit_logs.actorType`. */
export type ActorExterno = "patient" | "public" | "bot";

export const ETIQUETA_ACTOR_EXTERNO: Record<ActorExterno, string> = {
  patient: "El paciente (portal)",
  public: "Reserva web",
  bot: "Bot de WhatsApp",
};

export function esActorExterno(actorType: string | null | undefined): actorType is ActorExterno {
  return actorType === "patient" || actorType === "public" || actorType === "bot";
}

/**
 * Cómo se llama quien hizo el movimiento cuando no es del equipo. Una fila puede
 * precisar el origen en `changes._mov.after.actor` («El paciente (firma en
 * línea)»); si no, la etiqueta de su tipo.
 */
export function etiquetaDeActorExterno(actorType: ActorExterno, changes: unknown): string {
  const propia = comoObjeto(comoObjeto(comoObjeto(changes)?._mov)?.after)?.actor;
  return typeof propia === "string" && propia.trim() ? propia.trim().slice(0, 60) : ETIQUETA_ACTOR_EXTERNO[actorType];
}
