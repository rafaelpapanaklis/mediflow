"use client";

import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "@/i18n/t";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import {
  describeMembershipPlan,
  formatCents,
  moneyToCents,
  type BarberMembershipPlanView,
} from "@/lib/barber/memberships-core";
import { CheckCard, Field, Modal, apiCall } from "./ui";

interface ClientHit {
  id: string;
  name: string;
  phone: string;
  activeMembership: { name: string; endAt: string } | null;
}

/** Los tres métodos que de verdad se usan en México + el cobro en línea. */
const METHODS: BarberPaymentMethod[] = ["CASH", "SPEI", "CARD", "STRIPE"];

/**
 * Venta de una membresía en tres pasos: a quién, cuál y cómo paga.
 *
 * Efectivo, transferencia y tarjeta de mostrador se registran a mano y el
 * sistema calcula la vigencia — esa es la mitad del mercado que los demás
 * dejan fuera. "Tarjeta en línea" abre el cobro seguro de Stripe y, si se
 * marca la suscripción, se renueva sola.
 */
export function SellMembershipModal({
  t,
  locale,
  plans,
  stripeReady,
  open,
  onClose,
  onSold,
}: {
  t: TFunction;
  locale: string;
  plans: BarberMembershipPlanView[];
  stripeReady: boolean;
  open: boolean;
  onClose: () => void;
  onSold: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<ClientHit | null>(null);
  // Arranca en el primer plan VENDIBLE: la lista trae también los
  // desactivados (el panel los carga con ?all=1 para poder editarlos).
  const [planId, setPlanId] = useState<string>(plans.find((p) => p.isActive)?.id ?? "");
  const [method, setMethod] = useState<BarberPaymentMethod>("CASH");
  const [recurring, setRecurring] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sellable = useMemo(() => plans.filter((p) => p.isActive), [plans]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const res = await apiCall<{ clients: ClientHit[] }>(
        `/api/barber/memberships/clients?q=${encodeURIComponent(q)}`,
      );
      if (cancelled) return;
      setSearching(false);
      if (res.ok) setHits(res.data.clients ?? []);
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, open]);

  const plan = sellable.find((p) => p.id === planId) ?? null;
  const online = method === "STRIPE";

  async function submit() {
    if (!client || !plan) return;
    setSaving(true);
    setError(null);

    if (online) {
      const res = await apiCall<{ url: string }>("/api/barber/memberships/checkout", {
        method: "POST",
        body: JSON.stringify({ clientId: client.id, membershipId: plan.id, recurring }),
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Se sale del panel al pago seguro de Stripe.
      window.location.href = res.data.url;
      return;
    }

    const res = await apiCall("/api/barber/memberships/subscriptions", {
      method: "POST",
      body: JSON.stringify({ clientId: client.id, membershipId: plan.id, paymentMethod: method }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSold();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("barber.membresias.clientes.sellModal.title")}
      footer={
        <>
          <button type="button" className="bmem-btn bmem-btn-ghost" onClick={onClose}>
            {t("barber.membresias.planes.form.cancel")}
          </button>
          <button
            type="button"
            className="bmem-btn"
            onClick={submit}
            disabled={saving || !client || !plan}
          >
            {saving
              ? t("barber.membresias.planes.form.saving")
              : online
                ? t("barber.membresias.clientes.sellModal.confirmOnline")
                : t("barber.membresias.clientes.sellModal.confirm")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 1. Cliente */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="bmem-step">{t("barber.membresias.clientes.sellModal.step1")}</span>
          <input
            className="bmem-input"
            value={q}
            placeholder={t("barber.membresias.clientes.sellModal.searchClient")}
            onChange={(e) => {
              setQ(e.target.value);
              setClient(null);
            }}
          />
          {hits.length > 0 ? (
            <div className="bmem-results">
              {hits.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`bmem-result${client?.id === c.id ? " is-on" : ""}`}
                  onClick={() => setClient(c)}
                >
                  <span className="bmem-result-name">{c.name}</span>
                  <span className="bmem-result-sub">
                    {c.phone}
                    {c.activeMembership
                      ? ` · ${t("barber.membresias.clientes.sellModal.alreadyHas", {
                          plan: c.activeMembership.name,
                          date: new Date(c.activeMembership.endAt).toLocaleDateString(
                            locale === "en" ? "en-US" : "es-MX",
                          ),
                        })}`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : searching ? null : (
            <p className="bmem-hint">{t("barber.membresias.clientes.sellModal.noClients")}</p>
          )}
        </div>

        {/* 2. Plan */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="bmem-step">{t("barber.membresias.clientes.sellModal.step2")}</span>
          {sellable.length === 0 ? (
            <p className="bmem-hint">{t("barber.membresias.clientes.sellModal.noPlans")}</p>
          ) : (
            <Field label={t("barber.membresias.clientes.sellModal.choosePlan")} htmlFor="bmem-sell-plan">
              <select
                id="bmem-sell-plan"
                className="bmem-select"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                {sellable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatCents(moneyToCents(p.price), "MXN", locale)} ·{" "}
                    {describeMembershipPlan(
                      { includedCuts: p.includedCuts, periodDays: p.periodDays },
                      locale,
                    )}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {/* 3. Pago */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="bmem-step">{t("barber.membresias.clientes.sellModal.step3")}</span>
          <div className="bmem-chips">
            {METHODS.map((m) => {
              const disabled = m === "STRIPE" && !stripeReady;
              return (
                <button
                  key={m}
                  type="button"
                  className={`bmem-chip${method === m ? " is-on" : ""}`}
                  aria-pressed={method === m}
                  disabled={disabled}
                  style={disabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                  onClick={() => setMethod(m)}
                >
                  {t(`barber.membresias.payment.${m}`)}
                </button>
              );
            })}
          </div>
          <p className="bmem-hint">
            {online
              ? t("barber.membresias.clientes.sellModal.onlineHint")
              : t("barber.membresias.payment.chooseHint")}
          </p>

          {online ? (
            <CheckCard
              checked={recurring}
              onChange={setRecurring}
              title={t("barber.membresias.clientes.sellModal.recurring")}
              hint={t("barber.membresias.clientes.sellModal.recurringHint")}
            />
          ) : null}
        </div>

        {error ? <p className="bmem-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
