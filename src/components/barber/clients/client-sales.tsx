"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import type { ClientSaleRow, ClientSalesPage } from "@/lib/barber/client-sales";
import s from "./client-sales.module.css";

/**
 * «Cobros» en la ficha del cliente: los tickets que Caja ya escribió para
 * él. Solo pinta: los datos llegan del servidor (listClientSales), que ya
 * recortó por barbería, sede y —para el rol Barbero— por lo que cobró él.
 *
 * `headerAction` es el botón «Nuevo cobro» (lo pone la ficha si hay permiso
 * de caja) y `beforeList`, las notas «Por cobrar». `reloadKey` sube cuando
 * se cobra algo desde la ficha: la lista se vuelve a pedir.
 */
export function ClientSales({
  clientId,
  initial,
  dict,
  locale,
  timezone,
  canPrint,
  headerAction,
  beforeList,
  reloadKey = 0,
}: {
  clientId: string;
  initial: ClientSalesPage;
  /** Sub-árbol barber.cobros. */
  dict: Dictionary;
  locale: string;
  timezone: string;
  /** cash.view: enlace al ticket imprimible. */
  canPrint: boolean;
  headerAction?: React.ReactNode;
  beforeList?: React.ReactNode;
  reloadKey?: number;
}) {
  const t = useMemo(() => makeBarberT(dict), [dict]);
  const [data, setData] = useState<ClientSalesPage>(initial);
  const [error, setError] = useState(false);
  const first = useRef(true);

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
    async (page: number) => {
      setError(false);
      try {
        const res = await fetch(`/api/barber/clients/${clientId}/sales?page=${page}`, { cache: "no-store" });
        if (!res.ok) {
          setError(true);
          return;
        }
        setData((await res.json()) as ClientSalesPage);
      } catch {
        setError(true);
      }
    },
    [clientId],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(1);
  }, [reloadKey, load]);

  const pages = Math.max(1, Math.ceil(data.count / data.pageSize));

  return (
    <section className={s.wrap} data-cobros>
      <div className={s.head}>
        <div style={{ minWidth: 0 }}>
          <h2 className={s.title}>{t("title")}</h2>
          <p className={s.sub}>{data.scope === "own" ? t("subtitleOwn") : t("subtitle")}</p>
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
      </div>

      {beforeList}

      {error ? <p className={s.error} role="alert">{t("error")}</p> : null}

      {data.rows.length === 0 ? (
        <div className={s.empty}>
          <p style={{ margin: 0 }}>{t("empty")}</p>
          {headerAction ? <p style={{ margin: "4px 0 0", color: "var(--text-3)" }}>{t("emptyCta")}</p> : null}
        </div>
      ) : (
        <ul className={s.list}>
          {data.rows.map((row) => (
            <SaleRow key={row.id} row={row} t={t} money={money} when={when} canPrint={canPrint} />
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <div className={s.pager}>
          <button
            type="button"
            className="btn-new btn-new--ghost btn-new--sm"
            disabled={data.page <= 1}
            onClick={() => void load(data.page - 1)}
          >
            {t("prev")}
          </button>
          <span>{t("page", { page: data.page, pages })}</span>
          <button
            type="button"
            className="btn-new btn-new--ghost btn-new--sm"
            disabled={data.page >= pages}
            onClick={() => void load(data.page + 1)}
          >
            {t("next")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function SaleRow({
  row,
  t,
  money,
  when,
  canPrint,
}: {
  row: ClientSaleRow;
  t: (k: string, v?: Record<string, string | number>) => string;
  money: Intl.NumberFormat;
  when: (iso: string) => string;
  canPrint: boolean;
}) {
  const cancelled = row.status === "cancelled";
  const sold = row.lines.filter((l) => l.kind === "service" || l.kind === "product");
  const items = cancelled
    ? row.cancelledSummary
      ? t("cancelledWas", { summary: row.cancelledSummary })
      : "—"
    : sold
        .map((l) => {
          const name = l.description.replace(/ · Gratis \(lealtad[^)]*\)$/, "");
          const qty = l.qty > 1 ? `${l.qty}× ` : "";
          return `${qty}${name}${l.free ? ` (${t("free")})` : ""}`;
        })
        .join(" · ") || (row.kind !== "sale" ? t(`kind.${row.kind}`) : "—");
  const meta = [
    row.barberName ? t("by", { name: row.barberName }) : t("noBarber"),
    t("soldBy", { name: row.soldByName }),
    t(`methods.${row.paymentMethod}`),
    row.discount > 0 ? t("discount", { amount: money.format(row.discount) }) : null,
    row.bonusName ? t("bonus", { name: row.bonusName }) : null,
    row.tip > 0 ? t("tip", { amount: money.format(row.tip) }) : null,
  ].filter(Boolean);

  return (
    <li className={`${s.row} ${cancelled ? s.rowCancelled : ""}`} data-ticket={row.id}>
      <div style={{ minWidth: 0 }}>
        <p className={s.when}>
          <span>{when(row.createdAt)}</span>
          <span className={`${s.chip} ${cancelled ? s.chipCancelled : s.chipPaid}`}>
            {cancelled ? t("cancelled") : t("paid")}
          </span>
          {row.kind !== "sale" ? <span className={s.chip}>{t(`kind.${row.kind}`)}</span> : null}
        </p>
        <p className={s.items}>{items}</p>
        <p className={s.meta}>{meta.join(" · ")}</p>
      </div>
      <div className={s.side}>
        <span className={`${s.total} ${cancelled ? s.totalCancelled : ""}`}>{money.format(row.total)}</span>
        {canPrint ? (
          <a className={s.link} href={`/barber/caja/ticket/${row.id}`} target="_blank" rel="noopener noreferrer">
            <Printer size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {t("viewTicket")}
          </a>
        ) : null}
      </div>
    </li>
  );
}
