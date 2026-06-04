"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";

// Botón cliente: pide al backend una preferencia de MercadoPago y redirige al
// initPoint. El backend usa el token del proveedor; aquí sólo navegamos.
export function PayWithMercadoPago({ orderId }: { orderId: string }) {
  const t = useT();
  const [loading, setLoading] = useState(false);

  async function pay() {
    setLoading(true);
    try {
      const res = await fetch(`/api/compras/orders/${orderId}/pay`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.initPoint) {
        throw new Error(data?.error ?? t("procurement.payMercadopago.startFailed"));
      }
      window.location.href = data.initPoint as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("procurement.payMercadopago.startError"));
      setLoading(false);
    }
  }

  return (
    <ButtonNew variant="primary" onClick={pay} disabled={loading} icon={<Wallet size={14} />}>
      {loading ? t("procurement.payMercadopago.redirecting") : t("procurement.payMercadopago.payWithMP")}
    </ButtonNew>
  );
}
