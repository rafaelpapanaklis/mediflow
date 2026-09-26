import "server-only";
import { prisma } from "@/lib/prisma";
import {
  exencionDeIva,
  senalDeTarjetaEnLaFila,
  type ClinicaParaIva,
  type ExencionIva,
} from "@/lib/billing/iva-cobro";

/**
 * ¿La clínica TUVO una suscripción de tarjeta (que ya no está viva)? Sin SQL nuevo, con lo que existe:
 *   1. `stripeSubscriptionId` o `subscriptionId` en la fila (el webhook de cancelación no los limpia);
 *   2. si la fila no lo dice —el admin que cancela desde /admin deja `stripeSubscriptionId` en null—,
 *      una factura de Stripe pagada en `subscription_invoices` (`method: "stripe"`): el webhook y la
 *      importación de /admin solo registran así las facturas de SUSCRIPCIONES de tarjeta; los pagos
 *      únicos de OXXO/SPEI de Stripe no dejan fila, así que no hay falsos positivos por ellos.
 * Una suscripción viva no llega aquí (el checkout la manda al portal antes). `subscriptionStatus =
 * "cancelled"` NO cuenta como señal: un admin también suspende con ese estado a clínicas que pagan a mano.
 * Filtra por el `clinicId` recibido (de la sesión); sin él responde false SIN consultar.
 */
export async function tuvoSuscripcionDeTarjeta(
  clinica: { id?: string | null; stripeSubscriptionId?: string | null; subscriptionId?: string | null },
): Promise<boolean> {
  if (senalDeTarjetaEnLaFila(clinica)) return true;
  if (!clinica.id) return false; // sin clinicId Prisma descartaría el filtro
  try {
    const f = await prisma.subscriptionInvoice.findFirst({
      where: { clinicId: clinica.id, method: "stripe", status: "paid" },
      select: { id: true },
    });
    return !!f;
  } catch {
    // Si no se puede saber, NO se regala el IVA de una reactivación: se asume que sí tuvo tarjeta.
    return true;
  }
}

/**
 * La exención de IVA de esta clínica (ver `exencionDeIva`). Solo consulta la base cuando hace falta:
 * clínica de antes y sin señal de tarjeta en la fila. `null` = todo con IVA.
 */
export async function exencionIvaDeClinica(
  clinica: (ClinicaParaIva & { id?: string | null }) | null | undefined,
): Promise<ExencionIva | null> {
  if (!clinica) return null;
  // Primero la parte barata y pura: si es nueva (o sin datos) no hay nada que consultar.
  if (!exencionDeIva({ ...clinica, tuvoTarjeta: false })) return null;
  return exencionDeIva({ ...clinica, tuvoTarjeta: await tuvoSuscripcionDeTarjeta(clinica) });
}
