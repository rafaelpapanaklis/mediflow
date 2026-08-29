// ═══════════════════════════════════════════════════════════════════════
// DaleControl INSTITUCIONAL — contrato compartido del vertical.
// Espejo de src/lib/barber/types.ts. ÚNICA fuente de verdad de tipos,
// terminología y rutas del producto para escuelas de especialidades
// odontológicas.
//
// Es un producto SEPARADO del dental (que está VIVO en producción) y no
// comparte con él ni una tabla ni una pantalla. Multi-tenant:
// institutionId sale SIEMPRE de la sesión (getEduContext en
// src/lib/edu-auth.ts), NUNCA del body/query. Ojo Prisma: un
// institutionId undefined BORRA el filtro de tenant — jamás dejar pasar
// un undefined a un where.
//
// ── CONTRATO DE RUTAS ───────────────────────────────────────────────────
// Panel (sesión de instituto, guard en src/app/instituto/(panel)/layout.tsx):
//   /instituto              → router de entrada (login / inicio)   Ola 0 ✓
//   /instituto/login        → login DEDICADO del vertical          Ola 0 ✓
//   /instituto/inicio       → pantalla de inicio                   Ola 0 ✓
//   /instituto/padron       → padrón de alumnos                    Ola 1A ✓
//   /instituto/padron/estructura → especialidades y generaciones   Ola 1A ✓
//   /instituto/docentes     → docentes y su carga                  Ola 1A ✓
//   /instituto/pacientes    → pacientes de la clínica              Ola 2  ✓
//   /instituto/agenda       → día y semana, por sillón             Ola 2  ✓
//   /instituto/agenda/tamizaje → valoración inicial: asigna y abre caso  Ola 2 ✓
//   /instituto/sillones     → unidades dentales y su horario       Ola 2  ✓
//   /instituto/mi-dia       → lo que ve un alumno al llegar        Ola 2  ✓
//   /instituto/pacientes/[id]              → ficha, con pestañas   Ola 3  ✓
//   /instituto/pacientes/[id]/casos        → sus casos             Ola 3  ✓
//   /instituto/pacientes/[id]/expediente   → notas clínicas        Ola 3  ✓
//   /instituto/pacientes/[id]/odontograma  → el odontograma        Ola 3  ✓
//   /instituto/pacientes/[id]/estudios     → radiografías y tomografías Ola 3 ✓
//   /instituto/procedimientos → catálogo de procedimientos         Ola 5  ✓
//   /instituto/tarifarios   → listas de precios, tabla comparativa Ola 5  ✓
//   /instituto/caja         → cobrar: paciente → tarifa → recibo   Ola 5  ✓
//   /instituto/caja/corte   → corte del turno                      Ola 5  ✓
//   /instituto/equipo       → altas y bajas de cuentas             Ola 1B ✓
// Las olas que siguen cuelgan sus pantallas de /instituto/<área> y su
// entrada de menú de EDU_NAV_ITEMS (abajo). Ninguna inventa su propio
// guard: todas pasan por el layout del grupo (panel).
// APIs (prefijo /api/instituto/*; multi-tenant desde sesión):
//   POST  /api/instituto/auth/logout        → signOut              Ola 0 ✓
//   GET   /api/instituto/padron             → lista de alumnos     Ola 1A ✓
//   POST  /api/instituto/padron             → alta de alumno       Ola 1A ✓
//   PATCH /api/instituto/padron/[id]        → estado, semestre…    Ola 1A ✓
//   GET·POST  /api/instituto/programas      → especialidades       Ola 1A ✓
//   PATCH     /api/instituto/programas/[id] → editar / desactivar  Ola 1A ✓
//   GET·POST  /api/instituto/generaciones   → generaciones         Ola 1A ✓
//   PATCH     /api/instituto/generaciones/[id]                     Ola 1A ✓
//   GET   /api/instituto/docentes           → docentes + carga     Ola 1A ✓
//   POST  /api/instituto/supervision        → asignar docente      Ola 1A ✓
//   PATCH /api/instituto/supervision/[id]   → cerrar vigencia      Ola 1A ✓
//   GET·POST  /api/instituto/pacientes      → pacientes            Ola 2  ✓
//   PATCH     /api/instituto/pacientes/[id] → ficha                Ola 2  ✓
//   PATCH     /api/instituto/pacientes/[id]/origen → CUÁL alumno lo trajo Ola 2 ✓
//   GET·POST  /api/instituto/sillones       → unidades dentales    Ola 2  ✓
//   PATCH     /api/instituto/sillones/[id]  → nombre, número, alta/baja Ola 2 ✓
//   PUT       /api/instituto/sillones/[id]/horario → franjas       Ola 2  ✓
//   GET·POST  /api/instituto/agenda         → citas del rango      Ola 2  ✓
//   PATCH     /api/instituto/agenda/[id]    → reagendar y estado   Ola 2  ✓
//   GET·POST  /api/instituto/casos          → casos clínicos       Ola 2  ✓
//   PATCH     /api/instituto/casos/[id]     → estado y supervisor  Ola 2  ✓
//   POST      /api/instituto/tamizaje       → asigna alumno + abre caso  Ola 2 ✓
//   GET·POST  /api/instituto/pacientes/[id]/expediente   → notas    Ola 3 ✓
//   PATCH     /api/instituto/expediente/[id]  → editar, enviar, firmar Ola 3 ✓
//   GET·PUT·PATCH /api/instituto/pacientes/[id]/odontograma      Ola 3 ✓
//   GET       /api/instituto/pacientes/[id]/estudios     → archivos Ola 3 ✓
//   POST      /api/instituto/pacientes/[id]/estudios/sign    → firma Ola 3 ✓
//   POST      /api/instituto/pacientes/[id]/estudios/confirm        Ola 3 ✓
//   POST      /api/instituto/pacientes/[id]/estudios/abort          Ola 3 ✓
//   GET·POST  /api/instituto/procedimientos → catálogo             Ola 5  ✓
//   PATCH     /api/instituto/procedimientos/[id]                   Ola 5  ✓
//   GET·POST  /api/instituto/tarifarios     → listas de precios    Ola 5  ✓
//   PATCH     /api/instituto/tarifarios/[id]                       Ola 5  ✓
//   PUT       /api/instituto/tarifarios/precios → precios de un procedimiento Ola 5 ✓
//   GET       /api/instituto/caja/tarifa    → qué lista y qué precios
//                                              le tocan a un paciente Ola 5 ✓
//   GET·POST  /api/instituto/caja/cobros    → cobros / cobrar      Ola 5  ✓
//   GET·PATCH /api/instituto/caja/cobros/[id] → recibo / cancelar  Ola 5  ✓
//   POST      /api/instituto/caja/cobros/[id]/pagos → pago o devolución Ola 5 ✓
//   GET·POST·PATCH /api/instituto/caja/corte → turno: ver, abrir, cerrar Ola 5 ✓
//   POST      /api/instituto/equipo         → alta de cuenta(s)    Ola 1B ✓
//   PATCH     /api/instituto/equipo/[id]    → baja / reactivación   Ola 1B ✓
// ═══════════════════════════════════════════════════════════════════════

