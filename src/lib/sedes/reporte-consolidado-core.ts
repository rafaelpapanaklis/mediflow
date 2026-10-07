/**
 * Reporte consolidado de sedes (ws1-t10, auditoría BEVADENT · M6).
 *
 * PURO: sin Prisma ni React. Aquí viven los tipos, el periodo, la suma de las
 * sedes, el ticket promedio y el CSV; las consultas están en
 * `reporte-consolidado.server.ts` y la pantalla en
 * `src/app/dashboard/sedes/reporte/`. Las pruebas ejercitan esto con números.
 *
 * Definiciones (las MISMAS que el resto del panel; no se inventa ninguna):
 *  · ingresos = neto del periodo de @/lib/dinero (cobros − reembolsos, sin la
 *    historia migrada, con los anticipos cobrados sin factura): lo de Finanzas,
 *    Reportes, Inicio y Sabina;
 *  · citas = agendadas (todo menos CANCELLED); atendidas = COMPLETED o
 *    CHECKED_OUT; no-shows = NO_SHOW; tasa = no-shows ÷ agendadas;
 *  · pacientes nuevos = fichas creadas en el periodo (sin las borradas);
 *  · ocupación = la de Inicio y Analítica (`ocupacionDelPeriodo` de
 *    @/lib/agenda): minutos agendados ÷ horario de Ajustes por cada profesional
 *    que recibe citas; sin horario o sin profesionales no se calcula;
 *  · ticket promedio = cobrado bruto ÷ número de cobros (un cobro repartido en
 *    varias facturas cuenta una vez), igual que `ingresos_por_periodo`.
 */

export const PERIODOS = ["este-mes", "mes-pasado", "30-dias", "este-anio", "personalizado"] as const;
export type Periodo = (typeof PERIODOS)[number];

export interface RangoISO {
  desdeISO: string;
  hastaISO: string;
}

export interface FilaSedeReporte {
  clinicId: string;
  nombre: string;
  esActiva: boolean;
  /** Sede con el plan vencido o suspendida: se enseña con aviso, no se calla. */
  suspendida: boolean;
  ingresos: { neto: number; cobrado: number; reembolsos: number; numeroDeCobros: number };
  citas: { agendadas: number; atendidas: number; noShows: number; tasaNoShowPct: number | null };
  pacientesNuevos: number;
  /** `pct` nulo = sin horario en Ajustes o sin profesionales que reciban citas. */
  ocupacion: { pct: number | null; minutosOcupados: number; minutosDisponibles: number };
  ticketPromedio: number | null;
  /** La consulta de ESTA sede falló: se marca y se dice, no se presenta como cero. */
  fallo?: boolean;
}

export interface TotalesReporte {
  ingresosNeto: number;
  cobrado: number;
  reembolsos: number;
  numeroDeCobros: number;
  citasAgendadas: number;
  citasAtendidas: number;
  noShows: number;
  tasaNoShowPct: number | null;
  pacientesNuevos: number;
  ticketPromedio: number | null;
  /** Minutos agendados ÷ minutos disponibles de TODAS las sedes con horario (ponderada de verdad). */
  ocupacionPct: number | null;
}

export interface ReporteConsolidado extends RangoISO {
  periodo: Periodo;
  generadoEn: string;
  sedes: FilaSedeReporte[];
  totales: TotalesReporte;
}

/* ── Periodo ──────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function esFechaISO(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function sumarDiasISO(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Días naturales del periodo a partir del día de HOY en la zona de la sede
 * activa (`hoyISO`). Ambos extremos incluidos. Personalizado exige `desde` y
 * `hasta` válidos, en orden y de 366 días como mucho; si no, cae a «este mes».
 */
export function resolverPeriodo(periodo: string | null | undefined, hoyISO: string, desde?: string | null, hasta?: string | null): RangoISO & { periodo: Periodo } {
  const [y, m] = hoyISO.split("-").map(Number);
  const p: Periodo = (PERIODOS as readonly string[]).includes(periodo ?? "") ? (periodo as Periodo) : "este-mes";
  switch (p) {
    case "mes-pasado": {
      const ym = m === 1 ? [y - 1, 12] : [y, m - 1];
      const fin = new Date(Date.UTC(ym[0], ym[1], 0)).getUTCDate();
      return { periodo: p, desdeISO: iso(ym[0], ym[1], 1), hastaISO: iso(ym[0], ym[1], fin) };
    }
    case "30-dias":
      return { periodo: p, desdeISO: sumarDiasISO(hoyISO, -29), hastaISO: hoyISO };
    case "este-anio":
      return { periodo: p, desdeISO: iso(y, 1, 1), hastaISO: hoyISO };
    case "personalizado": {
      if (esFechaISO(desde) && esFechaISO(hasta) && desde <= hasta && diasEntre(desde, hasta) <= 366) {
        return { periodo: p, desdeISO: desde, hastaISO: hasta };
      }
      return { periodo: "este-mes", desdeISO: iso(y, m, 1), hastaISO: hoyISO };
    }
    default:
      return { periodo: "este-mes", desdeISO: iso(y, m, 1), hastaISO: hoyISO };
  }
}

