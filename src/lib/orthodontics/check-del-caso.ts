// Ortodoncia — lo que la BASE admite en `orthodontic_treatment_plans` (ws1-t10, 29-sep-2026). Puro: sin Prisma ni React.
//
// La tabla lleva, desde la migración 20260505000000_orthodontics_module, dos restricciones que el código de
// «Pago por control» no respetaba:
//   · `orthodontic_treatment_plans_duration_chk`: estimatedDurationMonths BETWEEN 3 AND 60 AND totalCostMxn > 0
//   · `orthodontic_treatment_plans_dropped_out_chk`: DROPPED_OUT pide droppedOutAt y un motivo de ≥ 20 caracteres
// Un caso «Pago por control» no tiene total (cada control se cobra aparte), así que guardaba 0 y la base lo rechazaba
// (Postgres 23514). Los dobles en memoria no aplicaban la restricción y por eso nadie lo vio.
//
// `sql/ortodoncia-costo-del-caso.sql` relaja la restricción (costo ≥ 0, duración 1..120). MIENTRAS ese SQL no esté
// pegado, el código guarda un costo ESTIMADO > 0 (o, sin ningún dato, $1 provisional) y la duración acotada a 3..60.
// Este archivo concentra esas reglas para que cada ruta que escribe un caso las aplique igual, y trae la restricción
// simulada (`violacionesDelPlan`) que usan los dobles de las pruebas y la comprobación previa del importador.

/** Duración que la restricción VIGENTE admite (meses). */
export const DURACION_MIN_MESES = 3;
export const DURACION_MAX_MESES = 60;
/** Duración que admitirá la restricción corregida por `sql/ortodoncia-costo-del-caso.sql`. */
export const DURACION_MIN_MESES_CORREGIDA = 1;
export const DURACION_MAX_MESES_CORREGIDA = 120;

/**
 * Un peso: lo único que se guarda cuando NO hay ningún dato para estimar el costo de un caso «Pago por control»
 * (la restricción vigente exige > 0). Nunca es un precio: `costoVisible` lo trata como «sin estimar».
 */
export const COSTO_PROVISIONAL = 1;

export const CHECK_DURACION_Y_COSTO = "orthodontic_treatment_plans_duration_chk";
export const CHECK_ABANDONO = "orthodontic_treatment_plans_dropped_out_chk";

/** `vigente` = la de la migración original; `corregida` = la que deja `sql/ortodoncia-costo-del-caso.sql`. */
export type ReglaDelCheck = "vigente" | "corregida";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que de una fila de `orthodontic_treatment_plans` miran las restricciones. */
export interface FilaDelPlan {
  estimatedDurationMonths?: number | null;
  totalCostMxn?: number | string | { toString(): string } | null;
  status?: string | null;
  droppedOutAt?: Date | string | null;
  droppedOutReason?: string | null;
}

/**
 * Las restricciones de la tabla aplicadas a una fila (la base las evalúa al insertar/actualizar; NULL en un CHECK
 * cuenta como cumplido, pero estas dos columnas son NOT NULL). Devuelve un texto por cada una que se rompe, con el
 * nombre de la restricción; vacío = la base la aceptaría.
 */
export function violacionesDelPlan(fila: FilaDelPlan, regla: ReglaDelCheck = "vigente"): string[] {
  const fallas: string[] = [];
  const min = regla === "vigente" ? DURACION_MIN_MESES : DURACION_MIN_MESES_CORREGIDA;
  const max = regla === "vigente" ? DURACION_MAX_MESES : DURACION_MAX_MESES_CORREGIDA;
  const meses = fila.estimatedDurationMonths;
  if (meses !== undefined && meses !== null && !(meses >= min && meses <= max)) {
    fallas.push(`${CHECK_DURACION_Y_COSTO}: la duración estimada (${meses}) debe estar entre ${min} y ${max} meses`);
  }
  if (fila.totalCostMxn !== undefined && fila.totalCostMxn !== null) {
    const costo = Number(fila.totalCostMxn.toString());
    const ok = regla === "vigente" ? costo > 0 : costo >= 0;
    if (!Number.isFinite(costo) || !ok) {
      fallas.push(`${CHECK_DURACION_Y_COSTO}: el costo total (${fila.totalCostMxn}) debe ser ${regla === "vigente" ? "mayor que" : "mayor o igual a"} cero`);
    }
  }
  if (fila.status === "DROPPED_OUT") {
    const motivo = (fila.droppedOutReason ?? "").length;
    if (!fila.droppedOutAt || motivo < 20) {
      fallas.push(`${CHECK_ABANDONO}: un caso abandonado pide fecha de abandono y un motivo de al menos 20 caracteres`);
    }
  }
  return fallas;
}

