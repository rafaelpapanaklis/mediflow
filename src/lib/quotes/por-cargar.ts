// ws1-t5 (F10): de la respuesta de GET /api/quotes, los presupuestos ACEPTADOS
// con algo todavía sin cargar (y qué conceptos). Puro, para «Cobrar hoy».

export interface PresupuestoPorCargar {
  id: string;
  folio: string;
  porCargar: number;
  conceptos: string[];
}

export function presupuestosPorCargar(respuesta: unknown): PresupuestoPorCargar[] {
  if (!Array.isArray(respuesta)) return [];
  const salida: PresupuestoPorCargar[] = [];
  for (const q of respuesta as Array<Record<string, any>>) {
    if (!q || q.status !== "ACCEPTED") continue;
    const cobro = q.cobro;
    const porCargar = Number(cobro?.porCargar);
    if (!cobro || !(porCargar > 0.005)) continue;
    const cargados = new Set<string>(Array.isArray(cobro.cargados) ? cobro.cargados : []);
    const conceptos = (Array.isArray(cobro.renglones) ? cobro.renglones : [])
      .filter((r: any) => r?.aceptado && !cargados.has(r.quoteItemId))
      .map((r: any) => String(r.nombre ?? ""))
      .filter(Boolean)
      .slice(0, 4);
    salida.push({ id: String(q.id), folio: String(q.folio ?? ""), porCargar: Math.round(porCargar * 100) / 100, conceptos });
  }
  return salida;
}
