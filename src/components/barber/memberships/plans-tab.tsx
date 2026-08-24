"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import {
  describeMembershipPlan,
  formatCents,
  moneyToCents,
  type BarberMembershipPlanView,
} from "@/lib/barber/memberships-core";
import { PlanFormModal } from "./plan-form-modal";
import { Badge, EmptyState, apiCall } from "./ui";

/**
 * Pestaña "Planes": el catálogo que la barbería vende. Los ejemplos del
 * estado vacío son NOMBRES, nunca precios: el precio lo pone la barbería.
 */
export function PlansTab({
  t,
  locale,
  plans,
  onRefresh,
}: {
  t: TFunction;
  locale: string;
  plans: BarberMembershipPlanView[];
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState<BarberMembershipPlanView | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive(plan: BarberMembershipPlanView) {
    setBusyId(plan.id);
    setError(null);
    const res = await apiCall("/api/barber/memberships/plans", {
      method: "PATCH",
      body: JSON.stringify({ id: plan.id, isActive: !plan.isActive }),
    });
    setBusyId(null);
    if (!res.ok) setError(res.error);
    else onRefresh();
  }

  async function remove(plan: BarberMembershipPlanView) {
    if (!window.confirm(t("barber.membresias.planes.deleteConfirm"))) return;
    setBusyId(plan.id);
    setError(null);
    const res = await apiCall(`/api/barber/memberships/plans?id=${encodeURIComponent(plan.id)}`, {
      method: "DELETE",
    });
    setBusyId(null);
    if (!res.ok) setError(res.error);
    else onRefresh();
  }

  return (
    <div className="bmem-card">
      <div className="bmem-section-head">
        <h2 className="bmem-h2">{t("barber.membresias.planes.heading")}</h2>
        <button type="button" className="bmem-btn" onClick={() => setCreating(true)}>
          <Plus size={15} />
          {t("barber.membresias.planes.new")}
        </button>
      </div>

      {error ? <p className="bmem-error" style={{ marginBottom: 10 }}>{error}</p> : null}

      {plans.length === 0 ? (
        <EmptyState
          title={t("barber.membresias.planes.empty.title")}
          body={t("barber.membresias.planes.empty.body")}
        >
          <div className="bmem-examples">
            <span className="bmem-example">{t("barber.membresias.planes.empty.example1")}</span>
            <span className="bmem-example">{t("barber.membresias.planes.empty.example2")}</span>
            <span className="bmem-example">{t("barber.membresias.planes.empty.example3")}</span>
          </div>
          <button type="button" className="bmem-btn" onClick={() => setCreating(true)}>
            <Plus size={15} />
            {t("barber.membresias.planes.new")}
          </button>
        </EmptyState>
      ) : (
        <div className="bmem-plans">
          {plans.map((plan) => (
            <article key={plan.id} className={`bmem-plan${plan.isActive ? "" : " is-off"}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="bmem-plan-name">{plan.name}</span>
                {plan.isActive ? null : (
                  <Badge tone="mute">{t("barber.membresias.planes.inactive")}</Badge>
                )}
              </div>

              <div className="bmem-plan-price">
                {formatCents(moneyToCents(plan.price), "MXN", locale)}
                <small>{t("barber.membresias.planes.perPeriod")}</small>
              </div>

              <span className="bmem-plan-what">
                {describeMembershipPlan(
                  { includedCuts: plan.includedCuts, periodDays: plan.periodDays },
                  locale,
                )}
              </span>

              {plan.description ? <p className="bmem-plan-desc">{plan.description}</p> : null}

              <span className="bmem-cell-sub">
                {t("barber.membresias.planes.clients", { count: plan.activeCount })}
              </span>

              <div className="bmem-plan-actions">
                <button
                  type="button"
                  className="bmem-btn bmem-btn-ghost bmem-btn-sm"
                  onClick={() => setEditing(plan)}
                >
                  {t("barber.membresias.planes.edit")}
                </button>
                <button
                  type="button"
                  className="bmem-btn bmem-btn-ghost bmem-btn-sm"
                  disabled={busyId === plan.id}
                  onClick={() => toggleActive(plan)}
                >
                  {plan.isActive
                    ? t("barber.membresias.planes.deactivate")
                    : t("barber.membresias.planes.activate")}
                </button>
                {plan.activeCount === 0 ? (
                  <button
                    type="button"
                    className="bmem-btn bmem-btn-danger bmem-btn-sm"
                    disabled={busyId === plan.id}
                    onClick={() => remove(plan)}
                  >
                    {t("barber.membresias.planes.delete")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {creating ? (
        <PlanFormModal
          t={t}
          locale={locale}
          plan={null}
          open
          onClose={() => setCreating(false)}
          onSaved={onRefresh}
        />
      ) : null}

      {editing ? (
        <PlanFormModal
          // key: cada plan estrena estado del formulario (no arrastra el anterior).
          key={editing.id}
          t={t}
          locale={locale}
          plan={editing}
          open
          onClose={() => setEditing(null)}
          onSaved={onRefresh}
        />
      ) : null}
    </div>
  );
}
