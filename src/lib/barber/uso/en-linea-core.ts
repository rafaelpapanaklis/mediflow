// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — «EN LÍNEA» en el admin (ws6, 17-nov-2026).
//
// Rafael: «que si alguien está en línea muestra en línea la barbería en
// admin igual que en dental».
//
// Igual que /admin/clinics del dental: «en línea» = alguien de su equipo usó
// el panel en los últimos MINUTOS_EN_LINEA minutos. En el dental la señal es
// la sesión de panel vista (lastSeenAt); en barber, el último evento de uso
// (barber_usage_events: entrar, abrir pantalla o tocar un botón). Las
// sesiones de «Ver como barbería» y de admins NO se registran, así que no
// cuentan.
//
// Puro y sin servidor: lo importan también las pantallas del navegador.
// ═══════════════════════════════════════════════════════════════════════

/**
 * El MISMO valor que MINUTOS_EN_LINEA del dental (src/lib/admin/salud-clinica.ts).
 * Se copia en vez de importarlo para que barber no dependa de archivos del dental.
 */
export const MINUTOS_EN_LINEA = 15;

/** Desde cuándo un uso cuenta como «en línea». */
export function desdeEnLinea(ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - MINUTOS_EN_LINEA * 60_000);
}

/** ¿Un último uso (Date o ISO) cae dentro de la ventana? Igual que el dental: `visto >= desde`. */
export function estaEnLinea(ultimo: Date | string | null | undefined, ahora: Date = new Date()): boolean {
  if (ultimo === null || ultimo === undefined) return false;
  const t = (ultimo instanceof Date ? ultimo : new Date(ultimo)).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= desdeEnLinea(ahora).getTime();
}

export interface UltimoUsoSede {
  barbershopId: string;
  /** Matriz de la sede (null si la sede ES la matriz). */
  parentId: string | null;
  ultimo: Date | string | null;
}

/**
 * Las barberías en línea a partir del último uso de cada sede. Una sede en
 * línea pone en línea a su MATRIZ también (una matriz sale en línea si
 * cualquiera de sus sedes lo está); una sucursal NO hereda de su matriz.
 */
export function barberiasEnLinea(filas: UltimoUsoSede[], ahora: Date = new Date()): Set<string> {
  const out = new Set<string>();
  for (const f of filas) {
    if (!estaEnLinea(f.ultimo, ahora)) continue;
    out.add(f.barbershopId);
    if (f.parentId) out.add(f.parentId);
  }
  return out;
}

/**
 * «N en línea» del resumen de la lista: cuenta cada barbería UNA vez. Una
 * sucursal cuya matriz está en la misma lista no suma aparte (su uso ya
 * enciende a la matriz), como las sedes incluidas en el resumen del dental.
 */
export function contarEnLinea(filas: Array<{ id: string; parentId: string | null; enLinea: boolean }>): number {
  const ids = new Set(filas.map((f) => f.id));
  let n = 0;
  for (const f of filas) {
    if (!f.enLinea) continue;
    if (f.parentId && ids.has(f.parentId)) continue;
    n += 1;
  }
  return n;
}
