/**
 * EL CONTRATO DEL HORARIO POR DOCTOR — lo que la pantalla espera del servidor.
 *
 * La API la escribe ws1-t2 en `src/lib/horario-doctor/` y `src/app/api/`, EN
 * PARALELO con esta pantalla. Esto es la otra mitad del cable y vive aquí a
 * propósito, igual que `bloqueos/tipos.ts`: la pantalla NO importa de esas
 * carpetas, así que compila, se prueba y puede entrar a `main` antes de que
 * existan. Cuando existan, lo único que tiene que cuadrar es este archivo:
 *
 *     GET    /api/team/[id]/horario   → { horario: Dia[], hereda: boolean }
 *     PUT    /api/team/[id]/horario   ← { horario: Dia[] }   (SIEMPRE los 7)
 *     DELETE /api/team/[id]/horario   → borra el propio y vuelve a heredar
 *
 *     Dia = { dayOfWeek: 0..6, enabled, openTime: "09:00", closeTime: "18:00" }
 *
 * Los errores llegan como `{ error: "CODIGO", mensaje: "frase" }`, y se pinta
 * SIEMPRE `mensaje` (ver `mensajeDeError` en `bloqueos/tipos.ts`).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 `dayOfWeek` ES 0=LUNES … 6=DOMINGO. NO ES EL `getDay()` DE JAVASCRIPT.
 *
 * Es la convención de `ClinicSchedule` en todo el repo (el seed, el PATCH de
 * `/api/settings/schedule`, la lista `DAYS` de Configuración). Confundirlo
 * corre la semana entera un día: el doctor pone «lunes» y se le agenda el
 * domingo. Por eso aquí no hay ni un `new Date().getDay()`: el índice del
 * arreglo ES el `dayOfWeek`, y los nombres salen de una lista que empieza en
 * lunes.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 UN DOCTOR SIN HORARIO PROPIO SIGUE EL DE LA CLÍNICA. Eso es lo que
 * garantiza que el día del despliegue no cambie ni una agenda: nadie tiene
 * horario propio hasta que alguien se lo pone. La pantalla lo dice con esas
 * palabras, y `hereda` es el dato que manda.
 *
 * 🔴 TODO LO QUE ENTRA POR RED SE PARSEA. Un día que llegue raro cae a
 * «cerrado» en vez de tumbar la ventana.
 */

export interface Dia {
  /** 0=Lunes … 6=Domingo. Ver la cabecera. */
  dayOfWeek: number;
  enabled: boolean;
  /** `HH:MM`, 24 h. */
  openTime: string;
  /** `HH:MM`, 24 h. */
  closeTime: string;
}

export interface HorarioDoctorDTO {
  /** Los 7 días, ordenados de lunes a domingo. */
  horario: Dia[];
  /** `true` = no tiene horario propio: sigue el de la clínica. */
  hereda: boolean;
}

export const DIAS_SEMANA = 7;

/** El mismo patrón que valida `/api/settings/schedule` para la clínica. */
export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Las horas de un día que no trae ninguna: las de la fila nueva de la clínica. */
export const APERTURA_POR_DEFECTO = "09:00";
export const CIERRE_POR_DEFECTO = "18:00";

/**
 * Las llaves i18n de los días, EN EL ORDEN DEL `dayOfWeek`: el índice 0 es
 * el lunes. Son las mismas que usa la lista `DAYS` de Configuración.
 */
export const LLAVES_DIA = [
  "settings.clientDays.monday",
  "settings.clientDays.tuesday",
  "settings.clientDays.wednesday",
  "settings.clientDays.thursday",
  "settings.clientDays.friday",
  "settings.clientDays.saturday",
  "settings.clientDays.sunday",
] as const;

/** Las abreviaturas, para el resumen de una línea. Mismo orden. */
export const LLAVES_DIA_CORTO = [
  "settings.horarioDoctor.diaCorto.lun",
  "settings.horarioDoctor.diaCorto.mar",
  "settings.horarioDoctor.diaCorto.mie",
  "settings.horarioDoctor.diaCorto.jue",
  "settings.horarioDoctor.diaCorto.vie",
  "settings.horarioDoctor.diaCorto.sab",
  "settings.horarioDoctor.diaCorto.dom",
] as const;

