/**
 * Campos de `Clinic` que son CREDENCIALES y jamás deben salir del servidor.
 *
 * Varias rutas devuelven la fila completa de la clínica (`findUnique`/`update`
 * sin `select`) y varias páginas la pasan entera a un componente cliente, así que
 * cada secreto nuevo se filtraba al navegador por default. Este helper es el
 * punto único para quitarlos antes de serializar.
 *
 * NO incluye `taxId`/`rfcEmisor`/`cpEmisor`: son datos fiscales que la propia UI
 * muestra y edita, no secretos.
 */
const CLINIC_SECRET_FIELDS = [
  "facturApiLiveKey",  // Live Secret Key de Facturapi → timbrar CFDI reales ante el SAT
  "waAccessToken",     // token de WhatsApp Cloud API
  "twilioAuthToken",   // token de Twilio (cifrado en reposo, pero sigue siendo secreto)
  "googleCalendarToken",
  "googleRefreshToken",
  "dailyApiKey",       // teleconsulta
  "liveModePassword",  // hash del password del modo "En Vivo"
] as const;

/**
 * Devuelve una copia de la clínica sin credenciales. Acepta null/undefined para
 * poder envolver un `findUnique` directo.
 */
export function stripClinicSecrets<T>(clinic: T): T {
  if (!clinic || typeof clinic !== "object") return clinic;
  const copy: Record<string, any> = { ...(clinic as Record<string, any>) };
  for (const field of CLINIC_SECRET_FIELDS) delete copy[field];
  return copy as T;
}
