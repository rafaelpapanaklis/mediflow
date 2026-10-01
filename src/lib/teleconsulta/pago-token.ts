// ─────────────────────────────────────────────────────────────────────────────
// Token de la liga de pago de una teleconsulta (M7, auditoría 30-sep-2026).
//
// `/pago/[appointmentId]` se abría con SOLO el id de la cita (un cuid, no un
// secreto): quien lo viera en un chat reenviado entraba a una página con el
// nombre del paciente, el doctor, la hora, el monto y —ya pagada— la URL de la
// sala y el token del paciente. Ahora la liga lleva `?t=<token>`:
//
//   token = base64url( HMAC-SHA256( secreto, "pago-teleconsulta:v1:<id>" ) )
//
// Determinista y sin columna nueva: no hay SQL que pegar, y la liga que la
// clínica copia del panel siempre es la misma para esa cita. Sin el secreto
// (que vive solo en el servidor) no se puede calcular ni adivinar. Las ligas
// viejas (`/pago/<id>` a secas) dejan de abrir: hay que volver a copiarlas.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "crypto";

function secretoDePago(): string {
  const s =
    process.env.PAGO_TOKEN_SECRET ||
    process.env.COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (s) return s;
  // Sin secreto en producción NO se emite ni se acepta nada (falla cerrado).
  if (process.env.NODE_ENV === "production") throw new Error("pago-token: sin secreto configurado");
  return "mediflow-pago-fallback-dev-only";
}

function calcular(appointmentId: string, secreto: string): string {
  return createHmac("sha256", secreto)
    .update(`pago-teleconsulta:v1:${appointmentId}`)
    .digest("base64url");
}

/** El token de la liga de pago de esa cita. */
export function firmarPagoTeleconsulta(appointmentId: string, secreto: string = secretoDePago()): string {
  return calcular(appointmentId, secreto);
}

/** true solo si `token` es el de ESA cita (comparación en tiempo constante). */
export function esTokenDePagoValido(
  appointmentId: string,
  token: string | null | undefined,
  secreto?: string,
): boolean {
  if (!appointmentId || typeof token !== "string" || token.length === 0) return false;
  try {
    const esperado = Buffer.from(calcular(appointmentId, secreto ?? secretoDePago()));
    const recibido = Buffer.from(token);
    return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
  } catch {
    return false;
  }
}

/** Ruta relativa de la liga de pago (el origen lo pone quien la usa). */
export function rutaDePago(appointmentId: string): string {
  return `/pago/${appointmentId}?t=${firmarPagoTeleconsulta(appointmentId)}`;
}