/** Duración estimada (meses) que se puede guardar bajo la restricción vigente, y el valor real si hubo que acotarla. */
export function acotarDuracion(meses: number | null | undefined, porDefecto = 18): { meses: number; real: number | null } {
  const n = Number(meses);
  if (!Number.isFinite(n) || n <= 0) return { meses: porDefecto, real: null };
  const entero = Math.round(n);
  const acotado = Math.min(DURACION_MAX_MESES, Math.max(DURACION_MIN_MESES, entero));
  return { meses: acotado, real: acotado === entero ? null : entero };
}

/**
 * El mejor estimado del costo de un caso «Pago por control»: la colocación más los controles previstos por el precio
 * del control; sin eso, la suma de los cargos conocidos del archivo. `null` = no hay ningún dato.
 */
export function estimarCostoPorControl(a: {
  colocacion?: number | null;
  controlesPrevistos?: number | null;
  precioControl?: number | null;
  /** Lo que suman los controles cuando ya se conoce el precio de cada uno (manda sobre previstos × precio). */
  importeDeControles?: number | null;
  /** Suma de todos los cargos que se conocen (p. ej. lo que trae el archivo del sistema anterior). */
  cargosConocidos?: number | null;
}): number | null {
  const colocacion = Number(a.colocacion) > 0 ? Number(a.colocacion) : 0;
  const controles = Math.floor(Number(a.controlesPrevistos));
  const precio = Number(a.precioControl);
  const sumados = Number(a.importeDeControles);
  const deControles = sumados > 0 ? sumados : controles > 0 && precio > 0 ? controles * precio : 0;
  const porPartes = round2(colocacion + deControles);
  if (porPartes > 0) return porPartes;
  const conocidos = round2(Number(a.cargosConocidos) || 0);
  return conocidos > 0 ? conocidos : null;
}

export type OrigenDelCosto = "escrito" | "estimado" | "provisional";

/**
 * El costo que se guarda en un caso «Pago por control» bajo la restricción vigente (> 0): lo que se escribió; si no
 * hay, el estimado; si tampoco, $1 provisional. En «Precio total» el costo no se toca (lo decide quien abre el caso).
 */
export function costoParaGuardarPorControl(a: { escrito?: number | null; estimado?: number | null }): { costo: number; origen: OrigenDelCosto } {
  const escrito = Number(a.escrito);
  if (Number.isFinite(escrito) && escrito > 0) return { costo: round2(escrito), origen: "escrito" };
  const estimado = Number(a.estimado);
  if (Number.isFinite(estimado) && estimado > 0) return { costo: round2(estimado), origen: "estimado" };
  return { costo: COSTO_PROVISIONAL, origen: "provisional" };
}

/** El costo tal como se enseña: `null` si es el provisional (no hay ningún precio detrás). */
export function costoVisible(costo: number | string | { toString(): string } | null | undefined): number | null {
  if (costo === null || costo === undefined) return null;
  const n = Number(costo.toString());
  return Number.isFinite(n) && n > COSTO_PROVISIONAL ? n : null;
}

/**
 * Cómo se rotula el costo de un caso ante quien lo lee (PDF del plan, vistas): en «Pago por control» no es un total
 * sino un ESTIMADO; el $1 provisional no se enseña. `null` = no hay costo que mostrar.
 */
export function descripcionDelCosto(modo: string | null | undefined, costo: number | string | { toString(): string } | null | undefined): { etiqueta: string; valor: number; estimado: boolean } | null {
  const valor = costoVisible(costo);
  if (valor === null) return null;
  return modo === "PAGO_POR_CONTROL"
    ? { etiqueta: "Costo estimado del tratamiento (referencia; cada control se cobra aparte)", valor, estimado: true }
    : { etiqueta: "Costo total del tratamiento", valor, estimado: false };
}

/** ¿El error de la base es una violación de una restricción CHECK de `orthodontic_treatment_plans`? */
export function esViolacionDelCheckDelPlan(e: unknown): boolean {
  const x = e as { code?: unknown; message?: unknown; meta?: { code?: unknown; constraint?: unknown; database_error?: unknown } } | null;
  if (!x || typeof x !== "object") return false;
  const texto = [x.message, x.meta?.constraint, x.meta?.database_error].filter((v): v is string => typeof v === "string").join(" ");
  if (texto.includes(CHECK_DURACION_Y_COSTO) || texto.includes(CHECK_ABANDONO)) return true;
  return (x.code === "23514" || x.meta?.code === "23514") && /orthodontic_treatment_plans/.test(texto);
}

/** Frase para quien usa la pantalla cuando la base rechaza el caso por una restricción (con qué valor y por qué). */
export function mensajeDelCheckDelPlan(fila: FilaDelPlan): string {
  const fallas = violacionesDelPlan(fila, "vigente");
  if (fallas.length === 0) return "La base de datos rechazó el caso por una restricción de la tabla de casos de ortodoncia.";
  return `La base de datos rechazó el caso: ${fallas.map((f) => f.replace(/^[a-z_]+: /, "")).join("; ")}.`;
}
