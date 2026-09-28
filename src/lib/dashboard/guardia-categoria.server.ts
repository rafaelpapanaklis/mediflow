/**
 * WS1-T4 ronda 6 · G7 — el guardia de categoría, del lado del SERVIDOR.
 *
 * La regla vive en `guardia-categoria.ts` (pura, con test). Aquí solo se lee la
 * categoría de la SESIÓN y se actúa: redirigir (páginas) o 403 (APIs).
 *
 * Sin `import "server-only"` a propósito, como interruptores.server.ts: las
 * rutas que lo usan se prueban con tsx, donde ese paquete no existe. Importa
 * `@/lib/auth` (Prisma), así que un componente cliente no puede traérselo.
 */
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { destinoSiNoPermitida, paginaPermitidaParaCategoria } from "./guardia-categoria";

/**
 * Para el principio de CADA page.tsx protegida (no en un layout).
 *
 * Lee al usuario de la sesión (`getCurrentUser` va con React cache(): si la
 * página lo vuelve a pedir, no hay otra consulta) y, si la categoría de su
 * clínica no tiene esta página, redirige. Devuelve el usuario para que la
 * página lo use sin pedirlo otra vez.
 *
 *   const user = await exigirCategoriaParaPagina("/dashboard/exercises");
 */
export async function exigirCategoriaParaPagina(ruta: string) {
  const user = await getCurrentUser();
  const categoria: string | null = (user.clinic as { category?: string | null } | null)?.category ?? null;
  if (!paginaPermitidaParaCategoria(ruta, categoria)) {
    redirect(destinoSiNoPermitida(ruta));
  }
  return user;
}

/**
 * Para las APIs de esas páginas, justo después del `if (!ctx) return 401`.
 * `categoria` es `ctx.clinicCategory` (de la sesión), nunca algo del body.
 * Devuelve la respuesta 403 o `null` si puede seguir.
 *
 *   const fuera = negarApiPorCategoria("/dashboard/exercises", ctx.clinicCategory);
 *   if (fuera) return fuera;
 */
export function negarApiPorCategoria(
  ruta: string,
  categoria: string | null | undefined,
): NextResponse | null {
  if (paginaPermitidaParaCategoria(ruta, categoria)) return null;
  return NextResponse.json(
    { error: "Esta función no está disponible para tu clínica.", code: "CATEGORY_NOT_ALLOWED" },
    { status: 403 },
  );
}
