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
// Las olas que siguen cuelgan sus pantallas de /instituto/<área> y su
// entrada de menú de EDU_NAV_ITEMS (abajo). Ninguna inventa su propio
// guard: todas pasan por el layout del grupo (panel).
// APIs (prefijo /api/instituto/*; multi-tenant desde sesión):
//   POST /api/instituto/auth/logout  → signOut                     Ola 0 ✓
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
 * Menú del panel. En la Ola 0 hay UN item porque hay UNA pantalla: un
 * sidebar con seis entradas que redirigen se lee como una app rota, no como
 * un producto joven.
 *
 * Para agregar una pantalla en las olas siguientes: una línea aquí + su key
 * en EDU_ALL_PERMISSIONS + el icono en el mapa de edu-sidebar.tsx. Nada más.
 * ⚠️ Un icono que no esté en ese mapa cae al genérico EN SILENCIO.
 */
export const EDU_NAV_ITEMS: EduNavItemDef[] = [
  {
    key: "inicio",
    href: "/instituto/inicio",
    icon: "home",
    section: "operacion",
    permission: "inicio.view",
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
  {
    key: "padron",
    title: "Padrón",
    detail: "Alumnos, docentes y generaciones, con su expediente académico.",
  },
  {
    key: "agenda",
    title: "Agenda",
    detail: "Citas por sillón y por alumno, con el docente que supervisa.",
  },
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
