"use client";

import Link from "next/link";
import { CreditCard, LifeBuoy, Loader2, MessageCircle } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { usePagarAhora } from "@/components/dashboard/pagar-ahora";
import s from "./acciones-suspendida.module.css";

/**
 * Lo que una clínica SUSPENDIDA por falta de pago sí puede hacer (decisión de Rafael): pagar, abrir un
 * ticket de soporte y contactar a su manager. Las tres cosas pasan el candado del plan vencido:
 *   · Pagar ahora       → POST /api/billing/checkout (portal de Stripe si la suscripción sigue viva, checkout
 *                         nuevo si ya no existe); /api/billing/* está exento (isPlanGateAllowlistedPath).
 *   · Abrir un ticket   → /dashboard/soporte, exenta (isAllowedWhileSuspended), y sus /api/support/*.
 *   · Contactar manager → enlace directo a su WhatsApp (sin ninguna API); sin manager asignado, lleva a
 *                         /dashboard/soporte, que sabe pintar ese caso.
 */
export function AccionesSuspendida({
  plan,
  clinicName,
  managerWhatsapp,
  sinPagar = false,
}: {
  plan: string | null;
  clinicName: string;
  /** E.164 sin «+» del manager asignado, o null si no tiene. */
  managerWhatsapp: string | null;
  /** Con la tarjeta rechazada, «Pagar mi plan» y «Cambiar a un plan más grande y pagar» (PagoPendiente) ya cubren el pago. */
  sinPagar?: boolean;
}) {
  const t = useT();
  const { pagar, pagando } = usePagarAhora(plan);
  const mensaje = t("pages.suspended.actions.managerMessage", { clinic: clinicName });

  return (
    <div className={s.fila} role="group" aria-label={t("pages.suspended.actions.label")}>
      {!sinPagar && (
        <button type="button" className={`${s.boton} ${s.principal}`} onClick={pagar} disabled={pagando} data-accion="pagar">
          {pagando ? <Loader2 size={16} className={s.girar} aria-hidden /> : <CreditCard size={16} aria-hidden />}
          {pagando ? t("shell.pagoRechazado.abriendo") : t("pages.suspended.actions.payNow")}
        </button>
      )}
      <Link href="/dashboard/soporte" className={s.boton} data-accion="ticket">
        <LifeBuoy size={16} aria-hidden />
        {t("pages.suspended.actions.openTicket")}
      </Link>
      {managerWhatsapp ? (
        <a
          href={`https://wa.me/${managerWhatsapp}?text=${encodeURIComponent(mensaje)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={s.boton}
          data-accion="manager"
        >
          <MessageCircle size={16} aria-hidden />
          {t("pages.suspended.actions.contactManager")}
        </a>
      ) : (
        <Link href="/dashboard/soporte" className={s.boton} data-accion="manager">
          <MessageCircle size={16} aria-hidden />
          {t("pages.suspended.actions.contactManager")}
        </Link>
      )}
    </div>
  );
}
