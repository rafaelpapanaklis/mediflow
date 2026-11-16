"use client";

// ═══════════════════════════════════════════════════════════════════════
// PEDIDOS DE LA TIENDA (pestaña dentro de Productos, ws6-t1).
//
// Lo que el cliente apartó en /b/<slug>/tienda. Acciones:
//   · «Listo para recoger»  → READY (el cliente se entera por el WhatsApp
//     que TÚ le mandas: «WhatsApp» abre su chat en Mensajes con el texto
//     si la ventana de 24 h está abierta, si no wa.me; nada sale solo);
//   · «Entregar y cobrar»   → sin pagar: el MISMO TicketModal de Caja con
//     las piezas a su precio congelado (createSale lo marca entregado en su
//     transacción). Pagado en línea: no se cobra; se registra la venta como
//     «Pago en línea» (fuera del efectivo del turno) en un clic;
//   · «Cancelar»            → libera las piezas. Si se pagó en línea, avisa
//     que el reembolso se hace en Mercado Pago y pide confirmarlo.
// Ver: products.view. Actuar: products.view + cash.manage (Recepción sí).
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { CheckCircle2, MessageCircle, PackageCheck, RefreshCw, Wallet, XCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashState, CheckoutContext, ClientLookup } from "@/lib/barber/cash";
import type { ProductOrderList, ProductOrderRow } from "@/lib/barber/tienda";
import { ChatClienteLink } from "../wa-chat";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BarberModal } from "@/components/barber/cash/modal";
import { TicketModal } from "@/components/barber/cash/ticket-modal";
import { OpenSessionModal } from "@/components/barber/cash/session-modals";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtDateTime, fmtMoney } from "@/components/barber/cash/money";

type Filter = "open" | "all";
type Dialog =
  | { kind: "none" }
  | { kind: "charge"; order: ProductOrderRow }
  | { kind: "deliverPaid"; order: ProductOrderRow }
  | { kind: "cancel"; order: ProductOrderRow };

const OPEN = new Set(["PENDING", "PAID_ONLINE", "READY"]);

