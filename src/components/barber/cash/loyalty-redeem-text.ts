// Qué se LEE en el cobro al canjear el premio de lealtad. Solo texto: la
// regla del canje no cambia (el servidor deja en $0 el servicio elegido).
//
// Antes la casilla decía «Canjear premio de lealtad: Barba gratis (3 sellos)»
// y dejaba gratis el servicio que estuviera en el ticket, fuera barba o no:
// el nombre del premio parecía decir QUÉ se regalaba y no era así.
//
// Ahora:
//   · la casilla es genérica: «Aplicar premio de lealtad (3 sellos)»;
//   · al marcarla se dice el servicio EXACTO que queda gratis y, aparte, cómo
//     se llama el premio que la barbería configuró:
//       «Corte» queda gratis en este ticket. El premio de la barbería es «Barba gratis».
//
// Puro: sin React ni servidor, para poder probarlo.
import type { TFunction } from "@/i18n/t";

export interface LoyaltyRedeemText {
  /** Texto de la casilla. Nunca lleva el nombre del premio. */
  label: string;
  /** Qué servicio queda gratis; null mientras no hay ninguno elegido. */
  effect: string | null;
}

export function loyaltyRedeemText(
  t: TFunction,
  args: { stamps: number; reward: string; serviceName: string | null | undefined },
): LoyaltyRedeemText {
  const service = (args.serviceName ?? "").trim();
  return {
    label: t("ticket.loyaltyRedeem", { count: args.stamps }),
    effect: service ? t("ticket.loyaltyRedeemEffect", { service, reward: args.reward }) : null,
  };
}
