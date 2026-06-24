// ═══════════════════════════════════════════════════════════════════════════
// CONTRATO DEL PORTAL DEL PACIENTE (cuentas reales) — PUBLICADO Y FIJO.
// Otra terminal consume este contrato tal cual: NO renombrar cookie, rutas,
// ni shapes sin coordinar.
//
//   · Cookie de sesión: httpOnly, nombre EXACTO `patient_session`.
//   · GET /api/paciente/me            → 200 PacienteMe | 401
//   · POST /api/paciente/register     → 200 { ok, email } | 400 | 409 | 429
//   · POST /api/paciente/verify       → 200 { ok } + Set-Cookie (auto-login +
//                                        auto-link por email) | 400 | 429
//   · POST /api/paciente/verify/resend→ 200 { ok } siempre | 429
//   · POST /api/paciente/login        → 200 { ok } + Set-Cookie | 401
//                                      | 403 { error, needsVerification: true } | 429
//   · POST /api/paciente/logout       → 200 { ok } + clear cookie
//   · POST /api/paciente/password/forgot → 200 { ok } siempre (sin enumeración) | 429
//   · POST /api/paciente/password/reset  → 200 { ok } | 400
//   · GET  /api/paciente/profile      → 200 PacientePerfil | 401
//   · PATCH /api/paciente/profile     → 200 { ok } | 400 | 401
//   · GET  /api/paciente/summary      → 200 PacienteSummaryResponse | 401
//   · GET  /api/paciente/appointments → 200 PacienteCitasResponse | 401
//   · GET  /api/paciente/appointments/[id]/slots?date=YYYY-MM-DD (WS1-T5)
//                                     → 200 { date, timezone, durationMin,
//                                        slots: "HH:mm"[] } | 400 | 401 | 404 | 422
//   · POST /api/paciente/appointments/[id]/change-request (WS1-T5)
//                                     → 200 { ok, autoApproved, status } | 400
//                                       | 401 | 404 | 409 | 422
//   · GET  /api/paciente/history      → 200 PacienteHistorialResponse | 401
//   · GET  /api/paciente/payments     → 200 PacientePagosResponse | 401
//   · POST /api/paciente/payments/checkout → 200 { url } | 400 | 401 | 404 | 409 | 429
//   · GET  /api/paciente/invoices/[id]/receipt → 200 PDF | 400 | 401 | 404
//
//   Documentos (WS1-T6, aditivo):
//   · GET  /api/paciente/documentos   → 200 PacienteDocumentosResponse | 401
//   · GET  /api/paciente/documentos/descargar?tipo=consentimiento&id=<id>
//       → 200 { url } (signed URL TTL 300s generada server-side TRAS validar
//         el vínculo; NUNCA paths del bucket) | 400 | 401 | 404
//   · GET  /api/paciente/recetas      → 200 PacienteRecetasResponse | 401
//   · GET  /api/paciente/recetas/[id]/pdf → 200 PDF (ownership por links) | 401 | 404
//   · GET  /api/paciente/recibos/[id]/pdf → 200 PDF (ownership por links) | 401 | 404
//
//   · /paciente/login y /paciente/registro aceptan ?next=<ruta interna> para
//     volver a donde estaba (solo rutas que empiecen con "/" — nunca URLs
//     absolutas, evita open redirect).
//
// REGLAS DE VISIBILIDAD PACIENTE-SAFE (mismas del portal por token, auditadas):
//   · MedicalRecord: SOLO id, visitDate y nombre del doctor. NUNCA subjective/
//     objective/assessment/plan/diagnoses/vitals/specialtyData/isPrivate.
//     Las consultas NO son SOAP: al paciente solo se le muestra que hubo visita.
//   · Patient: NUNCA notes internas, curp, rfc, portalToken, tokens de
//     telemedicina ni campos del doctor.
//   · Appointment: id, type, status, startsAt, endsAt, doctor (nombre) — nada más.
//   · Invoice: id, invoiceNumber, status, total, paid, balance, createdAt,
//     dueDate, paidAt. NUNCA items (pueden traer notas internas) ni notes.
//   · TreatmentPlan: name, status, fechas y progreso de sesiones. NUNCA
//     description ni notas de sesiones.
//   · Odontograma: SOLO conteos agregados (sin notas por diente).
//   · Payment (recibo): id, amount, method, paidAt + invoiceNumber/clinicId de
//     su factura. NUNCA notes ni reference (internos de la clínica).
//   · ConsentForm: SOLO firmados (signedAt != null): procedure, content,
//     signedAt y la firma del propio paciente vía signed URL on-demand.
//     NUNCA token de firma, expiresAt del link, ni paths del bucket.
//
// Multi-tenant estricto: toda query del panel filtra por los patientId de
// PatientAccountLink de la sesión (y clinicId del propio link). Jamás aceptar
// patientId/clinicId del cliente sin validar que pertenece a la cuenta.
// ═══════════════════════════════════════════════════════════════════════════

