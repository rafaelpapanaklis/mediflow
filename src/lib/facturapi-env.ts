/**
 * Ambiente de timbrado CFDI (Facturapi).
 *
 * FACTURAPI_ENV=live  → los CFDI se timbran ante el SAT y tienen validez fiscal.
 * ausente | cualquier → PRUEBAS: Facturapi timbra con sus certificados de
 *                       prueba, no llega al SAT y no requiere CSD reales.
 *
 * Vive aparte de `lib/facturapi.ts` para que un Server Component pueda leer el
 * ambiente sin arrastrar el cliente HTTP (que exige FACTURAPI_USER_KEY).
 * NUNCA se expone la env al navegador: los componentes de cliente reciben solo
 * el boolean por props.
 */
export type FacturapiEnv = "test" | "live";

let warned = false;

export function facturapiEnv(): FacturapiEnv {
  const raw = process.env.FACTURAPI_ENV?.trim().toLowerCase() ?? "";
  if (raw === "live") return "live";
  // "production", "prod", "1"… se degradan a PRUEBAS a propósito (nunca se activa
  // Live por accidente), pero en silencio sería una trampa: la UI diría "ambiente
  // de pruebas" y nadie sabría por qué. Se avisa una vez por proceso.
  if (raw && raw !== "test" && !warned) {
    warned = true;
    console.warn(`[facturapi] FACTURAPI_ENV="${process.env.FACTURAPI_ENV}" no se reconoce; se usa PRUEBAS. Para timbrar ante el SAT el valor debe ser exactamente "live".`);
  }
  return "test";
}

export function isFacturapiLive(): boolean {
  return facturapiEnv() === "live";
}
