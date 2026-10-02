// Las ventanas de tiempo de Reportes, cortadas en la ZONA DE LA CLÍNICA.
//
// 12h (ticket 3 de BEVADENT): `cargar-reportes.ts` armaba el mes con
// `new Date(año, mes, 1)` — el reloj y la zona del PROCESO. En Vercel eso es
// UTC: para una clínica del centro de México (UTC-6) el mes «cambiaba» a las
// 18:00 del último día, así que un cobro del 30-sep a las 20:00 caía en octubre,
// y desde las 18:00 del día 30 el KPI «Pacientes nuevos este mes» ya contaba
// el mes siguiente. Aquí todo se corta por día de calendario de la clínica
// (`tzLocalToUtc`, el mismo que usa la agenda).
//
// Todos los fines son EXCLUSIVOS (se consultan con `lt`): con el `23:59:59`
// inclusivo de antes, un cobro a las 23:59:59.500 no entraba en ningún mes.
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";

export interface MesDeReportes {
  /** Medianoche local del día 1, en UTC. */
  start: Date;
  /** Medianoche local del día 1 del mes siguiente, en UTC — EXCLUSIVO. */
  end: Date;
  /** «sep 26»: el mes visto en la zona de la clínica. */
  label: string;
}

export interface VentanasDeReportes {
  /** Los últimos 6 meses, del más viejo al actual. */
  meses: MesDeReportes[];
  inicioMes: Date;
  inicioMesAnterior: Date;
  /** Fin del mes anterior, EXCLUSIVO (= `inicioMes`). */
  finMesAnterior: Date;
  inicioHoy: Date;
  /** Fin de hoy, EXCLUSIVO. */
  finHoy: Date;
  /** Fin de los próximos 7 días (hoy incluido), EXCLUSIVO. */
  finSemana: Date;
  hace30Dias: Date;
}

const pad = (n: number) => n.toString().padStart(2, "0");

/** 'YYYY-MM-01' del mes `desfase` meses antes/después del (año, mes 1-12). */
function primeroDelMes(anio: number, mes: number, desfase: number): string {
  const idx = anio * 12 + (mes - 1) + desfase;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}-01`;
}

/** 'YYYY-MM-DD' de `dias` días después del calendario (año, mes, día), sin aritmética de husos. */
function sumarDias(anio: number, mes: number, dia: number, dias: number): string {
  const d = new Date(Date.UTC(anio, mes - 1, dia + dias, 12, 0, 0));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function ventanasDeReportes(ahora: Date, timezone: string): VentanasDeReportes {
  const p = getTzParts(ahora, timezone);
  const inicio = (iso: string) => tzLocalToUtc(iso, 0, 0, timezone);

  const meses: MesDeReportes[] = Array.from({ length: 6 }, (_, i) => {
    const desfase = -(5 - i);
    const start = inicio(primeroDelMes(p.year, p.month, desfase));
    const end = inicio(primeroDelMes(p.year, p.month, desfase + 1));
    return {
      start,
      end,
      label: start.toLocaleDateString("es-MX", { month: "short", year: "2-digit", timeZone: timezone }),
    };
  });

  const hoyISO = sumarDias(p.year, p.month, p.day, 0);
  return {
    meses,
    inicioMes: meses[5].start,
    inicioMesAnterior: meses[4].start,
    finMesAnterior: meses[4].end,
    inicioHoy: inicio(hoyISO),
    finHoy: inicio(sumarDias(p.year, p.month, p.day, 1)),
    finSemana: inicio(sumarDias(p.year, p.month, p.day, 7)),
    hace30Dias: new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000),
  };
}