// ── Enums ───────────────────────────────────────────────────────────────
// Espejo 1:1 del enum EduRole de Prisma, escrito como unión de strings para
// poder importarlo desde componentes "use client" sin arrastrar el runtime
// de Prisma al bundle del navegador. El candado de que ambos no se
// desincronicen es un chequeo de TIPOS en
// src/lib/edu/__tests__/edu-permissions.test.ts (lo verifica `tsc --noEmit`).
export type EduRole = "DIRECCION" | "DOCENTE" | "ALUMNO" | "CAJA";

export const EDU_ROLES: EduRole[] = ["DIRECCION", "DOCENTE", "ALUMNO", "CAJA"];

/**
 * Cómo se llama cada rol EN PANTALLA. La UI jamás pinta el valor del enum:
 * "ALUMNO" en mayúsculas no es lo que un alumno espera leer sobre su
 * nombre. Punto único — ninguna ola vuelve a traducir esto con un switch.
 */
export const EDU_ROLE_LABELS: Record<EduRole, string> = {
  DIRECCION: "Dirección",
  DOCENTE: "Docente",
  ALUMNO: "Alumno",
  CAJA: "Caja",
};

/**
 * Una línea que explica qué hace ese rol; se usa en el panel y en las altas
 * de /instituto/equipo.
 *
 * ⚠️ Aquí NO se dice "residente" (Ola 1B). El producto le dice ALUMNO en
 * todas sus pantallas, y llamarle de dos maneras distintas obliga a quien
 * da de alta a preguntarse si son dos cosas.
 */
