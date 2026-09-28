// ═══════════════════════════════════════════════════════════════════════════
// EL BLOQUE «ORTODONCIA» DE FINANZAS (ws1-t5, ronda 6 — fila 90 de la revisión
// de lógica de uso). Puro, sin I/O.
//
// Lo que el dueño no podía ver en ningún sitio: cuánto entra por ortodoncia,
// cuántos casos lleva cada doctor, cuántos casos se abandonan y qué tan vieja
// es la deuda. Nada de esto se calcula por su cuenta: los casos llegan con su
// `CobranzaDelCaso` ya resuelto (el mismo de Tablero, Alertas y Cobranza) y el
// dinero cobrado sale de `produccion.ts`. Aquí solo se cuenta y se reparte.
// ═══════════════════════════════════════════════════════════════════════════

import type { OrthoTreatmentStatus } from "@prisma/client";
import { diasEntre } from "./cobranza-modulo";
import type { ProduccionDeDoctor } from "./produccion";
import { ACTIVE_PLAN_STATUSES, type OrthoCaseSummary } from "./specialty-kpis";

const aCentavos = (pesos: number) => Math.round((Number(pesos) || 0) * 100);

export interface ConteoDeCasos {
  /** Casos abiertos: planeados, en tratamiento, en pausa y en retención. */
  activos: number;
  /** De los activos, cuántos están en pausa. */
  enPausa: number;
  terminados: number;
  abandonados: number;
  total: number;
  /**
   * Abandonados entre todos los casos que ya cerraron (terminados +
   * abandonados), en porcentaje entero. `null` si todavía no ha cerrado
   * ninguno: con cero casos cerrados no hay tasa que dar, y «0 %» sería
   * presumir de algo que aún no se ha medido.
   */
  tasaDeAbandono: number | null;
}

export function conteoDeCasos(cases: Array<{ status: OrthoTreatmentStatus }>): ConteoDeCasos {
  let activos = 0;
  let enPausa = 0;
  let terminados = 0;
  let abandonados = 0;
  for (const c of cases) {
    if (ACTIVE_PLAN_STATUSES.includes(c.status)) activos += 1;
    if (c.status === "ON_HOLD") enPausa += 1;
    else if (c.status === "COMPLETED") terminados += 1;
    else if (c.status === "DROPPED_OUT") abandonados += 1;
  }
  const cerrados = terminados + abandonados;
  return {
    activos,
    enPausa,
    terminados,
    abandonados,
    total: cases.length,
    tasaDeAbandono: cerrados > 0 ? Math.round((abandonados / cerrados) * 100) : null,
  };
}

export type ClaveDeTramo = "1-30" | "31-60" | "61-90" | "90+";

export interface TramoDeCartera {
  clave: ClaveDeTramo;
  etiqueta: string;
  /** Lo que falta de las cuotas vencidas de ese tramo, en pesos. */
  importe: number;
  /** Cuántos casos tienen al menos una cuota vencida en ese tramo. */
  casos: number;
}

export interface CarteraDeOrtodoncia {
  /** Todo lo que falta por cobrar de los casos, en pesos. */
  porCobrar: number;
  /** Lo que ya pasó de su fecha, en pesos. Es la suma de los tramos. */
  vencido: number;
  casosConAtraso: number;
  tramos: TramoDeCartera[];
}

const TRAMOS: Array<{ clave: ClaveDeTramo; etiqueta: string; hasta: number }> = [
  { clave: "1-30", etiqueta: "1 a 30 días", hasta: 30 },
  { clave: "31-60", etiqueta: "31 a 60 días", hasta: 60 },
  { clave: "61-90", etiqueta: "61 a 90 días", hasta: 90 },
  { clave: "90+", etiqueta: "Más de 90 días", hasta: Number.POSITIVE_INFINITY },
];

/** A qué tramo cae un atraso de `dias` días (mínimo 1: una cuota vencida lleva al menos un día). */
export function tramoDe(dias: number): ClaveDeTramo {
  const d = Math.max(1, dias);
  return (TRAMOS.find((t) => d <= t.hasta) ?? TRAMOS[TRAMOS.length - 1]).clave;
}

/**
 * Antigüedad de la cartera: cada cuota vencida va al tramo de SUS días de
 * atraso (no al de la más vieja del caso), así un caso con una cuota de hace
 * 100 días y otra de hace 10 reparte su deuda entre dos tramos. `hoy` es
 * "YYYY-MM-DD" en la zona de la clínica.
 */
