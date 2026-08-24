"use client";

import { useState } from "react";
import { Gift, Scissors } from "lucide-react";
import type { BarberLoyaltyState } from "@/lib/barber/loyalty";
import { Badge, Stamps, clientStyles as s, type BarberT } from "./ui";

/**
 * Tarjeta de lealtad de la ficha.
 *
 * El número NO lo calcula este componente: llega ya resuelto del servidor
 * (BarberLoyaltyState). Aquí solo se pinta y se pide el canje — que también
 * se decide en el servidor, con la condición `loyaltyCount >= threshold`
 * dentro del propio UPDATE.
 *
 * Nota sobre el `import type`: se borra al compilar (isolatedModules), así
 * que traer el tipo de un módulo `server-only` no arrastra nada al bundle
 * del navegador.
 */
export function LoyaltyCard({
  clientId,
  state,
  canRedeem,
  t,
  onRedeemed,
  onMessage,
}: {
  clientId: string;
  state: BarberLoyaltyState;
  canRedeem: boolean;
  t: BarberT;
  onRedeemed: (next: BarberLoyaltyState) => void;
  onMessage: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!state.enabled) {
    return (
      <div className={`${s.card} ${s.cardPad}`}>
        <h2 className={s.sectionTitle}>{t("loyalty.title")}</h2>
        <p className={s.sectionSub}>{t("loyalty.off")}</p>
      </div>
    );
  }

  async function redeem() {
    setBusy(true);
    try {
      const res = await fetch(`/api/barber/clients/${clientId}/loyalty`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onMessage(data?.error || t("errors.generic"));
        return;
      }
      onRedeemed(data.loyalty as BarberLoyaltyState);
      onMessage(t("loyalty.redeemed"));
    } catch {
      onMessage(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`${s.card} ${s.cardPad} ${s.loyalty} ${state.rewardAvailable ? s.loyaltyReady : ""}`}
    >
      <div className={s.loyaltyHead}>
        <h2 className={s.sectionTitle}>{t("loyalty.title")}</h2>
        {state.rewardAvailable ? (
          <Badge tone="brand">
            <Gift size={11} /> {t("loyalty.readyShort")}
          </Badge>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className={s.loyaltyCount}>
          {t("loyalty.stamps", { count: state.progress, total: state.threshold })}
        </span>
        <Stamps
          filled={state.progress}
          total={state.threshold}
          big
          label={t("loyalty.stamps", { count: state.progress, total: state.threshold })}
        />
      </div>

      <p className={s.loyaltyMsg}>
        {state.rewardAvailable
          ? t("loyalty.ready", { reward: state.reward })
          : t("loyalty.remaining", { count: state.remaining })}
      </p>

      {state.rewardAvailable && canRedeem ? (
        <button
          type="button"
          className={`${s.btn} barber-btn-primary`}
          onClick={redeem}
          disabled={busy}
        >
          <Scissors size={14} />
          {busy ? t("loyalty.redeeming") : t("loyalty.redeem", { reward: state.reward })}
        </button>
      ) : null}

      <span className={s.hint}>
        {state.redemptions > 0
          ? `${t("loyalty.history", { count: state.redemptions })} · ${t("loyalty.serverNote")}`
          : t("loyalty.serverNote")}
      </span>
    </div>
  );
}

/**
 * ── PIEZA LISTA PARA T1 (agenda) ────────────────────────────────────
 * Distintivo compacto de "premio disponible" para pintar al abrir la cita:
 *
 *   import { BarberLoyaltyBadge } from "@/components/barber/clients/loyalty-card";
 *   import { getBarberLoyaltyForAppointment } from "@/lib/barber/loyalty";
 *
 *   const loyalty = await getBarberLoyaltyForAppointment(ctx, appointmentId);
 *   {loyalty ? <BarberLoyaltyBadge state={loyalty} /> : null}
 *
 * No hace fetch ni sabe de rutas: recibe el estado ya calculado. Devuelve
 * null si la barbería no usa lealtad, así que se puede pintar sin `if`.
 */
export function BarberLoyaltyBadge({
  state,
  showProgress = true,
}: {
  state: BarberLoyaltyState;
  showProgress?: boolean;
}) {
  if (!state.enabled) return null;

  if (state.rewardAvailable) {
    return (
      <Badge tone="brand">
        <Gift size={11} /> {state.reward}
      </Badge>
    );
  }
  if (!showProgress) return null;
  return (
    <Badge>
      <Scissors size={11} /> {state.progress}/{state.threshold}
    </Badge>
  );
}