export const EDU_ROLE_DESCRIPTIONS: Record<EduRole, string> = {
  DIRECCION: "Dirige el instituto: padrón, docentes, contrato y reportes.",
  DOCENTE: "Supervisa a los alumnos y autoriza los procedimientos.",
  ALUMNO: "Alumno en formación: atiende pacientes y pide autorización.",
  CAJA: "Cobra a los pacientes y hace los cortes del día.",
};

/**
 * Estado académico del alumno. Espejo 1:1 del enum EduStudentStatus de
 * Prisma, escrito como unión para poder importarlo desde componentes
 * "use client" sin arrastrar el runtime de Prisma al navegador — igual que
 * EduRole. El candado de que no se desincronicen es un chequeo de TIPOS en
 * src/lib/edu/__tests__/edu-padron.test.ts (lo verifica `tsc --noEmit`).
 *
 * Un alumno NUNCA se borra del padrón: cambia de estado. Los actos
 * clínicos que hizo siguieron ocurriendo y su expediente los referencia.
 */
export type EduStudentStatus = "ACTIVE" | "ON_LEAVE" | "GRADUATED" | "WITHDRAWN";

export const EDU_STUDENT_STATUSES: EduStudentStatus[] = [
  "ACTIVE",
  "ON_LEAVE",
  "GRADUATED",
  "WITHDRAWN",
];

/** Cómo se llama cada estado EN PANTALLA. La UI jamás pinta el enum. */
export const EDU_STUDENT_STATUS_LABELS: Record<EduStudentStatus, string> = {
  ACTIVE: "Activo",
  ON_LEAVE: "Baja temporal",
  GRADUATED: "Egresado",
  WITHDRAWN: "Baja definitiva",
};

/** Una línea que explica qué significa el estado (se lee en el alta). */
export const EDU_STUDENT_STATUS_DESCRIPTIONS: Record<EduStudentStatus, string> = {
  ACTIVE: "Está inscrito y atendiendo pacientes.",
  ON_LEAVE: "Pausó la residencia; vuelve a activarse cuando regrese.",
  GRADUATED: "Terminó la especialidad. Su expediente sigue completo.",
  WITHDRAWN: "Ya no pertenece a la generación. No se borra nada de lo que hizo.",
};

// ═══════════════════════════════════════════════════════════════════════
// Ola 2 · EL PISO CLÍNICO — pacientes, sillones, agenda y el caso.
//
// Los cinco enums que siguen son espejo 1:1 de los de Prisma, escritos como
// uniones de strings para poder importarlos desde componentes "use client"
// sin arrastrar el runtime de Prisma al navegador — igual que EduRole y
// EduStudentStatus. El candado de que no se desincronicen es un chequeo de
// TIPOS en src/lib/edu/__tests__/edu-visibility.test.ts (lo verifica
// `tsc --noEmit`).
//
// Y la regla de siempre: la UI JAMÁS pinta el valor del enum. "IN_CHAIR"
// en mayúsculas no es lo que un alumno espera leer sobre su paciente.
// ═══════════════════════════════════════════════════════════════════════

/** En qué punto del embudo está el paciente de la escuela. */
export type EduPatientStatus = "NEW" | "ACTIVE" | "DISCHARGED" | "INACTIVE";

export const EDU_PATIENT_STATUSES: EduPatientStatus[] = [
  "NEW",
  "ACTIVE",
  "DISCHARGED",
  "INACTIVE",
];

export const EDU_PATIENT_STATUS_LABELS: Record<EduPatientStatus, string> = {
  NEW: "Nuevo",
  ACTIVE: "En tratamiento",
  DISCHARGED: "Dado de alta",
  INACTIVE: "Inactivo",
};

export const EDU_PATIENT_STATUS_DESCRIPTIONS: Record<EduPatientStatus, string> = {
  NEW: "Registrado en recepción. Todavía no pasa por tamizaje.",
  ACTIVE: "Tiene al menos un caso abierto: alguien lo está atendiendo.",
  DISCHARGED: "Terminó sus tratamientos. Su historia no se borra.",
  INACTIVE: "Dejó de venir. Vuelve a estar en tratamiento si regresa.",
};

/** Sexo tal como se captura en recepción. */
export type EduSex = "FEMALE" | "MALE" | "OTHER" | "UNSPECIFIED";

export const EDU_SEXES: EduSex[] = ["FEMALE", "MALE", "OTHER", "UNSPECIFIED"];

