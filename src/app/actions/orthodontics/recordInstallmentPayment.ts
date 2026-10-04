"use server";
// Orthodontics — action 7/15: recordInstallmentPayment. RETIRADA (ws1-t5).
//
// F13 de la auditoría del dinero (3-oct-2026): marcaba la mensualidad como
// PAGADA en `ortho_installments` SIN crear un Payment, así que ese dinero no
// entraba a Caja, ni al corte, ni a Finanzas, ni a la cobranza. Solo la llamaba
// el cajón viejo de ortodoncia (RecordPaymentDrawer, cuando el caso no tiene la
// vista nueva). Ya no escribe nada: las mensualidades se cobran con el cobro
// normal («Cobro del tratamiento» del caso o Caja), que crea el Payment de la
// factura del caso. Producción tenía 0 cuotas pagadas por aquí.

import { getOrthoBillingActionContext } from "./_helpers";
import { fail, isFailure, type ActionResult } from "./result";

/** El mensaje del camino retirado (lo ve quien abra el cajón viejo). */
const COBRO_VIEJO_RETIRADO =
  "Este registro ya no se usa: cobra la mensualidad desde «Cobro del tratamiento» del caso (o desde Caja) para que el dinero entre al corte de caja y a los reportes.";

export async function recordInstallmentPayment(
  _input: unknown,
): Promise<ActionResult<{ id: string }>> {
  // Misma puerta de siempre (billing.charge): sin sesión o sin permiso, el
  // mismo error que antes; con permiso, el aviso de dónde se cobra ahora.
  const auth = await getOrthoBillingActionContext("billing.charge");
  if (isFailure(auth)) return auth;
  return fail(COBRO_VIEJO_RETIRADO);
}
