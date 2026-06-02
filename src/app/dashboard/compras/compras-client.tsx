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
        throw new Error(data.error ?? "No se pudo actualizar la cantidad");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      clearBusy(itemId);
    }
  }

  async function removeItem(itemId: string, productName: string) {
    const ok = await confirm({
      title: "¿Quitar producto?",
      description: `Se quitará "${productName}" de tu carrito.`,
      variant: "danger",
      confirmText: "Quitar",
    });
    if (!ok) return;
    markBusy(itemId);
    try {
      const res = await fetch(`/api/compras/cart/${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No se pudo quitar el producto");
      }
      toast.success("Producto quitado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al quitar");
    } finally {
      clearBusy(itemId);
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
            Compras
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            Tu carrito y el historial de pedidos a proveedores.
          </p>
        </div>
        <ButtonNew
          variant="secondary"
          icon={<Store size={14} />}
          onClick={() => router.push("/dashboard/suppliers")}
        >
          Explorar proveedores
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
        <KpiCard label="Artículos en carrito" value={String(kpis.totalItems)} icon={ShoppingCart} />
        <KpiCard label="Proveedores" value={String(kpis.suppliers)} icon={Store} />
        <KpiCard label="Pedidos" value={String(kpis.orders)} icon={Package} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="segment-new">
          <button
            type="button"
            onClick={() => setTab("carrito")}
            className={`segment-new__btn ${tab === "carrito" ? "segment-new__btn--active" : ""}`}
          >
            Carrito
          </button>
          <button
            type="button"
            onClick={() => setTab("pedidos")}
            className={`segment-new__btn ${tab === "pedidos" ? "segment-new__btn--active" : ""}`}
          >
            Mis pedidos
          </button>
        </div>
      </div>

      {/* ── Tab Carrito ── */}
      {tab === "carrito" &&
        (carts.length === 0 ? (
          <CardNew>
            <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
              <ShoppingCart size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
              <div
                style={{
                  color: "var(--text-2)",
                  fontSize: 14,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                Tu carrito está vacío
              </div>
              <div style={{ fontSize: 12, marginBottom: 16 }}>
                Explora el catálogo de proveedores y agrega productos.
              </div>
              <ButtonNew
                variant="primary"
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
              const businessName = cart.supplier?.businessName ?? "Proveedor";
              return (
                <CardNew
                  key={cart.id}
                  title={businessName}
                  action={
                    <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>
                      {cart.items.length} {cart.items.length === 1 ? "producto" : "productos"}
                    </span>
                  }
                >
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
                              alt={product?.name ?? "Producto"}
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
                                background: "var(--bg-elev)",
                                border: "1px solid var(--border-soft)",
                                display: "grid",
                                placeItems: "center",
                                flexShrink: 0,
                              }}
                            >
                              <Package size={20} style={{ color: "var(--text-4)" }} />
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
                              {product?.name ?? "Producto"}
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
                              aria-label="Disminuir cantidad"
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
                              aria-label="Aumentar cantidad"
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
                            aria-label="Quitar producto"
                            disabled={isBusy}
                            onClick={() => removeItem(item.id, product?.name ?? "este producto")}
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
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>Subtotal</span>
                      <span
                        className="mono"
                        style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}
                      >
                        {fmtMXNdec(subtotal)}
                      </span>
                    </div>
                    <ButtonNew
                      variant="primary"
                      onClick={() => setCheckoutCart(cart)}
                    >
                      Realizar pedido
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
                Aún no tienes pedidos
              </div>
              <div style={{ fontSize: 12 }}>
                Cuando realices un pedido a un proveedor aparecerá aquí.
              </div>
            </div>
          </CardNew>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {orders.map((order) => {
              const businessName = order.supplier?.businessName ?? "Proveedor";
              const itemCount = order.items.reduce((s, it) => s + it.quantity, 0);
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => router.push(`/dashboard/compras/${order.id}`)}
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
                      <BadgeNew tone={ORDER_STATUS_TONE[order.status]} dot>
                        {SUPPLIER_ORDER_STATUS_LABELS[order.status]}
                      </BadgeNew>
                      <BadgeNew tone={PAYMENT_STATUS_TONE[order.paymentStatus]} dot>
                        {SUPPLIER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
                      </BadgeNew>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {businessName}
                      <span style={{ margin: "0 6px" }}>·</span>
                      {formatRelativeDate(order.createdAt)}
                      <span style={{ margin: "0 6px" }}>·</span>
                      {itemCount} {itemCount === 1 ? "producto" : "productos"}
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
      toast.error("Selecciona un método de pago");
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
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el pedido");
      toast.success("Pedido creado");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear el pedido");
    } finally {
      setSubmitting(false);
    }
  }

  const businessName = cart?.supplier?.businessName ?? "el proveedor";

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
              Realizar pedido a {businessName}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
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
                    Este proveedor aún no ha configurado métodos de pago. Contáctalo por chat para
                    coordinar el pago.
                  </span>
                </div>
              ) : (
                <>
                  {/* Método de pago */}
                  <div className="field-new">
                    <label className="field-new__label">Método de pago</label>
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
                        ? "Podrás pagar en línea con MercadoPago desde el detalle del pedido."
                        : paymentMethod === "TRANSFER"
                          ? "Verás los datos bancarios (CLABE) del proveedor en el detalle del pedido."
                          : "Pagas en efectivo al recibir el pedido."}
                    </span>
                  </div>
                </>
              )}

              {/* Notas */}
              <div className="field-new">
                <label className="field-new__label">Notas para el proveedor</label>
                <textarea
                  className="input-new"
                  placeholder="Indicaciones de entrega, referencias, etc. (opcional)"
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
                Cancelar
              </ButtonNew>
            </Dialog.Close>
            <ButtonNew variant="primary" onClick={submit} disabled={submitting || noMethods}>
              {submitting ? "Creando…" : "Confirmar pedido"}
            </ButtonNew>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