export const EDU_SEX_LABELS: Record<EduSex, string> = {
  FEMALE: "Mujer",
  MALE: "Hombre",
  OTHER: "Otro",
  UNSPECIFIED: "Sin especificar",
};

/**
 * El ciclo de vida del CASO. Un paciente puede tener varios a la vez, uno
 * por especialidad: la señora que necesita endodoncia y ortodoncia es una
 * persona con dos casos, dos alumnos y dos docentes.
 */
export type EduCaseStatus =
  | "SCREENING"
  | "ASSIGNED"
  | "IN_TREATMENT"
  | "ON_HOLD"
  | "COMPLETED"
  | "TRANSFERRED"
  | "ABANDONED";

export const EDU_CASE_STATUSES: EduCaseStatus[] = [
  "SCREENING",
  "ASSIGNED",
  "IN_TREATMENT",
  "ON_HOLD",
  "COMPLETED",
  "TRANSFERRED",
  "ABANDONED",
];

export const EDU_CASE_STATUS_LABELS: Record<EduCaseStatus, string> = {
  SCREENING: "En valoración",
  ASSIGNED: "Asignado",
  IN_TREATMENT: "En tratamiento",
  ON_HOLD: "En pausa",
  COMPLETED: "Terminado",
  TRANSFERRED: "Transferido",
  ABANDONED: "Abandonado",
};

export const EDU_CASE_STATUS_DESCRIPTIONS: Record<EduCaseStatus, string> = {
  SCREENING: "Se abrió en el tamizaje y todavía no se decide el tratamiento.",
  ASSIGNED: "Ya tiene alumno responsable; falta empezar.",
  IN_TREATMENT: "Ya se le está trabajando al paciente.",
  ON_HOLD: "Pausado: falta un estudio, un pago o que el paciente vuelva.",
  COMPLETED: "Terminó. No se borra: la historia queda.",
  TRANSFERRED: "Pasó a otro alumno o a otra especialidad.",
  ABANDONED: "El paciente dejó de venir y el caso se cerró así.",
};

/**
 * Los tres estados FINALES. Llegar a uno de ellos escribe `closedAt`; el
 * producto deriva esa fecha del estado y no la captura, para que no exista
 * un caso "terminado" sin fecha de cierre ni una fecha de cierre en un caso
 * que sigue vivo.
 */
export const EDU_CASE_CLOSED_STATUSES: EduCaseStatus[] = [
  "COMPLETED",
  "TRANSFERRED",
  "ABANDONED",
];

/** Para qué es la cita. */
export type EduAppointmentType = "TAMIZAJE" | "TRATAMIENTO" | "CONTROL";

export const EDU_APPOINTMENT_TYPES: EduAppointmentType[] = [
  "TAMIZAJE",
  "TRATAMIENTO",
  "CONTROL",
];

export const EDU_APPOINTMENT_TYPE_LABELS: Record<EduAppointmentType, string> = {
  TAMIZAJE: "Tamizaje",
  TRATAMIENTO: "Tratamiento",
  CONTROL: "Control",
};

export const EDU_APPOINTMENT_TYPE_DESCRIPTIONS: Record<EduAppointmentType, string> = {
  TAMIZAJE: "Valoración inicial. Es la que asigna el paciente a un alumno y abre el caso.",
  TRATAMIENTO: "Sesión de trabajo en el sillón.",
  CONTROL: "Revisión posterior, sin tratamiento nuevo.",
};

/**
 * Dónde va la cita HOY. "Llegó", "se sentó" y "se le está trabajando" son
 * tres momentos distintos y la escuela los mide: el tiempo entre el primero
 * y el segundo es la sala de espera, y el que va del segundo al tercero es
 * lo que tardó el docente en autorizar.
 */
