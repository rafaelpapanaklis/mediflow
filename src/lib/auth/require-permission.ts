// Helpers para gatear server components y endpoints con el sistema UI
// permissions del sprint Fase B. Convención de uso:
//
//   const user = await getCurrentUser();
//   requirePermissionOrRedirect(user, "billing.view");  // page.tsx
//
//   const ctx = await getAuthContext();
//   if (!ctx) return 401;
//   const denied = denyIfMissingPermission(ctx, "billing.charge");
//   if (denied) return denied;  // 403 con JSON

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { hasPermission, type PermissionKey } from "./permissions";

interface UserLike {
  role: any;
  permissionsOverride?: string[] | null;
}

/**
 * Gate para server components. Si el usuario no tiene el permiso,
 * lo manda al /dashboard (sin loop, ya que el dashboard root requiere
 * "today.view" pero todos los roles lo incluyen por default).
 */
export function requirePermissionOrRedirect(user: UserLike, key: PermissionKey): void {
  const userForPerm = {
    role: user.role,
    permissionsOverride: user.permissionsOverride ?? [],
  };
  if (!hasPermission(userForPerm, key)) {
    redirect(`/dashboard?denied=${encodeURIComponent(key)}`);
  }
}

/**
 * Gate para route handlers. Devuelve 403 si falta el permiso, o null si
 * lo tiene (el caller hace `if (denied) return denied`).
 */
export function denyIfMissingPermission(user: UserLike, key: PermissionKey): NextResponse | null {
  const userForPerm = {
    role: user.role,
    permissionsOverride: user.permissionsOverride ?? [],
  };
  if (!hasPermission(userForPerm, key)) {
    return NextResponse.json(
      { error: `Permiso requerido: ${key}` },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Igual que `denyIfMissingPermission`, pero permite CUALQUIERA de varias
 * keys (OR, no AND) — para una acción que dos permisos distintos habilitan
 * a propósito, sin que uno le quite alcance al otro (p. ej.
 * "billing.deposit.register" habilita solo esto; "billing.charge" habilita
 * esto Y toda la Caja — quien ya tiene la más amplia no se queda afuera).
 */
export function denyIfMissingAnyPermission(user: UserLike, keys: PermissionKey[]): NextResponse | null {
  const userForPerm = {
    role: user.role,
    permissionsOverride: user.permissionsOverride ?? [],
  };
  if (keys.some((key) => hasPermission(userForPerm, key))) return null;
  return NextResponse.json(
    { error: `Permiso requerido: ${keys.join(" o ")}` },
    { status: 403 },
  );
}
