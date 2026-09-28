// ═══════════════════════════════════════════════════════════════════════════
// COBRANZA DE MENSUALIDADES — la pantalla del módulo (ws1-t3, H16 de la QA en
// vivo del 28-sep-2026). Puro, sin I/O: recibe los casos ya cargados y devuelve
// las filas y el resumen que pinta `/dashboard/orthodontics/cobranza`.
//
// NO calcula dinero por su cuenta. Cada caso llega con su `CobranzaDelCaso`
// resuelto por `cobranzaDelCasoUnificada` (cobranza-caso.ts) — el mismo que
// usan el Tablero, Alertas, Pacientes en tratamiento, la lista de Caja y la
// ficha. Aquí solo se ORDENA y se RESUME, para que esta pantalla no pueda
// decir un número distinto al de las demás.
//
// Las fechas son de CALENDARIO ("YYYY-MM-DD"): el vencimiento de una
// mensualidad no tiene hora ni zona. `hoy` lo da quien llama, ya en la zona de
// la clínica (`hoyEnZona`).
// ═══════════════════════════════════════════════════════════════════════════

import type { OrthoTreatmentStatus } from "@prisma/client";
import { ACTIVE_PLAN_STATUSES, type OrthoCaseSummary } from "./specialty-kpis";

/** Una mensualidad «por vencer» es la que vence de hoy a siete días: la misma ventana que la lista de Caja. */
export const HORIZONTE_POR_VENCER_DIAS = 7;

export type SituacionCobranza =
  /** Tiene al menos una cuota pasada de fecha sin saldar. */
  | "vencido"
  /** Va al corriente y su próxima cuota vence dentro del horizonte. */
  | "por-vencer"
  /** Va al corriente y su próxima cuota queda más lejos. */
  | "al-corriente"
  /** Ya no debe nada de su plan. */
  | "saldado"
  /** Caso activo sin factura del tratamiento (o sin plan de pagos): todavía no hay qué cobrar. */
  | "sin-plan";

export interface FilaCobranza {
  planId: string;
  patientId: string;
  patientName: string;
  treatingDoctorName: string | null;
  status: OrthoTreatmentStatus;
  /** `false` = caso cerrado (terminado o abandonado) que sigue debiendo. */
  casoActivo: boolean;
  situacion: SituacionCobranza;
  /** Lo que falta de las cuotas ya vencidas, en pesos. */
  vencido: number;
  cuotasVencidas: number;
  /** "YYYY-MM-DD" de la cuota vencida más vieja. */
  vencidoDesde: string | null;
  /** Días de calendario desde esa fecha hasta hoy. */
  diasDeAtraso: number | null;
  /** "YYYY-MM-DD" de la próxima cuota que aún no vence. */
  proximaFecha: string | null;
  /** Lo que falta de esa cuota, en pesos. */
  proximoImporte: number | null;
  /** Días de calendario de hoy a esa fecha (0 = vence hoy). */
  diasParaLaProxima: number | null;
  /** Todo lo que falta por cobrar del tratamiento (vencido + por vencer), en pesos. */
  porCobrar: number;
  cuotasPagadas: number;
  cuotasTotales: number;
}

export interface ResumenDeCobranza {
  vencido: { casos: number; cuotas: number; importe: number };
  porVencer: { casos: number; importe: number };
  /** Todo lo que falta por cobrar de todos los casos, en pesos. */
  porCobrar: number;
  alCorriente: number;
  sinPlan: number;
  total: number;
}

const aCentavos = (pesos: number) => Math.round((Number(pesos) || 0) * 100);
const aPesos = (centavos: number) => centavos / 100;

