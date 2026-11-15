"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, Wallet } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import type { SaleDraftList, SaleDraftRow } from "@/lib/barber/sale-drafts";
import s from "./client-sales.module.css";

/**
 * Notas «Por cobrar»: se ven en la ficha del cliente (las suyas) y en Caja
 * (las de la sede). Son BORRADORES: el importe es un estimado con los precios
 * de hoy; el de verdad lo pone Caja al cobrar. «Cobrar» abre el mismo
 * TicketModal con la nota cargada; «Descartar» la cierra sin borrarla.
 */
export function SaleDraftsList({
  drafts,
  dict,
  locale,
  timezone,
  showClient,
  canManage,
  onCharge,
  onDiscarded,
}: {
  drafts: SaleDraftRow[];
  /** Sub-árbol barber.cobros. */
  dict: Dictionary;
  locale: string;
  timezone: string;
  /** En Caja se dice de qué cliente es cada nota. */
  showClient: boolean;
  /** cash.manage: cobrar y descartar. */
  canManage: boolean;
  onCharge: (draft: SaleDraftRow) => void;
  onDiscarded: () => void;
}) {
  const t = useMemo(() => makeBarberT(dict), [dict]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = useMemo(
    () => new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", { style: "currency", currency: "MXN" }),
    [locale],
  );
  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(iso));
    } catch {
      return iso.slice(0, 16);
    }
  };

  async function discard(d: SaleDraftRow) {
    if (!window.confirm(t("drafts.discardConfirm"))) return;
    setBusy(d.id);
    setError(null);
    try {
      const res = await fetch(`/api/barber/sales/drafts/${d.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("error"));
        return;
      }
      onDiscarded();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(null);
    }
  }

  if (drafts.length === 0) return null;

  return (
    <div className={s.section} data-por-cobrar>
      <p className={s.sectionHead}>{t("drafts.title")}</p>
      <p className={s.sectionHint}>{t("drafts.hint")}</p>
      {error ? <p className={s.error} role="alert">{error}</p> : null}
      <ul className={s.list}>
        {drafts.map((d) => (
          <li key={d.id} className={s.row} data-nota={d.id}>
            <div style={{ minWidth: 0 }}>
              <p className={s.when}>
                <span>{when(d.updatedAt)}</span>
                <span className={`${s.chip} ${s.chipPending}`}>{t("pending")}</span>
              </p>
              <p className={s.items}>
                {d.lines.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ""}${l.name}`).join(" · ")}
              </p>
              <p className={s.meta}>
                {[
                  showClient ? (d.clientName ? t("drafts.client", { name: d.clientName }) : t("drafts.noClient")) : null,
                  d.barberName ? t("by", { name: d.barberName }) : null,
                  t("drafts.createdBy", { name: d.createdByName }),
                  d.payload.notes,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className={s.side}>
              <span className={s.total} title={t("drafts.estimateHint")}>
                {t("drafts.estimate", { amount: money.format(d.estimate) })}
              </span>
              {canManage ? (
                <span className={s.actions}>
                  {d.clientId ? (
                    <button
                      type="button"
                      className="btn-new btn-new--secondary btn-new--sm"
                      onClick={() => onCharge(d)}
                      disabled={busy === d.id}
                      data-accion="cobrar-nota"
                    >
                      <Wallet size={13} /> {t("drafts.charge")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-new btn-new--ghost btn-new--sm"
                    onClick={() => void discard(d)}
                    disabled={busy === d.id}
                    data-accion="descartar-nota"
                  >
                    <Trash2 size={13} /> {t("drafts.discard")}
                  </button>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Las notas «Por cobrar» de UN cliente (la ficha), cargadas por API. */
export function ClientDrafts({
  clientId,
  dict,
  locale,
  timezone,
  canManage,
  reloadKey,
  onCharge,
}: {
  clientId: string;
  dict: Dictionary;
  locale: string;
  timezone: string;
  canManage: boolean;
  reloadKey: number;
  onCharge: (draft: SaleDraftRow) => void;
}) {
  const [list, setList] = useState<SaleDraftList | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/barber/sales/drafts?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      if (res.ok) setList((await res.json()) as SaleDraftList);
    } catch {
      /* sin red: la sección simplemente no sale */
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey, tick]);

  if (!list?.ready || list.drafts.length === 0) return null;
  return (
    <SaleDraftsList
      drafts={list.drafts}
      dict={dict}
      locale={locale}
      timezone={timezone}
      showClient={false}
      canManage={canManage}
      onCharge={onCharge}
      onDiscarded={() => setTick((n) => n + 1)}
    />
  );
}
