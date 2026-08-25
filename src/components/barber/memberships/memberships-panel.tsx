"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import {
  formatCents,
  moneyToCents,
  type BarberClientMembershipView,
  type BarberMembershipPlanView,
} from "@/lib/barber/memberships-core";
import type { BarberDepositPolicy, BarberDepositView } from "@/lib/barber/payments-core";
import { PlansTab } from "./plans-tab";
import { SubscriptionsTab, type SubsFilter } from "./subscriptions-tab";
import { DepositsTab, type DepositsFilter } from "./deposits-tab";
import { apiCall } from "./ui";
import "./membresias.css";

type TabKey = "planes" | "clientes" | "anticipos";

export interface MembershipsPanelProps {
  messages: Dictionary;
  locale: string;
  initialPlans: BarberMembershipPlanView[];
  initialItems: BarberClientMembershipView[];
  initialStats: { activeCount: number; soonCount: number; expiredCount: number; committedRevenue: number };
  initialDeposits: BarberDepositView[];
  depositPolicy: BarberDepositPolicy;
  storageReady: boolean;
  stripeConfigured: boolean;
  depositsFeature: boolean;
  canEditPolicy: boolean;
  canViewDeposits: boolean;
  canManageDeposits: boolean;
}

/**
 * Pantalla de membresías: planes, clientes y anticipos.
 *
 * Los datos llegan pintados desde el servidor (primer render sin espera) y a
 * partir de ahí la pantalla se refresca sola contra sus APIs. El
 * `barbershopId` NUNCA viaja en el cliente: cada endpoint lo resuelve de la
 * sesión.
 */
export function MembershipsPanel(props: MembershipsPanelProps) {
  const t = useMemo(() => makeBarberT(props.messages), [props.messages]);

  const [tab, setTab] = useState<TabKey>("clientes");
  const [plans, setPlans] = useState(props.initialPlans);
  const [items, setItems] = useState(props.initialItems);
  const [stats, setStats] = useState(props.initialStats);
  const [deposits, setDeposits] = useState(props.initialDeposits);
  const [filter, setFilter] = useState<SubsFilter>("all");
  const [query, setQuery] = useState("");
  const [depositsFilter, setDepositsFilter] = useState<DepositsFilter>("all");
  const [loading, setLoading] = useState(false);
  const syncedRef = useRef(false);

  const loadPlans = useCallback(async () => {
    const res = await apiCall<{ plans: BarberMembershipPlanView[] }>(
      "/api/barber/memberships/plans?all=1",
    );
    if (res.ok) setPlans(res.data.plans ?? []);
  }, []);

  const loadSubs = useCallback(async (f: SubsFilter, q: string) => {
    setLoading(true);
    const res = await apiCall<{
      items: BarberClientMembershipView[];
      stats: MembershipsPanelProps["initialStats"];
    }>(`/api/barber/memberships/subscriptions?filter=${f}&q=${encodeURIComponent(q)}`);
    setLoading(false);
    if (res.ok) {
      setItems(res.data.items ?? []);
      if (res.data.stats) setStats(res.data.stats);
    }
  }, []);

  const loadDeposits = useCallback(
    async (f: DepositsFilter) => {
      if (!props.canViewDeposits || !props.depositsFeature) return;
      const res = await apiCall<{ items: BarberDepositView[] }>(
        `/api/barber/deposits/actions?filter=${f}`,
      );
      if (res.ok) setDeposits(res.data.items ?? []);
    },
    [props.canViewDeposits, props.depositsFeature],
  );

  // Filtro y búsqueda de la lista de clientes (con freno de 300 ms).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => void loadSubs(filter, query), 300);
    return () => window.clearTimeout(timer);
  }, [filter, query, loadSubs]);

  useEffect(() => {
    void loadDeposits(depositsFilter);
  }, [depositsFilter, loadDeposits]);

  // Retorno del pago con tarjeta: confirma la membresía sin esperar al
  // webhook y limpia la URL para que un F5 no lo repita.
  useEffect(() => {
    if (syncedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("checkout");
    if (!sessionId || sessionId === "cancelado") return;
    syncedRef.current = true;
    void (async () => {
      await apiCall("/api/barber/memberships/checkout", {
        method: "PUT",
        body: JSON.stringify({ sessionId }),
      });
      window.history.replaceState({}, "", window.location.pathname);
      await loadSubs(filter, query);
    })();
  }, [filter, query, loadSubs]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadPlans(), loadSubs(filter, query)]);
  }, [loadPlans, loadSubs, filter, query]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "clientes", label: t("barber.membresias.tabs.clientes") },
    { key: "planes", label: t("barber.membresias.tabs.planes") },
    ...(props.depositsFeature && (props.canEditPolicy || props.canViewDeposits)
      ? [{ key: "anticipos" as TabKey, label: t("barber.membresias.tabs.anticipos") }]
      : []),
  ];

  return (
    <div className="bmem">
      <header className="bmem-head">
        <h1 className="bmem-title">{t("barber.membresias.title")}</h1>
        <p className="bmem-sub">{t("barber.membresias.subtitle")}</p>
      </header>

      <div className="bmem-stats">
        <div className="bmem-stat">
          <span className="bmem-stat-value">{stats.activeCount}</span>
          <span className="bmem-stat-label">{t("barber.membresias.stats.active")}</span>
        </div>
        <div className={`bmem-stat${stats.soonCount > 0 ? " is-warn" : ""}`}>
          <span className="bmem-stat-value">{stats.soonCount}</span>
          <span className="bmem-stat-label">{t("barber.membresias.stats.soon")}</span>
        </div>
        <div className="bmem-stat">
          <span className="bmem-stat-value">{stats.expiredCount}</span>
          <span className="bmem-stat-label">{t("barber.membresias.stats.expired")}</span>
        </div>
        <div className="bmem-stat">
          <span className="bmem-stat-value">
            {formatCents(moneyToCents(stats.committedRevenue), "MXN", props.locale)}
          </span>
          <span className="bmem-stat-label">{t("barber.membresias.stats.committed")}</span>
        </div>
      </div>

      <div className="bmem-tabs" role="tablist" aria-label={t("barber.membresias.title")}>
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            role="tab"
            id={`bmem-tab-${tb.key}`}
            aria-controls={`bmem-panel-${tb.key}`}
            className="bmem-tab"
            aria-selected={tab === tb.key}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`bmem-panel-${tab}`} aria-labelledby={`bmem-tab-${tab}`}>
      {tab === "clientes" ? (
        <SubscriptionsTab
          t={t}
          locale={props.locale}
          items={items}
          plans={plans}
          stripeReady={props.stripeConfigured}
          filter={filter}
          onFilterChange={setFilter}
          query={query}
          onQueryChange={setQuery}
          onRefresh={refreshAll}
          loading={loading}
        />
      ) : null}

      {tab === "planes" ? (
        <PlansTab t={t} locale={props.locale} plans={plans} onRefresh={refreshAll} />
      ) : null}

      {tab === "anticipos" ? (
        <DepositsTab
          t={t}
          locale={props.locale}
          initialPolicy={props.depositPolicy}
          storageReady={props.storageReady}
          stripeConfigured={props.stripeConfigured}
          deposits={deposits}
          depositsFilter={depositsFilter}
          onDepositsFilterChange={setDepositsFilter}
          onRefresh={() => void loadDeposits(depositsFilter)}
          canEditPolicy={props.canEditPolicy}
          canManageDeposits={props.canManageDeposits}
          loading={loading}
        />
      ) : null}
      </div>
    </div>
  );
}
