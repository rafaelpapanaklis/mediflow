/**
 * DaleControl BARBER — la cookie del selector de sede. Módulo PURO (sin
 * prisma, sin "server-only", sin next/headers): lo comparten el contexto de
 * sesión (src/lib/barber-auth.ts), las sucursales (branches.ts) y la barra
 * de arriba (cliente). Vive aparte para que un doble de barber-auth en las
 * pruebas no se lleve las constantes.
 */

/** Cookie con la sede elegida en el selector. Se VALIDA en cada lectura. */
export const BARBER_BRANCH_COOKIE = "dcb_branch";

/** Valor especial de la cookie: vista consolidada de toda la cadena. */
export const BARBER_BRANCH_ALL = "all";

/**
 * Encabezado con la sede de la PANTALLA en cada escritura del panel (ronda 2,
 * M3). Si no coincide con la sede que opera la sesión (otra pestaña cambió la
 * cookie), el servidor no atiende la escritura.
 */
export const BARBER_BRANCH_PIN_HEADER = "x-dcb-sede";

/**
 * Pantallas que saben enseñar «Toda la cadena» (leen resolveBranchScope).
 * En todas las demás, con la cookie en «all», la sesión opera su sede propia
 * y la barra de arriba lo dice.
 */
export const BARBER_CONSOLIDATED_PATHS = [
  "/barber/inicio",
  "/barber/reportes",
  "/barber/barberos",
  "/barber/equipo",
  "/barber/sucursales",
  "/barber/soporte",
] as const;

/** ¿Esta ruta del panel puede mostrar la vista consolidada? */
export function isConsolidatedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return BARBER_CONSOLIDATED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