export type EduAppointmentStatus =
  | "SCHEDULED"
  | "CHECKED_IN"
  | "IN_CHAIR"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export const EDU_APPOINTMENT_STATUSES: EduAppointmentStatus[] = [
  "SCHEDULED",
  "CHECKED_IN",
  "IN_CHAIR",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

export const EDU_APPOINTMENT_STATUS_LABELS: Record<EduAppointmentStatus, string> = {
  SCHEDULED: "Agendada",
  CHECKED_IN: "Llegó",
  IN_CHAIR: "En el sillón",
  IN_PROGRESS: "En tratamiento",
  COMPLETED: "Terminada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No llegó",
};

export const EDU_APPOINTMENT_STATUS_DESCRIPTIONS: Record<EduAppointmentStatus, string> = {
  SCHEDULED: "Tiene hora y sillón; el paciente todavía no llega.",
  CHECKED_IN: "El paciente ya está en recepción.",
  IN_CHAIR: "Ya está sentado en el sillón.",
  IN_PROGRESS: "Se le está trabajando.",
  COMPLETED: "Se terminó la sesión.",
  CANCELLED: "Se canceló antes de la hora.",
  NO_SHOW: "Llegó la hora y el paciente no se presentó.",
};

/**
 * Los estados que LIBERAN el sillón: una cita cancelada o a la que el
 * paciente no llegó deja de ocupar su hueco, así que no cuenta para el
 * choque de horarios. Una terminada SÍ sigue ocupándolo — ocurrió.
 */
export const EDU_APPOINTMENT_FREE_STATUSES: EduAppointmentStatus[] = ["CANCELLED", "NO_SHOW"];

// ═══════════════════════════════════════════════════════════════════════
// Ola 3 · EL EXPEDIENTE CLÍNICO — notas, odontograma y estudios.
//
// Los dos enums que siguen son espejo 1:1 de los de Prisma, escritos como
// uniones de strings para poder importarlos desde componentes "use client"
// sin arrastrar el runtime de Prisma al navegador — igual que los cinco de
// la Ola 2. El candado de que no se desincronicen es un chequeo de TIPOS en
// src/lib/edu/__tests__/edu-expediente.test.ts (lo verifica `tsc --noEmit`).
// ═══════════════════════════════════════════════════════════════════════

/**
 * Dónde va una nota clínica.
 *
 * 🔴 NOM-004: FIRMADA es un estado FINAL. Una nota firmada no se edita ni
 * se borra; se corrige con una nota NUEVA que referencia a la anterior. Si
 * se pudiera reescribir, el expediente dejaría de ser el registro de lo que
 * pasó y pasaría a ser el registro de lo que alguien quiere que parezca que
 * pasó.
 */
export type EduRecordStatus = "BORRADOR" | "ENVIADA" | "FIRMADA";

export const EDU_RECORD_STATUSES: EduRecordStatus[] = ["BORRADOR", "ENVIADA", "FIRMADA"];

export const EDU_RECORD_STATUS_LABELS: Record<EduRecordStatus, string> = {
  BORRADOR: "Borrador",
  ENVIADA: "Enviada",
  FIRMADA: "Firmada",
};

export const EDU_RECORD_STATUS_DESCRIPTIONS: Record<EduRecordStatus, string> = {
  BORRADOR: "La estás escribiendo. Todavía se puede cambiar todo.",
  ENVIADA: "Entregada al docente. Puede firmarla o devolverla para corregir.",
  FIRMADA: "Cerrada. Ya no se edita: si algo está mal, se corrige con una nota nueva.",
};

/**
 * A qué estados puede pasar una nota desde donde está.
 *
 * FIRMADA no lleva a ningún lado, y esa lista vacía es la regla de la NOM
 * escrita como dato en vez de como un `if` que alguien puede olvidar en el
 * segundo endpoint.
 */
export const EDU_RECORD_TRANSITIONS: Record<EduRecordStatus, EduRecordStatus[]> = {
  BORRADOR: ["ENVIADA", "FIRMADA"],
  // Devolver (ENVIADA → BORRADOR) existe a propósito: sin esa vuelta, la
  // única forma de arreglar una nota entregada con un dedazo sería firmarla
  // mal y corregirla después.
  ENVIADA: ["FIRMADA", "BORRADOR"],
  FIRMADA: [],
};

/** Qué es el archivo que se subió al expediente. */
export type EduStudyKind = "RADIOGRAFIA" | "TOMOGRAFIA" | "FOTO" | "PDF" | "OTRO";

export const EDU_STUDY_KINDS: EduStudyKind[] = [
  "RADIOGRAFIA",
  "TOMOGRAFIA",
  "FOTO",
  "PDF",
  "OTRO",
];

export const EDU_STUDY_KIND_LABELS: Record<EduStudyKind, string> = {
  RADIOGRAFIA: "Radiografía",
  TOMOGRAFIA: "Tomografía",
  FOTO: "Fotografía",
  PDF: "Documento",
  OTRO: "Otro archivo",
};

export const EDU_STUDY_KIND_DESCRIPTIONS: Record<EduStudyKind, string> = {
  RADIOGRAFIA: "Periapical, panorámica o cualquier placa en imagen.",
  TOMOGRAFIA: "CBCT: la carpeta de cortes DICOM comprimida, o un corte suelto.",
  FOTO: "Fotografía intraoral o extraoral.",
  PDF: "Reporte, interconsulta o cualquier papel escaneado.",
  OTRO: "Un archivo que no encaja en los anteriores.",
};

// ═══════════════════════════════════════════════════════════════════════
// Ola 5 · TARIFARIOS Y CAJA.
//
// Los tres enums que siguen son espejo 1:1 de los de Prisma, escritos como
// uniones de strings para poder importarlos desde componentes "use client"
// sin arrastrar el runtime de Prisma al navegador — igual que todos los
// anteriores. El candado de que no se desincronicen es un chequeo de TIPOS
// en src/lib/edu/__tests__/edu-tarifas.test.ts (lo verifica `tsc --noEmit`).
//
// Y la regla de siempre: la UI JAMÁS pinta el valor del enum.
// ═══════════════════════════════════════════════════════════════════════

/**
 * CUÁNDO se aplica sola una lista de precios.
 *
 * 🔴 Las LISTAS son N y abiertas; las REGLAS son un conjunto cerrado, y eso
 * es a propósito: una regla es código —alguien tiene que escribir de dónde
 * sale el dato que la dispara—. Una lista nueva (un convenio, una campaña,
 * el personal del instituto) nace MANUAL y se elige a mano al cobrar, sin
 * tocar una línea de código ni una migración.
 */
export type EduFeeRule = "MANUAL" | "REFERRED_BY_STUDENT";

export const EDU_FEE_RULES: EduFeeRule[] = ["MANUAL", "REFERRED_BY_STUDENT"];

export const EDU_FEE_RULE_LABELS: Record<EduFeeRule, string> = {
  MANUAL: "Se elige a mano",
  REFERRED_BY_STUDENT: "Paciente que trajo un alumno",
};

export const EDU_FEE_RULE_DESCRIPTIONS: Record<EduFeeRule, string> = {
  MANUAL:
    "No se aplica sola. Sirve para convenios, campañas y personal: al cobrar se elige a mano.",
  REFERRED_BY_STUDENT:
    "Se aplica sola cuando al paciente lo trajo un alumno (el origen que marca recepción con el permiso pacientes.origen).",
};

/** En qué va el cobro. Se DERIVA de (total, pagado, cancelado). */
export type EduChargeStatus = "PENDING" | "PARTIAL" | "PAID" | "REFUNDED" | "CANCELLED";

export const EDU_CHARGE_STATUSES: EduChargeStatus[] = [
  "PENDING",
  "PARTIAL",
  "PAID",
  "REFUNDED",
  "CANCELLED",
];

export const EDU_CHARGE_STATUS_LABELS: Record<EduChargeStatus, string> = {
  PENDING: "Por cobrar",
  PARTIAL: "Abonado",
  PAID: "Pagado",
  REFUNDED: "Devuelto",
  CANCELLED: "Cancelado",
};

export const EDU_CHARGE_STATUS_DESCRIPTIONS: Record<EduChargeStatus, string> = {
  PENDING: "Emitido y sin un peso pagado.",
  PARTIAL: "Pagado en parte. Falta el saldo.",
  PAID: "Liquidado.",
  REFUNDED: "Se pagó y se devolvió: el neto volvió a cero.",
  CANCELLED: "Anulado. No se le debe nada a nadie y no cuenta en ninguna suma.",
};

/** Cómo pagó el paciente. */
export type EduPaymentMethod = "CASH" | "CARD" | "TRANSFER" | "OTHER";

export const EDU_PAYMENT_METHODS: EduPaymentMethod[] = ["CASH", "CARD", "TRANSFER", "OTHER"];

export const EDU_PAYMENT_METHOD_LABELS: Record<EduPaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  OTHER: "Otro",
};