export function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = Date.UTC(...(desdeISO.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  const b = Date.UTC(...(hastaISO.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  return Math.round((b - a) / 86_400_000) + 1;
}

/* ── Aritmética ───────────────────────────────────────────────────────── */

/** A centavos y de vuelta: sin ruido de flotantes en los totales. */
export const dinero = (n: number): number => Math.round(n * 100) / 100;

export function ticketPromedio(cobrado: number, numeroDeCobros: number): number | null {
  return numeroDeCobros > 0 ? dinero(cobrado / numeroDeCobros) : null;
}

export function tasaPct(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

/** Los totales de todas las sedes con dato (las que fallaron no suman: se dicen aparte). */
export function totalesDe(sedes: readonly FilaSedeReporte[]): TotalesReporte {
  const t = { ingresosNeto: 0, cobrado: 0, reembolsos: 0, numeroDeCobros: 0, citasAgendadas: 0, citasAtendidas: 0, noShows: 0, pacientesNuevos: 0 };
  let minutosOcupados = 0;
  let minutosDisponibles = 0;
  for (const s of sedes) {
    if (s.fallo) continue;
    t.ingresosNeto += s.ingresos.neto;
    t.cobrado += s.ingresos.cobrado;
    t.reembolsos += s.ingresos.reembolsos;
    t.numeroDeCobros += s.ingresos.numeroDeCobros;
    t.citasAgendadas += s.citas.agendadas;
    t.citasAtendidas += s.citas.atendidas;
    t.noShows += s.citas.noShows;
    t.pacientesNuevos += s.pacientesNuevos;
    if (s.ocupacion.pct !== null && s.ocupacion.minutosDisponibles > 0) {
      minutosOcupados += s.ocupacion.minutosOcupados;
      minutosDisponibles += s.ocupacion.minutosDisponibles;
    }
  }
  return {
    ingresosNeto: dinero(t.ingresosNeto),
    cobrado: dinero(t.cobrado),
    reembolsos: dinero(t.reembolsos),
    numeroDeCobros: t.numeroDeCobros,
    citasAgendadas: t.citasAgendadas,
    citasAtendidas: t.citasAtendidas,
    noShows: t.noShows,
    tasaNoShowPct: tasaPct(t.noShows, t.citasAgendadas),
    pacientesNuevos: t.pacientesNuevos,
    ticketPromedio: ticketPromedio(t.cobrado, t.numeroDeCobros),
    ocupacionPct: minutosDisponibles > 0 ? Math.round((minutosOcupados / minutosDisponibles) * 1000) / 10 : null,
  };
}

/** Qué parte del total de ingresos pone cada sede (para la comparativa). */
export function participacionPct(sede: FilaSedeReporte, totales: TotalesReporte): number | null {
  if (sede.fallo || totales.ingresosNeto <= 0 || sede.ingresos.neto <= 0) return null;
  return Math.round((sede.ingresos.neto / totales.ingresosNeto) * 1000) / 10;
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

function celda(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con BOM (Excel en español lo abre bien), una fila por sede y la de totales al final. */
export function csvDelReporte(r: ReporteConsolidado): string {
  const cab = [
    "Sede", "Estado", "Ingresos netos", "Cobrado", "Reembolsos", "Cobros", "Ticket promedio",
    "Citas agendadas", "Citas atendidas", "No-shows", "Tasa no-show %", "Pacientes nuevos", "Ocupación %",
  ];
  const filas = r.sedes.map((s) => [
    s.nombre,
    s.fallo ? "sin datos (falló la consulta)" : s.suspendida ? "suspendida" : "activa",
    s.fallo ? null : s.ingresos.neto,
    s.fallo ? null : s.ingresos.cobrado,
    s.fallo ? null : s.ingresos.reembolsos,
    s.fallo ? null : s.ingresos.numeroDeCobros,
    s.fallo ? null : s.ticketPromedio,
    s.fallo ? null : s.citas.agendadas,
    s.fallo ? null : s.citas.atendidas,
    s.fallo ? null : s.citas.noShows,
    s.fallo ? null : s.citas.tasaNoShowPct,
    s.fallo ? null : s.pacientesNuevos,
    s.fallo ? null : s.ocupacion.pct,
  ]);
  const t = r.totales;
  filas.push([
    "TOTAL", "", t.ingresosNeto, t.cobrado, t.reembolsos, t.numeroDeCobros, t.ticketPromedio,
    t.citasAgendadas, t.citasAtendidas, t.noShows, t.tasaNoShowPct, t.pacientesNuevos, t.ocupacionPct,
  ]);
  const lineas = [
    [`Reporte consolidado de sedes`, `${r.desdeISO} a ${r.hastaISO}`].map(celda).join(","),
    cab.map(celda).join(","),
    ...filas.map((f) => f.map(celda).join(",")),
  ];
  return "﻿" + lineas.join("\r\n") + "\r\n";
}
