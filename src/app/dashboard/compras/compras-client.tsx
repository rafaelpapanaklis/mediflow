"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ShoppingCart,
  Store,
  Plus,
  Minus,
  Trash2,
  Package,
  ChevronRight,
  X,
  Info,
  Building2,
  Clock,
  CreditCard,
  RotateCcw,
} from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmtMXNdec, formatRelativeDate } from "@/lib/format";
import {
  type SupplierCartDTO,
  type SupplierOrderDTO,
  type SupplierOrderStatus,
  type SupplierPaymentStatus,
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
} from "@/lib/suppliers/types";
import { B2B_PAYMENT_METHOD_LABELS, type B2BPaymentMethod } from "@/lib/payments-b2b";
import { useT } from "@/i18n/i18n-provider";

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

// Mapa estado del pedido → tono del badge (ver contrato del sprint).
const ORDER_STATUS_TONE: Record<SupplierOrderStatus, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "info",
  SHIPPED: "brand",
  DELIVERED: "success",
  CANCELLED: "danger",
};

// Mapa estado de pago → tono del badge.
const PAYMENT_STATUS_TONE: Record<SupplierPaymentStatus, BadgeTone> = {
  UNPAID: "warning",
  PAID: "success",
};

type Tab = "carrito" | "pedidos";

interface Props {
  carts: SupplierCartDTO[];
  orders: SupplierOrderDTO[];
}