export function PedidosTab({
  dict,
  locale,
  ready,
  canHandle,
  canOpenSession,
  timezone,
  shopName,
  onCount,
  onChanged,
}: {
  dict: Dictionary;
  locale: string;
  /** La tabla de pedidos existe (sql/barber_tienda.sql). */
  ready: boolean;
  canHandle: boolean;
  canOpenSession: boolean;
  timezone: string;
  shopName: string;
  onCount: (n: number) => void;
  onChanged: () => void;
}) {
  const t = useBarberT(dict);
  const [list, setList] = useState<ProductOrderList | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mp, setMp] = useState<{ connected: boolean; account?: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/barber/product-orders", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ProductOrderList;
      setList(data);
      onCount(data.newCount);
    } catch {
      setLoadError(true);
    }
  }, [onCount]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // Mercado Pago (ws6-t5): si su ruta no existe (404) no se dice nada.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    fetch("/api/barber/mercadopago/status", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { connected?: boolean; account?: { nickname?: string | null } | null }) : null))
      .then((d) => {
        // account es un objeto (apodo, correo, número) y solo llega al Dueño y
        // a quien tiene Configuración (D3): aquí se enseña el apodo, si viene.
        if (alive && d && typeof d.connected === "boolean") setMp({ connected: d.connected, account: d.account?.nickname ?? null });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ready]);

  const orders = useMemo(() => (list?.orders ?? []).filter((o) => filter === "all" || OPEN.has(o.status)), [list, filter]);

  if (!ready) {
    return (
      <CardNew title={t("pedidos.title")}>
        <p className="bcaja-hint" style={{ margin: 0 }} data-pedidos-sin-sql>{t("pedidos.sqlPending")}</p>
      </CardNew>
    );
  }

  async function markReady(o: ProductOrderRow) {
    setBusyId(o.id);
    try {
      const res = await fetch(`/api/barber/product-orders/${o.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ready" }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error ?? t("common.error"));
      else toast.success(t("pedidos.markedReady", { folio: o.folio }));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusyId(null);
      void load();
    }
  }

  function waText(o: ProductOrderRow): string {
    const first = o.clientName.split(" ")[0] || o.clientName;
    return o.status === "READY"
      ? t("pedidos.waReady", { name: first, folio: o.folio, shop: shopName, total: fmtMoney(o.total) })
      : t("pedidos.waReceived", { name: first, folio: o.folio, shop: shopName });
  }

  const afterAction = () => {
    setDialog({ kind: "none" });
    void load();
    onChanged();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="btienda-filters">
        <div className="btienda-chips" role="group" aria-label={t("pedidos.filter")} style={{ flex: "1 1 auto" }}>
          <button type="button" className="btienda-chip" aria-pressed={filter === "open"} onClick={() => setFilter("open")}>{t("pedidos.filterOpen")}</button>
          <button type="button" className="btienda-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("pedidos.filterAll")}</button>
        </div>
        <button type="button" className="btn-new btn-new--ghost" onClick={() => void load()} aria-label={t("pedidos.refresh")} title={t("pedidos.refresh")}>
          <RefreshCw size={14} /> {t("pedidos.refresh")}
        </button>
      </div>
      {mp ? (
        <p className="bcaja-hint" style={{ margin: 0 }} data-mp-estado={mp.connected ? "conectado" : "no"}>
          {mp.connected ? t("pedidos.mpConnected", { account: mp.account ?? "" }) : t("pedidos.mpNotConnected")}
        </p>
      ) : null}
      {canHandle ? null : <p className="bcaja-hint" style={{ margin: 0 }}>{t("pedidos.readOnly")}</p>}

      {loadError ? (
        <div className="bcaja-alert bcaja-alert--danger" role="alert">{t("pedidos.loadError")}</div>
      ) : !list ? (
        <div className="btienda-orders" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="btienda-order" style={{ height: 96, background: "var(--bg-elev-2)" }} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <CardNew title={filter === "open" ? t("pedidos.emptyOpenTitle") : t("pedidos.emptyAllTitle")}>
          <p className="bcaja-hint" style={{ margin: 0 }}>{t("pedidos.emptyBody")}</p>
        </CardNew>
      ) : (
        <div className="btienda-orders" data-lista-pedidos>
          {orders.map((o) => {
            const open = OPEN.has(o.status);
            return (
              <article key={o.id} className={open ? "btienda-order" : "btienda-order btienda-order--closed"} data-pedido={o.folio}>
                <div className="btienda-order__row">
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <div className="btienda-order__top">
                      <span className="btienda-folio">{o.folio}</span>
                      <StatusBadge o={o} t={t} />
                      <BadgeNew tone={o.paidOnline ? "success" : "neutral"}>{o.paidOnline ? t("pedidos.paidOnline") : t("pedidos.payAtShop")}</BadgeNew>
                    </div>
                    <div className="btienda-order__who">
                      <strong>{o.clientName}</strong> · {formatBarberPhone(o.clientPhone)}
                    </div>
                    <div className="btienda-order__items">
                      {o.items.map((it) => (
                        <div key={it.productId}>{it.qty} × {it.name} <span className="bcaja-muted">({fmtMoney(it.unitPrice)})</span></div>
                      ))}
                    </div>
                    <div className="btienda-order__meta">
                      {t("pedidos.createdAt", { when: fmtDateTime(o.createdAt, timezone) })}
                      {o.expiresAt && open ? ` · ${t("pedidos.expiresAt", { when: fmtDateTime(o.expiresAt, timezone) })}` : ""}
                      {o.pickedUpAt ? ` · ${t("pedidos.pickedUpAt", { when: fmtDateTime(o.pickedUpAt, timezone) })}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                    <span className="btienda-order__total">{fmtMoney(o.total)}</span>
                    <div className="btienda-order__actions">
                      {open && canHandle && o.status !== "READY" ? (
                        <button type="button" className="btn-new btn-new--secondary" onClick={() => void markReady(o)} disabled={busyId === o.id} data-accion="listo">
                          <CheckCircle2 size={14} /> {t("pedidos.markReady")}
                        </button>
                      ) : null}
                      {open && canHandle ? (
                        <button type="button" className="btn-new barber-btn-primary" onClick={() => setDialog(o.paidOnline ? { kind: "deliverPaid", order: o } : { kind: "charge", order: o })} data-accion="entregar">
                          <PackageCheck size={14} /> {o.paidOnline ? t("pedidos.deliver") : t("pedidos.deliverAndCharge")}
                        </button>
                      ) : null}
                      <ChatClienteLink className="btn-new btn-new--ghost" phone={o.clientPhone} texto={waText(o)} data-accion="whatsapp">
                        <MessageCircle size={14} /> {t("pedidos.whatsapp")}
                      </ChatClienteLink>
                      {open && canHandle ? (
                        <button type="button" className="btn-new btn-new--ghost" onClick={() => setDialog({ kind: "cancel", order: o })} data-accion="cancelar">
                          <XCircle size={14} /> {t("pedidos.cancel")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialog.kind === "charge" ? (
        <OrderChargeBridge dict={dict} locale={locale} timezone={timezone} order={dialog.order} canOpenSession={canOpenSession} onClose={() => setDialog({ kind: "none" })} onCharged={afterAction} />
      ) : null}
      {dialog.kind === "deliverPaid" ? <DeliverPaidModal dict={dict} order={dialog.order} onClose={() => setDialog({ kind: "none" })} onDone={afterAction} /> : null}
      {dialog.kind === "cancel" ? <CancelOrderModal dict={dict} order={dialog.order} onClose={() => setDialog({ kind: "none" })} onDone={afterAction} /> : null}
    </div>
  );
}

function StatusBadge({ o, t }: { o: ProductOrderRow; t: (k: string, v?: Record<string, string | number>) => string }) {
  const map: Record<string, { tone: "success" | "warning" | "danger" | "info" | "brand" | "neutral"; key: string }> = {
    PENDING: { tone: "warning", key: "pedidos.stPending" },
    // Pagado y sin marcar «Listo»: sigue siendo NUEVO (el pago lo dice la otra etiqueta).
    PAID_ONLINE: { tone: "warning", key: "pedidos.stPending" },
    READY: { tone: "brand", key: "pedidos.stReady" },
    PICKED_UP: { tone: "success", key: "pedidos.stPickedUp" },
    CANCELLED: { tone: "neutral", key: "pedidos.stCancelled" },
    EXPIRED: { tone: "neutral", key: "pedidos.stExpired" },
  };
  const m = map[o.status] ?? map.PENDING;
  return <BadgeNew tone={m.tone} dot>{t(m.key)}</BadgeNew>;
}

/** Turno + contexto de cobro → el TicketModal de Caja con el pedido cargado. */
function OrderChargeBridge({
  dict,
  locale,
  timezone,
  order,
  canOpenSession,
  onClose,
  onCharged,
}: {
  dict: Dictionary;
  locale: string;
  timezone: string;
  order: ProductOrderRow;
  canOpenSession: boolean;
  onClose: () => void;
  onCharged: () => void;
}) {
  const t = useBarberT(dict);
  const [phase, setPhase] = useState<"loading" | "error" | "noSession" | "ticket">("loading");
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutContext | null>(null);
  const [client, setClient] = useState<ClientLookup | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const qs = order.clientId ? `?clientId=${encodeURIComponent(order.clientId)}` : "";
      const [cashRes, ctxRes] = await Promise.all([
        fetch("/api/barber/cash-sessions/current", { cache: "no-store" }),
        fetch(`/api/barber/sales/checkout-context${qs}`, { cache: "no-store" }),
      ]);
      if (!cashRes.ok || !ctxRes.ok) {
        const bad = cashRes.ok ? ctxRes : cashRes;
        setError(((await bad.json().catch(() => ({}))) as { error?: string }).error ?? null);
        setPhase("error");
        return;
      }
      const cash = (await cashRes.json()) as CashState;
      const ctx = (await ctxRes.json()) as CheckoutContext & { client?: ClientLookup | null };
      setCheckout(ctx);
      setClient(ctx.client ?? null);
      setPhase(cash.open ? "ticket" : "noSession");
    } catch {
      setPhase("error");
    }
  }, [order.clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === "ticket" && checkout) {
    return (
      <TicketModal
        dict={dict}
        locale={locale}
        checkout={checkout}
        appointment={null}
        initialClient={client}
        productOrder={{ id: order.id, folio: order.folio, clientId: order.clientId, items: order.items }}
        tz={timezone}
        onClose={onClose}
        onCharged={() => {
          toast.success(t("pedidos.delivered", { folio: order.folio }));
          onCharged();
        }}
      />
    );
  }
  if (opening) {
    return <OpenSessionModal dict={dict} onClose={() => setOpening(false)} onDone={() => { setOpening(false); void load(); }} />;
  }
  const title = t("pedidos.chargeTitle", { folio: order.folio });
  return (
    <BarberModal
      open
      title={title}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        phase === "noSession" && canOpenSession ? (
          <button type="button" className="btn-new barber-btn-primary" onClick={() => setOpening(true)} data-accion="abrir-turno">
            <Wallet size={14} /> {t("pedidos.openSession")}
          </button>
        ) : phase !== "loading" ? (
          <Link href="/barber/caja" className="btn-new barber-btn-primary">{t("pedidos.goCaja")}</Link>
        ) : undefined
      }
    >
      {phase === "loading" ? (
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("common.loading")}</p>
      ) : phase === "noSession" ? (
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("pedidos.noSession")}</p>
      ) : (
        <div className="bcaja-alert bcaja-alert--danger" role="alert">{error ?? t("common.error")}</div>
      )}
    </BarberModal>
  );
}

