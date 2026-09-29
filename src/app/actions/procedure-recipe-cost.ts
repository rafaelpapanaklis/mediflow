"use server";
/** Costo de receta por procedimiento de la clínica de la sesión (ws1-t6, H18). */
import { getAuthContext } from "@/lib/auth-context";
import { costoDeRecetaPorProcedimiento } from "@/lib/inventory/costo-receta.server";

export async function costoDeRecetaAction(): Promise<Record<string, number>> {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return {};
  return costoDeRecetaPorProcedimiento(ctx.clinicId);
}
