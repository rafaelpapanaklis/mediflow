// ws1-t8 · M1/M2 — LA decisión del 2FA para una sesión de clínica, con las
// cookies y el entorno ya leídos. Un solo punto que comparten getAuthContext,
// getCurrentUser, el layout de /dashboard, las pantallas /dashboard/2fa* y la
// página de teleconsulta: si la regla cambia, cambia para todos a la vez.
//
// La regla en sí es pura y vive en two-factor-gate (decisionDosPasos, con
// tests); aquí solo se juntan sus entradas. Usa next/headers (cookies) ⇒ solo
// Node: route handlers, server actions y server components. Nunca middleware.
import {
  hasValidTwoFactorCookie,
  hasValidVerComoCookie,
  leerSimulacionDosPasos,
} from "./two-factor-cookie";
import {
  decisionDosPasos,
  estadoDuenoDosPasos,
  leerPoliticaDosPasosDuenos,
  type DecisionDosPasos,
  type EstadoDuenoDosPasos,
} from "./two-factor-gate";

export interface SesionParaDosPasos {
  supabaseId: string;
  clinicId: string;
  role?: string | null;
  /** YA resuelto a nivel persona (EQ-02): alguna de sus filas activas lo tiene. */
  totpEnabled?: boolean | null;
  clinic?: { require2fa?: boolean | null } | null;
}

export interface ResultadoDosPasos {
  decision: DecisionDosPasos;
  dueno: EstadoDuenoDosPasos;
}

export function decidirDosPasos(u: SesionParaDosPasos, ahoraMs: number = Date.now()): ResultadoDosPasos {
  const dueno = estadoDuenoDosPasos({
    role: u.role,
    totpEnabled: u.totpEnabled,
    politica: leerPoliticaDosPasosDuenos(),
    ahoraMs,
    simulacion: leerSimulacionDosPasos(),
  });
  const decision = decisionDosPasos({
    totpEnabled: u.totpEnabled,
    require2fa: u.clinic?.require2fa,
    hasValidCookie: hasValidTwoFactorCookie(u.supabaseId, u.clinicId),
    verComoAdmin: hasValidVerComoCookie(u.supabaseId, u.clinicId),
    dueno,
  });
  return { decision, dueno };
}
