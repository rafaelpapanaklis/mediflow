"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { formatCents, moneyToCents } from "@/lib/barber/memberships-core";
import {
  computeDepositCents,
  describeDepositPolicy,
  normalizeDepositPolicy,
  type BarberDepositAudience,
  type BarberDepositMode,
  type BarberDepositPolicy,
  type BarberDepositView,
} from "@/lib/barber/payments-core";
import { Badge, CheckCard, Chips, EmptyState, Field, MoneyInput, apiCall, type BadgeTone } from "./ui";

export type DepositsFilter = "all" | "pending" | "paid" | "closed";

/** Servicio de ejemplo con el que se ve cuánto se pediría. */
const SAMPLE_SERVICE_CENTS = 30_000;

const AUDIENCES: BarberDepositAudience[] = ["NO_SHOW", "NEW", "ALL"];

/**
 * Pestaña "Anticipos": la política anti no-show y la lista de anticipos.
 *
 * La política se ve completa ANTES de pagar (previewBody + el texto que lee
 * el cliente): sin letra chica, que es justo donde la competencia se gana sus
 * peores reseñas.
 */
export function DepositsTab({
  t,
  locale,
  initialPolicy,
  storageReady,
  stripeConfigured,
  deposits,
  depositsFilter,
  onDepositsFilterChange,
  onRefresh,
  canEditPolicy,
  canManageDeposits,
  loading,
}: {
  t: TFunction;
  locale: string;
  initialPolicy: BarberDepositPolicy;
  storageReady: boolean;
  stripeConfigured: boolean;
  deposits: BarberDepositView[];
  depositsFilter: DepositsFilter;
  onDepositsFilterChange: (f: DepositsFilter) => void;
  onRefresh: () => void;
  canEditPolicy: boolean;
  canManageDeposits: boolean;
  loading: boolean;
}) {
  const [policy, setPolicy] = useState<BarberDepositPolicy>(initialPolicy);
  const [fixed, setFixed] = useState(String(initialPolicy.fixedCents / 100));
  const [max, setMax] = useState(
    initialPolicy.maxCents > 0 ? String(initialPolicy.maxCents / 100) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** La política "en vivo" con lo que hay escrito ahora en el formulario. */
  const live = useMemo(
    () =>
      normalizeDepositPolicy({
        ...policy,
        fixedCents: moneyToCents(fixed),
        maxCents: max ? moneyToCents(max) : 0,
      }),
    [policy, fixed, max],
  );

  const sampleCents = computeDepositCents({ ...live, enabled: true }, SAMPLE_SERVICE_CENTS);

  function set<K extends keyof BarberDepositPolicy>(key: K, value: BarberDepositPolicy[K]) {
    setSaved(false);
    setPolicy((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await apiCall<{ policy: BarberDepositPolicy }>("/api/barber/deposits/settings", {
      method: "PUT",
      body: JSON.stringify(live),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPolicy(res.data.policy);
    setSaved(true);
  }

  async function act(appointmentId: string, action: "refund" | "forfeit") {
    const confirmKey =
      action === "refund"
        ? "barber.membresias.anticipos.list.refundConfirm"
        : "barber.membresias.anticipos.list.forfeitConfirm";
    if (!window.confirm(t(confirmKey))) return;
    setBusyId(appointmentId);
    setError(null);
    const res = await apiCall("/api/barber/deposits/actions", {
      method: "POST",
      body: JSON.stringify({ appointmentId, action }),
    });
    setBusyId(null);
    if (!res.ok) setError(res.error);
    else onRefresh();
  }

  function depositTone(status: BarberDepositView["status"]): BadgeTone {
    if (status === "PAID") return "ok";
    if (status === "PENDING") return "warn";
    if (status === "REFUNDED") return "mute";
    return "bad";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!storageReady ? (
        <div className="bmem-note t-bad">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t("barber.membresias.anticipos.storageMissing")}</span>
        </div>
      ) : null}

      {canEditPolicy ? (
        <section className="bmem-card">
          <div className="bmem-section-head">
            <h2 className="bmem-h2">{t("barber.membresias.anticipos.heading")}</h2>
            <Badge tone={live.enabled ? "ok" : "mute"}>
              {live.enabled
                ? t("barber.membresias.status.ACTIVE")
                : t("barber.membresias.planes.inactive")}
            </Badge>
          </div>

          <p className="bmem-hint" style={{ marginBottom: 14 }}>
            {t("barber.membresias.anticipos.intro")}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <CheckCard
              checked={live.enabled}
              onChange={(v) => set("enabled", v)}
              title={t("barber.membresias.anticipos.enable")}
            />

            <Field label={t("barber.membresias.anticipos.mode")}>
              <Chips<BarberDepositMode>
                value={live.mode}
                options={[
                  { value: "FIXED", label: t("barber.membresias.anticipos.modeFixed") },
                  { value: "PERCENT", label: t("barber.membresias.anticipos.modePercent") },
                ]}
                onChange={(v) => set("mode", v)}
              />
            </Field>

            <div className="bmem-grid-2">
              {live.mode === "FIXED" ? (
                <Field label={t("barber.membresias.anticipos.fixedLabel")} htmlFor="bmem-dep-fixed">
                  <MoneyInput
                    id="bmem-dep-fixed"
                    value={fixed}
                    onChange={(v) => {
                      setSaved(false);
                      setFixed(v);
                    }}
                  />
                </Field>
              ) : (
                <Field label={t("barber.membresias.anticipos.percentLabel")} htmlFor="bmem-dep-pct">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      id="bmem-dep-pct"
                      className="bmem-input"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={live.percent}
                      onChange={(e) => set("percent", Number(e.target.value))}
                      style={{ maxWidth: 110 }}
                    />
                    <span className="bmem-hint">%</span>
                  </div>
                </Field>
              )}

              <Field
                label={t("barber.membresias.anticipos.maxLabel")}
                hint={t("barber.membresias.anticipos.maxHint")}
                htmlFor="bmem-dep-max"
              >
                <MoneyInput
                  id="bmem-dep-max"
                  value={max}
                  placeholder="0"
                  onChange={(v) => {
                    setSaved(false);
                    setMax(v);
                  }}
                />
              </Field>
            </div>

            <Field label={t("barber.membresias.anticipos.audience")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {AUDIENCES.map((a) => (
                  <CheckCard
                    key={a}
                    type="radio"
                    name="bmem-audience"
                    checked={live.audience === a}
                    onChange={() => set("audience", a)}
                    title={t(`barber.membresias.anticipos.audience${a}`)}
                    hint={t(`barber.membresias.anticipos.audience${a}Hint`)}
                  />
                ))}
              </div>
            </Field>

            <Field
              label={t("barber.membresias.anticipos.refundWindow")}
              hint={t("barber.membresias.anticipos.refundWindowHint")}
              htmlFor="bmem-dep-refund"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  id="bmem-dep-refund"
                  className="bmem-input"
                  type="number"
                  min={0}
                  max={720}
                  value={live.refundWindowHours}
                  onChange={(e) => set("refundWindowHours", Number(e.target.value))}
                  style={{ maxWidth: 110 }}
                />
                <span className="bmem-hint">
                  {t("barber.membresias.anticipos.refundWindowHours")}
                </span>
              </div>
            </Field>

            <CheckCard
              checked={live.onlineEnabled}
              onChange={(v) => set("onlineEnabled", v)}
              title={t("barber.membresias.anticipos.online")}
              hint={t("barber.membresias.anticipos.onlineHint")}
            />

            {!stripeConfigured && live.onlineEnabled ? (
              <div className="bmem-note t-bad">
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{t("barber.membresias.anticipos.stripeMissing")}</span>
              </div>
            ) : null}

            {live.onlineEnabled ? (
              <Field
                label={t("barber.membresias.anticipos.stripeAccount")}
                hint={t("barber.membresias.anticipos.stripeAccountHint")}
                htmlFor="bmem-dep-acct"
              >
                <input
                  id="bmem-dep-acct"
                  className="bmem-input"
                  value={policy.stripeAccountId}
                  placeholder={t("barber.membresias.anticipos.stripeAccountPlaceholder")}
                  onChange={(e) => set("stripeAccountId", e.target.value.trim())}
                />
              </Field>
            ) : null}

            <Field
              label={t("barber.membresias.anticipos.policyText")}
              hint={t("barber.membresias.anticipos.policyTextHint")}
              htmlFor="bmem-dep-text"
            >
              <textarea
                id="bmem-dep-text"
                className="bmem-textarea"
                maxLength={800}
                value={policy.policyText}
                onChange={(e) => set("policyText", e.target.value)}
              />
            </Field>

            <div className="bmem-note">
              <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>{t("barber.membresias.anticipos.previewTitle")}</strong>{" "}
                {t("barber.membresias.anticipos.previewBody", {
                  service: formatCents(SAMPLE_SERVICE_CENTS, "MXN", locale),
                  deposit: formatCents(sampleCents, "MXN", locale),
                })}
                <br />
                <span style={{ color: "var(--text-3)" }}>
                  {describeDepositPolicy(live, {
                    amountCents: sampleCents,
                    currency: "MXN",
                    locale,
                  })}
                </span>
              </span>
            </div>

            {error ? <p className="bmem-error">{error}</p> : null}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="bmem-btn"
                onClick={save}
                disabled={saving || !storageReady}
              >
                {saving
                  ? t("barber.membresias.planes.form.saving")
                  : t("barber.membresias.anticipos.save")}
              </button>
              {saved ? <Badge tone="ok">{t("barber.membresias.anticipos.saved")}</Badge> : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="bmem-card">
        <div className="bmem-section-head">
          <h2 className="bmem-h2">{t("barber.membresias.anticipos.list.heading")}</h2>
          <Chips<DepositsFilter>
            value={depositsFilter}
            options={[
              { value: "all", label: t("barber.membresias.anticipos.list.filters.all") },
              { value: "pending", label: t("barber.membresias.anticipos.list.filters.pending") },
              { value: "paid", label: t("barber.membresias.anticipos.list.filters.paid") },
              { value: "closed", label: t("barber.membresias.anticipos.list.filters.closed") },
            ]}
            onChange={onDepositsFilterChange}
          />
        </div>

        {deposits.length === 0 ? (
          <EmptyState
            title={t("barber.membresias.anticipos.list.heading")}
            body={t("barber.membresias.anticipos.list.empty")}
          />
        ) : (
          <div className="bmem-rows" aria-busy={loading}>
            {deposits.map((d) => (
              <div key={d.appointmentId} className="bmem-row">
                <div className="bmem-cell">
                  <span className="bmem-cell-main">{d.clientName}</span>
                  <span className="bmem-cell-sub">
                    {new Date(d.startAt).toLocaleString(locale === "en" ? "en-US" : "es-MX", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="bmem-cell">
                  <span className="bmem-cell-main" style={{ fontSize: 13.5 }}>
                    {formatCents(moneyToCents(d.amount), "MXN", locale)}
                  </span>
                  <span className="bmem-cell-sub">
                    {d.applied ? t("barber.membresias.anticipos.list.applied") : ""}
                  </span>
                </div>

                <div className="bmem-cell">
                  <Badge tone={depositTone(d.status)}>
                    {t(`barber.membresias.anticipos.depositStatus.${d.status}`)}
                  </Badge>
                </div>

                <div className="bmem-row-actions">
                  {canManageDeposits && d.status === "PAID" && !d.applied ? (
                    <>
                      <button
                        type="button"
                        className="bmem-btn bmem-btn-ghost bmem-btn-sm"
                        disabled={busyId === d.appointmentId}
                        onClick={() => act(d.appointmentId, "refund")}
                      >
                        {t("barber.membresias.anticipos.list.refund")}
                      </button>
                      <button
                        type="button"
                        className="bmem-btn bmem-btn-danger bmem-btn-sm"
                        disabled={busyId === d.appointmentId}
                        onClick={() => act(d.appointmentId, "forfeit")}
                      >
                        {t("barber.membresias.anticipos.list.forfeit")}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