export const EDU_PAYMENT_METHOD_DESCRIPTIONS: Record<EduPaymentMethod, string> = {
  CASH: "Entra al cajón y cuenta para el arqueo del turno.",
  CARD: "Terminal. Se guarda la autorización en la referencia.",
  TRANSFER: "SPEI o depósito. Se guarda el folio en la referencia.",
  OTHER: "Beca, intercambio o vale. Existe para no obligar a mentir en el método.",
};

/**
 * El único método que se CUENTA en el arqueo del cajón. Los demás entran al
 * corte como información, pero no hay billetes que contar.
 */
export const EDU_CASH_METHOD: EduPaymentMethod = "CASH";

// ── Navegación del panel ────────────────────────────────────────────────
export type EduNavSection = "operacion" | "academico" | "administracion";

/**
 * Definición estática de un item de menú. El layout (server) la filtra por
 * permiso y le pone la etiqueta; el sidebar (cliente) solo pinta.
 *
 * `permission` es un string y no `EduPermissionKey` A PROPÓSITO: si este
 * archivo importara el catálogo y el catálogo importara EduRole de aquí,
 * quedaría un ciclo. El layout hace el cast en un solo punto.
 * `null` = item que ve todo el mundo con sesión.
 */
export interface EduNavItemDef {
  key: string;
  href: string;
  icon: string;
  section: EduNavSection;
  permission: string | null;
}

