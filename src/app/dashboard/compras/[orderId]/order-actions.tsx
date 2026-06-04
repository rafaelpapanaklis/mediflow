"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Download } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";

// Acciones cliente del detalle de pedido:
//  - Reordenar: vuelve a agregar los productos del pedido al carrito y te lleva
//    al carrito. El backend (scoped por clinicId de sesión + orderId) usa el
//    precio vigente y omite productos no disponibles.
//  - Descargar comprobante: abre el PDF del pedido en una pestaña nueva.
export function OrderActions({ orderId }: { orderId: string }) {
  const t = useT();
  const router = useRouter();
  const [reordering, setReordering] = useState(false);

  async function reorder() {
    setReordering(true);
    try {
      const res = await fetch(`/api/compras/orders/${orderId}/reorder`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? t("procurement.orderActions.reorderFailed"));
      }
      toast.success(t("procurement.orderActions.addedToCart"));
      // Vamos al carrito (pestaña por defecto de /dashboard/compras).
      router.push("/dashboard/compras");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("procurement.orderActions.reorderError"));
      setReordering(false);
    }
  }

  function downloadReceipt() {
    window.open(`/api/compras/orders/${orderId}/receipt`, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <ButtonNew
        variant="primary"
        onClick={reorder}
        disabled={reordering}
        icon={<RotateCcw size={14} />}
      >
        {reordering ? t("procurement.orderActions.adding") : t("procurement.orderActions.reorder")}
      </ButtonNew>
      <ButtonNew
        variant="secondary"
        onClick={downloadReceipt}
        icon={<Download size={14} />}
      >
        {t("procurement.orderActions.downloadReceipt")}
      </ButtonNew>
    </>
  );
}
