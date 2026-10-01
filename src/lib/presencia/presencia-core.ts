/**
 * «Clínicas en línea» — la parte PURA (sin Redis, sin Next, sin React).
 *
 * Las reglas que Rafael aprobó (1-oct-2026):
 *   · el panel de la clínica manda una señal cada 60 s mientras la pestaña está
 *     VISIBLE; las pestañas en segundo plano no cuentan;
 *   · sin mouse, teclado ni toque en 15 min, deja de mandarla aunque la pestaña
 *     siga abierta;
 *   · una clínica está EN LÍNEA si al menos un usuario suyo mandó señal en los
 *     últimos 5 min;
 *   · no cuenta «Ver como clínica» del admin de plataforma ni nadie de /admin.
 *
 * Todo lo que el navegador y el servidor tienen que acordar vive aquí, una sola
 * vez: dos copias de estos números se separan al primer cambio.
 */

/** Cada cuánto manda señal una pestaña visible y activa. */
export const LATIDO_MS = 60_000;
/** Sin actividad del usuario durante este tiempo, la pestaña deja de mandar señal. */
export const INACTIVIDAD_MS = 15 * 60_000;
/** Una clínica está en línea si alguien suyo mandó señal hace menos que esto. */
export const VENTANA_EN_LINEA_MS = 5 * 60_000;
/** Entre dos señales de la MISMA pestaña, como mínimo (cambio de pantalla, vuelta a la pestaña). */
export const LATIDO_MINIMO_MS = 15_000;
/** Tope del servidor por usuario y minuto: una pestaña sana manda 1-2; varias, unas pocas. */
export const MAX_LATIDOS_POR_MINUTO = 10;
/** Cuántas clínicas lista el detalle como máximo (el conteo no tiene tope). */
export const MAX_CLINICAS_EN_LISTA = 200;

/** Ruta del endpoint de la señal (la comparten el cliente y las pruebas). */
export const RUTA_LATIDO = "/api/dashboard/presencia";

// ─────────────────────────── Decisión del cliente ───────────────────────────

/**
 * ¿Toca mandar señal ahora? Visible Y con actividad reciente. Es la única
 * decisión del navegador; el componente solo la llama y manda.
 */
export function debeLatir(e: { visible: boolean; ahora: number; ultimaActividad: number }): boolean {
  if (!e.visible) return false;
  return e.ahora - e.ultimaActividad < INACTIVIDAD_MS;
}

/** ¿Pasó el mínimo desde la última señal (para las que no son del reloj)? */
export function puedeLatirYa(ahora: number, ultimoLatido: number): boolean {
  return ahora - ultimoLatido >= LATIDO_MINIMO_MS;
}

// ─────────────────────────── Pantalla legible ───────────────────────────────

/** Primer segmento de /dashboard/<x> → nombre en el menú. */
const PANTALLAS: Record<string, string> = {
  agenda: "Agenda",
  appointments: "Citas",
  patients: "Pacientes",
  inbox: "Inbox",
  whatsapp: "WhatsApp / Bot",
  orthodontics: "Ortodoncia",
  marketplace: "Marketplace",
  "ai-assistant": "IA asistente",
  sabina: "Sabina",
  inventory: "Inventario",
  "before-after": "Antes y Después",
  formulas: "Fórmulas",
  exercises: "Ejercicios",
  orthotics: "Ortesis",
  specialties: "Especialidades",
  packages: "Paquetes",
  suppliers: "Proveedores",
  compras: "Mis compras",
  laboratorios: "Laboratorios",
  "ordenes-laboratorio": "Órdenes de laboratorio",
  "lab-chat": "Chat con laboratorio",
  "proveedor-chat": "Chat con proveedor",
  caja: "Caja",
  finanzas: "Finanzas",
  analytics: "Analytics",
  "tv-modes": "Pantallas TV",
  reports: "Reportes",
  resources: "Recursos",
  "resource-bookings": "Reservas de recursos",
  team: "Equipo",
  landing: "Página web",
  procedures: "Procedimientos",
  treatments: "Tratamientos",
  plantillas: "Plantillas",
  "clinic-layout": "Mi Clínica Visual",
  soporte: "Soporte Técnico",
  settings: "Configuración",
  auditoria: "Bitácora",
  billing: "Facturación",
  suspended: "Facturación",
  resenas: "Reseñas",
  xrays: "Radiografías",
  "walk-in": "Sala de espera",
  teleconsulta: "Teleconsulta",
  contratar: "Contratar módulo",
  "cambiar-contrasena": "Cambiar contraseña",
  "2fa": "Verificación en dos pasos",
};

