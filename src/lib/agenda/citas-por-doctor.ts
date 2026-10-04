// ═══════════════════════════════════════════════════════════════════════════
// CITAS POR DOCTOR con la definición única (ws1-t2, auditoría de uso C-11,
// segunda vuelta). Puro, sin Prisma (src/lib/agenda/__tests__/citas-por-doctor.test.ts).
//
// La segunda auditoría vio las «citas del mes» iguales en las cuatro pantallas
// (88), pero POR DOCTOR no cuadraban: Inicio 19/23/18/10 (suma 84) y Analítica
// y la nómina 11/17/13/13 (suma 75, «75 citas · 22 completadas»). Cada lista
// contaba otra cosa:
//   · Inicio: el mes entero sin canceladas, pero solo usuarios con rol DOCTOR
//     (las citas del dueño que atiende no salían);
//   · Analítica y nómina: del día 1 del mes del NAVEGADOR a «ahora» y CON las
//     canceladas;
//   · «completadas»: COMPLETED en Inicio; COMPLETED + CHECKED_OUT en Analítica.
// Ahora las tres cuentan con `citasDelPeriodoWhere` (periodo entero, zona de
// la clínica, sin canceladas), sobre la MISMA lista de personas —quien atiende
// más quien tuvo citas o cobros en el periodo— y «completadas» son las
// atendidas (COMPLETED y su cierre, CHECKED_OUT). La columna suma las citas
// del mes.
// ═══════════════════════════════════════════════════════════════════════════

/** Una cita «atendida»: el paciente vino y se le atendió (COMPLETED y su cierre, CHECKED_OUT). */
export const ESTADOS_ATENDIDOS = ["COMPLETED", "CHECKED_OUT"] as const;

export interface CitasDeDoctor {
  citas: number;
  atendidas: number;
  noAsistio: number;
}

/** Filas de `groupBy({ by: ["doctorId", "status"] })` → citas por doctor. */
export function contarCitasPorDoctor(
  filas: ReadonlyArray<{ doctorId: string | null; status: string; _count: { _all: number } }>,
): Map<string, CitasDeDoctor> {
  const out = new Map<string, CitasDeDoctor>();
  for (const f of filas) {
    if (!f.doctorId) continue;
    const g = out.get(f.doctorId) ?? { citas: 0, atendidas: 0, noAsistio: 0 };
    const n = f._count._all;
    g.citas += n;
    if ((ESTADOS_ATENDIDOS as readonly string[]).includes(f.status)) g.atendidas += n;
    if (f.status === "NO_SHOW") g.noAsistio += n;
    out.set(f.doctorId, g);
  }
  return out;
}

/** Quienes tuvieron citas en el periodo sin estar en la lista que la pantalla ya pinta. */
export function idsConCitasFueraDeLista(idsDeLaLista: Iterable<string>, citas: ReadonlyMap<string, CitasDeDoctor>): string[] {
  const enLista = new Set(idsDeLaLista);
  return Array.from(citas.entries())
    .filter(([id, c]) => !enLista.has(id) && c.citas > 0)
    .map(([id]) => id)
    .sort();
}

/** Días distintos (en la zona de la clínica) con al menos una cita, para «citas por día». */
export function diasConCitas(inicios: ReadonlyArray<Date>, zona: string): number {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
  return new Set(inicios.map((d) => f.format(d))).size;
}

/**
 * La ventana de Analítica › Doctores y de la nómina, `[desde, hasta)`. Con
 * `periodo=mes` es el mes ENTERO de la clínica (lo mismo que «Citas del mes» de
 * Inicio, Finanzas y Reportes); si no, el rango `from`–`to` que mandó la
 * pantalla, con `to` inclusivo. Sin nada, el mes de la clínica.
 */
export function ventanaDelPedido(
  p: { periodo?: string | null; from?: string | null; to?: string | null },
  mesDeLaClinica: () => { desde: Date; hasta: Date },
): { desde: Date; hasta: Date } {
  if (p.periodo === "mes" || (!p.from && !p.to)) return mesDeLaClinica();
  const hasta = p.to ? new Date(new Date(p.to).getTime() + 1) : new Date();
  const desde = p.from ? new Date(p.from) : new Date(hasta.getTime() - 30 * 86_400_000);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) || desde >= hasta) return mesDeLaClinica();
  return { desde, hasta };
}