export function carteraDeOrtodoncia(cases: OrthoCaseSummary[], hoy: string): CarteraDeOrtodoncia {
  const importeC = new Map<ClaveDeTramo, number>(TRAMOS.map((t) => [t.clave, 0]));
  const casosPorTramo = new Map<ClaveDeTramo, Set<string>>(TRAMOS.map((t) => [t.clave, new Set<string>()]));
  const conAtraso = new Set<string>();
  let porCobrarC = 0;

  for (const c of cases) {
    if (!c.cobranza) continue;
    porCobrarC += aCentavos(c.cobranza.saldoTotal);
    for (const q of c.cobranza.vencidas) {
      const faltaC = aCentavos(q.falta);
      if (faltaC <= 0) continue;
      const dias = q.vencimiento ? diasEntre(q.vencimiento, hoy) : null;
      const clave = tramoDe(dias ?? 1);
      importeC.set(clave, (importeC.get(clave) ?? 0) + faltaC);
      casosPorTramo.get(clave)!.add(c.planId);
      conAtraso.add(c.planId);
    }
  }

  const tramos = TRAMOS.map((t) => ({
    clave: t.clave,
    etiqueta: t.etiqueta,
    importe: (importeC.get(t.clave) ?? 0) / 100,
    casos: casosPorTramo.get(t.clave)!.size,
  }));
  return {
    porCobrar: porCobrarC / 100,
    vencido: tramos.reduce((s, t) => s + aCentavos(t.importe), 0) / 100,
    casosConAtraso: conAtraso.size,
    tramos,
  };
}

export interface FilaDeDoctor {
  doctorId: string | null;
  doctor: string;
  /** Casos abiertos que lleva HOY. */
  casosActivos: number;
  /** Cobrado menos reembolsado en el periodo, de los casos que llevaba el día de cada pago. */
  ingresos: number;
}

/**
 * Una fila por doctor: los casos abiertos que lleva hoy y lo que cobró en el
 * periodo. Un doctor sale si tiene casos abiertos O si cobró algo (quien ya
 * no lleva casos pero cobró este mes también cuenta). Orden: quien más cobró
 * primero; en empate, quien más casos lleva.
 */
export function filasPorDoctor(cases: OrthoCaseSummary[], produccion: ProduccionDeDoctor[]): FilaDeDoctor[] {
  const SIN = "__sin_doctor__";
  const filas = new Map<string, FilaDeDoctor>();
  const fila = (doctorId: string | null, doctor: string) => {
    const clave = doctorId ?? SIN;
    let f = filas.get(clave);
    if (!f) {
      f = { doctorId, doctor, casosActivos: 0, ingresos: 0 };
      filas.set(clave, f);
    }
    return f;
  };

  for (const p of produccion) fila(p.doctorId, p.doctorName).ingresos = p.amountMxn;
  for (const c of cases) {
    if (!ACTIVE_PLAN_STATUSES.includes(c.status)) continue;
    const f = fila(c.treatingDoctorId, c.treatingDoctorName ?? "Sin doctor tratante");
    f.casosActivos += 1;
    // El nombre del caso manda sobre el de la producción si éste venía sin resolver.
    if (c.treatingDoctorId && c.treatingDoctorName) f.doctor = c.treatingDoctorName;
  }

  return Array.from(filas.values()).sort(
    (a, b) => b.ingresos - a.ingresos || b.casosActivos - a.casosActivos || a.doctor.localeCompare(b.doctor, "es"),
  );
}

/** Lo que devuelve GET /api/finanzas/ortodoncia. */
export interface BloqueOrtodonciaFinanzas {
  /** `false` = la clínica no tiene el módulo ni casos: el bloque no se pinta. */
  activo: boolean;
  /** `false` con `activo: true` = tiene casos pero el módulo ya no está vigente: se lee, no se opera. */
  moduloVigente: boolean;
  periodo: { cobrado: number; reembolsado: number; neto: number };
  porDoctor: FilaDeDoctor[];
  casos: ConteoDeCasos;
  cartera: CarteraDeOrtodoncia;
}

export const BLOQUE_ORTODONCIA_INACTIVO: BloqueOrtodonciaFinanzas = {
  activo: false,
  moduloVigente: false,
  periodo: { cobrado: 0, reembolsado: 0, neto: 0 },
  porDoctor: [],
  casos: { activos: 0, enPausa: 0, terminados: 0, abandonados: 0, total: 0, tasaDeAbandono: null },
  cartera: { porCobrar: 0, vencido: 0, casosConAtraso: 0, tramos: [] },
};