/** Subpantallas que valen su propio nombre (el resto cuelga de la principal). */
const SUBPANTALLAS: Record<string, Record<string, string>> = {
  orthodontics: {
    tablero: "Ortodoncia · Tablero",
    pacientes: "Ortodoncia · Pacientes",
    controles: "Ortodoncia · Controles",
    cobranza: "Ortodoncia · Cobranza",
    alertas: "Ortodoncia · Alertas",
    configuracion: "Ortodoncia · Configuración",
  },
  whatsapp: { bot: "WhatsApp / Bot" },
};

export const PANTALLA_DESCONOCIDA = "Otra pantalla";

/**
 * Ruta del navegador → nombre de pantalla en español.
 *
 * 🔴 Es una lista CERRADA, a propósito: lo que se guarda en Redis y se enseña
 * al admin es el NOMBRE, nunca la ruta cruda. Una ruta lleva ids de paciente,
 * filtros y a veces texto del usuario, y eso no debe salir de la clínica.
 * Lo que no se reconoce (o no es del panel) es «Otra pantalla».
 */
export function etiquetaDePantalla(ruta: unknown): string {
  if (typeof ruta !== "string") return PANTALLA_DESCONOCIDA;
  const limpia = ruta.split(/[?#]/)[0].replace(/\/+$/, "");
  const partes = limpia.split("/").filter(Boolean);
  if (partes[0] !== "dashboard") return PANTALLA_DESCONOCIDA;
  if (partes.length === 1) return "Hoy";
  const seccion = partes[1];
  if (!Object.prototype.hasOwnProperty.call(PANTALLAS, seccion)) return PANTALLA_DESCONOCIDA;
  if (seccion === "patients" && partes.length >= 3) return "Ficha de paciente";
  if (seccion === "whatsapp" && partes[2] === "bot" && partes[3] === "saldo") return "Saldo IA";
  const sub = SUBPANTALLAS[seccion];
  if (sub && partes[2] && Object.prototype.hasOwnProperty.call(sub, partes[2])) return sub[partes[2]];
  return PANTALLAS[seccion];
}

// ─────────────────────────── Lo que se enseña ───────────────────────────────

export interface UsuarioEnLinea {
  nombre: string;
  pantalla: string;
  /** ms epoch de la primera señal de esta sesión continua. */
  desde: number;
  /** ms epoch de la última señal. */
  ultimaSenal: number;
}

export interface FilaEnLinea {
  clinicId: string;
  /** Primera señal de la sesión continua de la CLÍNICA (null = no se pudo leer). */
  desde: number | null;
  usuarios: UsuarioEnLinea[];
}

export interface ClinicaEnLinea {
  clinicId: string;
  nombre: string;
  usuarios: UsuarioEnLinea[];
  desde: number;
}

/**
 * Filas crudas de Redis → clínicas en línea, ordenadas: más usuarios primero y,
 * a igualdad, por nombre. Se vuelve a aplicar la ventana de 5 min aquí (el TTL
 * de Redis es la red de seguridad, no la regla). Una clínica sin ningún usuario
 * dentro de la ventana no sale.
 */
export function armarClinicasEnLinea(
  filas: FilaEnLinea[],
  nombres: Map<string, string>,
  ahora: number,
): ClinicaEnLinea[] {
  const corte = ahora - VENTANA_EN_LINEA_MS;
  const salida: ClinicaEnLinea[] = [];
  for (const f of filas) {
    const usuarios = f.usuarios
      .filter((u) => u.ultimaSenal >= corte)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (usuarios.length === 0) continue;
    const primera = Math.min(...usuarios.map((u) => u.desde));
    salida.push({
      clinicId: f.clinicId,
      nombre: nombres.get(f.clinicId) ?? "Clínica sin nombre",
      usuarios,
      // La sesión continua de la clínica puede venir de alguien que ya se fue.
      desde: f.desde !== null && f.desde <= primera ? f.desde : primera,
    });
  }
  return salida.sort((a, b) => b.usuarios.length - a.usuarios.length || a.nombre.localeCompare(b.nombre, "es"));
}

/** «42 min», «1 h 05 min», «menos de 1 min». */
export function formatoDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "menos de 1 min";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** Lo que el endpoint de /admin devuelve. `clinicas: null` = «sin dato». */
export interface RespuestaEnLinea {
  disponible: boolean;
  clinicas: number | null;
  /** ms epoch del momento de la lectura. */
  ahora: number;
  detalle?: Array<{
    clinicId: string;
    nombre: string;
    desde: number;
    usuarios: UsuarioEnLinea[];
  }>;
}
