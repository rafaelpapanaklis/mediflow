"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";

// Botón cliente: pide al backend una preferencia de MercadoPago y redirige al
// initPoint. El backend usa el token del proveedor; aquí sólo navegamos.
export function PayWithMercadoPago({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);

  async function pay() {
    setLoading(true);
    try {
      const res = await fetch(`/api/compras/orders/${orderId}/pay`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.initPoint) {
        throw new Error(data?.error ?? "No se pudo iniciar el pago.");
      }
      window.location.href = data.initPoint as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al iniciar el pago");
      setLoading(false);
    }
  }

  return (
    <ButtonNew variant="primary" onClick={pay} disabled={loading} icon={<Wallet size={14} />}>
      {loading ? "Redirigiendo…" : "Pagar con MercadoPago"}
    </ButtonNew>
  );
}
