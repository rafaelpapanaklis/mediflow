/**
 * Los tokens de la agenda nueva (Claude Design, paquete `design_handoff_agenda`).
 *
 * La fuente de la verdad es el `README.md` de ese paquete: aquí no se inventa
 * ni un color ni una medida, se transcriben. Todo lo que pinta la agenda nueva
 * —Día (ws1-t1), Semana y Mes (ws1-t2)— sale de aquí, para que las tres vistas
 * no puedan discrepar.
 *
 * Los MISMOS valores viven también como custom properties `--ag-*` en
 * `agenda-nueva.module.css` (clase `.raiz`). Regla de la casa: si lo pinta el
 * CSS, usa la variable; si lo calcula el JS (una altura en px, un color inline
 * de responsable), usa esta constante. Nunca escribas el literal a mano.
 *
 * MODO OSCURO (ws1-t1, hallazgo 18): estos colores acaban SIEMPRE en un
 * `style` inline (la tarjeta de cita, su chip, su ícono), así que cada uno
 * es ahora `var(--ag-…, <valor del README>)`: en claro resuelve al mismo
 * literal de antes, y en oscuro al que declara el bloque `:global(.dark)` de
 * la hoja. El literal queda de respaldo por si el nodo se pintara fuera de
 * `.raiz`, y como documentación del README.
 *
 * ⛔ Nada de esto se aplica con el interruptor apagado: la agenda de siempre no
 * monta ni un nodo de la agenda nueva.
 */

/** Paleta y tipografía del diseño. Los valores del README van de respaldo. */
export const AGENDA_TOKENS = {
  /** Tinta principal. */
  tinta: "var(--ag-tinta, #1a1826)",
  /** Texto secundario (subtítulos, metadatos). */
  texto2: "var(--ag-texto-2, #6e6b82)",
  /** Texto atenuado. */
  texto3: "var(--ag-texto-3, #3d3a4d)",
  /** Superficie de tarjetas y paneles. */
  superficie: "var(--ag-superficie, #ffffff)",
  /** Fondo de la app (segmented control, tarjeta de datos del panel). */
  fondoApp: "var(--ag-fondo-app, #f4f3f8)",
  /** Fondo de un día cerrado. */
  fondoCerrado: "var(--ag-fondo-cerrado, #faf9fc)",
  /** Borde divisor (líneas de la cuadrícula, separadores). */
  bordeDivisor: "var(--ag-borde-divisor, rgba(26,24,38,.09))",
  /** Borde de controles (botones, tarjetas de cita). */
  bordeControl: "var(--ag-borde-control, rgba(26,24,38,.12))",
  /** Línea de media hora. */
  bordeMedia: "var(--ag-borde-media, rgba(26,24,38,.045))",

  /** Morado principal — línea de «ahora», chip «Hoy», selección. */
  morado: "var(--ag-morado, oklch(0.47 0.2 280))",
  /** Morado para texto sobre tinte. */
  moradoTexto: "var(--ag-morado-texto, oklch(0.40 0.19 280))",
  /** Tinte morado — fondo de «en consulta» y del botón «Buscar espacio». */
  moradoTinte: "var(--ag-morado-tinte, oklch(0.94 0.035 280))",
  /** Fondo de la columna/celda de hoy. */
  hoy: "var(--ag-hoy, oklch(0.975 0.012 280))",
  /** Borde de una cita en consulta. */
  bordeConsulta: "var(--ag-borde-consulta, oklch(0.80 0.08 280))",

  /** Verde — pasos completados del flujo, ícono de confirmada. */
  verde: "var(--ag-verde, oklch(0.6 0.16 150))",
  /** Verde vivo — el punto «en vivo». */
  verdeVivo: "var(--ag-verde-vivo, oklch(0.72 0.18 150))",
  /** Chip «Confirmada». */
  chipVerdeFondo: "var(--ag-chip-verde-fondo, oklch(0.95 0.05 150))",
  chipVerdeTinta: "var(--ag-chip-verde-tinta, oklch(0.40 0.13 150))",

  /** Ámbar — la espera. */
  ambarIcono: "var(--ag-ambar-icono, oklch(0.55 0.14 70))",
  ambarTexto: "var(--ag-ambar-texto, oklch(0.45 0.13 70))",
  ambarTexto2: "var(--ag-ambar-texto-2, oklch(0.40 0.12 70))",
  ambarFondo: "var(--ag-ambar-fondo, oklch(0.95 0.07 80))",
  ambarClaro: "var(--ag-ambar-claro, oklch(0.975 0.03 80))",
  ambarBorde: "var(--ag-ambar-borde, oklch(0.85 0.1 80))",
  ambarBadge: "var(--ag-ambar-badge, oklch(0.86 0.13 80))",

  /**
   * Rojo. 🔴 NO está en el README: el diseño solo enseña cinco estados y
   * ninguno es «no asistió». Lo añadimos nosotros para los dos estados reales
   * que el diseño no contempla (ver `estados.ts`), en la misma familia `oklch`
   * y con el mismo croma que el ámbar para que no desentone.
   */
  rojoTexto: "var(--ag-rojo-texto, oklch(0.45 0.16 25))",
  rojoFondo: "var(--ag-rojo-fondo, oklch(0.96 0.03 25))",
  rojoBorde: "var(--ag-tarjeta-rojo-borde, oklch(0.86 0.08 25))",
  chipRojoFondo: "var(--ag-chip-rojo-fondo, oklch(0.94 0.055 25))",
} as const;

