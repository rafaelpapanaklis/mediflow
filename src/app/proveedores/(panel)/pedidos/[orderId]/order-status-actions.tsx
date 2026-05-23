"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { SUPPLIER_PAYMENT_STATUS_LABELS } from "@/lib/suppliers/types";
import type { SupplierOrderStatus, SupplierPaymentStatus } from "@/lib/suppliers/types";
import { ORDER_STATUS_FLOW, STATUS_ACTION_LABELS } from "@/lib/suppliers/orders-shared";

export function OrderStatusActions({
  orderId,
  status,
  paymentStatus,
}: {
  orderId: string;
  status: SupplierOrderStatus;
  paymentStatus: SupplierPaymentStatus;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function patch(payload: { status?: SupplierOrderStatus; paymentStatus?: SupplierPaymentStatus }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/proveedores/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No se pudo actualizar el pedido.");
      }
      toast.success("Pedido actualizado");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setSaving(false);
    }
  }

  const nextStatuses = ORDER_STATUS_FLOW[status];
  const togglePayment: SupplierPaymentStatus = paymentStatus === "PAID" ? "UNPAID" : "PAID";

  return (
    <CardNew title="Acciones">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {nextStatuses.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            Este pedido está {status === "DELIVERED" ? "entregado" : "cancelado"}; no hay más acciones de estado.
          </p>
        ) : (
          nextStatuses.map((to) => (
            <ButtonNew
              key={to}
              variant={to === "CANCELLED" ? "danger" : "primary"}
              disabled={saving}
              onClick={() => {
                if (
                  to === "CANCELLED" &&
                  !window.confirm("¿Cancelar este pedido? Esta acción no se puede deshacer.")
                ) {
                  return;
                }
                patch({ status: to });
              }}
            >
              {STATUS_ACTION_LABELS[to]}
            </ButtonNew>
          ))
        )}

        <div style={{ borderTop: "1px solid var(--border-soft)", margin: "4px 0" }} />

        <ButtonNew variant="secondary" disabled={saving} onClick={() => patch({ paymentStatus: togglePayment })}>
          {paymentStatus === "PAID" ? "Marcar como sin pagar" : "Marcar como pagado"}
        </ButtonNew>
        <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
          Pago actual: {SUPPLIER_PAYMENT_STATUS_LABELS[paymentStatus]}
        </p>
      </div>
    </CardNew>
  );
}
