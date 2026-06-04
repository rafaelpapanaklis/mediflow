"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, Loader2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system";
import { useT } from "@/i18n/i18n-provider";

// Botón de la clínica para pagar una orden de laboratorio con MercadoPago.
// POST al endpoint /pay → recibe { initPoint } → redirige al checkout. El
// estado de pago lo actualiza el webhook al volver (no aquí).
export function PayWithMercadoPago({ orderId }: { orderId: string }) {
  const t = useT();
  const [loading, setLoading] = useState(false);

  async function pay() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ordenes-laboratorio/${orderId}/pay`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.initPoint) {
        throw new Error(data?.error ?? t("procurement.payMp.startFailed"));
      }
      // Redirige al checkout de MercadoPago (no reseteamos loading: salimos).
      window.location.href = data.initPoint as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("procurement.payMp.startError"));
      setLoading(false);
    }
  }

  return (
    <ButtonNew
      variant="primary"
      icon={loading ? <Loader2 className="animate-spin" size={14} /> : <CreditCard size={14} />}
      disabled={loading}
      onClick={pay}
    >
      {loading ? t("procurement.payMp.redirecting") : t("procurement.payMp.payWithMercadoPago")}
    </ButtonNew>
  );
}
