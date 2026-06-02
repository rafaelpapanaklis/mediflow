"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Send, X, BadgeCheck } from "lucide-react";
import type { DentalLabOrderStatus } from "@/lib/laboratorios/types";
import {
  nextLabStatuses,
  DENTAL_LAB_STATUS_ACTION_LABELS,
} from "@/lib/laboratorios/orders-shared";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function OrderStatusActions({
  orderId,
  status,
}: {
  orderId: string;
  status: DentalLabOrderStatus;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);

  async function patch(next: DentalLabOrderStatus) {
    setSaving(true);
    try {
      const res = await fetch(`/api/laboratorios/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
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

  const nextStatuses = nextLabStatuses(status);

  const isDelivered = status === "ENTREGADA";

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
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <Send size={17} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
          Acciones
        </div>
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
              <BadgeCheck size={24} />
            </div>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, maxWidth: 280, lineHeight: 1.5 }}>
              Este pedido está {isDelivered ? "entregado" : "cancelado"}; no hay más acciones de estado.
            </p>
          </div>
        ) : (
          nextStatuses.map((to) => (
            <ButtonNew
              key={to}
              variant={to === "CANCELADA" ? "danger" : "primary"}
              icon={to === "CANCELADA" ? <X size={15} /> : <Send size={15} />}
              style={{ width: "100%", justifyContent: "center" }}
              disabled={saving}
              onClick={async () => {
                if (
                  to === "CANCELADA" &&
                  !(await confirm({
                    title: "¿Cancelar esta orden?",
                    description: "Esta acción no se puede deshacer.",
                    variant: "danger",
                    confirmText: "Cancelar orden",
                    cancelText: "Volver",
                  }))
                ) {
                  return;
                }
                patch(to);
              }}
            >
              {DENTAL_LAB_STATUS_ACTION_LABELS[to]}
            </ButtonNew>
          ))
        )}
      </div>
    </CardNew>
  );
}
