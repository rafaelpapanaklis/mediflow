/**
 * Salir de «Ver como clínica» y volver a la sesión de antes (ws1-t11, revisión
 * del 2-oct). Lo usan «Salir y volver a /admin» (POST /api/admin/impersonate/salir)
 * y «Cerrar sesión» del panel durante la suplantación (POST /api/auth/logout).
 *
 * Antes: signOut de la suplantación y nada más. Si el admin tenía su propia
 * sesión del panel en ese navegador (Rafael es dueño de su clínica), ya se había
 * perdido al entrar y /dashboard lo mandaba a /login. Ahora la entrada la guarda
 * en COOKIE_SESION_PREVIA y aquí se canjea: el navegador queda como estaba.
 */
import type { NextResponse } from "next/server";
import { cerrarSuplantacion, revocarDespues, revocarEnSupabase } from "./suplantacion";
import {
  COOKIE_PESTANA_VER_COMO,
  COOKIE_SESION_PREVIA,
  RUTA_COOKIE_SESION_PREVIA,
  desempacarSesionPrevia,
  type EstadoSuplantacion,
} from "./suplantacion-core";
import { clearActiveClinicCookie, writeActiveClinicCookie } from "@/lib/active-clinic";
import { clearVerComoCookie } from "@/lib/auth/two-factor-cookie";

type ClienteDeSesion = {
  auth: {
    getSession(): Promise<{ data: { session: { access_token?: string } | null } }>;
    signOut(o: { scope: "local" }): Promise<unknown>;
    refreshSession(s: { refresh_token: string }): Promise<{
      data: { user: { id: string } | null; session: unknown };
      error: unknown;
    }>;
  };
};

export interface Salida {
  /** ¿El navegador volvió a la sesión que tenía antes de entrar? */
  restaurada: boolean;
  /** La clínica activa de esa sesión, para volver a escribir su cookie. */
  clinicaPrevia: string | null;
}

/**
 * Cierra la suplantación de este navegador y, si hay copia de la sesión previa,
 * la canjea. La sesión de suplantación se revoca SOLO a ella (scope "local"): el
 * "global" echaría al dueño real de todos sus dispositivos. Si se volvió a la
 * sesión previa, esa revocación se aplaza (revocarDespues). Nunca lanza.
 */
export async function salirDeSuplantacion(
  supabase: ClienteDeSesion,
  estado: Exclude<EstadoSuplantacion, { tipo: "normal" }>,
  cookiePrevia: string | null | undefined,
): Promise<Salida> {
  if (estado.tipo === "activa") await cerrarSuplantacion(estado.fila.id, "salida");
  const previa = desempacarSesionPrevia(cookiePrevia);
  if (previa) {
    // La de suplantación NO se revoca aún en Supabase: las peticiones en vuelo
    // de otras pestañas con su cookie recibirían session_not_found y supabase-js
    // borraría la cookie de sesión, ya con la sesión devuelta dentro (medido en
    // QA). La fila cerrada ya la corta en el panel; se revoca pasada la gracia.
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const tokenSuplantacion = data.session?.access_token ?? null;
    try {
      const r = await supabase.auth.refreshSession({ refresh_token: previa.rt });
      if (!r.error && r.data.user?.id === previa.sub) {
        if (tokenSuplantacion) revocarDespues(tokenSuplantacion);
        return { restaurada: true, clinicaPrevia: previa.clinica };
      }
      console.warn(
        "[suplantacion] no se volvió a la sesión previa:",
        r.error ? (r.error as { message?: string }).message ?? r.error : "es de otra persona; no se usa",
      );
    } catch (e) {
      console.warn("[suplantacion] no se pudo volver a la sesión previa:", e instanceof Error ? e.message : e);
    }
    // Sin vuelta no hay nada que proteger: se revoca ya (el canje fallido ya
    // vació la sesión del cliente, así que el signOut de abajo no la alcanza).
    if (tokenSuplantacion) await revocarEnSupabase(tokenSuplantacion);
  }
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ya cerrada */ }
  return { restaurada: false, clinicaPrevia: null };
}

/** Las cookies de la respuesta de salida: sin rastro de la suplantación y la clínica de antes. */
export function cookiesDeSalida(res: NextResponse, s: Salida): void {
  res.cookies.set(COOKIE_SESION_PREVIA, "", { path: RUTA_COOKIE_SESION_PREVIA, maxAge: 0 });
  res.cookies.set(COOKIE_PESTANA_VER_COMO, "", { path: "/", maxAge: 0 });
  clearVerComoCookie(res);
  if (s.restaurada && s.clinicaPrevia) writeActiveClinicCookie(res, s.clinicaPrevia);
  else clearActiveClinicCookie(res);
}