/** Sombras del diseño. */
export const AGENDA_SOMBRAS = {
  desplegable: "0 16px 40px rgba(26,24,38,.16)",
  segmentoActivo: "0 1px 2px rgba(26,24,38,.1)",
  seleccion: "0 0 0 2px oklch(0.47 0.2 280)",
} as const;

/* ────────────────────────────────────────────────────────────────────────
   Escala vertical. Es el corazón de la cuadrícula: las citas se colocan con
   aritmética sobre estos números, no con flexbox.
   ──────────────────────────────────────────────────────────────────────── */

/** Alto de una hora, en px. README: «112 px por hora». */
export const ALTO_HORA = 112;

/** Alto de media hora, en px (la línea tenue). */
export const ALTO_MEDIA = 56;

/** Ancho de la columna de horas, en px. */
export const ANCHO_EJE = 64;

/** Hora en la que ARRANCA la cuadrícula del diseño. */
export const HORA_INICIO_DISENO = 8;

/** Hora en la que TERMINA la cuadrícula del diseño. */
export const HORA_FIN_DISENO = 20;

/**
 * Colchón que el diseño deja bajo la última hora (1352 = 12 × 112 + 8), para
 * que la etiqueta «CIERRE» y la última media hora no queden pegadas al borde.
 */
export const COLCHON_REJILLA = 8;

/** Alto del encabezado de columnas en Día. */
export const ALTO_ENCABEZADO_DIA = 60;

/** Alto del encabezado de columnas en Semana (lo usa ws1-t2). */
export const ALTO_ENCABEZADO_SEMANA = 52;

/** Alto de la barra de herramientas, común a las tres vistas. */
export const ALTO_BARRA = 64;

/** Ancho del panel lateral de cita. */
export const ANCHO_PANEL_CITA = 420;

/** Ancho del panel «Buscar espacio». */
export const ANCHO_PANEL_HUECOS = 400;

/**
 * Paleta de responsables. El README da tres «de ejemplo, asignables»; el
 * sistema ya tiene la suya (`DOCTOR_PALETTE` en `src/lib/agenda/doctor-color.ts`)
 * y **manda la del sistema**: el color de un doctor es un dato de la clínica
 * (se edita en Equipo) y cambiarlo aquí lo cambiaría en media aplicación.
 *
 * Esta constante existe solo para documentar los tres del diseño y para que
 * `colorDeResponsable` tenga a qué caer cuando un doctor no tiene color propio.
 */
export const COLORES_RESPONSABLE_DISENO = [
  "oklch(0.47 0.2 280)", // morado — Dra. Díaz en el prototipo
  "oklch(0.62 0.12 200)", // azul   — Dr. Jorge
  "oklch(0.62 0.16 30)", // coral  — Karla Ortiz
] as const;
