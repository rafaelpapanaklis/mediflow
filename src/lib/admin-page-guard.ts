import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getAdminSession,
  getAdminSessionResult,
  type AdminAuthContext,
} from "@/lib/admin-auth";
import { origenNoCoincide } from "@/lib/csrf-origen";

/**
 * Seguridad admin-auth (auditoría «cloudflare», §1b) — el guard de CADA página de /admin.
 *
 * El layout de /admin valida la sesión, pero en el App Router el layout y la página son segmentos
 * distintos del RSC: la página se renderiza (y su flight viaja) aunque el layout pinte el login, y el
 * cliente puede pedir solo los segmentos de abajo (`Next-Router-State-Tree`), saltándose el layout. El
 * middleware solo mira que la cookie EXISTA. Por eso cada `page.tsx` de /admin (y su `generateMetadata`,
 * si lee datos) empieza con `await requireAdminPage()`; la prueba `admin-paginas-guard` lo exige.
 *
 * `cache()`: layout, metadata y página comparten UNA validación por petición (una consulta, no tres).
 */
export const sesionAdminDeEstaPeticion = cache(getAdminSessionResult);

/** Error de BD al validar: la página no se pinta (el layout ya enseña «no se pudo comprobar»). */
export class SesionAdminNoComprobada extends Error {
  constructor() {
    super("No se pudo comprobar la sesión de admin (error de base); la página no se pinta.");
    this.name = "SesionAdminNoComprobada";
  }
}

/**
 * Sesión de admin viva o nada: sin sesión → redirect a /admin/login (lo mismo que hace el middleware
 * sin cookie); con la base caída → lanza `SesionAdminNoComprobada`. Nunca devuelve sin sesión.
 */
export async function requireAdminPage(): Promise<AdminAuthContext> {
  const r = await sesionAdminDeEstaPeticion();
  if (r.state === "ok") return r.ctx;
  if (r.state === "anonymous") redirect("/admin/login");
  throw new SesionAdminNoComprobada();
}

/**
 * Para las server actions de admin (hueco nº9 del crítico): sesión de admin viva Y el mismo chequeo de
 * Origin que el middleware aplica a las mutaciones de /api/admin/* (Origin, o Referer, con el mismo host;
 * sin ninguno de los dos, fuera). Next ya aborta una acción con Origin ajeno, pero deja pasar la que llega
 * sin Origin; /api/admin no. null = no autorizado: la acción responde su «No autorizado» de siempre.
 */
export async function sesionAdminDeAccion(): Promise<AdminAuthContext | null> {
  const h = await headers();
  if (origenNoCoincide(h, "POST")) {
    console.warn("[admin-auth] server action rechazada: origen distinto del host");
    return null;
  }
  return getAdminSession();
}
