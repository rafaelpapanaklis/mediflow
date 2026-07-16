"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Settings, X, CheckCircle2, DollarSign } from "lucide-react";
import { SUPPLIER_PAYMENT_STATUS_LABELS } from "@/lib/suppliers/types";
import type { SupplierOrderStatus, SupplierPaymentStatus } from "@/lib/suppliers/types";
import { ORDER_STATUS_FLOW, STATUS_ACTION_LABELS } from "@/lib/suppliers/orders-shared";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function OrderStatusActions({
  orderId,
  status,
  paymentStatus,
  paymentMethod,
}: {
  orderId: string;
  status: SupplierOrderStatus;
  paymentStatus: SupplierPaymentStatus;
  paymentMethod: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
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
  // MercadoPago se marca pagado solo por el webhook; el vendedor no lo toca a mano.
  const isMercadoPago = paymentMethod === "MERCADOPAGO";
  const isDelivered = status === "DELIVERED";
  const isPaid = paymentStatus === "PAID";

  return (
    <CardNew>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "var(--brand-grad)",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <Settings size={17} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>Acciones</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {nextStatuses.length === 0 ? (
          <div
            style={{
              padding: "28px 16px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                display: "grid",
                placeItems: "center",
                background: isDelivered ? "var(--success-soft)" : "var(--bg-elev-2)",
                border: `1px solid ${isDelivered ? "var(--success)" : "var(--border-soft)"}`,
                color: isDelivered ? "var(--success)" : "var(--text-3)",
              }}
            >
              <CheckCircle2 size={24} />
            </div>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, maxWidth: 280, lineHeight: 1.5 }}>
              Este pedido está {isDelivered ? "entregado" : "cancelado"}; no hay más acciones de estado.
            </p>
          </div>
        ) : (
          nextStatuses.map((to) => (
            <ButtonNew
              key={to}
              variant={to === "CANCELLED" ? "danger" : "primary"}
              icon={to === "CANCELLED" ? <X size={15} /> : <CheckCircle2 size={15} />}
              style={{ width: "100%", justifyContent: "center" }}
              disabled={saving}
              onClick={async () => {
                if (
                  to === "CANCELLED" &&
                  !(await confirm({
                    title: "¿Cancelar este pedido?",
                    description: "Esta acción no se puede deshacer.",
                    variant: "danger",
                    confirmText: "Cancelar pedido",
                    cancelText: "Volver",
                  }))
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

        {isMercadoPago ? (
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            El pago por MercadoPago se marca automáticamente al confirmarse en línea. No es necesario
            marcarlo a mano.
          </p>
        ) : (
          <ButtonNew
            variant="secondary"
            icon={<DollarSign size={15} />}
            style={{ width: "100%", justifyContent: "center" }}
            disabled={saving}
            onClick={() => patch({ paymentStatus: togglePayment })}
          >
            {paymentStatus === "PAID" ? "Marcar como no pagada" : "Marcar como pagada"}
          </ButtonNew>
        )}
        <p
          style={{
            fontSize: 11,
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: isPaid ? "var(--success)" : "var(--text-3)",
          }}
        >
          {isPaid && <CheckCircle2 size={12} />}
          Pago actual: {SUPPLIER_PAYMENT_STATUS_LABELS[paymentStatus]}
        </p>
      </div>
    </CardNew>
  );
}
