"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Ban,
  ChevronDown,
  ChevronUp,
  FileText,
  Printer,
  Receipt,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import type { ClientSaleRow, ClientSalesPage } from "@/lib/barber/client-sales";
import {
  NO_SALES_FILTER,
  SALES_METHOD_FILTERS,
  SALES_PERIOD_FILTERS,
  clientSalesFilterQuery,
  type ClientSalesFilter,
} from "@/lib/barber/ficha-core";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { WhatsAppGlyph } from "@/components/ui/whatsapp-glyph";
import { CancelSaleModal, ChangeMethodModal, type SaleForModal } from "@/components/barber/cash/session-modals";
import { ChatClienteLink } from "../wa-chat";
import s from "./client-sales.module.css";
import f from "./ficha.module.css";

/**
 * «Pagos» en la ficha del cliente (antes «Cobros»): los tickets que Caja ya
 * escribió para él. Los datos llegan del servidor (listClientSales), que ya
 * recortó por barbería, sede y —para el rol Barbero— por lo que cobró él.
 *
 * Sin lógica de dinero propia: «Cambiar método» y «Cancelar ticket» son los
 * MISMOS diálogos de Caja (session-modals) contra las MISMAS rutas
 * (/api/barber/sales/[id]/payment-method y /cancel), con el mismo permiso
 * (cash.manage, `canManage`) y solo en tickets de un turno ABIERTO, como en
 * Caja. El servidor lo vuelve a revisar todo.
 *
 * `headerAction` es «Nuevo cobro», `beforeList` las notas «Por cobrar» y
 * `pending` su resumen para la cifra de arriba. `reloadKey` sube cuando se
 * cobra algo desde la ficha: la lista se vuelve a pedir.
 */
