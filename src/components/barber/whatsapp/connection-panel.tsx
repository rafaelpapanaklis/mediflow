"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Send, Unplug } from "lucide-react";
import { Banner, Btn, ErrorText, Modal, useSaving, apiCall } from "../team/admin-ui";
import {
  BARBER_WA_PRICE_USD,
  isBarberWaUnlimited,
  type BarberWaConnectionDTO,
  type BarberWaQuotaDTO,
} from "@/lib/barber/whatsapp-core";
import { BarberEmbeddedSignupButton } from "./embedded-signup-button";
import { useWaT, formatWhen } from "./ui";
import s from "./whatsapp.module.css";

/**
 * Conexión + cupo. Lo primero que ve la barbería.
 *
 * DECISIÓN DE PRODUCTO: "sin verificar" se pinta como una NOTA, no como un
 * error. Sin verificación de negocio Meta permite escribirle a 250 clientes
 * distintos cada 24 h, que le sobra a cualquier barbería — poner un muro ahí
 * sería inventar un problema que no existe.
 */
export function ConnectionPanel({
  connection,
  quota,
  locale,
  canEdit,
  canSend,
  onChanged,
}: {
  connection: BarberWaConnectionDTO;
  quota: BarberWaQuotaDTO;
  locale: string;
  canEdit: boolean;
  canSend: boolean;
  onChanged: () => void;
}) {
  const t = useWaT();
  const { saving, error, setError, run } = useSaving();
  const [confirmOff, setConfirmOff] = useState(false);
  const [dispatchNote, setDispatchNote] = useState<string | null>(null);

  const connected = connection.state !== "DISCONNECTED";
  const dotClass =
    connection.state === "CONNECTED"
      ? s.dotOk
      : connection.state === "UNVERIFIED"
        ? s.dotWarn
        : connection.state === "DISCONNECTED"
          ? ""
          : s.dotBad;

  const unlimited = isBarberWaUnlimited(quota.limit);
  const pct = unlimited || quota.limit <= 0 ? 0 : Math.min(100, Math.round((quota.used / quota.limit) * 100));

  function disconnect() {
    void run(async () => {
      await apiCall("/api/barber/whatsapp/connect", { method: "DELETE" });
      setConfirmOff(false);
      onChanged();
    });
  }

  function sendPending() {
    setDispatchNote(null);
    void run(async () => {
      const result = await apiCall<{ queued: number; sent: number; failed: number }>(
        "/api/barber/whatsapp/dispatch",
        { method: "POST", json: {} },
      );
      setDispatchNote(
        t("outbox.result", {
          queued: result.queued,
          sent: result.sent,
          failed: result.failed,
        }),
      );
      onChanged();
    });
  }

  return (
    <div className={s.cards}>
      {/* ── Conexión ────────────────────────────────────────────────── */}
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t("connection.title")}</h2>
        <p className={s.cardLead}>{t("connection.lead")}</p>

        <div className={s.stateRow}>
          <span className={[s.dot, dotClass].filter(Boolean).join(" ")} aria-hidden="true" />
          <span className={s.stateLabel}>{t(`connection.state.${connection.state}`)}</span>
        </div>

        <p className={s.cardLead}>{t(`connection.help.${connection.state}`)}</p>

        {connection.problem ? (
          <Banner tone="danger" icon={<AlertTriangle size={16} />}>
            {connection.problem}
          </Banner>
        ) : null}

        {connected ? (
          <div className={s.meta}>
            {connection.phoneNumberId ? (
              <span className={s.metaItem}>
                {t("connection.number")}:
                <span className={s.metaValue}>{connection.phoneNumberId}</span>
              </span>
            ) : null}
            <span className={s.metaItem}>
              {connection.verifiedAt ? (
                <>
                  {t("connection.verifiedAt")}:
                  <span className={s.metaValue}>{formatWhen(connection.verifiedAt, locale)}</span>
                </>
              ) : (
                <span className={s.metaValue}>{t("connection.notVerified")}</span>
              )}
            </span>
          </div>
        ) : null}

        {!connection.canConnect ? (
          <Banner icon={<Info size={16} />}>{t("connection.unavailable")}</Banner>
        ) : canEdit ? (
          <div className={s.rowActions}>
            <BarberEmbeddedSignupButton
              label={connected ? t("connection.reconnect") : t("connection.connect")}
              onDone={() => {
                setError(null);
                onChanged();
              }}
              onError={(message) => setError(message)}
            />
            {connected ? (
              <Btn variant="danger" onClick={() => setConfirmOff(true)} disabled={saving}>
                <Unplug size={15} />
                {t("connection.disconnect")}
              </Btn>
            ) : null}
          </div>
        ) : null}

        <ErrorText>{error}</ErrorText>
      </section>

      {/* ── Cupo del periodo ────────────────────────────────────────── */}
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t("quota.title")}</h2>

        {unlimited ? (
          <p className={s.cardLead}>
            <CheckCircle2 size={15} style={{ verticalAlign: "-2px", marginInlineEnd: 6 }} />
            {t("quota.unlimited")}
          </p>
        ) : (
          <>
            <p className={s.cardLead}>
              {t("quota.used", { used: quota.used, limit: quota.limit })} ·{" "}
              {t("quota.remaining", { remaining: quota.remaining })}
            </p>
            <div className={s.meter} role="presentation">
              <div
                className={[
                  s.meterFill,
                  quota.exhausted ? s.meterFillFull : quota.nearLimit ? s.meterFillWarn : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}

        {quota.periodStart ? (
          <p className={s.tplMeta}>{t("quota.since", { date: formatWhen(quota.periodStart, locale) })}</p>
        ) : null}

        {quota.exhausted ? (
          <Banner tone="danger" icon={<AlertTriangle size={16} />}>
            {t("quota.exhausted")}
          </Banner>
        ) : quota.nearLimit ? (
          <Banner icon={<AlertTriangle size={16} />}>{t("quota.near")}</Banner>
        ) : null}

        <p className={s.tplMeta}>
          {t("quota.cost", { price: BARBER_WA_PRICE_USD.UTILITY.toFixed(4) })}
        </p>
      </section>

      {/* ── Pendientes por enviar ───────────────────────────────────── */}
      {connected && canSend ? (
        <section className={[s.card, s.cardWide].join(" ")}>
          <h2 className={s.cardTitle}>{t("outbox.title")}</h2>
          <p className={s.cardLead}>{t("outbox.lead")}</p>
          <div className={s.rowActions}>
            <Btn onClick={sendPending} disabled={saving}>
              <Send size={15} />
              {saving ? t("outbox.sending") : t("outbox.sendNow")}
            </Btn>
            {dispatchNote ? <span className={s.tplMeta}>{dispatchNote}</span> : null}
          </div>
        </section>
      ) : null}

      {confirmOff ? (
        <Modal
          title={t("connection.disconnect")}
          onClose={() => setConfirmOff(false)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setConfirmOff(false)}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="danger" onClick={disconnect} disabled={saving}>
                {t("connection.disconnect")}
              </Btn>
            </>
          }
        >
          <p className={s.cardLead}>{t("connection.disconnectConfirm")}</p>
          <ErrorText>{error}</ErrorText>
        </Modal>
      ) : null}
    </div>
  );
}
