// «Hecho» pregunta en qué cita se hizo (v17, decisión 1 de Rafael, 28-oct-2026). PURO: lo usan la tarjeta
// del plan y el servidor.
//
//  · Al pulsar «Hecho» en la tarjeta sale la elección con las citas recientes del paciente, la de HOY
//    primero (`ordenarCitasParaHecho`). «Hoy en el sillón» no pregunta: la cita es la de esa consulta.
//  · «Se hizo sin cita» pide un motivo corto y obligatorio (`limpiarMotivoSinCita`); queda en la fila
//    hecha y en Movimientos.
//  · Si la cita elegida no tiene nota clínica, la pantalla AVISA y ofrece escribirla. Nunca bloquea el
//    «Hecho» ni el cobro.

import { diaEnZona } from "@/lib/fechas/fecha-en-zona";

export const MIN_MOTIVO_SIN_CITA = 3;
export const MAX_MOTIVO_SIN_CITA = 200;

/** El motivo de «Se hizo sin cita», limpio (espacios juntados), o null si no llega a lo mínimo. */
export function limpiarMotivoSinCita(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.replace(/\s+/g, " ").trim().slice(0, MAX_MOTIVO_SIN_CITA);
  return m.length >= MIN_MOTIVO_SIN_CITA ? m : null;
}

/** Una cita que se puede elegir para «Hecho» (GET /api/treatments/[id]/citas-para-hecho). */
export interface CitaParaHecho {
  id: string;
  /** ISO. */
  startsAt: string;
  status: string;
  /** «Dra. Ana López» (nombre y apellido del doctor de la cita), o null. */
  doctor: string | null;
  /** El motivo de la cita («Resina», «Limpieza»…), si lo tiene. */
  motivo: string | null;
  /** Es de hoy en la zona de la clínica. */
  esHoy: boolean;
  /** Tiene nota clínica con algo escrito (ligada por `specialtyData.appointmentId`). */
  tieneNota: boolean;
  /**
   * v18 (t5 de la v17, m2): quien pregunta puede escribir AHORA la nota ligada a esta cita
   * («Marcar y escribir la nota»; regla en `notaLigable`).
   */
  notaLigable: boolean;
}

/** Estados en los que una cita no respalda nada: no se pasó (cancelada) o el paciente no vino. */
const CITA_SIN_CONSULTA = ["CANCELLED", "NO_SHOW"];
/** La consulta de la cita ya se cerró. */
const CITA_TERMINADA = ["COMPLETED", "CHECKED_OUT"];

/** Cuándo es la cita respecto de hoy, en la zona de la clínica. */
export type MomentoDeLaCita = "pasado" | "hoy" | "futuro";

/**
 * v18 (t5 de la v17, m2): ¿se puede ligar EXPLÍCITAMENTE una nota nueva de `quienEscribe` a esta cita
 * («Marcar y escribir la nota»)? Sí aunque sea de otro día o de otro doctor, salvo:
 *  · cancelada, «no vino» o de un día que aún no llega;
 *  · la cita de HOY de OTRO doctor que aún no termina (por atender, en sala o en consulta): esa consulta la
 *    escribe y la firma su doctor. «Completar consulta» firma la nota más reciente de la cita y «Nueva
 *    consulta» adopta el borrador de la cita: otra nota ligada antes le cambiaría cuál firma, o dejaría la
 *    suya suelta («una cita, una nota»).
 * El servidor exige además misma clínica y paciente, y algo del plan marcado «Hecho» en esa cita.
 */
export function notaLigable(cita: { status: string; doctorId: string | null; momento: MomentoDeLaCita }, quienEscribe: string): boolean {
  if (CITA_SIN_CONSULTA.includes(cita.status) || cita.momento === "futuro") return false;
  if (cita.doctorId === quienEscribe) return true;
  return CITA_TERMINADA.includes(cita.status) || cita.momento === "pasado";
}

