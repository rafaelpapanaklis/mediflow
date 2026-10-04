// Ortodoncia — «Registrar colocación» / «Colocar aparatos hoy» (ws1-t8, auditoría de BEVADENT: F12 y mejora 5). Puro:
// sin base ni React.
//
// Antes la colocación solo se registraba escribiendo «Fecha de colocación» dentro de «Datos del caso»; ninguna fila de
// Casos ni la cabecera del caso lo ofrecían, y de ella dependen el conteo de meses y los controles. Ahora un botón
// visible abre un cajón con la fecha (hoy propuesta), la técnica y los controles previstos; el caso pasa a «En curso»
// y se propone el calendario de controles (las fechas, cada «frecuencia de control» de la clínica). Nada se agenda
// solo: el primer control se agenda desde ahí con la «Nueva cita» de siempre (y su aviso al paciente de siempre).

import { CONTROLES_MAXIMOS } from "./plan-detalle";

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
/** No se registra una colocación de antes de esto (un año tecleado de más o de menos). */
export const PRIMER_ANIO_DE_COLOCACION = 2000;
/** Cuántas fechas del calendario propuesto se enseñan (el resto se dice como «y N más»). */
export const FECHAS_A_MOSTRAR = 6;

/** "YYYY-MM-DD" válido del calendario, o null. */
export function fechaDeCalendario(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = FECHA.exec(v.trim());
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return v.trim();
}

/**
 * El instante que se guarda en `installedAt`: el MEDIODÍA UTC de ese día. Así se lee el mismo día en cualquier zona de
 * México (a medianoche UTC, en UTC-6 caía el día anterior: el mismo defecto que tuvo la fecha de nacimiento).
 */
export function instanteDeColocacion(fecha: string): Date {
  return new Date(`${fecha}T12:00:00.000Z`);
}

export interface DatosDeColocacion {
  treatmentPlanId: string;
  /** "YYYY-MM-DD", en el calendario de la clínica. */
  fecha: string;
  /**
   * Id de la técnica elegida en la lista de la clínica («Técnicas y precios»). Ausente o `ID_TECNICA_ACTUAL` = la que
   * ya tiene el caso. El servidor la busca entre las ACTIVAS de la clínica: del navegador solo llega el id.
   */
  tecnicaId?: string;
  /** Controles previstos del plan. Ausente = no tocarlos. */
  controlesPrevistos?: number;
}

// Los dos campos en las dos formas: con `"strict": false` TypeScript no estrecha la unión por `ok`.
export type ValidacionDeColocacion = { ok: true; datos: DatosDeColocacion; error?: undefined } | { ok: false; error: string; datos?: undefined };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Lo que llega del cajón. `hoy` = "YYYY-MM-DD" de hoy en la zona de la clínica: la colocación no puede ser de un día
 * que aún no llega (se registra cuando se colocan los aparatos, no antes).
 */
export function validarColocacion(raw: unknown, hoy: string): ValidacionDeColocacion {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Los datos de la colocación llegaron en un formato que no se entiende." };
  const o = raw as Record<string, unknown>;
  if (typeof o.treatmentPlanId !== "string" || !ID.test(o.treatmentPlanId)) return { ok: false, error: "Caso no encontrado." };
  const fecha = fechaDeCalendario(o.fecha);
  if (!fecha) return { ok: false, error: "Elige la fecha de colocación." };
  if (fecha > hoy) return { ok: false, error: "La fecha de colocación no puede ser de un día que aún no llega." };
  if (Number(fecha.slice(0, 4)) < PRIMER_ANIO_DE_COLOCACION) return { ok: false, error: "Revisa el año de la fecha de colocación." };
  const datos: DatosDeColocacion = { treatmentPlanId: o.treatmentPlanId, fecha };
  if (o.tecnicaId !== undefined && o.tecnicaId !== null && o.tecnicaId !== "") {
    if (typeof o.tecnicaId !== "string" || !ID.test(o.tecnicaId)) return { ok: false, error: "Elige una técnica de la lista." };
    datos.tecnicaId = o.tecnicaId;
  }
  if (o.controlesPrevistos !== undefined && o.controlesPrevistos !== null && o.controlesPrevistos !== "") {
    const n = typeof o.controlesPrevistos === "string" ? Number(o.controlesPrevistos) : o.controlesPrevistos;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > CONTROLES_MAXIMOS) {
      return { ok: false, error: `Controles previstos: escribe un número entero de 1 a ${CONTROLES_MAXIMOS}.` };
    }
    datos.controlesPrevistos = n;
  }
  return { ok: true, datos };
}

/** Por qué este caso ya no se puede «colocar» (solo los «Por colocar»), o null. */
export function motivoParaNoColocar(status: string | null | undefined): string | null {
  if (status === "PLANNED") return null;
  if (status === "IN_PROGRESS" || status === "ON_HOLD" || status === "RETENTION") {
    return "Este caso ya tiene la colocación registrada. La fecha se corrige desde «Datos del caso».";
  }
  return "Este caso ya no está activo: no se le puede registrar la colocación.";
}

