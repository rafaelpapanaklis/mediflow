"use server";

// ═══════════════════════════════════════════════════════════════════════
// Acciones de "Mis textos" — la libreta de mensajes de venta.
//
// 🔴 CADA UNA VUELVE A VERIFICAR LA SESIÓN DE ADMIN, por el mismo motivo
// que las de ./actions.ts: el layout de /admin bloquea el RENDER, pero una
// server action es un endpoint POST que se alcanza solo, sin pasar por
// ningún layout. Es la sesión de PLATAFORMA (admin_token, getAdminSession)
// y NO getAuthContext: /admin no es el panel de una clínica.
//
// Sin auditoría estructurada aquí, a diferencia de los prospectos: un
// texto de venta no es un dato de un negocio real y anotar cada retoque de
// una coma llenaría de ruido el registro que hay que poder leer. Lo que sí
// queda es el correo de quien lo escribió, en la propia fila.
// ═══════════════════════════════════════════════════════════════════════
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/admin-auth";
import type { CrmResultado } from "@/lib/admin/crm/service";
import {
  crmTextoActualizar,
  crmTextoCrear,
  crmTextoEliminar,
  crmTextosReordenar,
} from "@/lib/admin/crm/textos-service";
import type { CrmTextoDTO, CrmTextoEntrada } from "@/lib/admin/crm/textos-core";

const NO_AUTORIZADO = { ok: false as const, error: "No autorizado" };

/**
 * Los textos se pintan en tres sitios: su propia pantalla, el tablero y la
 * ficha de CADA prospecto. Por eso se revalida el árbol entero de
 * /admin/crm ("layout") y no una ruta suelta: desde aquí no se sabe qué
 * ficha tiene alguien abierta, y una que se quedara con la lista vieja
 * ofrecería copiar un texto que ya se borró.
 */
function refrescar(): void {
  revalidatePath("/admin/crm", "layout");
}

export async function crearTextoAccion(
  entrada: CrmTextoEntrada,
): Promise<CrmResultado<CrmTextoDTO>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmTextoCrear(entrada, admin.user.email);
  if (r.ok) refrescar();
  return r;
}

export async function actualizarTextoAccion(
  id: string,
  entrada: CrmTextoEntrada,
): Promise<CrmResultado<CrmTextoDTO>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmTextoActualizar(id, entrada);
  if (r.ok) refrescar();
  return r;
}

export async function eliminarTextoAccion(id: string): Promise<CrmResultado> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmTextoEliminar(id);
  if (r.ok) refrescar();
  return r;
}

export async function reordenarTextosAccion(ids: string[]): Promise<CrmResultado> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmTextosReordenar(ids);
  if (r.ok) refrescar();
  return r;
}
