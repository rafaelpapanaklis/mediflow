// ─────────────────────────────────────────────────────────────────────────────
// Registro de depuración de la resolución de sesión (`[AUTH-DEBUG …]`).
//
// Antes se imprimía en CADA petición de producción, con el clinicId (tenant) de
// cada usuario: llenaba los logs de Vercel de identificadores y de ruido (H15,
// auditoría 30-sep-2026). Ahora solo habla fuera de producción. La señal
// operativa de una cookie de clínica inconsistente sigue viva por
// `logClinicFallback` (active-clinic.ts), que solo se emite en la anomalía.
// ─────────────────────────────────────────────────────────────────────────────

export function authDebug(nivel: "log" | "warn", ...args: unknown[]): void {
  if (process.env.NODE_ENV === "production") return;
  console[nivel](...args);
}
