import { prisma } from "@/lib/prisma";
import { sendPaymentFailedEmail } from "@/lib/email";
import { PLAN_MARKETING } from "@/lib/plan-shared";
import { fechaHoraDeLaClinica } from "@/lib/billing/cobro-rechazado";

/**
 * Correo «No pudimos cobrar tu plan» (ws1-t1). Sale UNA vez por cobro rechazado: el candado es la fila de
 * `billing_email_logs`, que es única por `invoiceId`. La factura que falló y la que luego se paga son la
 * MISMA, y su fila de «plan renovado» usa el id a secas; por eso la clave de este aviso lleva el sufijo
 * `:payment_failed` y no le quita el recibo de la renovación si el reintento cobra.
 *
 * NUNCA lanza: un correo que no sale no puede tumbar el webhook (Stripe lo reintentaría y repetiría el
 * resto del evento). Sin la tabla migrada o con cualquier error del candado, NO se envía (sin candado no
 * se puede deduplicar, y mejor un aviso de menos que dos).
 */

export const TIPO_AVISO_COBRO_RECHAZADO = "payment_failed";

export function claveAvisoCobroRechazado(invoiceId: string): string {
  return `${invoiceId}:${TIPO_AVISO_COBRO_RECHAZADO}`;
}

export interface ClinicaParaAvisoDeCobro {
  name: string;
  email: string | null;
  plan: string | null;
  timezone: string | null;
  /** Dueño (SUPER_ADMIN activo más antiguo): destinatario preferente, igual que «plan activado». */
  users: Array<{ email: string; firstName: string | null }>;
}

export type ResultadoAvisoCobro = "enviado" | "ya-enviado" | "sin-destinatario" | "sin-candado" | "fallo";

export async function avisarCobroRechazado(args: {
  clinicId: string;
  invoiceId: string;
  clinica: ClinicaParaAvisoDeCobro;
  /** Hasta cuándo sigue el acceso (la hora de suspensión que se le dice a la clínica). */
  accesoHasta: Date;
  siteUrl: string;
}): Promise<ResultadoAvisoCobro> {
  try {
    const dueno = args.clinica.users[0];
    const to = dueno?.email ?? args.clinica.email ?? null;
    if (!to) return "sin-destinatario";

    try {
      await prisma.billingEmailLog.create({
        data: {
          invoiceId: claveAvisoCobroRechazado(args.invoiceId),
          clinicId: args.clinicId,
          kind: TIPO_AVISO_COBRO_RECHAZADO,
          email: to,
        },
      });
    } catch (e: any) {
      if (e?.code === "P2002") return "ya-enviado";
      console.error("[stripe webhook] aviso de cobro rechazado: candado", e?.code ?? e);
      return "sin-candado";
    }

    const planName = PLAN_MARKETING[args.clinica.plan as keyof typeof PLAN_MARKETING]?.name ?? String(args.clinica.plan ?? "");
    await sendPaymentFailedEmail({
      email: to,
      firstName: dueno?.firstName,
      clinicName: args.clinica.name,
      planName,
      suspensionLabel: fechaHoraDeLaClinica(args.accesoHasta, args.clinica.timezone),
      payUrl: `${args.siteUrl}/dashboard/settings?tab=subscription`,
    });
    return "enviado";
  } catch (err) {
    console.error("[stripe webhook] aviso de cobro rechazado:", err);
    return "fallo";
  }
}