/* ────────────────────────────── parsers ────────────────────────────────── */

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const esDiaSemana = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < DIAS_SEMANA;

const hora = (v: unknown, fb: string): string =>
  typeof v === "string" && HORA_RE.test(v) ? v : fb;

/** Un día cerrado con las horas por defecto: lo que vale un día que falta. */
export function diaCerrado(dayOfWeek: number): Dia {
  return { dayOfWeek, enabled: false, openTime: APERTURA_POR_DEFECTO, closeTime: CIERRE_POR_DEFECTO };
}

/** Una fila, o `null` si ni siquiera dice qué día es. */
export function parseDia(raw: unknown): Dia | null {
  if (!esObjeto(raw) || !esDiaSemana(raw.dayOfWeek)) return null;
  return {
    dayOfWeek: raw.dayOfWeek,
    // Fail-closed: solo `true` abre el día. Un `"true"` o un `1` no.
    enabled: raw.enabled === true,
    openTime: hora(raw.openTime, APERTURA_POR_DEFECTO),
    closeTime: hora(raw.closeTime, CIERRE_POR_DEFECTO),
  };
}

/**
 * SIEMPRE los 7 días, de lunes a domingo. Un día que falte, o que llegue
 * repetido, queda como vino la primera vez o cerrado. Es lo mismo que hace
 * Configuración con el horario de la clínica: «los días sin fila van con
 * defaults y enabled=false».
 */
export function semanaCompleta(filas: unknown): Dia[] {
  const porDia = new Map<number, Dia>();
  if (Array.isArray(filas)) {
    for (const fila of filas) {
      const d = parseDia(fila);
      if (d && !porDia.has(d.dayOfWeek)) porDia.set(d.dayOfWeek, d);
    }
  }
  const out: Dia[] = [];
  for (let i = 0; i < DIAS_SEMANA; i++) out.push(porDia.get(i) ?? diaCerrado(i));
  return out;
}

/**
 * La respuesta del GET, o `null` si no se entiende. Sin `hereda` booleano no
 * se adivina: decir «sigue el de la clínica» a quien tiene uno propio (o al
 * revés) es justo la confusión que esta pantalla viene a quitar.
 */
export function parseHorarioDoctor(raw: unknown): HorarioDoctorDTO | null {
  if (!esObjeto(raw) || typeof raw.hereda !== "boolean") return null;
  return { horario: semanaCompleta(raw.horario), hereda: raw.hereda };
}

/**
 * El horario de la CLÍNICA a partir de sus filas de `ClinicSchedule`, o
 * `null` si la clínica no tiene ninguna. `null` quiere decir «no se sabe»: la
 * pantalla no avisa de nada contra un horario que no existe.
 */
export function horarioClinica(filas: unknown): Dia[] | null {
  if (!Array.isArray(filas) || filas.length === 0) return null;
  const alguna = filas.some((f) => parseDia(f) !== null);
  return alguna ? semanaCompleta(filas) : null;
}

/** El cuerpo del PUT. Los 7 días, siempre, de lunes a domingo. */
export function cuerpoPut(dias: Dia[]): { horario: Dia[] } {
  return {
    horario: semanaCompleta(dias).map((d) => ({
      dayOfWeek: d.dayOfWeek,
      enabled: d.enabled,
      openTime: d.openTime,
      closeTime: d.closeTime,
    })),
  };
}

/* ───────────────────────────── validaciones ────────────────────────────── */

/**
 * ¿Este día está mal escrito? Solo cuenta si está abierto: un día cerrado
 * con horas raras no le hace daño a nadie. La misma regla que el PATCH del
 * horario de la clínica (`openTime >= closeTime` es 400).
 */
export function rangoInvalido(d: Dia): boolean {
  if (!d.enabled) return false;
  if (!HORA_RE.test(d.openTime) || !HORA_RE.test(d.closeTime)) return true;
  return d.openTime >= d.closeTime;
}

export function hayRangoInvalido(dias: Dia[]): boolean {
  return dias.some(rangoInvalido);
}

export function algunDiaAbierto(dias: Dia[]): boolean {
  return dias.some((d) => d.enabled);
}

