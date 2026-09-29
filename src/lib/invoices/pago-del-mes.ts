import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { montoSugeridoDeCobro } from "@/lib/invoices/plan-de-pagos";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";

/**
 * ws1-t4 #82 (decisión de Rafael) — «Tu pago de este mes es $X (saldo total $Y)».
 * El aviso de cobro de una factura A PLAZOS decía solo el saldo total, mientras el
 * recordatorio de Alertas decía lo vencido y el automático la cuota: tres montos
 * verdaderos que parecían contradecirse. Esta es la cifra del mes: lo vencido, o si
 * nada venció, la cuota por la que va (`montoSugeridoDeCobro`, la misma que usa
 * «Cobrar»).
 *
 * `null` = no aplica (pago único, sin condiciones, o la cuota ya es todo el saldo):
 * el aviso sale como siempre. Nunca lanza: si la lectura falla, el aviso de siempre.
 * `db` ya viene acotado por la clínica de la sesión; `invoiceId` también.
 */
export async function pagoDelMesDeFactura(
  db: unknown,
  args: { clinicId: string; invoiceId: string; total: number; paid: number; zonaHoraria?: string | null; ahora?: Date },
): Promise<number | null> {
  try {
    if (!args.clinicId || !args.invoiceId) return null;
    const { porFactura } = await leerCondicionesDeFacturas(db as Parameters<typeof leerCondicionesDeFacturas>[0], {
      clinicId: args.clinicId,
      invoiceIds: [args.invoiceId],
    });
    const condiciones = porFactura.get(args.invoiceId) ?? null;
    const hoy = hoyEnZona(args.ahora ?? new Date(), args.zonaHoraria || "America/Mexico_City");
    const monto = montoSugeridoDeCobro(condiciones, args.total, args.paid, hoy);
    const saldo = Math.round((args.total - args.paid) * 100) / 100;
    if (!(monto > 0) || monto >= saldo - 0.005) return null;
    return Math.round(monto * 100) / 100;
  } catch {
    return null;
  }
}