/** Item YA resuelto que viaja del server al sidebar (serializable). */
export interface EduNavItem {
  key: string;
  href: string;
  icon: string;
  section: EduNavSection;
  label: string;
}

/**
 * Menú del panel. Cada item corresponde a una pantalla que EXISTE: un
 * sidebar con entradas que redirigen se lee como una app rota, no como un
 * producto joven.
 *
 * Para agregar una pantalla en las olas siguientes: una línea aquí + su key
 * en EDU_ALL_PERMISSIONS + su etiqueta en EDU_NAV_LABELS + el icono en el
 * mapa ICONS de src/components/edu/edu-shell.tsx. Nada más.
 * ⚠️ Un icono que no esté en ese mapa cae al genérico EN SILENCIO.
 *
 * El orden importa: dentro de una sección se pintan en este orden, y el
 * sidebar marca activo el item cuyo href COINCIDE MÁS (el más largo), así
 * que /instituto/padron/estructura no enciende también "Padrón".
 */
export const EDU_NAV_ITEMS: EduNavItemDef[] = [
  {
    key: "inicio",
    href: "/instituto/inicio",
    icon: "home",
    section: "operacion",
    permission: "inicio.view",
  },
  {
    // Va justo después de Inicio y antes de la agenda completa a
    // propósito: es la pantalla del ALUMNO, que llega al piso clínico con
    // el teléfono en la mano y necesita UNA cosa — qué le toca hoy.
    key: "mi-dia",
    href: "/instituto/mi-dia",
    icon: "sun",
    section: "operacion",
    permission: "agenda.view",
  },
  {
    key: "agenda",
    href: "/instituto/agenda",
    icon: "calendar",
    section: "operacion",
    permission: "agenda.view",
  },
  {
    key: "pacientes",
    href: "/instituto/pacientes",
    icon: "contact",
    section: "operacion",
    permission: "pacientes.view",
  },
  {
    key: "padron",
    href: "/instituto/padron",
    icon: "users",
    section: "academico",
    permission: "padron.view",
  },
  {
    key: "estructura",
    href: "/instituto/padron/estructura",
    icon: "layers",
    section: "academico",
    permission: "padron.manage",
  },
  {
    key: "docentes",
    href: "/instituto/docentes",
    icon: "user-check",
    section: "academico",
    permission: "docentes.view",
  },
  {
    // Los sillones son infraestructura de la escuela, no operación del
    // día: se dan de alta una vez y casi no se vuelven a tocar.
    key: "sillones",
    href: "/instituto/sillones",
    icon: "chair",
    section: "administracion",
    permission: "sillones.view",
  },
  // ── Ola 5 · tarifarios y caja ────────────────────────────────────────
  {
    // Caja es OPERACIÓN del día y va con la agenda: quien cobra está en el
    // mostrador, no en una oficina. El corte cuelga de aquí (/caja/corte) y
    // no lleva item propio: se llega desde la pantalla de cobro, que es
    // donde uno está cuando decide cortar.
    key: "caja",
    href: "/instituto/caja",
    icon: "banknote",
    section: "operacion",
    permission: "caja.view",
  },
  {
    // Los tarifarios y el catálogo son configuración: se tocan al arrancar
    // y cuando suben los precios, no todos los días.
    key: "tarifarios",
    href: "/instituto/tarifarios",
    icon: "tags",
    section: "administracion",
    permission: "tarifarios.view",
  },
  {
    key: "procedimientos",
    href: "/instituto/procedimientos",
    icon: "clipboard-list",
    section: "administracion",
    permission: "tarifarios.view",
  },
  // ── Ola 1B · las cuentas ─────────────────────────────────────────────
  {
    // Va en ADMINISTRACIÓN y no en ACADÉMICO a propósito: aquí se dan de
    // alta las cuentas de TODO el instituto —dirección, docentes, alumnos
    // y caja—, no solo las del padrón. Un cajero no es asunto académico, y
    // meterlo bajo "Académico" haría que quien busca "cómo doy de alta al
    // de recepción" no lo encontrara.
    key: "equipo",
    href: "/instituto/equipo",
    icon: "user-plus",
    section: "administracion",
    permission: "equipo.manage",
  },
];

