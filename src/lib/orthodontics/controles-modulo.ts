// ═══════════════════════════════════════════════════════════════════════════
// CONTROLES / AGENDA — la pantalla del módulo (ws1-t3, H16 de la QA en vivo del
// 28-sep-2026). Puro, sin I/O: recibe las citas y los casos ya cargados
// (`controles-data.ts`) y devuelve lo que pinta
// `/dashboard/orthodontics/controles`.
//
// Un control de ortodoncia ES una cita de la Agenda (`Appointment.type ===
// TIPO_CITA_CONTROL_ORTO`, decisión 2 de la arquitectura). Esta pantalla no es
// otra agenda: es la Agenda de siempre, filtrada a los controles.
//
// Las citas son INSTANTES: el día al que pertenecen se decide en la zona de la
// clínica, no en la del servidor (una cita de las 19:30 del lunes en Ciudad de
// México es martes en UTC).
// ═══════════════════════════════════════════════════════════════════════════

import { pintaDeEstado } from "@/lib/agenda-nueva/estados";
import { ACTIVE_PLAN_STATUSES, type OrthoCaseSummary } from "./specialty-kpis";

/** Cuántos días se enseñan después de hoy. */
export const DIAS_DE_LA_SEMANA = 7;

/** Con cuántos días sin control (y sin cita futura) un caso pasa de «pendiente» a «urgente». */
export const DIAS_SIN_CONTROL_URGENTE = 45;

export type EstadoDeCita =
  | "PENDING"
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "IN_CHAIR"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CHECKED_OUT"
  | "CANCELLED"
  | "NO_SHOW";

export interface CitaDeControl {
  appointmentId: string;
  patientId: string;
  patientName: string;
  doctorName: string | null;
  startsAt: Date;
  status: EstadoDeCita | string;
  /** `null` = aún no se registra la hoja de ese control. */
  hoja: "DRAFT" | "SIGNED" | null;
  /**
   * M3 (ws1-t8, Ronda 6): caso activo del paciente, para poder ofrecer
   * "Registrar control" en la fila misma cuando `hoja` todavía es `null`.
   * Opcional — los tests de este archivo no lo necesitan.
   */
  treatmentPlanId?: string | null;
}

export interface DiaDeControles {
  /** "YYYY-MM-DD", en la zona de la clínica. */
  dia: string;
  citas: CitaDeControl[];
}

export type TonoEstado = "exito" | "alerta" | "peligro" | "violeta" | "neutro";

const TONO_DE_ESTADO: Record<string, TonoEstado> = {
  SCHEDULED: "violeta",
  CONFIRMED: "exito",
  CHECKED_IN: "alerta",
  IN_CHAIR: "violeta",
  IN_PROGRESS: "violeta",
  COMPLETED: "neutro",
  CHECKED_OUT: "neutro",
  CANCELLED: "neutro",
  NO_SHOW: "peligro",
};

/**
 * Cómo se le dice a la clínica el estado de una cita, y con qué color.
 *
 * ws1-t4 ronda 6 (fila 24 de la revisión de lógica de uso): el TEXTO sale de
 * la misma fuente que la Agenda y la ficha del paciente (`pintaDeEstado`,
 * `agenda-nueva/estados.ts`). Antes esta pantalla tenía sus propios nombres
 * —«Por confirmar», «En sala de espera», «Atendida», «No se presentó»— y la
 * misma cita se llamaba de tres maneras según dónde se mirara. Los colores
 * son los de la tabla de citas de la ficha.
 */
export function estadoDeCita(status: string): { texto: string; tono: TonoEstado } {
  return { texto: pintaDeEstado(status).chipTexto, tono: TONO_DE_ESTADO[status] ?? "violeta" };
}

/** ¿Esta cita ya ocurrió (el paciente pasó a consulta y salió)? */
export function citaAtendida(status: string): boolean {
  return status === "COMPLETED" || status === "CHECKED_OUT";
}

