import { hasPermission } from "@/lib/auth/permissions";

/**
 * ¿Quién recarga el Saldo IA? (decisión de Rafael, 27-oct-2026)
 *
 * No es cosa solo del dueño, como el plan: lo hace cualquiera a quien se le dé
 * el permiso «Recargar Saldo IA» (`aiWallet.topup`) en Equipo → Permisos. El
 * dueño (SUPER_ADMIN) SIEMPRE puede, aunque su propio override no lo traiga.
 *
 * Cubre todo lo que mete dinero al monedero o autoriza a cobrarlo: tarjeta,
 * Mercado Pago, SPEI (ticket y comprobante) y la auto-recarga (guardar la
 * tarjeta y sus ajustes). Encender o apagar funciones de IA NO pasa por aquí:
 * sigue siendo de administradores.
 *
 * Puro (sin Next ni Prisma): lo usan los route handlers y la pantalla recibe
 * el resultado ya calculado por `GET /api/ai-wallet` (`puedeRecargar`).
 */
export const PERMISO_RECARGA_SALDO_IA = "aiWallet.topup" as const;

export const MENSAJE_SIN_PERMISO_RECARGA =
  "No tienes permiso para recargar el Saldo IA. Pídeselo a quien tenga el permiso «Recargar Saldo IA».";

export function puedeRecargarSaldoIa(
  user: { role: string; permissionsOverride?: string[] | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  return hasPermission(user, "aiWallet.topup");
}

/** Cuerpo 403 de las rutas de recarga; la llave viaja aparte en `permiso`, como en `denyIfMissingPermission`. */
export function sinPermisoDeRecarga() {
  return {
    error: MENSAJE_SIN_PERMISO_RECARGA,
    code: "SIN_PERMISO_RECARGA_SALDO_IA",
    permiso: PERMISO_RECARGA_SALDO_IA,
  };
}
