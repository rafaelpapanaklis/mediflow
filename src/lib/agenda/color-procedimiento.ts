/**
 * COLOR POR PROCEDIMIENTO (WS1-T5 · grupo Salamanca) — la parte PURA.
 *
 * Con la bandera `agenda-flexible` y el ajuste «Colorear las citas por:
 * Procedimiento», cada cita toma el color del procedimiento del catálogo que
 * tiene por motivo; sin procedimiento reconocible, el de su doctor (como hoy).
 *
 * 🔴 LA CITA NO TIENE UN ID DE PROCEDIMIENTO. Su motivo (`appointments.type`)
 * es texto libre: el bot y Sabina guardan el NOMBRE del procedimiento del
 * catálogo, y la ventana «Nueva cita» lo que escriba la persona. Así que se
 * casa por nombre, sin mayúsculas ni acentos: igual, o el motivo empieza por
 * el nombre («Limpieza dental — control» → «Limpieza dental»). Si varios
 * casan, gana el nombre más largo (el más concreto).
 *
 * 🔴 TOKENS, NO HEX. El color guardado es una CLAVE de la paleta (`"azul"`),
 * y se pinta con `var(--ag-proc-azul, <respaldo>)`: los valores claro y
 * oscuro viven en `agenda-nueva.module.css`. El respaldo `oklch` es para lo
 * que se pinta fuera de la agenda nueva (la ficha del catálogo, la agenda de
 * siempre), en la misma familia que los acentos del diseño.
 *
 * Client-safe: sin prisma.
 */

export const COLORES_PROCEDIMIENTO = {
  morado: "var(--ag-proc-morado, oklch(0.55 0.17 290))",
  azul: "var(--ag-proc-azul, oklch(0.56 0.14 250))",
  cian: "var(--ag-proc-cian, oklch(0.62 0.11 210))",
  verde: "var(--ag-proc-verde, oklch(0.6 0.14 150))",
  oliva: "var(--ag-proc-oliva, oklch(0.62 0.12 115))",
  ambar: "var(--ag-proc-ambar, oklch(0.7 0.14 75))",
  naranja: "var(--ag-proc-naranja, oklch(0.65 0.16 50))",
  coral: "var(--ag-proc-coral, oklch(0.62 0.17 25))",
  rosa: "var(--ag-proc-rosa, oklch(0.6 0.18 350))",
  gris: "var(--ag-proc-gris, oklch(0.58 0.02 280))",
} as const;

export type ClaveColorProcedimiento = keyof typeof COLORES_PROCEDIMIENTO;

export const CLAVES_COLOR_PROCEDIMIENTO = Object.keys(COLORES_PROCEDIMIENTO) as ClaveColorProcedimiento[];

export function esClaveColor(v: unknown): v is ClaveColorProcedimiento {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COLORES_PROCEDIMIENTO, v);
}

/**
 * El color por defecto de un procedimiento sin color elegido: estable (sale de
 * su id, así no cambia al renombrarlo) y nunca el gris, que se reserva para
 * quien lo elija a propósito.
 */
export function colorPorDefecto(procedureId: string): ClaveColorProcedimiento {
  const opciones = CLAVES_COLOR_PROCEDIMIENTO.filter((c) => c !== "gris");
  let hash = 0;
  for (let i = 0; i < procedureId.length; i++) hash = (hash * 31 + procedureId.charCodeAt(i)) >>> 0;
  return opciones[hash % opciones.length]!;
}

/** El color con el que se pinta: el elegido, o el de por defecto. */
export function claveDeProcedimiento(p: { id: string; color?: string | null }): ClaveColorProcedimiento {
  return esClaveColor(p.color) ? p.color : colorPorDefecto(p.id);
}

/** La CSS de una clave (`var(--ag-proc-…, respaldo)`). */
export function cssDeColor(clave: ClaveColorProcedimiento): string {
  return COLORES_PROCEDIMIENTO[clave];
}

/** Sin mayúsculas, sin acentos, sin espacios de sobra. */
export function normalizarNombre(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo que viaja a la agenda: un procedimiento activo del catálogo con su color ya resuelto. */
export interface ProcedimientoConColor {
  id: string;
  nombre: string;
  color: ClaveColorProcedimiento;
}

/** El índice para casar rápido: nombre normalizado → procedimiento, del más largo al más corto. */
export interface IndiceProcedimientos {
  exactos: Map<string, ProcedimientoConColor>;
  porLargo: { clave: string; p: ProcedimientoConColor }[];
}

export function indiceDeProcedimientos(lista: readonly ProcedimientoConColor[] | null | undefined): IndiceProcedimientos {
  const exactos = new Map<string, ProcedimientoConColor>();
  for (const p of lista ?? []) {
    const clave = normalizarNombre(p.nombre);
    if (clave && !exactos.has(clave)) exactos.set(clave, p);
  }
  const porLargo = [...exactos.entries()]
    .map(([clave, p]) => ({ clave, p }))
    .sort((a, b) => b.clave.length - a.clave.length);
  return { exactos, porLargo };
}

/** El procedimiento del catálogo que nombra este motivo, o `null`. */
export function procedimientoDelMotivo(
  motivo: string | null | undefined,
  indice: IndiceProcedimientos,
): ProcedimientoConColor | null {
  const m = normalizarNombre(motivo);
  if (!m) return null;
  const exacto = indice.exactos.get(m);
  if (exacto) return exacto;
  for (const { clave, p } of indice.porLargo) {
    // Empieza por el nombre y sigue con algo que no es letra ni número:
    // «Resina — 2 caras» casa con «Resina»; «Resinas» no.
    if (m.startsWith(clave) && /^[^\p{L}\p{N}]/u.test(m.slice(clave.length))) return p;
  }
  return null;
}

/**
 * EL COLOR DE UNA CITA. Con «Procedimiento» y un motivo que casa, el del
 * procedimiento; en cualquier otro caso, el del doctor que ya calculaba la
 * agenda (se pasa hecho, para no duplicar su regla).
 */
export function colorDeCita(args: {
  modo: "doctor" | "procedimiento";
  motivo: string | null | undefined;
  indice: IndiceProcedimientos | null;
  colorDoctor: string;
}): { color: string; procedimiento: ProcedimientoConColor | null } {
  if (args.modo !== "procedimiento" || !args.indice) return { color: args.colorDoctor, procedimiento: null };
  const p = procedimientoDelMotivo(args.motivo, args.indice);
  return p ? { color: cssDeColor(p.color), procedimiento: p } : { color: args.colorDoctor, procedimiento: null };
}

/**
 * LA LEYENDA con «Procedimiento»: los procedimientos que de verdad aparecen en
 * las citas que se ven (no el catálogo entero: hay clínicas con 200), en orden
 * de aparición, más «Sin procedimiento» si alguna cita cae al color del doctor.
 */
export function leyendaDeProcedimientos(
  motivos: readonly (string | null | undefined)[],
  indice: IndiceProcedimientos,
): { procedimientos: ProcedimientoConColor[]; haySinProcedimiento: boolean } {
  const vistos = new Map<string, ProcedimientoConColor>();
  let haySinProcedimiento = false;
  for (const motivo of motivos) {
    const p = procedimientoDelMotivo(motivo, indice);
    if (p) {
      if (!vistos.has(p.id)) vistos.set(p.id, p);
    } else {
      haySinProcedimiento = true;
    }
  }
  return { procedimientos: [...vistos.values()], haySinProcedimiento };
}
