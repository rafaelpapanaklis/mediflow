"use server";

// ═══════════════════════════════════════════════════════════════════════
// Acciones del CRM del AFILIADO.
//
// 🔴 EL `affiliateId` SALE DE LA SESIÓN, NUNCA DE LOS ARGUMENTOS. Ninguna
// de estas funciones lo recibe: lo resuelve `getAffiliateContext()` en cada
// llamada. Si viniera del cliente, cualquier socio podría escribir —y leer
// al guardar— los prospectos de otro cambiando un id en la petición.
//
// El layout de /afiliados/(panel) bloquea el RENDER sin sesión, pero una
// server action es un POST que se alcanza sola, sin pasar por ningún
// layout: por eso se vuelve a verificar aquí, incluido el estado APROBADO
// (un socio pendiente o suspendido no da de alta nada).
// ═══════════════════════════════════════════════════════════════════════
import { revalidatePath } from "next/cache";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import {
  crmAfiliadoActualizar,
  crmAfiliadoCrear,
  crmAfiliadoEliminar,
  type CrmAfiliadoEntrada,
  type CrmAfiliadoResultado,
  type CrmProspectoAfiliadoDTO,
} from "@/lib/affiliates/crm";

const RUTA = "/afiliados/crm";

/** Sesión de socio APROBADO, o null. Un único punto de verdad para las tres. */
async function socioActivo(): Promise<string | null> {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") return null;
  return ctx.affiliateId;
}

const NO_AUTORIZADO = { ok: false as const, error: "Tu sesión expiró. Vuelve a entrar." };

export async function recomendarAccion(
  entrada: CrmAfiliadoEntrada,
): Promise<CrmAfiliadoResultado<CrmProspectoAfiliadoDTO>> {
  const affiliateId = await socioActivo();
  if (!affiliateId) return NO_AUTORIZADO;

  const r = await crmAfiliadoCrear(affiliateId, entrada);
  if (r.ok) revalidatePath(RUTA);
  return r;
}

export async function editarRecomendacionAccion(
  prospectId: string,
  entrada: CrmAfiliadoEntrada,
): Promise<CrmAfiliadoResultado<CrmProspectoAfiliadoDTO>> {
  const affiliateId = await socioActivo();
  if (!affiliateId) return NO_AUTORIZADO;

  const r = await crmAfiliadoActualizar(affiliateId, prospectId, entrada);
  if (r.ok) revalidatePath(RUTA);
  return r;
}

export async function quitarRecomendacionAccion(
  prospectId: string,
): Promise<CrmAfiliadoResultado> {
  const affiliateId = await socioActivo();
  if (!affiliateId) return NO_AUTORIZADO;

  const r = await crmAfiliadoEliminar(affiliateId, prospectId);
  if (r.ok) revalidatePath(RUTA);
  return r;
}
