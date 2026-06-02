"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
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

  return (
    <CardNew title="Acciones">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {nextStatuses.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            Este pedido está {status === "ENTREGADA" ? "entregado" : "cancelado"}; no hay más acciones de estado.
          </p>
        ) : (
          nextStatuses.map((to) => (
            <ButtonNew
              key={to}
              variant={to === "CANCELADA" ? "danger" : "primary"}
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