export function ComprasClient({ carts, orders }: Props) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("carrito");
  // Ids de items de carrito con una mutación en vuelo (deshabilita controles).
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // Carrito (proveedor) cuyo modal de checkout está abierto.
  const [checkoutCart, setCheckoutCart] = useState<SupplierCartDTO | null>(null);

  const kpis = useMemo(() => {
    const totalItems = carts.reduce(
      (sum, c) => sum + c.items.reduce((s, it) => s + it.quantity, 0),
      0,
    );
    return {
      totalItems,
      suppliers: carts.length,
      orders: orders.length,
    };
  }, [carts, orders]);

  function markBusy(id: string) {
    setBusy((prev) => new Set(prev).add(id));
  }
  function clearBusy(id: string) {
    setBusy((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function changeQuantity(itemId: string, quantity: number) {
    if (quantity < 1) return;
    markBusy(itemId);
    try {
      const res = await fetch(`/api/compras/cart/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("procurement.comprasClient.couldNotUpdateQty"));
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("procurement.comprasClient.updateError"));
    } finally {
      clearBusy(itemId);
    }
  }

  async function removeItem(itemId: string, productName: string) {
    const ok = await confirm({
      title: t("procurement.comprasClient.removeProductTitle"),
      description: t("procurement.comprasClient.removeProductDesc", { productName }),
      variant: "danger",
      confirmText: t("procurement.comprasClient.remove"),
    });
    if (!ok) return;
    markBusy(itemId);
    try {
      const res = await fetch(`/api/compras/cart/${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("procurement.comprasClient.couldNotRemoveProduct"));
      }
      toast.success(t("procurement.comprasClient.productRemoved"));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("procurement.comprasClient.removeError"));
    } finally {
      clearBusy(itemId);
    }
  }

  async function reorder(orderId: string) {
    if (busy.has(orderId)) return;
    markBusy(orderId);
    try {
      const res = await fetch(`/api/compras/orders/${orderId}/reorder`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? t("procurement.comprasClient.couldNotReorder"));
      }
      toast.success(t("procurement.comprasClient.productsAddedToCart"));
      setTab("carrito");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("procurement.comprasClient.reorderError"));
    } finally {
      clearBusy(orderId);
    }
  }

  function cartSubtotal(cart: SupplierCartDTO): number {
    return cart.items.reduce(
      (sum, it) => sum + (it.product?.price ?? 0) * it.quantity,
      0,
    );
  }

  return (
    <div>
      {/* HERO con icon-chip + glow violeta */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 280,
            height: 180,
            pointerEvents: "none",
            background:
              "radial-gradient(60% 70% at 20% 30%, rgba(124,58,237,0.18), transparent 70%)",
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
            <ShoppingCart size={22} />
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
              {t("procurement.comprasClient.heroTitle")}
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              {t("procurement.comprasClient.heroSubtitle")}
            </p>
          </div>
        </div>
        <ButtonNew
          variant="secondary"
          icon={<Store size={14} />}
          onClick={() => router.push("/dashboard/suppliers")}
        >
          {t("procurement.comprasClient.exploreSuppliers")}
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <KpiCard label={t("procurement.comprasClient.kpiItemsInCart")} value={String(kpis.totalItems)} icon={ShoppingCart} />
        <KpiCard label={t("procurement.comprasClient.kpiSuppliers")} value={String(kpis.suppliers)} icon={Store} />
        <KpiCard label={t("procurement.comprasClient.kpiOrders")} value={String(kpis.orders)} icon={Package} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="segment-new">
          <button
            type="button"
            onClick={() => setTab("carrito")}
            className={`segment-new__btn ${tab === "carrito" ? "segment-new__btn--active" : ""}`}
          >
            {t("procurement.comprasClient.tabCart")}
          </button>
          <button
            type="button"
            onClick={() => setTab("pedidos")}
            className={`segment-new__btn ${tab === "pedidos" ? "segment-new__btn--active" : ""}`}
          >
            {t("procurement.comprasClient.tabMyOrders")}
          </button>
        </div>
      </div>

      {/* ── Tab Carrito ── */}
      {tab === "carrito" &&
        (carts.length === 0 ? (
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
                <ShoppingCart size={26} />
              </div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                {t("procurement.comprasClient.cartEmptyTitle")}
              </div>
              <p
                style={{
                  color: "var(--text-3)",
                  fontSize: 13,
                  margin: 0,
                  maxWidth: 340,
                  lineHeight: 1.5,
                }}
              >
                {t("procurement.comprasClient.cartEmptyDesc")}
              </p>
              <ButtonNew
                variant="primary"
                size="sm"
                icon={<Store size={14} />}
                onClick={() => router.push("/dashboard/suppliers")}
              >
                Explorar proveedores
              </ButtonNew>
            </div>
          </CardNew>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {carts.map((cart) => {
              const subtotal = cartSubtotal(cart);
              const businessName = cart.supplier?.businessName ?? t("procurement.comprasClient.supplierFallback");
              return (
                <CardNew
                  key={cart.id}
                  title={businessName}
                  action={
                    <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>
                      {t("procurement.comprasClient.productCount", { count: cart.items.length })}
                    </span>
                  }
                >
                  {/* Acento superior de la card */}
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      insetInline: 0,
                      top: 0,
                      height: 3,
                      background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
                      pointerEvents: "none",
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {cart.items.map((item) => {
                      const product = item.product;
                      const isBusy = busy.has(item.id);
                      const unitPrice = product?.price ?? 0;
                      const lineTotal = unitPrice * item.quantity;
                      const image = product?.images?.[0]?.url;
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            padding: "10px 12px",
                            background: "var(--bg-elev-2)",
                            border: "1px solid var(--border-soft)",
                            borderRadius: 10,
                            opacity: isBusy ? 0.6 : 1,
                            transition: "opacity .15s",
                          }}
                        >
                          {/* Imagen o placeholder */}
                          {image ? (
                            <img
                              src={image}
                              alt={product?.name ?? t("procurement.comprasClient.productFallback")}
                              style={{
                                width: 52,
                                height: 52,
                                borderRadius: 8,
                                objectFit: "cover",
                                background: "var(--bg-elev)",
                                border: "1px solid var(--border-soft)",
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 52,
                                height: 52,
                                borderRadius: 8,
                                background: "var(--brand-soft)",
                                border: "1px solid var(--border-brand)",
                                display: "grid",
                                placeItems: "center",
                                flexShrink: 0,
                              }}
                            >
                              <Package size={20} style={{ color: "var(--violet-400)" }} />
                            </div>
                          )}

                          {/* Nombre + unidad + precio unitario */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--text-1)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {product?.name ?? t("procurement.comprasClient.productFallback")}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                              {fmtMXNdec(unitPrice)}
                              {product?.unit ? ` · ${product.unit}` : ""}
                            </div>
                          </div>

                          {/* Stepper de cantidad */}
                          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                            <ButtonNew
                              variant="ghost"
                              size="sm"
                              aria-label={t("procurement.comprasClient.decreaseQty")}
                              disabled={isBusy || item.quantity <= 1}
                              onClick={() => changeQuantity(item.id, item.quantity - 1)}
                              icon={<Minus size={12} />}
                            />
                            <span
                              className="mono"
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--text-1)",
                                width: 28,
                                textAlign: "center",
                              }}
                            >
                              {item.quantity}
                            </span>
                            <ButtonNew
                              variant="ghost"
                              size="sm"
                              aria-label={t("procurement.comprasClient.increaseQty")}
                              disabled={isBusy}
                              onClick={() => changeQuantity(item.id, item.quantity + 1)}
                              icon={<Plus size={12} />}
                            />
                          </div>

                          {/* Total de línea */}
                          <div
                            className="mono"
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text-1)",
                              minWidth: 90,
                              textAlign: "right",
                              flexShrink: 0,
                            }}
                          >
                            {fmtMXNdec(lineTotal)}
                          </div>

                          {/* Quitar */}
                          <ButtonNew
                            variant="ghost"
                            size="sm"
                            aria-label={t("procurement.comprasClient.removeProductAria")}
                            disabled={isBusy}
                            onClick={() => removeItem(item.id, product?.name ?? t("procurement.comprasClient.thisProductFallback"))}
                            icon={<Trash2 size={12} />}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Pie del card: subtotal + realizar pedido */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: "1px solid var(--border-soft)",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.comprasClient.subtotal")}</span>
                      <span
                        className="mono"
                        style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}
                      >
                        {fmtMXNdec(subtotal)}
                      </span>
                    </div>
                    <ButtonNew
                      variant="primary"
                      icon={<CreditCard size={14} />}
                      onClick={() => setCheckoutCart(cart)}
                    >
                      {t("procurement.comprasClient.placeOrder")}
                    </ButtonNew>
                  </div>
                </CardNew>
              );
            })}
          </div>
        ))}

      {/* ── Tab Mis pedidos ── */}
      {tab === "pedidos" &&
        (orders.length === 0 ? (
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
                <Package size={26} />
              </div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                {t("procurement.comprasClient.ordersEmptyTitle")}
              </div>
              <p
                style={{
                  color: "var(--text-3)",
                  fontSize: 13,
                  margin: 0,
                  maxWidth: 340,
                  lineHeight: 1.5,
                }}
              >
                {t("procurement.comprasClient.ordersEmptyDesc")}
              </p>
            </div>
          </CardNew>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {orders.map((order) => {
              const businessName = order.supplier?.businessName ?? t("procurement.comprasClient.supplierFallback");
              const itemCount = order.items.reduce((s, it) => s + it.quantity, 0);
              return (
                <div
                  key={order.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/dashboard/compras/${order.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/dashboard/compras/${order.id}`);
                    }
                  }}
                  className="ped-list-card"
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    position: "relative",
                    overflow: "hidden",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 16,
                    padding: "14px 18px 14px 20px",
                    width: "100%",
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
                  <div
                    style={{
                      minWidth: 0,
                      flex: "1 1 220px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        className="mono"
                        style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}
                      >
                        {order.orderNumber}
                      </span>
                      <BadgeNew tone={ORDER_STATUS_TONE[order.status]} dot>
                        {SUPPLIER_ORDER_STATUS_LABELS[order.status]}
                      </BadgeNew>
                      <BadgeNew tone={PAYMENT_STATUS_TONE[order.paymentStatus]} dot>
                        {SUPPLIER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
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
                        {businessName}
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
                        {t("procurement.comprasClient.productCount", { count: itemCount })}
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
                    <span className="mono">{formatRelativeDate(order.createdAt)}</span>
                  </div>

                  {/* Total */}
                  <div style={{ textAlign: "right", flexShrink: 0, minWidth: 96 }}>
                    <div style={{ color: "var(--text-4)", fontSize: 11, marginBottom: 2 }}>{t("common.total")}</div>
                    <div
                      className="mono"
                      style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15 }}
                    >
                      {fmtMXNdec(order.total)}
                    </div>
                  </div>

                  <ButtonNew
                    variant="ghost"
                    size="sm"
                    aria-label={t("procurement.comprasClient.reorder")}
                    title={t("procurement.comprasClient.reorderTitle")}
                    disabled={busy.has(order.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      reorder(order.id);
                    }}
                    icon={<RotateCcw size={14} />}
                  />
                  <ChevronRight size={18} style={{ color: "var(--text-4)", flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        ))}

      {/* ── Modal de checkout ── */}
      <CheckoutModal
        cart={checkoutCart}
        onClose={() => setCheckoutCart(null)}
        onCreated={() => {
          setCheckoutCart(null);
          setTab("pedidos");
          router.refresh();
        }}
      />
    </div>
  );
}

// ── Modal de checkout ───────────────────────────────────────────────────
function CheckoutModal({
  cart,
  onClose,
  onCreated,
}: {
  cart: SupplierCartDTO | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const open = cart !== null;

  // Métodos de pago: SÓLO los que el proveedor tiene habilitados (rails B2B).
  const s = cart?.supplier;
  const paymentOptions: B2BPaymentMethod[] = [];
  if (s?.payTransferEnabled) paymentOptions.push("TRANSFER");
  if (s?.payMercadoPagoEnabled) paymentOptions.push("MERCADOPAGO");
  if (s?.payCashEnabled) paymentOptions.push("CASH");

  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reinicia el form cada vez que se abre con un carrito distinto.
  const cartId = cart?.id ?? null;
  const [lastCartId, setLastCartId] = useState<string | null>(null);
  if (cartId !== lastCartId) {
    setLastCartId(cartId);
    setPaymentMethod(paymentOptions[0] ?? "");
    setNotes("");
    setSubmitting(false);
  }

  const noMethods = paymentOptions.length === 0;

  async function submit() {
    if (!cart) return;
    if (!paymentMethod) {
      toast.error(t("procurement.comprasClient.selectPaymentMethod"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/compras/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: cart.supplierId,
          paymentMethod,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t("procurement.comprasClient.couldNotCreateOrder"));
      toast.success(t("procurement.comprasClient.orderCreated"));
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("procurement.comprasClient.createOrderError"));
    } finally {
      setSubmitting(false);
    }
  }

  const businessName = cart?.supplier?.businessName ?? t("procurement.comprasClient.theSupplierFallback");

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal"
          aria-describedby={undefined}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            maxWidth: 480,
            width: "calc(100vw - 32px)",
            maxHeight: "90vh",
            zIndex: 101,
          }}
        >
          <div className="modal__header">
            <Dialog.Title className="modal__title">
              {t("procurement.comprasClient.placeOrderTo", { businessName })}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="modal__body">
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {noMethods ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    background: "var(--warning-soft)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 10,
                  }}
                >
                  <Info size={16} style={{ color: "#fcd34d", flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: "#fcd34d", lineHeight: 1.5 }}>
                    {t("procurement.comprasClient.noPaymentMethods")}
                  </span>
                </div>
              ) : (
                <>
                  <div className="form-section__title">
                    <CreditCard size={15} style={{ color: "var(--violet-400)" }} />
                    <span>{t("procurement.comprasClient.payment")}</span>
                    <span className="form-section__rule" />
                  </div>

                  {/* Método de pago */}
                  <div className="field-new">
                    <label className="field-new__label">{t("procurement.comprasClient.paymentMethod")}</label>
                    <select
                      className="input-new"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    >
                      {paymentOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {B2B_PAYMENT_METHOD_LABELS[opt]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Aviso según método elegido */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 12px",
                      background: "var(--bg-elev-2)",
                      border: "1px solid var(--border-soft)",
                      borderRadius: 10,
                    }}
                  >
                    <Info size={16} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
                      {paymentMethod === "MERCADOPAGO"
                        ? t("procurement.comprasClient.noticeMercadoPago")
                        : paymentMethod === "TRANSFER"
                          ? t("procurement.comprasClient.noticeTransfer")
                          : t("procurement.comprasClient.noticeCash")}
                    </span>
                  </div>
                </>
              )}

              {/* Notas */}
              <div className="field-new">
                <label className="field-new__label">{t("procurement.comprasClient.notesForSupplier")}</label>
                <textarea
                  className="input-new"
                  placeholder={t("procurement.comprasClient.notesPlaceholder")}
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="modal__footer">
            <Dialog.Close asChild>
              <ButtonNew variant="ghost" type="button">
                {t("common.cancel")}
              </ButtonNew>
            </Dialog.Close>
            <ButtonNew variant="primary" onClick={submit} disabled={submitting || noMethods}>
              {submitting ? t("procurement.comprasClient.creating") : t("procurement.comprasClient.confirmOrder")}
            </ButtonNew>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
