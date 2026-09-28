import "server-only";
import { getStripeSafe } from "@/lib/stripe";
import { MODULE_SUBSCRIPTION_KIND } from "./module-purchase-core";

/**
 * ¿Esta sesión de checkout es un pago COMPLETADO del módulo `moduleKey` hecho
 * por la clínica `clinicId`? (ws1-t3, 28-sep-2026)
 *
 * La página de contratar vuelve de Stripe con `?compra=ok&session_id=…`. Sin
 * esta comprobación, el aviso «Pago recibido» salía con solo escribir
 * `?compra=ok` en la barra: a quien reabriera esa dirección meses después se
 * le decía que no pagara. Solo LEE la sesión en Stripe; no cambia nada.
 *
 * Falla cerrado: sin Stripe configurado, sin `session_id`, con una sesión de
 * otra clínica o de otra cosa, o con cualquier error, devuelve false y la
 * página se pinta como si no se hubiera pagado. La activación del módulo no
 * depende de esto: la hace el webhook.
 */
export async function pagoDeModuloConfirmado(input: {
  sessionId: string | null | undefined;
  clinicId: string;
  moduleKey: string;
}): Promise<boolean> {
  const { sessionId, clinicId, moduleKey } = input;
  if (!clinicId || !sessionId || !/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) return false;
  const stripe = getStripeSafe();
  if (!stripe) return false;
  try {
    const sesion = await stripe.checkout.sessions.retrieve(sessionId);
    return (
      sesion.status === "complete" &&
      sesion.metadata?.kind === MODULE_SUBSCRIPTION_KIND &&
      sesion.metadata?.clinicId === clinicId &&
      sesion.metadata?.moduleKey === moduleKey
    );
  } catch {
    return false;
  }
}