/** "YYYY-MM-DD" + días, en el calendario (sin horas ni zonas). */
export function sumarDiasACalendario(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export interface CalendarioPropuesto {
  /** Las primeras fechas propuestas ("YYYY-MM-DD"): la primera es el primer control. */
  fechas: string[];
  /** Cuántos controles quedan después de las que se enseñan. */
  masAdelante: number;
  /** Cuántos controles se proponen en total (los previstos, o los que se enseñan si no hay previstos). */
  total: number | null;
}

/** 0 = domingo … 6 = sábado, del día "YYYY-MM-DD" (sin zonas: es un día del calendario). */
export function diaDeLaSemana(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/**
 * C-69 (auditoría de uso): el día hábil más cercano EN O DESPUÉS de `fecha`. `diasCerrados` son los días de la
 * semana en que la clínica no abre (Configuración → Horario); sin horario conocido, solo el domingo. Si la clínica
 * no abre ningún día (dato roto), la fecha se queda como está.
 */
export function siguienteDiaHabil(fecha: string, diasCerrados: readonly number[] = [0]): string {
  const cerrados = new Set(diasCerrados.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (cerrados.size >= 7) return fecha;
  let f = fecha;
  for (let i = 0; i < 7 && cerrados.has(diaDeLaSemana(f)); i++) f = sumarDiasACalendario(f, 1);
  return f;
}

/**
 * El calendario de controles que se propone al colocar: uno cada `frecuenciaDias` desde la colocación (la frecuencia
 * de control de la clínica, Configuración → Plan de tratamiento). Sin «controles previstos» se enseñan las primeras
 * fechas sin decir cuántas son en total. Solo es una propuesta: nada se agenda solo.
 *
 * C-69: una fecha que cae en día cerrado (domingo, o los que diga el horario de la clínica) se corre al siguiente
 * día hábil; el siguiente control se sigue contando desde la colocación, no desde el día corrido.
 */
export function calendarioDeControles(
  fecha: string,
  frecuenciaDias: number,
  controlesPrevistos: number | null,
  diasCerrados: readonly number[] = [0],
): CalendarioPropuesto {
  const paso = Number.isInteger(frecuenciaDias) && frecuenciaDias >= 7 && frecuenciaDias <= 120 ? frecuenciaDias : 30;
  const total = controlesPrevistos && controlesPrevistos > 0 ? Math.min(controlesPrevistos, CONTROLES_MAXIMOS) : null;
  const cuantas = total === null ? FECHAS_A_MOSTRAR : Math.min(total, FECHAS_A_MOSTRAR);
  const fechas = Array.from({ length: cuantas }, (_, i) => siguienteDiaHabil(sumarDiasACalendario(fecha, paso * (i + 1)), diasCerrados));
  return { fechas, masAdelante: total === null ? 0 : total - fechas.length, total };
}

/** Los días de la semana en que la clínica NO abre, de sus filas de `clinic_schedules`. Sin filas: solo el domingo. */
export function diasCerradosDelHorario(filas: ReadonlyArray<{ dayOfWeek: number; enabled: boolean }> | null | undefined): number[] {
  if (!filas || filas.length === 0) return [0];
  const abiertos = new Set(filas.filter((f) => f.enabled).map((f) => f.dayOfWeek));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !abiertos.has(d));
}

/**
 * C-62 (auditoría de uso; decisión de Rafael 5): sin el consentimiento de ortodoncia firmado NO se registra la
 * colocación. `null` = no se pudo comprobar: tampoco se deja pasar (un aparato puesto sin papel no se deshace).
 */
export function motivoSinConsentimiento(firmado: boolean | null): string | null {
  if (firmado === true) return null;
  if (firmado === null) return "No se pudo comprobar el consentimiento de ortodoncia. Intenta de nuevo antes de registrar la colocación.";
  return "Falta el consentimiento de ortodoncia firmado: no se puede registrar la colocación. Créalo y fírmalo en «Consentimientos».";
}

/**
 * C-66 (auditoría de uso): con qué estado nace un caso. «Fecha de colocación» en el alta puede ser una colocación
 * PROGRAMADA (futura; tiene su recordatorio de WhatsApp 24 h antes): el caso nacía «En curso · Mes 0 · Inicio
 * 14-oct» con la fecha aún por llegar. Solo una colocación de hoy o anterior lo pone «En curso»; una futura lo
 * deja «Por colocar» con su fecha guardada. El cajón manda el DÍA como medianoche UTC (`new Date("YYYY-MM-DD")`),
 * así que se compara el día UTC de `instante` con `hoy` ("YYYY-MM-DD" en la zona de la clínica).
 */
export function colocadoAlAbrir(instante: Date | null, hoy: string): boolean {
  if (instante === null || Number.isNaN(instante.getTime())) return false;
  return instante.toISOString().slice(0, 10) <= hoy;
}