/** El día de calendario de un instante, en la zona dada: "YYYY-MM-DD". */
export function diaEnZona(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** `dias` días de calendario después de `dia` ("YYYY-MM-DD"). Sin husos: mediodía UTC. */
export function sumarDias(dia: string, dias: number): string {
  const [a, m, d] = dia.split("-").map((x) => parseInt(x, 10));
  const f = new Date(Date.UTC(a, m - 1, d, 12));
  f.setUTCDate(f.getUTCDate() + dias);
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${f.getUTCFullYear()}-${dd(f.getUTCMonth() + 1)}-${dd(f.getUTCDate())}`;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «Mañana · martes 29 sep», «jueves 1 oct». */
export function rotuloDelDia(dia: string, hoy: string): string {
  const [a, m, d] = dia.split("-").map((x) => parseInt(x, 10));
  const semana = DIAS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()];
  const fecha = `${semana} ${d} ${MESES[m - 1]}`;
  if (dia === hoy) return `Hoy · ${fecha}`;
  if (dia === sumarDias(hoy, 1)) return `Mañana · ${fecha}`;
  return fecha;
}

export interface ControlesDeLaSemana {
  hoy: CitaDeControl[];
  /** De mañana a `DIAS_DE_LA_SEMANA` días: solo los días que tienen controles. */
  proximosDias: DiaDeControles[];
  /** Cuántos controles hay en `proximosDias`, sin contar los cancelados. */
  totalProximos: number;
  /** De hoy: cuántos siguen en pie, cuántos ya se atendieron y cuántos faltaron. */
  resumenHoy: { enPie: number; atendidos: number; faltaron: number; cancelados: number };
}

/**
 * Reparte las citas de control por día (en la zona de la clínica) y separa las
 * de hoy. Las canceladas se quedan en la lista —recepción quiere ver el hueco
 * que dejaron— pero no cuentan en los totales.
 */
export function controlesDeLaSemana(citas: CitaDeControl[], hoy: string, zona: string): ControlesDeLaSemana {
  const limite = sumarDias(hoy, DIAS_DE_LA_SEMANA);
  const porDia = new Map<string, CitaDeControl[]>();
  for (const c of [...citas].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const dia = diaEnZona(c.startsAt, zona);
    if (dia < hoy || dia > limite) continue;
    const lista = porDia.get(dia);
    if (lista) lista.push(c);
    else porDia.set(dia, [c]);
  }

  const deHoy = porDia.get(hoy) ?? [];
  const proximosDias = Array.from(porDia.entries())
    .filter(([dia]) => dia !== hoy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, lista]) => ({ dia, citas: lista }));

  const resumenHoy = { enPie: 0, atendidos: 0, faltaron: 0, cancelados: 0 };
  for (const c of deHoy) {
    if (c.status === "CANCELLED") resumenHoy.cancelados += 1;
    else if (c.status === "NO_SHOW") resumenHoy.faltaron += 1;
    else if (citaAtendida(c.status)) resumenHoy.atendidos += 1;
    else resumenHoy.enPie += 1;
  }

  return {
    hoy: deHoy,
    proximosDias,
    totalProximos: proximosDias.reduce((s, d) => s + d.citas.filter((c) => c.status !== "CANCELLED").length, 0),
    resumenHoy,
  };
}

export interface CasoSinControl {
  planId: string;
  patientId: string;
  patientName: string;
  treatingDoctorName: string | null;
  /** El último control al que SÍ vino (cita atendida u hoja registrada), o `null` si no hay ninguno. */
  ultimoControl: Date | null;
  /** Días de calendario desde ese control. `null` si no hay ninguno. */
  diasSinControl: number | null;
  /** Faltó a su último control (y no se le ha dado otra cita). */
  faltoAlUltimo: boolean;
  urgente: boolean;
}

export interface HistorialDeControles {
  /** Pacientes con al menos un control futuro que no está cancelado. */
  conControlFuturo: ReadonlySet<string>;
  /** Por paciente: el último control al que vino. */
  ultimoAtendido: ReadonlyMap<string, Date>;
  /** Por paciente: la última falta (NO_SHOW). */
  ultimaFalta: ReadonlyMap<string, Date>;
}

/**
 * Arma el historial a partir de las citas de control (pasadas y futuras) y de
 * las hojas de control ya registradas. Una cita pasada que nadie marcó como
 * atendida NI como falta, y que tampoco tiene hoja, no cuenta como control
 * hecho: no se sabe si vino.
 */
export function historialDeControles(
  citas: { patientId: string; startsAt: Date; status: string }[],
  ahora: Date,
  /** La fecha de la última hoja de control de cada paciente, si la hay. */
  hojas: { patientId: string; visitDate: Date }[] = [],
): HistorialDeControles {
  const conControlFuturo = new Set<string>();
  const ultimoAtendido = new Map<string, Date>();
  const ultimaFalta = new Map<string, Date>();
  const masReciente = (mapa: Map<string, Date>, id: string, f: Date) => {
    const previa = mapa.get(id);
    if (!previa || f > previa) mapa.set(id, f);
  };
  for (const c of citas) {
    if (c.status === "CANCELLED") continue;
    if (c.startsAt >= ahora) {
      if (c.status !== "NO_SHOW") conControlFuturo.add(c.patientId);
      continue;
    }
    if (c.status === "NO_SHOW") masReciente(ultimaFalta, c.patientId, c.startsAt);
    else if (citaAtendida(c.status)) masReciente(ultimoAtendido, c.patientId, c.startsAt);
  }
  for (const h of hojas) {
    if (h.visitDate <= ahora) masReciente(ultimoAtendido, h.patientId, h.visitDate);
  }
  return { conControlFuturo, ultimoAtendido, ultimaFalta };
}

/**
 * Quién falta de control: casos ACTIVOS sin ningún control futuro en la
 * agenda. El mismo criterio que la alerta «Falta de control» (L2,
 * `listMissingNextControl`), con el dato que le faltaba a la alerta: hace
 * cuánto fue el último. Arriba, quien lleva más tiempo sin venir; quien no
 * tiene ningún control registrado va al final (suele ser un caso recién abierto).
 */
export function casosSinControl(
  cases: OrthoCaseSummary[],
  historial: HistorialDeControles,
  hoy: string,
  zona: string,
): CasoSinControl[] {
  const vistos = new Set<string>();
  const salida: CasoSinControl[] = [];
  for (const c of cases) {
    if (!ACTIVE_PLAN_STATUSES.includes(c.status)) continue;
    if (historial.conControlFuturo.has(c.patientId)) continue;
    if (vistos.has(c.patientId)) continue;
    vistos.add(c.patientId);

    const ultimo = historial.ultimoAtendido.get(c.patientId) ?? null;
    const falta = historial.ultimaFalta.get(c.patientId) ?? null;
    const dias = ultimo ? diasDeCalendario(diaEnZona(ultimo, zona), hoy) : null;
    salida.push({
      planId: c.planId,
      patientId: c.patientId,
      patientName: c.patientName,
      treatingDoctorName: c.treatingDoctorName,
      ultimoControl: ultimo,
      diasSinControl: dias,
      faltoAlUltimo: falta !== null && (ultimo === null || falta > ultimo),
      urgente: dias !== null && dias >= DIAS_SIN_CONTROL_URGENTE,
    });
  }
  return salida.sort((a, b) => {
    if (a.diasSinControl === null && b.diasSinControl === null) return a.patientName.localeCompare(b.patientName, "es");
    if (a.diasSinControl === null) return 1;
    if (b.diasSinControl === null) return -1;
    return b.diasSinControl - a.diasSinControl || a.patientName.localeCompare(b.patientName, "es");
  });
}

function diasDeCalendario(desde: string, hasta: string): number {
  const leer = (f: string) => {
    const [a, m, d] = f.split("-").map((x) => parseInt(x, 10));
    return Date.UTC(a, m - 1, d);
  };
  return Math.max(0, Math.round((leer(hasta) - leer(desde)) / 86_400_000));
}

/** «Su último control fue hace 52 días», «… fue ayer», «Sin controles registrados». */
export function fraseSinControl(c: Pick<CasoSinControl, "diasSinControl" | "faltoAlUltimo">): string {
  const falto = c.faltoAlUltimo ? " · faltó a su última cita" : "";
  if (c.diasSinControl === null) {
    return c.faltoAlUltimo ? "Faltó a su cita · sin controles registrados" : "Sin controles registrados";
  }
  if (c.diasSinControl === 0) return `Su último control fue hoy${falto}`;
  if (c.diasSinControl === 1) return `Su último control fue ayer${falto}`;
  return `Su último control fue hace ${c.diasSinControl} días${falto}`;
}
