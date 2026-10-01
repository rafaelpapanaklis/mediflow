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

// ─────────────────────────── El registro de una sesión ──────────────────────
//
// Una sesión (login de un navegador) = UN registro en Redis, con su identidad,
// su «desde», su última señal, su pantalla y el contador del límite por minuto.
// Se guarda como texto delimitado con «|» (sin cjson: un script de Lua que no
// depende de librerías) y se cambia con UNA llamada: el script de presencia-lua.ts
// o, si EVAL no sirve, `aplicarLatido` de abajo, que hace lo MISMO en JS.
// Las pruebas contra un Redis real comparan las dos.
//
//   clínica|usuario|cuenta|desde|ts|minuto|n|pantalla|nombre
//
// El nombre va al final (el único campo libre) y se limpia de «|» y controles.

export interface RegistroSesion {
  clinicId: string;
  userId: string;
  /** false = «Ver como clínica» o usuario de plataforma: no cuenta, solo se recuerda para no volver a preguntar. */
  cuenta: boolean;
  /** Primera señal de la sesión continua. */
  desde: number;
  /** Última señal. */
  ts: number;
  /** Minuto (ms/60000) del contador del límite. */
  minuto: number;
  /** Señales aceptadas en ese minuto. */
  n: number;
  pantalla: string;
  nombre: string;
}

/** Quita lo que rompería el formato (|, saltos de línea, controles). */
export function limpiarTexto(t: string, max = 80): string {
  // eslint-disable-next-line no-control-regex
  return t.replace(/[|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function codificarRegistro(r: RegistroSesion): string {
  return [r.clinicId, r.userId, r.cuenta ? "1" : "0", r.desde, r.ts, r.minuto, r.n, limpiarTexto(r.pantalla, 60), limpiarTexto(r.nombre)].join("|");
}

/** null si no es un registro válido (ausente o dañado: se trata como ausente). */
export function leerRegistro(crudo: unknown): RegistroSesion | null {
  if (typeof crudo !== "string") return null;
  const f = crudo.split("|");
  if (f.length < 9) return null;
  const [clinicId, userId, cuenta, desde, ts, minuto, n, pantalla] = f;
  const nombre = f.slice(8).join("|");
  const num = (x: string) => (x !== "" && Number.isFinite(Number(x)) ? Number(x) : NaN);
  const r = { desde: num(desde), ts: num(ts), minuto: num(minuto), n: num(n) };
  if (!clinicId || !userId || [r.desde, r.ts, r.minuto, r.n].some(Number.isNaN)) return null;
  return { clinicId, userId, cuenta: cuenta === "1", ...r, pantalla, nombre };
}

/** Códigos que devuelve la señal (el script de Lua devuelve los mismos). */
export const LATIDO = { GUARDADO: 0, FALTA_IDENTIDAD: 1, NO_CUENTA: 2, LIMITE: 3 } as const;

export interface ParamsLatido {
  ahora: number;
  /** TTL del registro en segundos (= la vida de la identidad en caché). */
  ttlS: number;
  limitePorMinuto: number;
  pantalla: string;
  ventanaMs: number;
  /** Solo cuando el servidor ya resolvió la identidad con la base. */
  identidad?: { clinicId: string; userId: string; cuenta: boolean; nombre: string };
}

export type DecisionLatido =
  | { codigo: 1 }
  | { codigo: 2; escribir: string | null }
  | { codigo: 3; reintentarEnS: number }
  | { codigo: 0; escribir: string; indexar: { clinicId: string; userId: string } };

/**
 * La regla de una señal, pura. Es la MISMA que ejecuta el script de Lua en
 * Redis; esta versión existe para el camino de reserva (EVAL no disponible) y
 * para las pruebas de las dos contra un Redis real.
 *
 *  · sin registro y sin identidad → pide la identidad (código 1);
 *  · registro de quien no cuenta → 2, sin escribir nada;
 *  · límite por minuto y por sesión → código 3 con los segundos que faltan;
 *  · `desde` se conserva mientras entre señal y señal no pasen más de `ventanaMs`.
 */
export function aplicarLatido(crudo: string | null, p: ParamsLatido): DecisionLatido {
  const previo = leerRegistro(crudo);
  if (previo && !previo.cuenta) return { codigo: 2, escribir: null };
  let r: RegistroSesion;
  if (previo) {
    r = { ...previo };
  } else {
    if (!p.identidad) return { codigo: 1 };
    r = {
      clinicId: p.identidad.clinicId, userId: p.identidad.userId, cuenta: p.identidad.cuenta,
      desde: p.ahora, ts: 0, minuto: -1, n: 0, pantalla: "", nombre: limpiarTexto(p.identidad.nombre),
    };
    if (!r.cuenta) return { codigo: 2, escribir: codificarRegistro({ ...r, ts: p.ahora, minuto: Math.floor(p.ahora / 60_000), n: 1, pantalla: limpiarTexto(p.pantalla, 60) }) };
  }
  const minuto = Math.floor(p.ahora / 60_000);
  if (r.minuto === minuto) {
    if (r.n >= p.limitePorMinuto) return { codigo: 3, reintentarEnS: 60 - Math.floor((p.ahora % 60_000) / 1000) };
    r.n += 1;
  } else {
    r.minuto = minuto;
    r.n = 1;
  }
  if (r.ts === 0 || p.ahora - r.ts > p.ventanaMs) r.desde = p.ahora;
  r.ts = p.ahora;
  r.pantalla = p.pantalla;
  return { codigo: 0, escribir: codificarRegistro(r), indexar: { clinicId: r.clinicId, userId: r.userId } };
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
