// Procedimientos con el MISMO nombre en el tarifario (segunda auditoría de uso,
// N-08, 4-oct-2026). Puro, client-safe.
//
// «Nueva factura → Del tarifario» enseñaba dos «Blanqueamiento — $3,500.00»
// idénticos. Desde C-40 el renglón guarda el procedimiento que se toque, y ese
// decide la clave SAT y el IVA del CFDI: hay que poder distinguirlos. Aquí se
// dice, para cada repetido, qué lo distingue (categoría, duración, descripción)
// y cuál es de cuántos. Los repetidos se corrigen en Procedimientos.

export interface ProcedimientoParaDistinguir {
  id: string;
  name: string;
  basePrice?: number | null;
  category?: string | null;
  duration?: number | null;
  description?: string | null;
}

const norm = (t: string) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** id → texto corto que distingue al repetido («Repetido 1 de 2 · dental · 45 min · Con lámpara…»). Los únicos no salen. */
export function distintivosDeRepetidos(lista: readonly ProcedimientoParaDistinguir[]): Map<string, string> {
  const grupos = new Map<string, ProcedimientoParaDistinguir[]>();
  for (const p of lista) {
    const k = norm(p.name);
    if (!k) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  const out = new Map<string, string>();
  for (const g of Array.from(grupos.values())) {
    if (g.length < 2) continue;
    g.forEach((p, i) => {
      const partes = [`Repetido ${i + 1} de ${g.length}`];
      if (p.category) partes.push(p.category);
      if (p.duration) partes.push(`${p.duration} min`);
      const d = (p.description ?? "").trim();
      if (d) partes.push(d.length > 40 ? `${d.slice(0, 40)}…` : d);
      partes.push(`ref. ${p.id.slice(-4)}`);
      out.set(p.id, partes.join(" · "));
    });
  }
  return out;
}
