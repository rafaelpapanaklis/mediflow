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
import { estadoDeClave, sedesConClaveActiva, tablaExiste } from "./estado.server";

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
 * ¿Esta persona, en ESTE navegador, tiene la sede cerrada por clave? `false`
 * sin tablas (función apagada), sin clave en la sede, con «Ver como clínica»
 * de /admin o con un desbloqueo vigente. Si no se puede saber si la sede tiene
 * clave, `true` (falla cerrado).
 */
export async function sedeCerradaPara(u: { supabaseId: string; clinicId: string }): Promise<boolean> {
  if (!u?.supabaseId || !u?.clinicId) return true;
  if (!(await tablaExiste())) return false;
  let estado;
  try {
    estado = await estadoDeClave(u.clinicId);
  } catch {
    return true;
  }
  if (!estado.activa) return false;
  return sedeBloqueada({
    estado,
    verComoAdmin: await hasValidVerComoCookie(u.supabaseId, u.clinicId),
    cookie: await leerCookie(nombreCookieDesbloqueo(u.supabaseId, u.clinicId)),
    supabaseId: u.supabaseId,
    clinicId: u.clinicId,
  });
}

/**
 * De estas sedes (de la MISMA persona), ¿cuáles tiene cerradas por clave en
 * este navegador? Para las vistas que juntan varias sedes: lo que sale aquí se
 * enseña como «Sede con clave», sin cifras, o se omite. Falla cerrado: si no se
 * puede leer el estado, TODAS cuentan como cerradas (la vista degrada a «solo
 * la sede activa», que es lo que el panel enseña sin esta función).
 *
 * «Ver como clínica» NO abre las demás sedes: su prueba está atada a la sede
 * que se abrió desde /admin.
 */
export async function sedesCerradasPara(supabaseId: string, clinicIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set((clinicIds ?? []).filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return new Set();
  if (!supabaseId) return new Set(ids);
  if (!(await tablaExiste())) return new Set();
  let mapa: Map<string, number>;
  try {
    mapa = await sedesConClaveActiva();
  } catch {
    return new Set(ids);
  }
  const cerradas = new Set<string>();
  for (const clinicId of ids) {
    const version = mapa.get(clinicId);
    if (version === undefined) continue;
    const cerrada = sedeBloqueada({
      estado: { activa: true, version },
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
 * Las sedes de esta lista que tienen clave activa, sin mirar desbloqueos. Solo
 * para PINTAR un candado en el selector y para no compartir pacientes de una
 * sede con clave. Falla cerrado (todas) si no se puede leer.
 */
export async function sedesConClave(clinicIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set((clinicIds ?? []).filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return new Set();
  if (!(await tablaExiste())) return new Set();
  let mapa: Map<string, number>;
  try {
    mapa = await sedesConClaveActiva();
  } catch {
    return new Set(ids);
  }
  return new Set(ids.filter((id) => mapa.has(id)));
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