/** Días de calendario de `desde` a `hasta` ("YYYY-MM-DD"). Negativo si `hasta` es anterior. `null` si alguna no se lee. */
export function diasEntre(desde: string, hasta: string): number | null {
  const leer = (f: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = leer(desde);
  const b = leer(hasta);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

const ORDEN: Record<SituacionCobranza, number> = {
  vencido: 0,
  "por-vencer": 1,
  "al-corriente": 2,
  "sin-plan": 3,
  saldado: 4,
};

/**
 * Una fila por caso, con lo más urgente arriba: primero quien debe (el atraso
 * más viejo antes), luego quien está por vencer (la fecha más cercana antes),
 * luego el resto.
 *
 * Entran los casos ACTIVOS, deban o no. Un caso cerrado (terminado o
 * abandonado) entra solo si todavía debe: la deuda no se borra al cerrar.
 */
export function filasDeCobranza(cases: OrthoCaseSummary[], hoy: string): FilaCobranza[] {
  const filas: FilaCobranza[] = [];

  for (const c of cases) {
    const casoActivo = ACTIVE_PLAN_STATUSES.includes(c.status);
    const base = {
      planId: c.planId,
      patientId: c.patientId,
      patientName: c.patientName,
      treatingDoctorName: c.treatingDoctorName,
      status: c.status,
      casoActivo,
    };

    const cob = c.cobranza;
    const cuotasTotales = cob ? cob.pagadas.length + cob.vencidas.length + cob.proximas.length : 0;
    if (!cob || cuotasTotales === 0) {
      if (!casoActivo) continue;
      filas.push({
        ...base,
        situacion: "sin-plan",
        vencido: 0,
        cuotasVencidas: 0,
        vencidoDesde: null,
        diasDeAtraso: null,
        proximaFecha: null,
        proximoImporte: null,
        diasParaLaProxima: null,
        porCobrar: 0,
        cuotasPagadas: 0,
        cuotasTotales: 0,
      });
      continue;
    }

    const vencidoC = cob.vencidas.reduce((s, q) => s + aCentavos(q.falta), 0);
    const vencidoDesde = cob.vencidas.reduce<string | null>(
      (min, q) => (q.vencimiento && (min === null || q.vencimiento < min) ? q.vencimiento : min),
      null,
    );
    const proxima = cob.proximas.reduce<(typeof cob.proximas)[number] | null>(
      (min, q) => (q.vencimiento && (min === null || q.vencimiento < (min.vencimiento ?? "")) ? q : min),
      null,
    );
    const porCobrarC = aCentavos(cob.saldoTotal);
    if (!casoActivo && porCobrarC <= 0) continue;

    const diasParaLaProxima = proxima?.vencimiento ? diasEntre(hoy, proxima.vencimiento) : null;
    let situacion: SituacionCobranza;
    if (cob.vencidas.length > 0 && vencidoC > 0) situacion = "vencido";
    else if (porCobrarC <= 0) situacion = "saldado";
    else if (diasParaLaProxima !== null && diasParaLaProxima <= HORIZONTE_POR_VENCER_DIAS) situacion = "por-vencer";
    else situacion = "al-corriente";

    filas.push({
      ...base,
      situacion,
      vencido: aPesos(vencidoC),
      cuotasVencidas: situacion === "vencido" ? cob.vencidas.length : 0,
      vencidoDesde: situacion === "vencido" ? vencidoDesde : null,
      diasDeAtraso: situacion === "vencido" && vencidoDesde ? diasEntre(vencidoDesde, hoy) : null,
      proximaFecha: proxima?.vencimiento ?? null,
      proximoImporte: proxima ? proxima.falta : null,
      diasParaLaProxima,
      porCobrar: aPesos(porCobrarC),
      cuotasPagadas: cob.pagadas.length,
      cuotasTotales,
    });
  }

  return filas.sort((a, b) => {
    if (ORDEN[a.situacion] !== ORDEN[b.situacion]) return ORDEN[a.situacion] - ORDEN[b.situacion];
    if (a.situacion === "vencido") {
      const atraso = (b.diasDeAtraso ?? 0) - (a.diasDeAtraso ?? 0);
      if (atraso !== 0) return atraso;
      if (b.vencido !== a.vencido) return b.vencido - a.vencido;
    } else {
      const fecha = (a.proximaFecha ?? "9999").localeCompare(b.proximaFecha ?? "9999");
      if (fecha !== 0) return fecha;
    }
    return a.patientName.localeCompare(b.patientName, "es");
  });
}

/** Los totales de arriba de la pantalla. Suma en centavos: sin decimales perdidos. */
export function resumenDeCobranza(filas: FilaCobranza[]): ResumenDeCobranza {
  let vencidoC = 0;
  let porVencerC = 0;
  let porCobrarC = 0;
  const r: ResumenDeCobranza = {
    vencido: { casos: 0, cuotas: 0, importe: 0 },
    porVencer: { casos: 0, importe: 0 },
    porCobrar: 0,
    alCorriente: 0,
    sinPlan: 0,
    total: filas.length,
  };
  for (const f of filas) {
    porCobrarC += aCentavos(f.porCobrar);
    if (f.situacion === "vencido") {
      r.vencido.casos += 1;
      r.vencido.cuotas += f.cuotasVencidas;
      vencidoC += aCentavos(f.vencido);
    } else if (f.situacion === "por-vencer") {
      r.porVencer.casos += 1;
      porVencerC += aCentavos(f.proximoImporte ?? 0);
    } else if (f.situacion === "al-corriente" || f.situacion === "saldado") {
      r.alCorriente += 1;
    } else {
      r.sinPlan += 1;
    }
  }
  r.vencido.importe = aPesos(vencidoC);
  r.porVencer.importe = aPesos(porVencerC);
  r.porCobrar = aPesos(porCobrarC);
  return r;
}

export type FiltroCobranza = "todos" | "vencido" | "por-vencer" | "al-corriente";

/** ¿Entra esta fila en el filtro? «Al corriente» junta a quien va al día, a quien ya saldó y a quien aún no tiene plan. */
export function entraEnFiltro(fila: FilaCobranza, filtro: FiltroCobranza): boolean {
  if (filtro === "todos") return true;
  if (filtro === "vencido") return fila.situacion === "vencido";
  if (filtro === "por-vencer") return fila.situacion === "por-vencer";
  return fila.situacion === "al-corriente" || fila.situacion === "saldado" || fila.situacion === "sin-plan";
}

/** Minúsculas y sin acentos: «nunez» encuentra a «Núñez». */
export function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Las filas que se ven: el filtro de situación y, encima, el buscador por nombre de paciente o de doctor. */
export function filtrarCobranza(filas: FilaCobranza[], filtro: FiltroCobranza, consulta: string): FilaCobranza[] {
  const q = sinAcentos(consulta);
  return filas.filter(
    (f) =>
      entraEnFiltro(f, filtro) &&
      (q === "" || sinAcentos(f.patientName).includes(q) || sinAcentos(f.treatingDoctorName ?? "").includes(q)),
  );
}

/** «3 días de atraso», «1 día de atraso», «vence hoy», «vence mañana», «vence en 5 días». */
export function fraseDeAtraso(dias: number | null): string | null {
  if (dias === null || dias < 0) return null;
  if (dias === 0) return "venció hoy";
  return `${dias} ${dias === 1 ? "día" : "días"} de atraso`;
}

export function fraseDeProxima(dias: number | null): string | null {
  if (dias === null || dias < 0) return null;
  if (dias === 0) return "vence hoy";
  if (dias === 1) return "vence mañana";
  return `vence en ${dias} días`;
}

/** «2 pagos vencidos», «1 pago vencido»: una cuota vencida puede ser el enganche, no solo una mensualidad. */
export function fraseDeVencidos(n: number): string {
  return `${n} ${n === 1 ? "pago vencido" : "pagos vencidos"}`;
}
