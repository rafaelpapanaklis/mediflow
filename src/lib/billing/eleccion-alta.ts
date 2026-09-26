/**
 * Lo que la persona eligió en el alta (plan y periodo mensual/anual), guardado
 * SOLO en su navegador para que la pantalla de pago (/dashboard/suspended) no
 * se lo vuelva a preguntar. No toca servidor ni base: el alta no persiste el
 * periodo (ver register/route.ts), y esto es el puente hasta que lo haga.
 *
 * Reglas: se escribe al crear la cuenta, caduca a los 7 días y se borra en
 * cuanto se inicia un pago. Todo va en try/catch: sin localStorage (modo
 * privado, bloqueo) simplemente no hay dato y la pantalla arranca en Mensual.
 * Solo se lee en compra nueva; en reactivación ni se mira.
 */
export type BillingAlta = "monthly" | "annual";

export interface EleccionAlta {
  plan: string;
  billing: BillingAlta;
  /** Epoch ms de cuando se creó la cuenta. */
  ts: number;
}

export const CLAVE_ELECCION_ALTA = "dc.alta.eleccion";
const CADUCIDAD_MS = 7 * 24 * 60 * 60 * 1000;

export function guardarEleccionAlta(e: { plan: string; billing: BillingAlta }): void {
  try {
    window.localStorage.setItem(CLAVE_ELECCION_ALTA, JSON.stringify({ ...e, ts: Date.now() }));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/** Devuelve la elección si existe y no ha caducado; si caducó, la borra. */
export function leerEleccionAlta(ahora = Date.now()): EleccionAlta | null {
  try {
    const raw = window.localStorage.getItem(CLAVE_ELECCION_ALTA);
    if (!raw) return null;
    const e = JSON.parse(raw) as Partial<EleccionAlta>;
    const valida =
      typeof e.plan === "string" &&
      (e.billing === "monthly" || e.billing === "annual") &&
      typeof e.ts === "number" &&
      ahora - e.ts <= CADUCIDAD_MS;
    if (!valida) {
      window.localStorage.removeItem(CLAVE_ELECCION_ALTA);
      return null;
    }
    return { plan: e.plan as string, billing: e.billing as BillingAlta, ts: e.ts as number };
  } catch {
    return null;
  }
}

export function borrarEleccionAlta(): void {
  try {
    window.localStorage.removeItem(CLAVE_ELECCION_ALTA);
  } catch {
    /* nada */
  }
}
