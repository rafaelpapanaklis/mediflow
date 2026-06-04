"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Beaker, Package, ChevronRight, Loader } from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import { fmtMXNdec, formatRelativeDate } from "@/lib/format";
import {
  type DentalLabOrderDTO,
  type DentalLabOrderStatus,
  type DentalLabPaymentStatus,
  DENTAL_LAB_ORDER_STATUS,
} from "@/lib/laboratorios/types";
import {
  isTerminalLabStatus,
  DENTAL_LAB_STATUS_ACTION_LABELS,
} from "@/lib/laboratorios/orders-shared";

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

// Mapa estado de pago → tono del badge.
const PAYMENT_STATUS_TONE: Record<DentalLabPaymentStatus, BadgeTone> = {
  UNPAID: "warning",
  PAID: "success",
};

// Estado de pago → translation-key (resuelta con t() al renderizar; solo dos valores).
const PAYMENT_STATUS_LABEL_KEYS: Record<DentalLabPaymentStatus, string> = {
  UNPAID: "procurement.ordenesClient.payUnpaid",
  PAID: "procurement.ordenesClient.payPaid",
};

interface Props {
  orders: DentalLabOrderDTO[];
}

export function OrdenesClient({ orders }: Props) {
  const t = useT();
  const router = useRouter();

  const kpis = useMemo(() => {
    const enProceso = orders.filter((o) => !isTerminalLabStatus(o.status)).length;
    const entregadas = orders.filter((o) => o.status === "ENTREGADA").length;
    return {
      orders: orders.length,
      enProceso,
      entregadas,
    };
  }, [orders]);

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
              boxShadow: "0 10px 24px -8px rgba(124,58,237,0.7)",
            }}
          >
            <Package size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: 22,
                letterSpacing: "-0.02em",
                color: "var(--text-1)",
                fontWeight: 600,
                margin: 0,
              }}
            >
              {t("procurement.ordenesClient.title")}
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
              {t("procurement.ordenesClient.subtitle")}
            </p>
          </div>
        </div>
        <ButtonNew
          variant="secondary"
          icon={<Beaker size={14} />}
          onClick={() => router.push("/dashboard/laboratorios")}
        >
          {t("procurement.ordenesClient.exploreLabs")}
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <KpiCard label={t("procurement.ordenesClient.kpiOrders")} value={String(kpis.orders)} icon={Package} />
        <KpiCard label={t("procurement.ordenesClient.kpiInProcess")} value={String(kpis.enProceso)} icon={Loader} />
        <KpiCard label={t("procurement.ordenesClient.kpiDelivered")} value={String(kpis.entregadas)} icon={Beaker} />
      </div>

      {/* ── Mis órdenes ── */}
      {orders.length === 0 ? (
        <CardNew>
            <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
              <Package size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
              <div
                style={{
                  color: "var(--text-2)",
                  fontSize: 14,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                {t("procurement.ordenesClient.emptyTitle")}
              </div>
              <div style={{ fontSize: 12 }}>
                {t("procurement.ordenesClient.emptyBody")}
              </div>
            </div>
          </CardNew>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {orders.map((order) => {
              const labName = order.lab?.name ?? t("procurement.ordenesClient.labFallback");
              const detail = order.patientName ?? order.internalRef ?? t("procurement.ordenesClient.noReference");
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => router.push(`/dashboard/ordenes-laboratorio/${order.id}`)}
                  className="card"
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    padding: "14px 18px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev)",
                    color: "inherit",
                    transition: "border-color .15s",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 4,
                      }}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}
                      >
                        {order.orderNumber}
                      </span>
                      <BadgeNew tone={DENTAL_LAB_ORDER_STATUS[order.status].tone} dot>
                        {DENTAL_LAB_ORDER_STATUS[order.status].label}
                      </BadgeNew>
                      <BadgeNew tone={PAYMENT_STATUS_TONE[order.paymentStatus]} dot>
                        {t(PAYMENT_STATUS_LABEL_KEYS[order.paymentStatus])}
                      </BadgeNew>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {labName}
                      <span style={{ margin: "0 6px" }}>·</span>
                      {formatRelativeDate(order.createdAt)}
                      <span style={{ margin: "0 6px" }}>·</span>
                      {detail}
                    </div>
                  </div>

                  <div
                    className="mono"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-1)",
                      flexShrink: 0,
                      textAlign: "right",
                    }}
                  >
                    {fmtMXNdec(order.total)}
                  </div>

                  <ChevronRight size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ── Botón de cancelar orden (isla cliente del detalle) ───────────────────
// Mirror del patrón de acciones de estatus del lado proveedor: PATCH +
// confirm dialog + deshabilitado en estados terminales / mientras guarda.
export function CancelOrderButton({
  orderId,
  status,
}: {
  orderId: string;
  status: DentalLabOrderStatus;
}) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);

  // CANCELADA solo es alcanzable desde un estado no terminal.
  const terminal = isTerminalLabStatus(status);

  async function cancelOrder() {
    const ok = await confirm({
      title: t("procurement.ordenesClient.cancelConfirmTitle"),
      description: t("procurement.ordenesClient.cancelConfirmDesc"),
      variant: "danger",
      confirmText: t("procurement.ordenesClient.cancelConfirmText"),
      cancelText: t("common.back"),
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ordenes-laboratorio/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELADA" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("procurement.ordenesClient.cancelFailed"));
      }
      toast.success(t("procurement.ordenesClient.cancelSuccess"));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("procurement.ordenesClient.cancelError"));
    } finally {
      setSaving(false);
    }
  }

  if (terminal) {
    return (
      <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
        {status === "ENTREGADA"
          ? t("procurement.ordenesClient.terminalDelivered")
          : t("procurement.ordenesClient.terminalCancelled")}
      </p>
    );
  }

  return (
    <ButtonNew variant="danger" disabled={saving} onClick={cancelOrder}>
      {DENTAL_LAB_STATUS_ACTION_LABELS.CANCELADA}
    </ButtonNew>
  );
}
