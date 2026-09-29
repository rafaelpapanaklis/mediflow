// Con qué día abre «Nueva cita» (ws1-t6, H5). Antes abría siempre con HOY,
// aunque quien la pedía estuviera viendo la agenda de otro día. Puro: la
// prueba lo importa sin navegador.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es un día de calendario válido «AAAA-MM-DD»? (rechaza 2026-02-31) */
export function esDiaISO(v: string | null | undefined): v is string {
  if (!v || !ISO.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/**
 * El día que se está viendo en la agenda, leído de la URL (`?date=`), o
 * `null` si no se está en la agenda o no hay día válido.
 */
export function diaDeLaAgendaVisible(pathname: string, search: string): string | null {
  if (!/^\/dashboard\/agenda(\/|$)/.test(pathname)) return null;
  const v = new URLSearchParams(search).get("date");
  return esDiaISO(v) ? v : null;
}

/**
 * El día con el que abre la ventana: el pedido a mano, si no el de la agenda
 * que se está viendo, si no hoy. Un día ya pasado no se ofrece (la ventana no
 * agenda en el pasado): cae a hoy.
 */
export function diaInicialDeNuevaCita(opts: { pedido?: string | null; visible: string | null; hoy: string }): string {
  for (const c of [opts.pedido, opts.visible]) {
    if (esDiaISO(c) && c >= opts.hoy) return c;
  }
  return opts.hoy;
}