/** Etiqueta de cada sección del menú (las vacías no se pintan). */
export const EDU_NAV_SECTION_LABELS: Record<EduNavSection, string> = {
  operacion: "Operación",
  academico: "Académico",
  administracion: "Administración",
};

/** Orden en que se pintan las secciones del sidebar. */
export const EDU_NAV_SECTION_ORDER: EduNavSection[] = [
  "operacion",
  "academico",
  "administracion",
];

/** Etiqueta de menú de cada item (español; el vertical no está en i18n). */
export const EDU_NAV_LABELS: Record<string, string> = {
  inicio: "Inicio",
  "mi-dia": "Mi día",
  agenda: "Agenda",
  pacientes: "Pacientes",
  padron: "Padrón",
  // Ola 1B: la escuela les dice ESPECIALIDADES, no "programas". El modelo
  // sigue llamándose EduProgram y la ruta sigue siendo /padron/estructura —
  // solo cambia lo que se LEE. Renombrar el modelo obligaría a migrar
  // tablas y a tocar el dental; renombrar la ruta rompería los enlaces que
  // la escuela ya tenga guardados.
  estructura: "Especialidades y generaciones",
  docentes: "Docentes",
  sillones: "Sillones",
  caja: "Caja",
  tarifarios: "Tarifarios",
  procedimientos: "Procedimientos",
  equipo: "Equipo",
};

// ── Marca del vertical ──────────────────────────────────────────────────
export const EDU_BRAND = {
  product: "DaleControl",
  vertical: "Institucional",
  /** Lo que se lee en el login y en el <title>. */
  full: "DaleControl Institucional",
  tagline: "El panel de las escuelas de especialidades odontológicas",
} as const;

/**
 * Las áreas que vienen. Se pintan en Inicio como "Próximamente" para que
 * nadie las busque en el menú, y son las mismas que cada ola irá cableando.
 * Vive aquí y no en la página porque la lista es del PRODUCTO, no de una
 * pantalla: cuando una área se entregue, se saca de aquí y se agrega a
 * EDU_NAV_ITEMS, en el mismo commit.
 */
export const EDU_UPCOMING_AREAS: { key: string; title: string; detail: string }[] = [
  // "padron" salió de esta lista en la Ola 1A, "agenda" en la Ola 2,
  // "expediente" en la Ola 3 y "caja" en la Ola 5, cada una en el mismo
  // commit en que se entregó. Es la regla: un área está en el menú o está
  // aquí, nunca en las dos ni en ninguna. (El candado es la prueba "un
  // área entregada sale de 'Próximamente'" de edu-permissions.test.ts.)
  //
  // ⚠️ EL EXPEDIENTE ES LA EXCEPCIÓN A "ni en ninguna de las dos", y es a
  // propósito: no tiene item de menú porque no es una pantalla suelta —
  // vive DENTRO de la ficha del paciente (/instituto/pacientes/[id]), que
  // es donde está la persona cuando lo necesita. Un item "Expediente" en
  // el sidebar tendría que abrir una pantalla que solo pregunta "¿de qué
  // paciente?", y eso es un paso de más en un teléfono, de pie, con el
  // paciente en el sillón. Se llega desde Pacientes, que sí está en el
  // menú.
  {
    key: "autorizaciones",
    title: "Autorizaciones",
    detail: "El visto bueno del docente antes y después de cada procedimiento.",
  },
  {
    key: "evaluacion",
    title: "Evaluación",
    detail: "Rúbricas, requisitos cumplidos y avance de cada alumno.",
  },
];
