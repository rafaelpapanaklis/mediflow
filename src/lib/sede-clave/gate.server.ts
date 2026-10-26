// ws1-t4 · «Clave de la sede» — el gate, con las cookies y la base en mano.
//
// UNA decisión (`sedeBloqueada` de ./core) para todos los que la necesitan:
//   · getAuthContext y getCurrentUser (cada /api, server action y página),
//   · el layout de /dashboard (manda a la pantalla de la clave),
//   · /api/switch-clinic (no deja cambiar a una sede con clave sin teclearla),
//   · y las vistas que juntan varias sedes del dueño (reporte de sedes, Sabina
//     comparar_sedes, Sucursales, cerrar sede, pacientes compartidos), que
//     preguntan con `sedesCerradasPara`.
//
// Usa next/headers (cookies) ⇒ solo Node: route handlers, server actions y
// server components. Nunca middleware.
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { hasValidVerComoCookie } from "@/lib/auth/two-factor-cookie";
import {
  empacarDesbloqueo,
  nombreCookieDesbloqueo,
  sedeBloqueada,
  VIGENCIA_DESBLOQUEO_MS,
} from "./core";
import { estadoDeClave, estadosDeClaves, tablaExiste } from "./estado.server";

const isProd = process.env.NODE_ENV === "production";

type ResLike = Pick<NextResponse, "cookies">;

async function leerCookie(nombre: string): Promise<string | undefined> {
  try {
    return (await cookies()).get(nombre)?.value;
  } catch {
    return undefined;
  }
}

/**
 * Lo que el gate decide para una persona en una sede, en ESTE navegador:
 *   · "libre"         → sin tablas (función apagada), sin clave en la sede, con
 *                       «Ver como clínica» de /admin o con desbloqueo vigente;
 *   · "cerrada"       → la sede tiene clave y no hay desbloqueo vigente;
 *   · "sin_comprobar" → no se pudo leer ni la lista ni la fila de ESA sede
 *                       (v2, A1): se corta, pero con «No pudimos comprobar la
 *                       clave de la sede, recarga», nunca con «tiene clave».
 */
export type EstadoGate = "libre" | "cerrada" | "sin_comprobar";

export async function estadoGateSede(u: { supabaseId: string; clinicId: string }): Promise<EstadoGate> {
  if (!u?.supabaseId || !u?.clinicId) return "sin_comprobar";
  if (!(await tablaExiste())) return "libre";
  let estado;
  try {
    estado = await estadoDeClave(u.clinicId);
  } catch {
    return "sin_comprobar";
  }
  if (!estado.activa) return "libre";
  const cerrada = sedeBloqueada({
    estado,
    verComoAdmin: await hasValidVerComoCookie(u.supabaseId, u.clinicId),
    cookie: await leerCookie(nombreCookieDesbloqueo(u.supabaseId, u.clinicId)),
    supabaseId: u.supabaseId,
    clinicId: u.clinicId,
  });
  return cerrada ? "cerrada" : "libre";
}

/** ¿Cerrada para esta persona en este navegador? (`cerrada` o `sin_comprobar`). */
export async function sedeCerradaPara(u: { supabaseId: string; clinicId: string }): Promise<boolean> {
  return (await estadoGateSede(u)) !== "libre";
}

/**
 * De estas sedes (de la MISMA persona), ¿cuáles tiene cerradas por clave en
 * este navegador? Para las vistas que juntan varias sedes: lo que sale aquí se
 * enseña como «Sede con clave», sin cifras, o se omite. Si la lista no se puede
 * leer, se mira la fila de cada sede (v2, A1); solo la sede que tampoco se
 * pueda comprobar cuenta como cerrada (no todas).
 *
 * «Ver como clínica» NO abre las demás sedes: su prueba está atada a la sede
 * que se abrió desde /admin.
 */
export async function sedesCerradasPara(supabaseId: string, clinicIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set((clinicIds ?? []).filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return new Set();
  if (!supabaseId) return new Set(ids);
  if (!(await tablaExiste())) return new Set();
  const estados = await estadosDeClaves(ids);
  const cerradas = new Set<string>();
  for (const clinicId of ids) {
    const estado = estados.get(clinicId);
    if (estado === null || estado === undefined) {
      cerradas.add(clinicId);
      continue;
    }
    if (!estado.activa) continue;
    const cerrada = sedeBloqueada({
      estado,
      verComoAdmin: await hasValidVerComoCookie(supabaseId, clinicId),
      cookie: await leerCookie(nombreCookieDesbloqueo(supabaseId, clinicId)),
      supabaseId,
      clinicId,
    });
    if (cerrada) cerradas.add(clinicId);
  }
  return cerradas;
}

/**
 * Las sedes de esta lista que tienen clave activa, sin mirar desbloqueos. Para
 * PINTAR un candado en el selector, para no compartir pacientes de una sede con
 * clave y para no copiar la configuración de la activa si tiene clave. Una sede
 * que no se pueda comprobar cuenta como con clave.
 */
export async function sedesConClave(clinicIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set((clinicIds ?? []).filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return new Set();
  if (!(await tablaExiste())) return new Set();
  const estados = await estadosDeClaves(ids);
  return new Set(ids.filter((id) => { const e = estados.get(id); return !e || e.activa; }));
}

// ── Escritura de la cookie (route handlers) ─────────────────────────────

/** El desbloqueo de ESTA persona en ESTA sede para la versión vigente, 72 h. */
export function ponerDesbloqueo(res: ResLike, supabaseId: string, clinicId: string, version: number): void {
  res.cookies.set({
    name: nombreCookieDesbloqueo(supabaseId, clinicId),
    value: empacarDesbloqueo({ supabaseId, clinicId, version, emitidoMs: Date.now() }),
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(VIGENCIA_DESBLOQUEO_MS / 1000),
  });
}

export function quitarDesbloqueo(res: ResLike, supabaseId: string, clinicId: string): void {
  res.cookies.set({ name: nombreCookieDesbloqueo(supabaseId, clinicId), value: "", path: "/", maxAge: 0 });
}
