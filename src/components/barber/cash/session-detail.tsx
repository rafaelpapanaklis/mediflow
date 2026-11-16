"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashSessionRow, CashSessionSummary } from "@/lib/barber/cash";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { differenceKind } from "@/lib/barber/caja-movimientos-core";
import { BarberModal } from "./modal";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, fmtSigned, fromCents, PAYMENT_METHOD_KEYS } from "./money";
import { closeExpectedView } from "./close-expected";
import { CloseExpectedBreakdown } from "./close-expected-breakdown";
import { corteDiffCents, corteDiffLabel } from "./corte-core";
import { DayList } from "./day-list";

/**
 * Un corte YA CERRADO con TODO su detalle (lógica L2 + caja completa): «el
 * cliente dice que ayer le cobraron de más», «¿quién sacó los $1,000?» o
 * «reimprime el corte del sábado». Lee GET /api/barber/cash-sessions/[id]
 * (cash.view): esperado desglosado, contado y diferencia, y la lista del día
 * (tickets y movimientos) sin acciones: un turno cerrado no se toca.
 */
export function SessionDetailModal({
  dict,
  row,
  tz,
  onClose,
}: {
  dict: Dictionary;
  row: Pick<CashSessionRow, "id" | "openedAt">;
  tz: string;
  onClose: () => void;
}) {
  const t = useBarberT(dict);
  const [data, setData] = useState<CashSessionSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/barber/cash-sessions/${encodeURIComponent(row.id)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as CashSessionSummary;
        if (alive) setData(json);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [row.id]);

  const methodLabel = (m: BarberPaymentMethod) => t(PAYMENT_METHOD_KEYS[m]);
  const diff = data ? corteDiffCents(data) : null;

  return (
    <BarberModal
      open
      wide
      title={t("caja.historyDetailTitle", { date: fmtDateTime(row.openedAt, tz) })}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <a className="btn-new btn-new--secondary" href={`/barber/caja/corte/${encodeURIComponent(row.id)}`} data-reimprimir>
            <Printer size={14} /> {t("corte.reprint")}
          </a>
          <button type="button" className="btn-new barber-btn-primary" onClick={onClose}>{t("common.close")}</button>
        </>
      }
    >
      <p className="bcaja-hint" style={{ margin: "0 0 10px" }}>{t("caja.historyDetailClosed")}</p>
      {failed ? (
        <div className="bcaja-alert bcaja-alert--danger" role="alert">{t("common.error")}</div>
      ) : !data ? (
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("common.loading")}</p>
      ) : (
        <div className="bcaja-form">
          <div className="bcaja-hint" style={{ margin: 0 }}>
            {t("corte.whoLine", {
              opened: data.session.openedByName,
              closed: data.session.closedByName ?? "—",
              when: fmtDateTime(data.session.closedAt, tz),
            })}
          </div>
          <CloseExpectedBreakdown view={closeExpectedView(data)} t={t} />
          {data.session.countedAmount !== null && diff !== null && (
            <div className="bcaja-totals" data-corte-contado>
              <div className="bcaja-totals__row"><span>{t("corte.counted")}</span><span>{fmtMoney(data.session.countedAmount)}</span></div>
              <div className="bcaja-totals__row">
                <span>{t("corte.difference")}</span>
                <span className={`bcaja-diff bcaja-diff--${differenceKind(diff)}`}>{corteDiffLabel(t, diff)} ({fmtSigned(fromCents(diff))})</span>
              </div>
              {data.session.leftForNext !== null && data.session.leftForNext !== undefined && (
                <div className="bcaja-totals__row"><span>{t("corte.leftForNext")}</span><span>{fmtMoney(data.session.leftForNext)}</span></div>
              )}
            </div>
          )}
          <div className="bcaja-low" aria-label={t("caja.byMethod")}>
            {(["CASH", "CARD", "SPEI"] as BarberPaymentMethod[]).map((m) => (
              <span key={m} className="bcaja-low__item" style={{ background: "var(--bg-elev)", color: "var(--text-2)", borderColor: "var(--border-soft)" }}>
                {methodLabel(m)}: <strong style={{ color: "var(--text-1)" }}>{fmtMoney(data.byMethod[m].total)}</strong>
                <span className="bcaja-muted">({data.byMethod[m].count})</span>
              </span>
            ))}
          </div>
          {data.session.notes && <p className="bcaja-hint" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{data.session.notes}</p>}
          {data.sales.length === 0 && (data.movements ?? []).length === 0 ? (
            <p className="bcaja-hint" style={{ margin: 0 }}>{t("caja.historyDetailEmpty")}</p>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <DayList dict={dict} sales={data.sales} movements={data.movements ?? []} tz={tz} readOnly />
            </div>
          )}
        </div>
      )}
    </BarberModal>
  );
}
