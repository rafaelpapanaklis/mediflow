"use client";

import { useMemo, useState } from "react";
import type { TFunction } from "@/i18n/t";
import {
  describeMembershipPlan,
  type BarberMembershipPlanView,
} from "@/lib/barber/memberships-core";
import { Chips, Field, Modal, MoneyInput, apiCall } from "./ui";

/**
 * Alta y edición de un plan de membresía. El precio, los cortes incluidos y
 * la duración del periodo los define CADA barbería: aquí no hay ni un solo
 * número sugerido.
 */
export function PlanFormModal({
  t,
  locale,
  plan,
  open,
  onClose,
  onSaved,
}: {
  t: TFunction;
  locale: string;
  /** null = alta nueva. */
  plan: BarberMembershipPlanView | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [price, setPrice] = useState(plan ? String(plan.price) : "");
  const [unlimited, setUnlimited] = useState(plan ? plan.includedCuts === null : false);
  const [cuts, setCuts] = useState(plan?.includedCuts != null ? String(plan.includedCuts) : "2");
  const [periodDays, setPeriodDays] = useState(String(plan?.periodDays ?? 30));
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () =>
      describeMembershipPlan(
        {
          includedCuts: unlimited ? null : Number(cuts) || 1,
          periodDays: Number(periodDays) || 30,
        },
        locale,
      ),
    [unlimited, cuts, periodDays, locale],
  );

  const periodOptions = [
    { value: "7", label: t("barber.membresias.planes.form.periodWeek") },
    { value: "15", label: t("barber.membresias.planes.form.periodBiweekly") },
    { value: "30", label: t("barber.membresias.planes.form.periodMonthly") },
    { value: "365", label: t("barber.membresias.planes.form.periodYearly") },
  ];

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      ...(plan ? { id: plan.id } : {}),
      name,
      description,
      price,
      unlimited,
      includedCuts: unlimited ? null : Number(cuts),
      periodDays: Number(periodDays),
      isActive,
    };
    const res = await apiCall("/api/barber/memberships/plans", {
      method: plan ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        plan
          ? t("barber.membresias.planes.form.editTitle")
          : t("barber.membresias.planes.form.createTitle")
      }
      footer={
        <>
          <button type="button" className="bmem-btn bmem-btn-ghost" onClick={onClose}>
            {t("barber.membresias.planes.form.cancel")}
          </button>
          <button type="button" className="bmem-btn" onClick={save} disabled={saving}>
            {saving
              ? t("barber.membresias.planes.form.saving")
              : t("barber.membresias.planes.form.save")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={t("barber.membresias.planes.form.name")} htmlFor="bmem-plan-name">
          <input
            id="bmem-plan-name"
            className="bmem-input"
            value={name}
            maxLength={80}
            placeholder={t("barber.membresias.planes.form.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <div className="bmem-grid-2">
          <Field
            label={t("barber.membresias.planes.form.price")}
            hint={t("barber.membresias.planes.form.priceHint")}
            htmlFor="bmem-plan-price"
          >
            <MoneyInput id="bmem-plan-price" value={price} onChange={setPrice} placeholder="0" />
          </Field>

          <Field
            label={t("barber.membresias.planes.form.cuts")}
            hint={t("barber.membresias.planes.form.cutsHint")}
            htmlFor="bmem-plan-cuts"
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                id="bmem-plan-cuts"
                className="bmem-input"
                type="number"
                min={1}
                max={999}
                value={unlimited ? "" : cuts}
                disabled={unlimited}
                onChange={(e) => setCuts(e.target.value)}
                style={{ maxWidth: 110 }}
              />
              <button
                type="button"
                className={`bmem-chip${unlimited ? " is-on" : ""}`}
                aria-pressed={unlimited}
                onClick={() => setUnlimited((v) => !v)}
              >
                {t("barber.membresias.planes.form.unlimited")}
              </button>
            </div>
          </Field>
        </div>

        <Field label={t("barber.membresias.planes.form.period")}>
          <Chips
            value={periodOptions.some((o) => o.value === periodDays) ? periodDays : ""}
            options={periodOptions}
            onChange={(v) => setPeriodDays(v)}
            ariaLabel={t("barber.membresias.planes.form.period")}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <input
              className="bmem-input"
              type="number"
              min={1}
              max={365}
              value={periodDays}
              onChange={(e) => setPeriodDays(e.target.value)}
              style={{ maxWidth: 110 }}
              aria-label={t("barber.membresias.planes.form.period")}
            />
            <span className="bmem-hint">{t("barber.membresias.planes.form.periodDays")}</span>
          </div>
        </Field>

        <Field label={t("barber.membresias.planes.form.description")}>
          <textarea
            className="bmem-textarea"
            value={description}
            maxLength={500}
            placeholder={t("barber.membresias.planes.form.descriptionPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <label className={`bmem-check${isActive ? " is-on" : ""}`}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span className="bmem-check-body">
            <span className="bmem-check-title">{t("barber.membresias.planes.form.active")}</span>
          </span>
        </label>

        <p className="bmem-hint">
          {t("barber.membresias.planes.form.preview", { text: preview })}
        </p>

        {error ? <p className="bmem-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
