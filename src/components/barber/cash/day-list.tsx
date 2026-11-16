"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Image as ImageIcon, Printer, XCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { SaleRow } from "@/lib/barber/cash";
import type { CashMovementRow } from "@/lib/barber/cash-movements";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, fmtTime, PAYMENT_METHOD_KEYS } from "./money";
import { buildDayRows, countByFilter, DAY_FILTERS, drawerEffect, filterDayRows, type DayFilter, type DayRow } from "./caja-dia-core";
import { movementTitle } from "./movement-modals";

/**
 * La lista ÚNICA del día (ws6-t1): tickets, gastos, retiros, entradas, pagos
 * y anticipos en orden de hora, con filtro por tipo y quién lo hizo. Lo
 * anulado o cancelado queda tachado con quién y cuándo (nunca desaparece).
 * Un turno cerrado se ve igual, sin acciones (readOnly).
 */
export function DayList({
  dict,
  sales,
  movements,
  tz,
  readOnly = false,
  canManage = false,
  canVoid,
  onChangeMethod,
  onCancelSale,
  onVoidMovement,
}: {
  dict: Dictionary;
  sales: SaleRow[];
  movements: CashMovementRow[];
  tz: string;
  readOnly?: boolean;
  canManage?: boolean;
  /** ¿Puede anular ESTE movimiento? (la llave depende del tipo). */
  canVoid?: (m: CashMovementRow) => boolean;
  onChangeMethod?: (s: SaleRow) => void;
  onCancelSale?: (s: SaleRow) => void;
  onVoidMovement?: (m: CashMovementRow) => void;
}) {
  const t = useBarberT(dict);
  const [filter, setFilter] = useState<DayFilter>("all");
  const rows = useMemo(() => buildDayRows(sales, movements), [sales, movements]);
  const counts = useMemo(() => countByFilter(rows), [rows]);
  const shown = filterDayRows(rows, filter);
  const methodLabel = (m: BarberPaymentMethod) => t(PAYMENT_METHOD_KEYS[m]);

  if (rows.length === 0) {
    return <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("day.empty")}</p>;
  }

  return (
    <div>
      <div className="bcaja-filters" role="radiogroup" aria-label={t("day.filter")}>
        {DAY_FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} className={`bcaja-chip ${filter === f ? "bcaja-chip--on" : ""}`} onClick={() => setFilter(f)} data-filtro={f}>
            {t(`day.f.${f}`)} <span className="bcaja-muted">({counts[f]})</span>
          </button>
        ))}
      </div>
      <div className="bcaja-table-wrap">
        <table className="table-new bcaja-tickets bcaja-day">
          <thead>
            <tr>
              <th>{t("caja.colTime")}</th>
              <th>{t("day.colWhat")}</th>
              <th>{t("day.colWho")}</th>
              <th>{t("caja.colMethod")}</th>
              <th className="bcaja-num">{t("day.colAmount")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <DayRowView
                key={`${r.source}-${r.id}`}
                row={r}
                t={t}
                tz={tz}
                methodLabel={methodLabel}
                readOnly={readOnly}
                canManage={canManage}
                canVoid={canVoid}
                onChangeMethod={onChangeMethod}
                onCancelSale={onCancelSale}
                onVoidMovement={onVoidMovement}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayRowView({
  row,
  t,
  tz,
  methodLabel,
  readOnly,
  canManage,
  canVoid,
  onChangeMethod,
  onCancelSale,
  onVoidMovement,
}: {
  row: DayRow;
  t: (k: string, v?: Record<string, string | number>) => string;
  tz: string;
  methodLabel: (m: BarberPaymentMethod) => string;
  readOnly: boolean;
  canManage: boolean;
  canVoid?: (m: CashMovementRow) => boolean;
  onChangeMethod?: (s: SaleRow) => void;
  onCancelSale?: (s: SaleRow) => void;
  onVoidMovement?: (m: CashMovementRow) => void;
}) {
  const effect = drawerEffect(row);
  const sign = effect > 0 ? "+" : effect < 0 ? "−" : "";
  const tone = effect > 0 ? "var(--success)" : effect < 0 ? "var(--danger)" : "var(--text-2)";

  if (row.source === "sale") {
    const s = row.sale;
    const what =
      s.kind === "deposit"
        ? t("day.kind.deposit")
        : s.kind === "refund"
          ? t("day.kind.refund")
          : s.kind === "membership"
            ? t("day.kind.membership")
            : t("day.kind.ticket");
    const detail = [s.clientName, s.barberName, s.itemsSummary].filter(Boolean).join(" · ");
    return (
      <tr className={s.cancelled ? "bcaja-strike" : undefined} data-renglon="ticket" data-grupo={row.group}>
        <td data-label={t("caja.colTime")}>{fmtTime(s.createdAt, tz)}</td>
        <td data-label={t("day.colWhat")} style={{ whiteSpace: "normal", maxWidth: 320 }}>
          <strong>{what}</strong>
          {detail ? <span className="bcaja-muted"> · {detail}</span> : null}
          {s.cancelled ? <> <BadgeNew tone="neutral">{t("common.cancelled")}</BadgeNew></> : null}
        </td>
        <td data-label={t("day.colWho")}>{s.soldByName}</td>
        <td data-label={t("caja.colMethod")}>
          {methodLabel(s.paymentMethod)}
          {(s.methodChanges ?? []).length > 0 ? (
            <span className="bcaja-muted" style={{ display: "block", fontSize: 11.5 }}>{t("caja.changedFrom", { method: methodLabel(s.methodChanges[0].from) })}</span>
          ) : null}
        </td>
        <td className="bcaja-num" data-label={t("day.colAmount")}>
          <strong style={{ color: tone }}>{sign}{fmtMoney(Math.abs(s.total))}</strong>
          {s.tip > 0 ? <span className="bcaja-muted" style={{ display: "block", fontSize: 11.5 }}>{t("day.tipIncluded", { tip: fmtMoney(s.tip) })}</span> : null}
        </td>
        <td>
          <span className="bcaja-row-actions">
            <Link href={`/barber/caja/ticket/${s.id}`} className="icon-btn-new" title={t("caja.view")} aria-label={t("caja.view")}>
              <Printer size={13} />
            </Link>
            {!readOnly && canManage && !s.cancelled && s.paymentMethod !== "STRIPE" && onChangeMethod && (
              <button type="button" className="icon-btn-new" title={t("caja.changeMethod")} aria-label={t("caja.changeMethod")} onClick={() => onChangeMethod(s)}>
                <ArrowLeftRight size={13} />
              </button>
            )}
            {!readOnly && canManage && !s.cancelled && onCancelSale && (
              <button type="button" className="icon-btn-new" title={t("caja.cancelTicket")} aria-label={t("caja.cancelTicket")} onClick={() => onCancelSale(s)}>
                <XCircle size={13} />
              </button>
            )}
          </span>
        </td>
      </tr>
    );
  }

  const m = row.movement;
  return (
    <tr className={m.voidedAt ? "bcaja-strike" : undefined} data-renglon="movimiento" data-grupo={row.group}>
      <td data-label={t("caja.colTime")}>{fmtTime(m.createdAt, tz)}</td>
      <td data-label={t("day.colWhat")} style={{ whiteSpace: "normal", maxWidth: 320 }}>
        <strong>{movementTitle(t, m)}</strong>
        {m.note ? <span className="bcaja-muted"> · {m.note}</span> : null}
        {m.voidedAt ? (
          <span className="bcaja-muted" style={{ display: "block", fontSize: 11.5, textDecoration: "none" }} data-anulado>
            {t("day.voidedBy", { name: m.voidedByName ?? "—", when: fmtDateTime(m.voidedAt, tz) })}
            {m.voidReason ? ` · ${m.voidReason}` : ""}
          </span>
        ) : null}
      </td>
      <td data-label={t("day.colWho")}>{m.createdByName}</td>
      <td data-label={t("caja.colMethod")}>{t(`mov.method.${m.method}`)}</td>
      <td className="bcaja-num" data-label={t("day.colAmount")}>
        <strong style={{ color: tone }}>{sign}{fmtMoney(m.amount)}</strong>
      </td>
      <td>
        <span className="bcaja-row-actions">
          {m.hasReceipt && (
            <a href={`/api/barber/cash-movements/${m.id}/receipt`} target="_blank" rel="noopener noreferrer" className="icon-btn-new" title={t("mov.receiptView")} aria-label={t("mov.receiptView")}>
              <ImageIcon size={13} />
            </a>
          )}
          {!readOnly && !m.voidedAt && onVoidMovement && (canVoid ? canVoid(m) : false) && m.payoutKind !== "COMMISSION" && m.payoutKind !== "SALARY" && (
            <button type="button" className="icon-btn-new" title={t("mov.void")} aria-label={t("mov.void")} onClick={() => onVoidMovement(m)} data-mov-anular-abrir>
              <XCircle size={13} />
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}
