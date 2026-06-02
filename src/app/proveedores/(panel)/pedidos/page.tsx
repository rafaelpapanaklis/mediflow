export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import {
  ClipboardList,
  Package,
  ChevronRight,
  Clock,
  CheckCircle2,
  Receipt,
  Building2,
} from "lucide-react";
import {
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
} from "@/lib/suppliers/types";
import type { SupplierOrderStatus } from "@/lib/suppliers/types";
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from "@/lib/suppliers/orders-shared";

// Estatus que cuentan como "en proceso" para el KPI (sobre los datos ya cargados).
const IN_PROGRESS: SupplierOrderStatus[] = ["CONFIRMED", "SHIPPED"];

const FILTERS: { value: SupplierOrderStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "PENDING", label: "Pendientes" },
  { value: "CONFIRMED", label: "Confirmados" },
  { value: "SHIPPED", label: "Enviados" },
  { value: "DELIVERED", label: "Entregados" },
  { value: "CANCELLED", label: "Cancelados" },
];

export default async function SupplierOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");

  const validValues = FILTERS.map((f) => f.value) as string[];
  const active = (
    searchParams.status && validValues.includes(searchParams.status) ? searchParams.status : "ALL"
  ) as SupplierOrderStatus | "ALL";

  const orders = await prisma.supplierOrder.findMany({
    // Multi-tenant: solo los pedidos de este proveedor.
    where: { supplierId: ctx.supplierId, ...(active !== "ALL" ? { status: active } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      clinic: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  // KPIs derivados SOLO de los datos ya cargados (respetan el filtro activo).
  const totalShown = orders.length;
  const inProgressCount = orders.filter((o) => IN_PROGRESS.indexOf(o.status) !== -1).length;
  const deliveredCount = orders.filter((o) => o.status === "DELIVERED").length;
  const totalAmount = orders.reduce((sum, o) => sum + o.total, 0);
  const viewLabel = active === "ALL" ? "Total recibidos" : "En este filtro";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* HERO con icon-chip + glow violeta */}
      <div style={{ position: "relative" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -28,
            left: -20,
            width: 240,
            height: 160,
            pointerEvents: "none",
            background:
              "radial-gradient(120px 90px at 40px 60px, rgba(124,58,237,0.18), transparent 70%)",
          }}
        />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
              boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
            }}
          >
            <ClipboardList size={22} />
          </div>
          <div>
            <h1
              style={{
                fontSize: 22,
                letterSpacing: "-0.02em",
                color: "var(--text-1)",
                fontWeight: 600,
                margin: 0,
              }}
            >
              Pedidos recibidos
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              Gestiona los pedidos que las clínicas te han enviado.
            </p>
          </div>
        </div>
      </div>

      {/* KPIs — métricas sobre los pedidos ya cargados */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 14,
        }}
      >
        <KpiCard label={viewLabel} value={String(totalShown)} icon={Package} />
        <KpiCard label="En proceso" value={String(inProgressCount)} icon={Clock} />
        <KpiCard label="Entregados" value={String(deliveredCount)} icon={CheckCircle2} />
        <KpiCard label="Monto total" value={formatCurrency(totalAmount)} icon={Receipt} />
      </div>

      {/* Filtros por estado (segmented chips) */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const isActive = f.value === active;
          const href = f.value === "ALL" ? "/proveedores/pedidos" : `/proveedores/pedidos?status=${f.value}`;
          return (
            <Link
              key={f.value}
              href={href}
              className="tag-new"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                textDecoration: "none",
                cursor: "pointer",
                ...(isActive
                  ? {
                      background: "var(--brand-soft)",
                      color: "#c4b5fd",
                      borderColor: "var(--border-brand)",
                      fontWeight: 600,
                      boxShadow: "0 0 0 1px var(--border-brand), 0 4px 12px -6px rgba(124,58,237,0.5)",
                    }
                  : {}),
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: isActive ? "var(--violet-400)" : "var(--text-4)",
                  boxShadow: isActive ? "0 0 8px var(--violet-400)" : "none",
                }}
              />
              {f.label}
            </Link>
          );
        })}
      </div>

      {orders.length === 0 ? (
        <CardNew noPad>
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--violet-400)",
              }}
            >
              {active === "ALL" ? <Package size={26} /> : <ClipboardList size={26} />}
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
              {active === "ALL" ? "Aún no has recibido pedidos" : "Sin pedidos en este estado"}
            </div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
              {active === "ALL"
                ? "Cuando una clínica te envíe un pedido, aparecerá aquí listo para que lo gestiones."
                : "No hay pedidos con este estado por ahora. Prueba con otro filtro para ver más órdenes."}
            </p>
          </div>
        </CardNew>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/proveedores/pedidos/${o.id}`}
              className="ped-list-card"
              style={{
                position: "relative",
                overflow: "hidden",
                flexDirection: "row",
                alignItems: "center",
                gap: 16,
                padding: "14px 18px 14px 20px",
              }}
            >
              {/* Acento superior */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
                }}
              />

              {/* Identidad del pedido */}
              <div style={{ minWidth: 0, flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="mono" style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                    {o.orderNumber}
                  </span>
                  <BadgeNew tone={ORDER_STATUS_TONE[o.status]} dot>
                    {SUPPLIER_ORDER_STATUS_LABELS[o.status]}
                  </BadgeNew>
                  <BadgeNew tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                    {SUPPLIER_PAYMENT_STATUS_LABELS[o.paymentStatus]}
                  </BadgeNew>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--text-2)",
                    fontSize: 13,
                    minWidth: 0,
                  }}
                >
                  <Building2 size={14} style={{ color: "var(--violet-400)", flexShrink: 0 }} />
                  <span
                    style={{
                      color: "var(--text-1)",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {o.clinic.name}
                  </span>
                  <span style={{ color: "var(--text-4)" }}>·</span>
                  <span
                    style={{
                      color: "var(--text-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {o._count.items} {o._count.items === 1 ? "artículo" : "artículos"}
                  </span>
                </div>
              </div>

              {/* Fecha relativa */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--text-3)",
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                <Clock size={13} style={{ flexShrink: 0 }} />
                <span className="mono">{formatRelativeDate(o.createdAt)}</span>
              </div>

              {/* Total */}
              <div style={{ textAlign: "right", flexShrink: 0, minWidth: 96 }}>
                <div style={{ color: "var(--text-4)", fontSize: 11, marginBottom: 2 }}>Total</div>
                <div className="mono" style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15 }}>
                  {formatCurrency(o.total)}
                </div>
              </div>

              <ChevronRight size={18} style={{ color: "var(--text-4)", flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
