"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import {
  formatCents,
  moneyToCents,
  type BarberClientMembershipView,
  type BarberMembershipPlanView,
} from "@/lib/barber/memberships-core";
import { SellMembershipModal } from "./sell-membership-modal";
import { Badge, Chips, EmptyState, Modal, apiCall, type BadgeTone } from "./ui";

export type SubsFilter = "all" | "active" | "soon" | "expired";

const MANUAL_METHODS: BarberPaymentMethod[] = ["CASH", "SPEI", "CARD"];

/**
 * Pestaña "Clientes": quién tiene membresía, cuántos cortes lleva y cuándo
 * vence. Los filtros "Por vencer" y "Vencidas" son literalmente la lista con
 * la que el dueño sale a cobrar.
 */
export function SubscriptionsTab({
  t,
  locale,
  items,
  plans,
  stripeReady,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  onRefresh,
  loading,
}: {
  t: TFunction;
  locale: string;
  items: BarberClientMembershipView[];
  plans: BarberMembershipPlanView[];
  stripeReady: boolean;
  filter: SubsFilter;
  onFilterChange: (f: SubsFilter) => void;
  query: string;
  onQueryChange: (q: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [selling, setSelling] = useState(false);
  const [renewing, setRenewing] = useState<BarberClientMembershipView | null>(null);
  const [renewMethod, setRenewMethod] = useState<BarberPaymentMethod>("CASH");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await apiCall("/api/barber/memberships/subscriptions", {
      method: "PATCH",
      body: JSON.stringify({ id, ...body }),
    });
    setBusyId(null);
    if (!res.ok) setError(res.error);
    else onRefresh();
    return res.ok;
  }

  function expiryLabel(m: BarberClientMembershipView): string {
    if (m.daysLeft === 0) return t("barber.membresias.clientes.today");
    if (m.daysLeft > 0) return t("barber.membresias.clientes.expiresIn", { count: m.daysLeft });
    return t("barber.membresias.clientes.expiredAgo", { count: Math.abs(m.daysLeft) });
  }

  function statusTone(m: BarberClientMembershipView): BadgeTone {
    if (m.status !== "ACTIVE") return m.status === "EXPIRED" ? "bad" : "mute";
    if (m.urgency === "EXPIRED") return "bad";
    if (m.urgency === "SOON") return "warn";
    return "ok";
  }

  return (
    <div className="bmem-card">
      <div className="bmem-section-head">
        <h2 className="bmem-h2">{t("barber.membresias.clientes.heading")}</h2>
        <button
          type="button"
          className="bmem-btn"
          onClick={() => setSelling(true)}
          disabled={plans.filter((p) => p.isActive).length === 0}
        >
          <Plus size={15} />
          {t("barber.membresias.clientes.sell")}
        </button>
      </div>

      <div className="bmem-toolbar">
        <Chips<SubsFilter>
          value={filter}
          options={[
            { value: "all", label: t("barber.membresias.clientes.filters.all") },
            { value: "active", label: t("barber.membresias.clientes.filters.active") },
            { value: "soon", label: t("barber.membresias.clientes.filters.soon") },
            { value: "expired", label: t("barber.membresias.clientes.filters.expired") },
          ]}
          onChange={onFilterChange}
          ariaLabel={t("barber.membresias.clientes.filters.all")}
        />
        <div className="bmem-search" style={{ position: "relative" }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-4)",
              pointerEvents: "none",
            }}
          />
          <input
            className="bmem-input"
            style={{ paddingLeft: 33 }}
            value={query}
            placeholder={t("barber.membresias.clientes.search")}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label={t("barber.membresias.clientes.search")}
          />
        </div>
      </div>

      {(filter === "soon" || filter === "expired") && items.length > 0 ? (
        <div className="bmem-note" style={{ marginBottom: 12 }}>
          <span>{t("barber.membresias.clientes.callToCollect")}</span>
        </div>
      ) : null}

      {error ? <p className="bmem-error" style={{ marginBottom: 10 }}>{error}</p> : null}

      {items.length === 0 ? (
        <EmptyState
          title={t("barber.membresias.clientes.heading")}
          body={t(`barber.membresias.clientes.empty.${filter}`)}
        />
      ) : (
        <div className="bmem-rows" aria-busy={loading}>
          {items.map((m) => {
            const pct =
              m.includedCuts === null
                ? 0
                : Math.min(100, Math.round((m.cutsUsed / Math.max(1, m.includedCuts)) * 100));
            const full = m.includedCuts !== null && m.remaining === 0;
            const rowClass =
              m.urgency === "EXPIRED" ? " is-late" : m.urgency === "SOON" ? " is-warn" : "";

            return (
              <div key={m.id} className={`bmem-row${rowClass}`}>
                <div className="bmem-cell">
                  <span className="bmem-cell-main">{m.clientName}</span>
                  <span className="bmem-cell-sub">{m.clientPhone}</span>
                </div>

                <div className="bmem-cell">
                  <span className="bmem-cell-main" style={{ fontSize: 13.5 }}>
                    {m.membershipName}
                  </span>
                  <span className="bmem-cell-sub">
                    {m.includedCuts === null
                      ? t("barber.membresias.clientes.cutsUnlimited", { used: m.cutsUsed })
                      : t("barber.membresias.clientes.cutsOf", {
                          used: m.cutsUsed,
                          total: m.includedCuts,
                        })}
                  </span>
                  {m.includedCuts === null ? null : (
                    <div className="bmem-bar" aria-hidden="true">
                      <div
                        className={`bmem-bar-fill${full ? " is-full" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="bmem-cell">
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <Badge tone={statusTone(m)}>{expiryLabel(m)}</Badge>
                    {m.autoRenew ? (
                      <Badge tone="brand">{t("barber.membresias.clientes.autoRenew")}</Badge>
                    ) : null}
                  </span>
                  <span className="bmem-cell-sub">
                    {t(`barber.membresias.payment.${m.paymentMethod}`)} ·{" "}
                    {formatCents(moneyToCents(m.price), "MXN", locale)}
                  </span>
                </div>

                <div className="bmem-row-actions">
                  {m.autoRenew ? null : (
                    <button
                      type="button"
                      className="bmem-btn bmem-btn-sm"
                      disabled={busyId === m.id}
                      onClick={() => {
                        setRenewMethod(
                          MANUAL_METHODS.includes(m.paymentMethod) ? m.paymentMethod : "CASH",
                        );
                        setRenewing(m);
                      }}
                    >
                      {t("barber.membresias.clientes.renew")}
                    </button>
                  )}
                  {m.status === "ACTIVE" ? (
                    <button
                      type="button"
                      className="bmem-btn bmem-btn-ghost bmem-btn-sm"
                      disabled={busyId === m.id}
                      onClick={() => patch(m.id, { action: "pause" })}
                    >
                      {t("barber.membresias.clientes.pause")}
                    </button>
                  ) : m.status === "PAUSED" ? (
                    <button
                      type="button"
                      className="bmem-btn bmem-btn-ghost bmem-btn-sm"
                      disabled={busyId === m.id}
                      onClick={() => patch(m.id, { action: "resume" })}
                    >
                      {t("barber.membresias.clientes.resume")}
                    </button>
                  ) : null}
                  {m.status === "CANCELLED" ? null : (
                    <button
                      type="button"
                      className="bmem-btn bmem-btn-danger bmem-btn-sm"
                      disabled={busyId === m.id}
                      onClick={() => {
                        if (window.confirm(t("barber.membresias.clientes.cancelConfirm"))) {
                          patch(m.id, { action: "cancel" });
                        }
                      }}
                    >
                      {t("barber.membresias.clientes.cancel")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selling ? (
        <SellMembershipModal
          t={t}
          locale={locale}
          plans={plans}
          stripeReady={stripeReady}
          open
          onClose={() => setSelling(false)}
          onSold={onRefresh}
        />
      ) : null}

      {renewing ? (
        <Modal
          open
          title={t("barber.membresias.clientes.renewModal.title")}
          onClose={() => setRenewing(null)}
          footer={
            <>
              <button
                type="button"
                className="bmem-btn bmem-btn-ghost"
                onClick={() => setRenewing(null)}
              >
                {t("barber.membresias.planes.form.cancel")}
              </button>
              <button
                type="button"
                className="bmem-btn"
                disabled={busyId === renewing.id}
                onClick={async () => {
                  const ok = await patch(renewing.id, {
                    action: "renew",
                    paymentMethod: renewMethod,
                  });
                  if (ok) setRenewing(null);
                }}
              >
                {t("barber.membresias.clientes.renewModal.confirm")}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="bmem-hint">
              {t("barber.membresias.clientes.renewModal.body", {
                client: renewing.clientName,
                plan: renewing.membershipName,
              })}
            </p>
            <span className="bmem-label">
              {t("barber.membresias.clientes.renewModal.howPaid")}
            </span>
            <Chips<BarberPaymentMethod>
              value={renewMethod}
              options={MANUAL_METHODS.map((m) => ({
                value: m,
                label: t(`barber.membresias.payment.${m}`),
              }))}
              onChange={setRenewMethod}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