/** Las de hoy primero (en orden de hora); después las demás, de la más reciente a la más vieja. */
export function ordenarCitasParaHecho<T extends Pick<CitaParaHecho, "startsAt" | "esHoy">>(citas: readonly T[]): T[] {
  const t = (c: T) => Date.parse(c.startsAt) || 0;
  return [
    ...citas.filter((c) => c.esHoy).sort((a, b) => t(a) - t(b)),
    ...citas.filter((c) => !c.esHoy).sort((a, b) => t(b) - t(a)),
  ];
}

/** Lo que la tarjeta manda en el PATCH según lo elegido: la cita, o «sin cita» con su motivo. */
export type EleccionDeCita = { citaId: string } | { sinCita: true; motivo: string };

// ── v19 (t5 de la v18, m1): la cita elegida, dicha en una frase ────────────────────────────────────

/** La cita que «Marcar y escribir la nota» lleva a «Nueva consulta». */
export interface CitaElegidaParaLaNota {
  id: string;
  /** ISO: el formulario arma la frase («la cita de hoy a las 10:00») en la zona de la clínica. */
  startsAt: string;
}

type T = (clave: string, vars?: Record<string, string | number>) => string;

/**
 * «la cita de hoy a las 10:00» · «la cita del martes 27 de octubre a las 10:00» · «a la 1:00» (es);
 * «today's appointment at 10:00 AM» · «the appointment on Tuesday, October 27 at 10:00 AM» (en). Con el año
 * solo si no es el de hoy. Antes se metía la etiqueta de la lista («Hoy, 10:00 a.m.», «mar 27 de oct…») en
 * «…la cita del {fecha}…» y salía «la cita del Hoy, 10:00 a.m.».
 */
export function fraseDeLaCitaElegida(
  t: T,
  startsAt: string,
  /** `locale`: «en» = inglés; cualquier otro, español (el de `useLocale()`). */
  opciones: { zona: string | null; locale: string; ahora?: Date },
): string {
  const inicio = new Date(startsAt);
  if (Number.isNaN(inicio.getTime())) return t("clinical.dentalForm.citaSinFecha");
  const en = opciones.locale === "en";
  const ahora = opciones.ahora ?? new Date();
  const conZona = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => (opciones.zona ? { ...o, timeZone: opciones.zona } : o);
  const partes = (o: Intl.DateTimeFormatOptions, fecha: Date) => {
    let p: Intl.DateTimeFormatPart[];
    try {
      p = new Intl.DateTimeFormat(en ? "en-US" : "es-MX", conZona(o)).formatToParts(fecha);
    } catch {
      p = new Intl.DateTimeFormat(en ? "en-US" : "es-MX", o).formatToParts(fecha); // zona inválida
    }
    return (tipo: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === tipo)?.value ?? "";
  };
  const h = partes(en ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit", hourCycle: "h23" }, inicio);
  // es-MX en 24 h escribe «01»: sin el cero («a la 1:05», «a las 9:30»).
  const horaSola = String(Number(h("hour")));
  const hora = en ? `${horaSola}:${h("minute")} ${h("dayPeriod")}`.trim() : `${horaSola}:${h("minute")}`;
  const aLas = t(!en && horaSola === "1" ? "clinical.dentalForm.horaALaUna" : "clinical.dentalForm.horaALas", { hora });
  if (diaEnZona(inicio, opciones.zona) === diaEnZona(ahora, opciones.zona)) return t("clinical.dentalForm.citaDeHoy", { aLas });
  const d = partes({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, inicio);
  const anio = partes({ year: "numeric" }, ahora)("year") !== d("year") ? d("year") : "";
  const dia = en
    ? `${d("weekday")}, ${d("month")} ${d("day")}${anio ? `, ${anio}` : ""}`
    : `${d("weekday")} ${d("day")} de ${d("month")}${anio ? ` de ${anio}` : ""}`;
  return t("clinical.dentalForm.citaDelDia", { dia, aLas });
}