export function ClientSales({
  clientId,
  clientPhone,
  shopName,
  initial,
  dict,
  cajaDict,
  locale,
  timezone,
  canPrint,
  canManage = false,
  headerAction,
  beforeList,
  pending = null,
  reloadKey = 0,
  onChanged,
}: {
  clientId: string;
  clientPhone?: string | null;
  /** Para el texto del ticket por WhatsApp («Tu ticket de {shop}…»). */
  shopName?: string;
  initial: ClientSalesPage;
  /** Sub-árbol barber.cobros. */
  dict: Dictionary;
  /** Sub-árbol barber.caja (los diálogos de Caja y el texto del ticket). */
  cajaDict?: Dictionary;
  locale: string;
  timezone: string;
  /** cash.view: ver y reimprimir el ticket. */
  canPrint: boolean;
  /** Plan con caja + cash.manage: cambiar método y cancelar (turno abierto). */
  canManage?: boolean;
  headerAction?: React.ReactNode;
  beforeList?: React.ReactNode;
  /** Notas «Por cobrar» (null = no se sabe / sin permiso: la cifra no sale). */
  pending?: { count: number; total: number } | null;
  reloadKey?: number;
  /** Algo cambió (método, cancelación): la ficha refresca lo demás. */
  onChanged?: () => void;
}) {
  const t = useMemo(() => makeBarberT(dict), [dict]);
  const tc = useMemo(() => (cajaDict ? makeBarberT(cajaDict) : null), [cajaDict]);
  const [data, setData] = useState<ClientSalesPage>(initial);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(initial.rows[0]?.id ?? null);
  const [modal, setModal] = useState<{ kind: "method" | "cancel"; row: ClientSaleRow } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const first = useRef(true);
  const filter = data.filter ?? NO_SALES_FILTER;

  const money = useMemo(
    () => new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", { style: "currency", currency: "MXN" }),
    [locale],
  );
  const when = useCallback(
    (iso: string) => {
      try {
        return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: timezone,
        }).format(new Date(iso));
      } catch {
        return iso.slice(0, 10);
      }
    },
    [locale, timezone],
  );

  const load = useCallback(
    async (page: number, nextFilter: ClientSalesFilter) => {
      setError(false);
      setLoading(true);
      try {
        const q = clientSalesFilterQuery(nextFilter);
        const res = await fetch(`/api/barber/clients/${clientId}/sales?page=${page}${q ? `&${q}` : ""}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setError(true);
          return;
        }
        const next = (await res.json()) as ClientSalesPage;
        setData(next);
        setOpen((cur) => (next.rows.some((r) => r.id === cur) ? cur : null));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [clientId],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(1, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando se cobra algo desde la ficha
  }, [reloadKey, load]);

  const pages = Math.max(1, Math.ceil(data.count / data.pageSize));
  const totals = data.totals ?? { all: data.count, paid: data.summary.paidTickets, cancelled: 0 };
  const setFilter = (patch: Partial<ClientSalesFilter>) => void load(1, { ...filter, ...patch });
  const methodLabel = (m: BarberPaymentMethod) => t(`methods.${m}`);
  const shareText = (row: ClientSaleRow) =>
    tc ? tc("print.shareText", { shop: shopName ?? "", total: money.format(row.total) }) : null;

  return (
    <section className={f.panel} data-cobros aria-labelledby="ficha-pagos-titulo">
      <div className={f.panelHead}>
        <div style={{ minWidth: 0 }}>
          <h2 className={f.panelTitle} id="ficha-pagos-titulo">{t("title")}</h2>
          <p className={f.panelSub}>{data.scope === "own" ? t("subtitleOwn") : t("subtitle")}</p>
        </div>
        {headerAction ? <div>{headerAction}</div> : null}
      </div>

      <div className={s.band}>
        <div className={`${s.cell} ${s.cellMain}`}>
          <p className={s.cellLabel}>{t("spent")}</p>
          <p className={s.cellValue} data-cifra="pagado">{money.format(data.summary.spent)}</p>
          <p className={s.cellHint}>{t("spentHint")}</p>
        </div>
        <div className={s.cell}>
          <p className={s.cellLabel}>{t("visits")}</p>
          <p className={s.cellValue} data-cifra="visitas">{data.summary.chargedVisits}</p>
        </div>
        <div className={s.cell}>
          <p className={s.cellLabel}>{t("tickets")}</p>
          <p className={s.cellValue}>{data.summary.paidTickets}</p>
        </div>
        {pending && pending.count > 0 ? (
          <div className={s.cell}>
            <p className={s.cellLabel}>{t("ficha.pendingCell")}</p>
            <p className={s.cellValue} style={{ color: "var(--warning)" }} data-cifra="por-cobrar">
              {money.format(pending.total)}
            </p>
            <p className={s.cellHint}>{t("ficha.pendingNotes", { count: pending.count })}</p>
          </div>
        ) : null}
      </div>

      {beforeList ? <div className={`${f.card} ${f.cardPad} ${s.draftsBox}`}>{beforeList}</div> : null}

      <div className={f.card}>
        <div className={s.ticketsHead}>
          <h3 className={f.cardTitle} style={{ margin: 0 }}>{t("tickets")}</h3>
          <div className={s.filters} role="group" aria-label={t("ficha.filters.label")}>
            {(["all", "paid", "cancelled"] as const).map((st) => (
              <button
                key={st}
                type="button"
                className={`${f.pill} ${filter.status === st ? f.pillOn : ""}`}
                aria-pressed={filter.status === st}
                onClick={() => setFilter({ status: st })}
                data-filtro-estado={st}
              >
                {t(`ficha.filters.${st}`)}{" "}
                <span className={f.pillCount}>{st === "all" ? totals.all : st === "paid" ? totals.paid : totals.cancelled}</span>
              </button>
            ))}
            <select
              className={s.select}
              value={filter.period}
              aria-label={t("ficha.filters.periodAll")}
              onChange={(e) => setFilter({ period: e.target.value as ClientSalesFilter["period"] })}
            >
              {SALES_PERIOD_FILTERS.map((p) => (
                <option key={p} value={p}>
                  {t(`ficha.filters.period${p === "all" ? "All" : p === "year" ? "Year" : p}`)}
                </option>
              ))}
            </select>
            <select
              className={s.select}
              value={filter.method}
              aria-label={t("ficha.filters.methodAll")}
              onChange={(e) => setFilter({ method: e.target.value as ClientSalesFilter["method"] })}
            >
              {SALES_METHOD_FILTERS.map((m) => (
                <option key={m} value={m}>
                  {m === "all" ? t("ficha.filters.methodAll") : methodLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? <p className={s.error} role="alert" style={{ margin: "0 20px 12px" }}>{t("error")}</p> : null}
        {notice ? (
          <p className={s.notice} role="status" aria-live="polite">{notice}</p>
        ) : null}

        {data.rows.length === 0 ? (
          <div className={s.empty} style={{ margin: 20 }}>
            {totals.all > 0 ? (
              <p style={{ margin: 0 }}>{t("ficha.filters.none")}</p>
            ) : (
              <>
                <p style={{ margin: 0 }}>{t("empty")}</p>
                {headerAction ? <p style={{ margin: "4px 0 0", color: "var(--text-3)" }}>{t("emptyCta")}</p> : null}
              </>
            )}
          </div>
        ) : (
          <ul className={s.tickets} aria-busy={loading}>
            {data.rows.map((row) => (
              <TicketRow
                key={row.id}
                row={row}
                t={t}
                money={money}
                when={when}
                open={open === row.id}
                onToggle={() => setOpen((cur) => (cur === row.id ? null : row.id))}
                canPrint={canPrint}
                canManage={canManage && Boolean(cajaDict)}
                clientPhone={clientPhone ?? null}
                shareText={shareText(row)}
                onChangeMethod={() => setModal({ kind: "method", row })}
                onCancel={() => setModal({ kind: "cancel", row })}
              />
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <div className={s.pager}>
            <span>{t("page", { page: data.page, pages })}</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={`${f.btn} ${f.btnSm}`}
                disabled={data.page <= 1 || loading}
                onClick={() => void load(data.page - 1, filter)}
              >
                {t("prev")}
              </button>
              <button
                type="button"
                className={`${f.btn} ${f.btnSm}`}
                disabled={data.page >= pages || loading}
                onClick={() => void load(data.page + 1, filter)}
              >
                {t("next")}
              </button>
            </span>
          </div>
        ) : null}
      </div>

      <p className={s.cfdi}>
        <FileText size={15} aria-hidden="true" />
        <span>
          <strong>{t("ficha.cfdi")}</strong> · {t("ficha.cfdiBody")}
        </span>
        <span className={f.chip}>{t("ficha.cfdiSoon")}</span>
      </p>

      {/* Los diálogos de Caja, tal cual (BarberModal, sin portal). */}
      {modal?.kind === "method" && cajaDict ? (
        <ChangeMethodModal
          dict={cajaDict}
          sale={toModalSale(modal.row, t)}
          onClose={() => setModal(null)}
          onDone={(m) => {
            setModal(null);
            setNotice(t("ficha.actions.changed", { method: methodLabel(m) }));
            void load(data.page, filter);
            onChanged?.();
          }}
        />
      ) : null}
      {modal?.kind === "cancel" && cajaDict ? (
        <CancelSaleModal
          dict={cajaDict}
          sale={toModalSale(modal.row, t)}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setNotice(t("ficha.actions.cancelled"));
            void load(data.page, filter);
            onChanged?.();
          }}
        />
      ) : null}
    </section>
  );
}

/** Lo que muestran los diálogos de Caja: qué llevaba, total y método. */
function toModalSale(row: ClientSaleRow, t: (k: string, v?: Record<string, string | number>) => string): SaleForModal {
  return {
    id: row.id,
    itemsSummary: itemsText(row, t) || (row.kind !== "sale" ? t(`kind.${row.kind}`) : "—"),
    total: row.total,
    paymentMethod: row.paymentMethod,
    kind: row.kind,
  };
}

function soldLines(row: ClientSaleRow) {
  return row.lines.filter((l) => l.kind === "service" || l.kind === "product");
}

function lineName(description: string): string {
  return description.replace(/ · Gratis \(lealtad[^)]*\)$/, "");
}

function itemsText(row: ClientSaleRow, t: (k: string, v?: Record<string, string | number>) => string): string {
  return soldLines(row)
    .map((l) => `${l.qty > 1 ? `${l.qty}× ` : ""}${lineName(l.description)}${l.free ? ` (${t("free")})` : ""}`)
    .join(" · ");
}

function TicketRow({
  row,
  t,
  money,
  when,
  open,
  onToggle,
  canPrint,
  canManage,
  clientPhone,
  shareText,
  onChangeMethod,
  onCancel,
}: {
  row: ClientSaleRow;
  t: (k: string, v?: Record<string, string | number>) => string;
  money: Intl.NumberFormat;
  when: (iso: string) => string;
  open: boolean;
  onToggle: () => void;
  canPrint: boolean;
  canManage: boolean;
  clientPhone: string | null;
  shareText: string | null;
  onChangeMethod: () => void;
  onCancel: () => void;
}) {
  const cancelled = row.status === "cancelled";
  const items = cancelled
    ? row.cancelledSummary
      ? t("cancelledWas", { summary: row.cancelledSummary })
      : "—"
    : itemsText(row, t) || (row.kind !== "sale" ? t(`kind.${row.kind}`) : "—");
  const sub = cancelled
    ? [row.cancelledBy ? t("ficha.detail.cancelledBy", { name: row.cancelledBy }) : null].filter(Boolean)
    : [row.barberName ? t("by", { name: row.barberName }) : t("noBarber"), t(`methods.${row.paymentMethod}`)];
  const total = cancelled && row.cancelledTotal !== null ? row.cancelledTotal : row.total;
  const detailId = `ticket-${row.id}`;

  // Cambiar método / cancelar: como en Caja, solo con el turno abierto.
  const why = row.sessionOpen
    ? null
    : row.hasSession
      ? t("ficha.actions.closedHint")
      : t("ficha.actions.noSessionHint");
  const canChangeMethod = canManage && !cancelled && row.sessionOpen && row.paymentMethod !== "STRIPE";
  const canCancel = canManage && !cancelled && row.sessionOpen;

  return (
    <li className={`${s.ticket} ${open ? s.ticketOpen : ""}`} data-ticket={row.id}>
      <button
        type="button"
        className={s.ticketHead}
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className={s.ticketWhen}>
          <strong>{when(row.createdAt)}</strong>
          <span>{t("ficha.ticket", { id: row.shortId })}</span>
        </span>
        <span className={s.ticketWhat}>
          <span className={`${s.ticketItems} ${cancelled ? s.muted : ""}`}>{items}</span>
          <span className={s.ticketSub}>{sub.join(" · ")}</span>
        </span>
        <span className={s.ticketChips}>
          <span className={`${s.chip} ${cancelled ? s.chipCancelled : s.chipPaid}`}>
            {cancelled ? t("cancelled") : t("paid")}
          </span>
          {row.kind !== "sale" ? <span className={s.chip}>{t(`kind.${row.kind}`)}</span> : null}
        </span>
        <span className={`${s.total} ${cancelled ? s.totalCancelled : ""}`}>{money.format(total)}</span>
        {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>

      {open ? (
        <div className={s.ticketBody} id={detailId}>
          <div className={s.ticketCols}>
            <table className={s.lines}>
              <tbody>
                {cancelled ? (
                  <tr>
                    <td colSpan={2} className={s.muted}>
                      {row.cancelReason ? t("ficha.detail.reason", { reason: row.cancelReason }) : items}
                    </td>
                  </tr>
                ) : (
                  row.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <span className={s.lineName}>
                          {l.qty > 1 ? `${l.qty}× ` : ""}
                          {lineName(l.description)}
                        </span>
                        {l.kind === "product" ? <span className={s.lineHint}>{t("ficha.detail.product")}</span> : null}
                        {l.free ? <span className={s.lineHint}>{t("free")}</span> : null}
                      </td>
                      <td className={s.num}>{money.format(l.unitPrice * l.qty)}</td>
                    </tr>
                  ))
                )}
                {!cancelled && row.tip > 0 ? (
                  <tr>
                    <td className={s.muted}>{t("ficha.detail.tipLine")}</td>
                    <td className={`${s.num} ${s.muted}`}>{money.format(row.tip)}</td>
                  </tr>
                ) : null}
                <tr className={s.linesTotal}>
                  <td>{t("ficha.detail.total")}</td>
                  <td className={s.num}>{money.format(total)}</td>
                </tr>
              </tbody>
            </table>
            <dl className={s.facts}>
              <div>
                <dt>{t("ficha.detail.attended")}</dt>
                <dd>{row.barberName ?? t("noBarber")}</dd>
              </div>
              <div>
                <dt>{t("ficha.detail.charged")}</dt>
                <dd>{row.soldByName}</dd>
              </div>
              <div>
                <dt>{t("ficha.detail.method")}</dt>
                <dd>{t(`methods.${row.paymentMethod}`)}</dd>
              </div>
              <div>
                <dt>{t("ficha.detail.shift")}</dt>
                <dd>{row.sessionOpen ? t("ficha.detail.shiftOpen") : row.hasSession ? t("ficha.detail.shiftClosed") : t("ficha.detail.shiftNone")}</dd>
              </div>
              {row.bonusName ? (
                <div>
                  <dt>{t("ficha.detail.discountLine")}</dt>
                  <dd>{t("bonus", { name: row.bonusName })}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className={s.ticketActions}>
            {canPrint ? (
              <>
                <a className={`${f.btn} ${f.btnSm}`} href={`/barber/caja/ticket/${row.id}`} target="_blank" rel="noopener noreferrer" data-accion="ver-ticket">
                  <Receipt size={14} aria-hidden="true" /> {t("ficha.actions.view")}
                </a>
                <a className={`${f.btn} ${f.btnSm}`} href={`/barber/caja/ticket/${row.id}?imprimir=1`} target="_blank" rel="noopener noreferrer" data-accion="reimprimir">
                  <Printer size={14} aria-hidden="true" /> {t("ficha.actions.reprint")}
                </a>
              </>
            ) : null}
            {canPrint && !cancelled && clientPhone && shareText ? (
              <ChatClienteLink className={`${f.btn} ${f.btnSm}`} phone={clientPhone} texto={shareText} data-accion="ticket-whatsapp">
                <WhatsAppGlyph size={14} /> {t("ficha.actions.whatsapp")}
              </ChatClienteLink>
            ) : null}
            {canManage && !cancelled && row.paymentMethod !== "STRIPE" ? (
              <button
                type="button"
                className={`${f.btn} ${f.btnSm}`}
                onClick={onChangeMethod}
                disabled={!canChangeMethod}
                title={canChangeMethod ? undefined : why ?? undefined}
                data-accion="cambiar-metodo"
              >
                <ArrowLeftRight size={14} aria-hidden="true" /> {t("ficha.actions.changeMethod")}
              </button>
            ) : null}
            {canManage && !cancelled ? (
              <button
                type="button"
                className={`${f.btn} ${f.btnSm} ${f.btnDanger} ${s.pushRight}`}
                onClick={onCancel}
                disabled={!canCancel}
                title={canCancel ? undefined : why ?? undefined}
                data-accion="cancelar-ticket"
              >
                <Ban size={14} aria-hidden="true" /> {t("ficha.actions.cancel")}
              </button>
            ) : null}
          </div>
          {canManage && !cancelled && !row.sessionOpen ? <p className={s.actionsHint}>{why}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
