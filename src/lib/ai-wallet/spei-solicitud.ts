/**
 * Recarga de saldo IA por SPEI: el PRIMER paso ya no es subir un comprobante.
 *
 * DaleControl todavía no publica una cuenta para transferir
 * (`src/lib/spei/config.ts` sale vacío a propósito), así que pedirle a la
 * clínica el comprobante de una transferencia a una CLABE que nunca vio no
 * tenía salida. Ahora la clínica abre un ticket de soporte con el texto ya
 * escrito y el equipo le pasa los datos por ahí. El comprobante se sigue
 * subiendo después, por `/api/ai-wallet/spei/topup`: es lo que crea el
 * `AiTopup` PENDING que administración confirma para acreditar.
 *
 * Puro (sin prisma ni `server-only`): la ruta lo usa y las pruebas también.
 */

import { getDict } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { montoMxn } from "./spei-montos";

// Solo servidor: `getDict` trae los dos diccionarios completos. La pantalla
// importa los topes y el formato desde `./spei-montos`.

/**
 * Asunto y mensaje del ticket, en el idioma de la clínica. Lleva lo que
 * soporte necesita para no tener que volver a preguntar: la clínica, cuánto
 * quiere recargar y quién lo pide.
 */
export function redactarSolicitudSpei(p: {
  clinica: string;
  persona: string | null;
  amountCents: number;
  locale: string | null | undefined;
}): { subject: string; body: string } {
  const t = makeT(getDict(p.locale));
  const monto = montoMxn(p.amountCents);
  const clinica = p.clinica.trim() || "—";
  const persona = p.persona?.trim() || null;

  const lineas = [
    t("saldoIa.speiTicket.greeting"),
    "",
    t("saldoIa.speiTicket.intro"),
    "",
    t("saldoIa.speiTicket.clinic", { clinica }),
    t("saldoIa.speiTicket.amount", { monto }),
    ...(persona ? [t("saldoIa.speiTicket.requester", { persona })] : []),
    "",
    t("saldoIa.speiTicket.ask"),
    "",
    t("saldoIa.speiTicket.thanks"),
  ];

  return {
    subject: t("saldoIa.speiTicket.subject", { monto }),
    body: lineas.join("\n"),
  };
}