export const PATIENT_SESSION_COOKIE = "patient_session";
export const PATIENT_SESSION_DAYS = 30;
export const VERIFY_CODE_TTL_MIN = 15;
export const VERIFY_MAX_ATTEMPTS = 5;
export const RESET_TOKEN_TTL_MIN = 60;

// ── Auth ────────────────────────────────────────────────────────────────────

/** Respuesta de GET /api/paciente/me (contrato FIJO). */
export interface PacienteMe {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

/** Contexto de sesión que devuelve el guard server-side. */
export interface PatientPortalContext {
  account: PacienteMe;
  /** Vínculos cuenta ↔ expediente. Fuente de verdad del multi-tenant. */
  links: { patientId: string; clinicId: string }[];
}

export interface RegisterBody {
  name: string;
  email: string;
  phone: string;
  password: string; // mínimo 8 caracteres
}

export interface VerifyBody {
  email: string;
  code: string; // 6 dígitos
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface ForgotPasswordBody {
  email: string;
}

export interface ResetPasswordBody {
  token: string;
  password: string; // mínimo 8 caracteres
}

export interface UpdateProfileBody {
  name?: string;
  phone?: string;
  /** Para cambiar contraseña deben venir ambos. */
  currentPassword?: string;
  newPassword?: string;
}

// ── Datos del panel ─────────────────────────────────────────────────────────

/** Una clínica donde la cuenta tiene expediente vinculado. */
export interface PacienteClinica {
  clinicId: string;
  clinicName: string;
  clinicSlug: string;
  logoUrl: string | null;
  city: string | null;
  phone: string | null;
  patientId: string;
  patientNumber: string;
  /** true si la clínica acepta pago en línea desde el portal (WS1-T4). */
  onlinePaymentEnabled?: boolean;
}

/** Solicitud de cambio PENDING de una cita (reagendar/cancelar, WS1-T5). */
export interface PacienteCambioPendiente {
  id: string;
  type: "RESCHEDULE" | "CANCEL";
  proposedStartsAt: string | null;
  createdAt: string;
}

/** Política de cambios de citas por clínica (ventana mínima + auto-aprobación). */
export interface PacientePoliticaCambios {
  clinicId: string;
  minHours: number;
  autoApprove: boolean;
}

export interface PacienteCita {
  id: string;
  clinicId: string;
  type: string;
  /** AppointmentStatus como string: PENDING|SCHEDULED|CONFIRMED|CHECKED_IN|IN_CHAIR|IN_PROGRESS|COMPLETED|CHECKED_OUT|CANCELLED|NO_SHOW */
  status: string;
  startsAt: string; // ISO UTC
  endsAt: string; // ISO UTC
  doctorName: string;
  /**
   * Solicitud de cambio PENDING de esta cita, o null. Solo la puebla
   * /api/paciente/appointments en `upcoming`; otros endpoints (summary) la omiten.
   */
  pendingChange?: PacienteCambioPendiente | null;
}

/** Consulta paciente-safe: solo que hubo visita y con quién. CERO SOAP. */
export interface PacienteConsulta {
  id: string;
  clinicId: string;
  visitDate: string; // ISO
  doctorName: string;
}

export interface PacienteTratamiento {
  id: string;
  clinicId: string;
  name: string;
  /** TreatmentStatus como string: ACTIVE|COMPLETED|ABANDONED|PAUSED */
  status: string;
  startDate: string; // ISO
  endDate: string | null;
  totalSessions: number;
  sessionsDone: number;
}

/** Resumen agregado del odontograma por clínica (solo conteos, sin notas). */
export interface PacienteOdontoResumen {
  clinicId: string;
  /** Dientes distintos con al menos un hallazgo registrado. */
  teethWithFindings: number;
  /** Total de hallazgos registrados (excluye notas "__note__"). */
  totalFindings: number;
  updatedAt: string | null; // ISO del hallazgo más reciente
}

export interface PacienteFactura {
  id: string;
  clinicId: string;
  invoiceNumber: string;
  /** InvoiceStatus como string: DRAFT|PENDING|PARTIAL|PAID|OVERDUE|CANCELLED */
  status: string;
  total: number; // MXN
  paid: number; // MXN
  balance: number; // MXN
  createdAt: string; // ISO
  dueDate: string | null;
  paidAt: string | null;
}

// ── Shapes de respuesta por endpoint ────────────────────────────────────────

export interface PacienteSummaryResponse {
  me: PacienteMe;
  clinics: PacienteClinica[];
  /** Próximas 5 citas (startsAt >= ahora, status no cancelado/no-show), ascendente. */
  upcoming: PacienteCita[];
  /** Saldo pendiente (suma de Invoice.balance con status PENDING|PARTIAL|OVERDUE) por clínica. */
  pendingByClinic: { clinicId: string; amount: number }[];
  pendingTotal: number; // MXN
}

export interface PacienteCitasResponse {
  clinics: PacienteClinica[];
  /** startsAt >= ahora, ascendente. Incluye PENDING/SCHEDULED/CONFIRMED. */
  upcoming: PacienteCita[];
  /** startsAt < ahora o canceladas, descendente, máx 100. */
  past: PacienteCita[];
  /** Política de cambios por clínica de los links (WS1-T5). */
  policies: PacientePoliticaCambios[];
}

export interface PacienteHistorialResponse {
  clinics: PacienteClinica[];
  consultas: PacienteConsulta[]; // desc por visitDate, máx 100
  tratamientos: PacienteTratamiento[]; // desc por startDate
  odontograma: PacienteOdontoResumen[]; // una entrada por clínica con datos
}

export interface PacientePagosResponse {
  clinics: PacienteClinica[];
  invoices: PacienteFactura[]; // desc por createdAt, máx 200, sin DRAFT
  totals: { paidTotal: number; pendingTotal: number }; // MXN global
  byClinic: { clinicId: string; paid: number; pending: number }[];
}

export interface PacientePerfil {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string; // ISO
  clinics: PacienteClinica[];
}

// ── Documentos (WS1-T6) ─────────────────────────────────────────────────────

/** Consentimiento firmado paciente-safe (espejo del portal por token). */
export interface PacienteConsentimiento {
  id: string;
  clinicId: string;
  /** Procedimiento del consentimiento (ej. "Extracción simple"). */
  procedure: string;
  /** Texto que el paciente leyó y aceptó al firmar. */
  content: string;
  signedAt: string; // ISO
  /** true si hay firma descargable vía /api/paciente/documentos/descargar. */
  hasFirma: boolean;
}

/** Pago individual paciente-safe. NUNCA notes ni reference. */
export interface PacienteRecibo {
  id: string; // Payment.id
  clinicId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number; // MXN
  method: string; // crudo de DB; la UI lo mapea a español
  paidAt: string; // ISO
}

export interface PacienteDocumentosResponse {
  clinics: PacienteClinica[];
  consentimientos: PacienteConsentimiento[]; // desc por signedAt, máx 100
  recibos: PacienteRecibo[]; // desc por paidAt, máx 200
}

/** Medicamento de una receta (shape de GET /api/paciente/recetas). */
export interface PacienteRecetaMed {
  id: string;
  nombre: string;
  presentacion: string | null;
  dosis: string;
  duracion: string | null;
  cantidad: string | null;
  notas: string | null;
}

/** Receta del portal (shape EXACTO que ya devuelve GET /api/paciente/recetas). */
export interface PacienteReceta {
  id: string;
  clinicId: string;
  clinicName: string;
  doctorName: string;
  issuedAt: string; // ISO
  expiresAt: string | null;
  expired: boolean;
  folio: string;
  verifyUrl: string;
  diagnosis: string | null;
  indications: string | null;
  cofeprisGroup: string | null;
  cofeprisFolio: string | null;
  medicamentos: PacienteRecetaMed[];
}

export interface PacienteRecetasResponse {
  recetas: PacienteReceta[];
}

// ── Agendar cita nueva (WS2-T1, aditivo) ─────────────────────────────────────

/** Doctor agendable de una clínica (wizard de nueva cita). */
export interface PacienteBookingDoctor {
  id: string;
  name: string; // "Nombre Apellido"
  specialty: string | null;
}

/** Clínica + sus doctores agendables. GET /api/paciente/booking/options. */
export interface PacienteBookingClinica {
  clinicId: string;
  clinicName: string;
  timezone: string;
  doctors: PacienteBookingDoctor[];
}

export interface PacienteBookingOptionsResponse {
  clinics: PacienteBookingClinica[];
}

/** GET /api/paciente/booking/slots?clinicId=&doctorId=&date=YYYY-MM-DD. */
export interface PacienteBookingSlotsResponse {
  date: string; // YYYY-MM-DD
  timezone: string;
  durationMin: number; // 30
  slots: string[]; // "HH:mm" libres
}

/** Body de POST /api/paciente/appointments (agendar nueva cita). */
export interface PacienteNuevaCitaBody {
  clinicId: string;
  doctorId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  type?: string;
  reason?: string;
}

/** Respuesta de POST /api/paciente/appointments. */
export interface PacienteNuevaCitaResponse {
  ok: boolean;
  appointmentId: string;
  startsAt: string; // ISO UTC
  status: string; // "SCHEDULED"
}

// ── Subir documentos (WS1-T8, aditivo) ───────────────────────────────────────

/** Tipo de archivo que el paciente sube (WS1-T8). Espejo del enum Prisma. */
export type PacienteSubidoKind = "ESTUDIO" | "IDENTIFICACION" | "OTRO";

/** Archivo subido por el paciente (shape de GET /api/paciente/documentos/subidos).
 *  NUNCA incluye el storageKey: la descarga se firma on-demand. */
export interface PacienteSubido {
  id: string;
  clinicId: string;
  fileName: string;
  fileType: string; // MIME
  sizeBytes: number;
  kind: PacienteSubidoKind;
  createdAt: string; // ISO
}

export interface PacienteSubidosResponse {
  items: PacienteSubido[]; // desc por createdAt
}
