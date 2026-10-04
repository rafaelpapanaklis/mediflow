// «Corregir gasto» de Finanzas (ws1-t2, auditoría de dinero F11). Puro: lo usan
// las dos pantallas de Finanzas (la de siempre y la del rediseño) para armar el
// PATCH /api/gastos, que deja antes y después en la bitácora.

export interface GastoOriginal {
  date: string;          // ISO
  category: string;
  amount: number;
  note: string | null;
}

export interface FormularioGasto {
  fecha: string;         // "YYYY-MM-DD"
  categoria: string;
  monto: number;
  nota: string;
}

/** El día del gasto en la hora LOCAL del navegador, como lo enseña el campo de fecha. */
export function fechaLocalDeGasto(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * Solo lo que CAMBIÓ, para el cuerpo del PATCH. La fecha va únicamente si se
 * cambió el día: reenviarla igual movería la hora guardada a las 00:00. `null`
 * si no hay nada que cambiar.
 */
export function cambiosDelGasto(
  original: GastoOriginal,
  form: FormularioGasto,
): { date?: string; category?: string; amount?: number; note?: string | null } | null {
  const out: { date?: string; category?: string; amount?: number; note?: string | null } = {};
  if (form.fecha && form.fecha !== fechaLocalDeGasto(original.date)) out.date = form.fecha;
  if (form.categoria.trim() && form.categoria.trim() !== original.category) out.category = form.categoria.trim();
  if (Math.round(form.monto * 100) !== Math.round((original.amount || 0) * 100)) out.amount = form.monto;
  const nota = form.nota.trim() || null;
  if (nota !== (original.note || null)) out.note = nota;
  return Object.keys(out).length ? out : null;
}