/** Pagado en línea: no se cobra; se registra la venta como «Pago en línea». */
function DeliverPaidModal({ dict, order, onClose, onDone }: { dict: Dictionary; order: ProductOrderRow; onClose: () => void; onDone: () => void }) {
  const t = useBarberT(dict);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/barber/product-orders/${order.id}/deliver`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        setError(data.code === "NO_OPEN_SESSION" ? t("ticket.errorNoSession") : data.error ?? t("common.error"));
        return;
      }
      toast.success(t("pedidos.delivered", { folio: order.folio }));
      onDone();
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BarberModal
      open
      title={t("pedidos.deliverPaidTitle", { folio: order.folio })}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button type="button" className="btn-new barber-btn-primary" onClick={go} disabled={busy} data-accion="confirmar-entrega">
            <PackageCheck size={14} /> {busy ? t("common.saving") : t("pedidos.deliverPaidConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        {error ? <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div> : null}
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-1)" }}>{t("pedidos.deliverPaidBody", { total: fmtMoney(order.total) })}</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {order.items.map((it) => <li key={it.productId}>{it.qty} × {it.name}</li>)}
        </ul>
      </div>
    </BarberModal>
  );
}

function CancelOrderModal({ dict, order, onClose, onDone }: { dict: Dictionary; order: ProductOrderRow; onClose: () => void; onDone: () => void }) {
  const t = useBarberT(dict);
  const [busy, setBusy] = useState(false);
  const [refunded, setRefunded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = !busy && (!order.paidOnline || refunded);
  async function go() {
    if (!can) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/barber/product-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", refundConfirmed: order.paidOnline ? refunded : undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? t("common.error"));
        return;
      }
      toast.success(t("pedidos.cancelled", { folio: order.folio }));
      onDone();
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BarberModal
      open
      title={t("pedidos.cancelTitle", { folio: order.folio })}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("pedidos.keep")}</button>
          <button type="button" className="btn-new btn-new--danger" onClick={go} disabled={!can} data-accion="confirmar-cancelar">
            <XCircle size={14} /> {busy ? t("common.saving") : t("pedidos.cancelConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        {error ? <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div> : null}
        {order.paidOnline ? (
          <>
            <div className="bcaja-alert bcaja-alert--warning" role="alert" data-aviso-reembolso>{t("pedidos.refundWarning", { total: fmtMoney(order.total) })}</div>
            <label className="btienda-switch">
              <input type="checkbox" checked={refunded} onChange={(e) => setRefunded(e.target.checked)} data-reembolso-hecho />
              <span>{t("pedidos.refundDone")}</span>
            </label>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13 }}>{t("pedidos.cancelBody")}</p>
        )}
      </div>
    </BarberModal>
  );
}