export function mismoHorario(a: Dia[], b: Dia[]): boolean {
  const x = semanaCompleta(a);
  const y = semanaCompleta(b);
  for (let i = 0; i < DIAS_SEMANA; i++) {
    if (x[i].enabled !== y[i].enabled) return false;
    // Las horas de un día cerrado no cuentan: no cambian nada.
    if (!x[i].enabled) continue;
    if (x[i].openTime !== y[i].openTime || x[i].closeTime !== y[i].closeTime) return false;
  }
  return true;
}

/* ─────────────────────── el aviso contra la clínica ─────────────────────── */

/**
 * Lo que se sale del horario de la clínica, para AVISAR (no para prohibir).
 *
 * La agenda ofrece la intersección: un doctor que pone 20:00 en una clínica
 * que cierra a las 18:00 no va a recibir citas de 18:00 a 20:00. Se le dice
 * ahí mismo, junto al día, y se le deja guardar igual — puede que la clínica
 * cambie su horario mañana.
 */
export type AvisoClinica =
  | { tipo: "cerrada" }
  | { tipo: "fuera"; abre: string; cierra: string; antes: boolean; despues: boolean };

export function avisoFueraDeClinica(dia: Dia, clinica: Dia[] | null): AvisoClinica | null {
  if (!dia.enabled || !clinica) return null;
  // Un rango mal escrito ya lleva su propio error; dos mensajes en la misma
  // fila se tapan el uno al otro.
  if (rangoInvalido(dia)) return null;
  const c = clinica[dia.dayOfWeek];
  if (!c || !c.enabled) return { tipo: "cerrada" };
  const antes = dia.openTime < c.openTime;
  const despues = dia.closeTime > c.closeTime;
  if (!antes && !despues) return null;
  return { tipo: "fuera", abre: c.openTime, cierra: c.closeTime, antes, despues };
}

/* ──────────────────────── el resumen de una línea ──────────────────────── */

/** Un tramo de días SEGUIDOS con las mismas horas: «Lun-Vie 9:00-19:00». */
export interface Tramo {
  desde: number;
  hasta: number;
  openTime: string;
  closeTime: string;
}

/**
 * Los días abiertos agrupados en tramos de días consecutivos con el mismo
 * horario, de lunes a domingo. Los cerrados no salen: el resumen dice cuándo
 * se atiende, no cuándo no.
 */
export function tramosDeSemana(dias: Dia[]): Tramo[] {
  const semana = semanaCompleta(dias);
  const out: Tramo[] = [];
  for (const d of semana) {
    if (!d.enabled || rangoInvalido(d)) continue;
    const ultimo = out[out.length - 1];
    if (
      ultimo &&
      ultimo.hasta === d.dayOfWeek - 1 &&
      ultimo.openTime === d.openTime &&
      ultimo.closeTime === d.closeTime
    ) {
      ultimo.hasta = d.dayOfWeek;
    } else {
      out.push({ desde: d.dayOfWeek, hasta: d.dayOfWeek, openTime: d.openTime, closeTime: d.closeTime });
    }
  }
  return out;
}

/** `"09:00"` → `"9:00"`. Solo para leer; al servidor va siempre `HH:MM`. */
export function horaCorta(h: string): string {
  return HORA_RE.test(h) && h.startsWith("0") ? h.slice(1) : h;
}

/** Lo que se necesita de `t`: así esto se prueba sin React ni proveedor. */
export type TLike = (key: string, vars?: Record<string, string | number>) => string;

/** «Lun-Vie 9:00-19:00 · Sáb 9:00-14:00», o `null` si no hay días abiertos. */
export function resumenSemana(dias: Dia[], t: TLike): string | null {
  const tramos = tramosDeSemana(dias);
  if (tramos.length === 0) return null;
  return tramos
    .map((tr) => {
      const abre = horaCorta(tr.openTime);
      const cierra = horaCorta(tr.closeTime);
      return tr.desde === tr.hasta
        ? t("settings.horarioDoctor.tramoUno", { dia: t(LLAVES_DIA_CORTO[tr.desde]), abre, cierra })
        : t("settings.horarioDoctor.tramoVarios", {
            desde: t(LLAVES_DIA_CORTO[tr.desde]),
            hasta: t(LLAVES_DIA_CORTO[tr.hasta]),
            abre,
            cierra,
          });
    })
    .join(" · ");
}
