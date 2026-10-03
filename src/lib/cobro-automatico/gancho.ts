// Cobro automático (ws1-t6) — el gancho que llaman los demás cuando cambia una
// factura (saldo, precio, plan, estado del caso). Barato a propósito: sin el SQL
// pegado, o sin suscripción viva en esa factura, no hace nada más que una
// consulta (la sonda de tablas se recuerda en globalThis). Solo entonces carga el
// servicio (import perezoso: factura-mp → aquí → servicio → factura-mp no hace
// ciclo al cargar). NUNCA lanza.
//
// `db` es la base de quien llama (sus pruebas pasan un doble): con un doble que
// no conoce la consulta, la sonda contesta «no sé» y el gancho no hace nada.

import { prisma } from "@/lib/prisma";
import { repoSql, tablasListas, type Db } from "./db";

type Reconciliar = (a: { clinicId: string; invoiceId: string }) => Promise<unknown>;

const reconciliarPerezoso: Reconciliar = async (a) => (await import("./servicio.server")).reconciliarFactura(a);

export async function avisarCambioDeFactura(
  a: { clinicId: string; invoiceId: string },
  db: Db = prisma,
  reconciliar: Reconciliar = reconciliarPerezoso,
): Promise<void> {
  try {
    if (!a.clinicId || !a.invoiceId) return;
    if ((await tablasListas(db)) !== true) return;
    if (!(await repoSql(db).vivoDeFactura(a.clinicId, a.invoiceId))) return;
    await reconciliar(a);
  } catch (e) {
    console.error(`[cobro-automatico] gancho de la factura ${a.invoiceId}: ${(e as Error).message}`);
  }
}

/** El caso de ortodoncia cambió de estado: si se cerró, que deje de cobrar solo. */
export async function avisarCambioDeCaso(a: { clinicId: string; invoiceId: string | null | undefined }): Promise<void> {
  if (!a.invoiceId) return;
  await avisarCambioDeFactura({ clinicId: a.clinicId, invoiceId: a.invoiceId });
}
