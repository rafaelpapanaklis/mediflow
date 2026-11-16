"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Gift, Link2, Minus, Plus, QrCode, RotateCcw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Dictionary } from "@/i18n/t";
import type { BonusPublic, StarsView } from "@/lib/barber/stars-core";
import { StarsCard, StarsDetails, starsT } from "@/components/barber/stars/stars-card";
import { Field, Modal, clientStyles as s } from "./ui";

/**
 * La tarjeta de ESTRELLAS en la ficha del cliente.
 *
 * Lo que se ve llega resuelto del servidor (loadStarsView, audiencia
 * «staff»: con motivo y quién de cada ajuste). Lo que se hace aquí —dar o
 * quitar una estrella, marcar un bono como entregado, sacar o revocar el
 * enlace de la tarjeta— lo decide el servidor (/api/barber/clients/[id]/stars)
 * con permiso cash.manage y candado sobre el cliente. El navegador nunca
 * manda un número de estrellas.
 */

type Dialog =
  | { kind: "adjust"; delta: 1 | -1 }
  | { kind: "deliver"; bonus: BonusPublic }
  | { kind: "revoke" }
  | null;

export function StarsPanel({
  clientId,
  clientName,
  initial,
  dict,
  locale,
  timezone,
  canHandle,
  onMessage,
  onChanged,
  hideHistory = false,
  historyLink = null,
}: {
  clientId: string;
  clientName: string;
  initial: StarsView;
  /** Sub-árbol barber.estrellas. */
  dict: Dictionary;
  locale: string;
  timezone: string;
  /** cash.manage: dar/quitar, entregar bono, enlace. */
  canHandle: boolean;
  onMessage: (text: string) => void;
  onChanged?: (next: StarsView) => void;
  /** Ficha «A»: el historial va en Historial › Estrellas; aquí solo el enlace. */
  hideHistory?: boolean;
  historyLink?: React.ReactNode;
}) {
  const t = useMemo(() => starsT(dict), [dict]);
  const [view, setView] = useState<StarsView>(initial);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const firstName = clientName.trim().split(/\s+/)[0] || clientName;

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(`/api/barber/clients/${clientId}/stars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        onMessage(typeof data.error === "string" ? data.error : t("staff.error"));
        return null;
      }
      return data;
    } catch {
      onMessage(t("staff.error"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function applyView(data: Record<string, unknown> | null): boolean {
    const next = data?.stars as StarsView | undefined;
    if (!next) return false;
    setView(next);
    onChanged?.(next);
    return true;
  }

  async function adjust(delta: 1 | -1) {
    const data = await call({ action: "adjust", delta, reason });
    if (applyView(data)) {
      onMessage(delta > 0 ? t("staff.given") : t("staff.removed"));
      setDialog(null);
      setReason("");
    }
  }

  async function deliver(bonus: BonusPublic) {
    const data = await call({ action: "deliver", bonusId: bonus.id, note: reason });
    if (applyView(data)) {
      onMessage(t("staff.delivered"));
      setDialog(null);
      setReason("");
    }
  }

  async function ensureLink(action: "link" | "revoke" = "link"): Promise<string | null> {
    if (action === "link" && link) return link;
    const data = await call({ action });
    const path = (data?.link as { path?: string } | undefined)?.path;
    if (!path) return null;
    const url = `${window.location.origin}${path}`;
    setLink(url);
    return url;
  }

  async function copyLink() {
    const url = await ensureLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      onMessage(t("staff.copied"));
    } catch {
      // Sin permiso de portapapeles: que se vea para copiarlo a mano.
      setShowQr(true);
    }
  }

  async function toggleQr() {
    if (showQr) {
      setShowQr(false);
      return;
    }
    if (await ensureLink()) setShowQr(true);
  }

  async function revoke() {
    const url = await ensureLink("revoke");
    if (url) {
      onMessage(t("staff.revoked"));
      setShowQr(true);
    }
    setDialog(null);
  }

  return (
    <section className={`${s.card} ${s.cardPad}`} data-stars-panel>
      {!view.enabled ? (
        <>
          <h2 className={s.sectionTitle}>{t("card.titleStaff")}</h2>
          <p className={s.sectionSub}>{t("card.off")}</p>
        </>
      ) : (
        <>
          <StarsCard view={view} t={t} audience="staff" locale={locale} />

          {canHandle ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button
                type="button"
                className={`${s.btn} ${s.btnSm}`}
                onClick={() => setDialog({ kind: "adjust", delta: 1 })}
                data-accion="dar-estrella"
              >
                <Plus size={13} /> {t("staff.give")}
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.btnSm}`}
                onClick={() => setDialog({ kind: "adjust", delta: -1 })}
                disabled={view.stars < 1}
                data-accion="quitar-estrella"
              >
                <Minus size={13} /> {t("staff.remove")}
              </button>
            </div>
          ) : (
            <p className={s.hint} style={{ marginTop: 10 }}>{t("staff.noPermission")}</p>
          )}

          <StarsDetails
            view={view}
            t={t}
            audience="staff"
            locale={locale}
            timezone={timezone}
            hideHistory={hideHistory}
            availableAction={
              canHandle
                ? (bonus) => (
                    <button
                      type="button"
                      className={`${s.btn} ${s.btnSm}`}
                      onClick={() => setDialog({ kind: "deliver", bonus })}
                      data-accion="entregar-bono"
                    >
                      <Gift size={13} /> {t("staff.deliver")}
                    </button>
                  )
                : undefined
            }
          />

          {historyLink ? <div style={{ marginTop: 10, textAlign: "right" }}>{historyLink}</div> : null}

          {canHandle ? (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
              <h3 className={s.sectionTitle} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Link2 size={14} /> {t("staff.linkTitle")}
              </h3>
              <p className={s.hint} style={{ margin: "4px 0 10px" }}>{t("staff.linkHint")}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={copyLink} disabled={busy} data-accion="copiar-enlace">
                  <Copy size={13} /> {t("staff.copy")}
                </button>
                <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={toggleQr} disabled={busy} data-accion="ver-qr">
                  <QrCode size={13} /> {showQr ? t("staff.hideQr") : t("staff.showQr")}
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSm} ${s.btnGhost}`}
                  onClick={() => setDialog({ kind: "revoke" })}
                  disabled={busy}
                  data-accion="revocar-enlace"
                >
                  <RotateCcw size={13} /> {t("staff.revoke")}
                </button>
              </div>
              {showQr && link ? (
                <div style={{ marginTop: 12, display: "grid", justifyItems: "start", gap: 8 }}>
                  <div style={{ borderRadius: 12, overflow: "hidden", lineHeight: 0 }}>
                    {/* El QR trae su propio fondo blanco y margen: se lee también en modo oscuro. */}
                    <QRCodeSVG value={link} size={176} level="M" marginSize={2} />
                  </div>
                  <code className={s.hint} style={{ wordBreak: "break-all" }}>{link}</code>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {dialog?.kind === "adjust" ? (
        <Modal
          title={dialog.delta > 0 ? t("staff.giveTitle", { name: firstName }) : t("staff.removeTitle", { name: firstName })}
          onClose={() => setDialog(null)}
          closeLabel={t("staff.cancel")}
          footer={
            <>
              <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setDialog(null)} disabled={busy}>
                {t("staff.cancel")}
              </button>
              <button
                type="button"
                className={`${s.btn} barber-btn-primary`}
                onClick={() => adjust(dialog.delta)}
                disabled={busy}
              >
                <Check size={14} /> {dialog.delta > 0 ? t("staff.confirmGive") : t("staff.confirmRemove")}
              </button>
            </>
          }
        >
          <Field label={t("staff.reason")} htmlFor="star-reason" hint={t("staff.reasonHint")}>
            <textarea
              id="star-reason"
              className={s.textarea}
              value={reason}
              maxLength={200}
              placeholder={dialog.delta > 0 ? t("staff.reasonPlaceholderGive") : t("staff.reasonPlaceholderRemove")}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}

      {dialog?.kind === "deliver" ? (
        <Modal
          title={t("staff.deliverTitle", { bonus: dialog.bonus.name })}
          onClose={() => setDialog(null)}
          closeLabel={t("staff.cancel")}
          footer={
            <>
              <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setDialog(null)} disabled={busy}>
                {t("staff.cancel")}
              </button>
              <button type="button" className={`${s.btn} barber-btn-primary`} onClick={() => deliver(dialog.bonus)} disabled={busy}>
                <Gift size={14} /> {t("staff.deliver")}
              </button>
            </>
          }
        >
          <p className={s.sectionSub}>{t("staff.deliverBody", { count: dialog.bonus.cost, name: firstName })}</p>
          <Field label={t("staff.deliverNote")} htmlFor="bonus-note">
            <input id="bonus-note" className={s.input} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      ) : null}

      {dialog?.kind === "revoke" ? (
        <Modal
          title={t("staff.revoke")}
          onClose={() => setDialog(null)}
          closeLabel={t("staff.cancel")}
          footer={
            <>
              <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setDialog(null)} disabled={busy}>
                {t("staff.cancel")}
              </button>
              <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={revoke} disabled={busy}>
                <RotateCcw size={14} /> {t("staff.revoke")}
              </button>
            </>
          }
        >
          <p className={s.sectionSub}>{t("staff.revokeConfirm")}</p>
        </Modal>
      ) : null}
    </section>
  );
}
