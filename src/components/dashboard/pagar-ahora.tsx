"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { isPlanId } from "@/lib/billing/plans";
import { useT } from "@/i18n/i18n-provider";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";

/**
 * «Pagar ahora» / «Actualizar tarjeta» de una clínica con el cobro rechazado o suspendida (ws1-t1).
 *
 * Un solo camino para el aviso rojo del panel, Configuración › Suscripción y la pantalla de suspendida:
 * POST /api/billing/checkout con el plan de la clínica. El SERVIDOR decide: si la suscripción de tarjeta
 * sigue viva en Stripe devuelve el portal de facturación (`portal: true`, para cambiar la tarjeta sin
 * abrir una segunda suscripción); si ya no existe, devuelve un Checkout nuevo. Esa ruta está en la lista
 * de /api que una clínica suspendida SÍ puede llamar (isPlanGateAllowlistedPath: /api/billing/*).
 *
 * Sin un plan válido en la clínica no hay nada que cobrar desde aquí: se manda a /dashboard/suspended,
 * donde elige plan y forma de pago.
 */
export function usePagarAhora(plan: string | null | undefined): { pagar: () => Promise<void>; pagando: boolean } {
  const t = useT();
  const router = useRouter();
  const [pagando, setPagando] = useState(false);

  async function pagar() {
    if (pagando) return;
    setPagando(true);
    try {
      if (!isPlanId(plan)) {
        router.push("/dashboard/suspended");
        setPagando(false);
        return;
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.message ?? data.error ?? t("shell.pagoRechazado.errorAbrir"));
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error(mensajeDeError(err, t, { porDefecto: t("shell.pagoRechazado.errorAbrir") }));
      setPagando(false);
    }
  }

  return { pagar, pagando };
}
