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
//   /instituto/padron/estructura → programas y generaciones        Ola 1A ✓
//   /instituto/docentes     → docentes y su carga                  Ola 1A ✓
//   /instituto/pacientes    → pacientes de la clínica              Ola 2  ✓
//   /instituto/agenda       → día y semana, por sillón             Ola 2  ✓
//   /instituto/agenda/tamizaje → valoración inicial: asigna y abre caso  Ola 2 ✓
//   /instituto/sillones     → unidades dentales y su horario       Ola 2  ✓
//   /instituto/mi-dia       → lo que ve un alumno al llegar        Ola 2  ✓
// Las olas que siguen cuelgan sus pantallas de /instituto/<área> y su
// entrada de menú de EDU_NAV_ITEMS (abajo). Ninguna inventa su propio
// guard: todas pasan por el layout del grupo (panel).
// APIs (prefijo /api/instituto/*; multi-tenant desde sesión):
//   POST  /api/instituto/auth/logout        → signOut              Ola 0 ✓
//   GET   /api/instituto/padron             → lista de alumnos     Ola 1A ✓
//   POST  /api/instituto/padron             → alta de alumno       Ola 1A ✓
//   PATCH /api/instituto/padron/[id]        → estado, semestre…    Ola 1A ✓
//   GET·POST  /api/instituto/programas      → programas            Ola 1A ✓
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
 * "ALUMNO" en mayúsculas no es lo que un residente espera leer sobre su
 * nombre. Punto único — ninguna ola vuelve a traducir esto con un switch.
 */
export const EDU_ROLE_LABELS: Record<EduRole, string> = {
  DIRECCION: "Dirección",
  DOCENTE: "Docente",
  ALUMNO: "Alumno",
  CAJA: "Caja",
};

/** Una línea que explica qué hace ese rol; se usa en el panel y en altas. */
export const EDU_ROLE_DESCRIPTIONS: Record<EduRole, string> = {
  DIRECCION: "Dirige el instituto: padrón, docentes, contrato y reportes.",
  DOCENTE: "Supervisa a los alumnos y autoriza los procedimientos.",
  ALUMNO: "Residente en formación: atiende pacientes y pide autorización.",
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
  GRADUATED: "Terminó el programa. Su expediente sigue completo.",
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
  estructura: "Programas y generaciones",
  docentes: "Docentes",
  sillones: "Sillones",
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
  // "padron" salió de esta lista en la Ola 1A y "agenda" en la Ola 2, en
  // el mismo commit en que entraron a EDU_NAV_ITEMS. Es la regla: un área
  // está en el menú o está aquí, nunca en las dos ni en ninguna.
  {
    key: "expediente",
    title: "Expediente",
    detail: "Historia clínica del paciente de la escuela, firmada por quien atiende.",
  },
  {
    key: "autorizaciones",
    title: "Autorizaciones",
    detail: "El visto bueno del docente antes y después de cada procedimiento.",
  },
  {
    key: "caja",
    title: "Caja",
    detail: "Cobro al paciente, cuotas de material y corte por turno.",
  },
  {
    key: "evaluacion",
    title: "Evaluación",
    detail: "Rúbricas, requisitos cumplidos y avance de cada residente.",
  },
];
