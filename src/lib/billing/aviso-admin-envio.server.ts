import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import type { AvisoAdmin } from "@/lib/billing/avisos-admin";

/**
 * Envío de avisos para quien administra la PLATAFORMA (mismo buzón que el aviso de afiliados y el de SPEI:
 * ADMIN_NOTIFY_EMAIL, o el general). Los textos viven en `avisos-admin.ts`. NUNCA lanza: un correo que no sale no puede
 * tumbar el webhook.
 *
 * `avisarAdminUnaVez`: el candado es la fila única de `billing_email_logs` (`invoiceId` = `clave`). Un evento de Stripe que
 * se reintenta durante horas (porque el webhook responde 5xx a propósito) NO manda el mismo aviso cada vez. Sin la tabla
 * migrada o con cualquier error del candado, NO se envía (sin candado no se puede deduplicar).
 */

function destino(): string {
  return process.env.ADMIN_NOTIFY_EMAIL?.trim() || "hola@dalecontrol.com";
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function enviarAvisoAlAdmin(aviso: AvisoAdmin): Promise<boolean> {
  try {
    await sendEmail({ to: destino(), subject: aviso.asunto, html: aviso.lineas.map((l) => `<p>${esc(l)}</p>`).join(""), text: aviso.lineas.join("\n") });
    return true;
  } catch (err) {
    console.error("[aviso-admin] no se pudo enviar:", aviso.asunto, (err as Error)?.message ?? err);
    return false;
  }
}

export async function avisarAdminUnaVez(clave: string, clinicId: string, aviso: AvisoAdmin): Promise<boolean> {
  try {
    await prisma.billingEmailLog.create({ data: { invoiceId: clave, clinicId, kind: "aviso_admin", email: destino() } });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== "P2002") console.error("[aviso-admin] candado:", code ?? e);
    return false;
  }
  return enviarAvisoAlAdmin(aviso);
}
