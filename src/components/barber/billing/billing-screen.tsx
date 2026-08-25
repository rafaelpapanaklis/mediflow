"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { makeBarberT } from "@/lib/barber/i18n";
import { BillingModal } from "./modal";
import { PlanCards } from "./plan-cards";
import { SubscriptionPanel } from "./subscription-panel";
import { InvoicesTable } from "./invoices-table";
import {
  billingStatusKey,
  formatBarberCents,
  formatBarberDate,
  type BarberBillingIntervalUI,
  type BarberBillingSummary,
  type BarberChangePreviewDTO,
  type BarberGateDTO,
  type BarberPlanCardDTO,
  type Dictionary,
} from "./shared";

type NoticeTone = "ok" | "warn" | "danger" | "info";
interface Notice {
  tone: NoticeTone;
  text: string;
  action?: { label: string; href: string; external?: boolean };
}

interface CheckoutReturn {
  result: "success" | "cancel" | null;
  sessionId: string | null;
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const ICON: Record<NoticeTone, typeof Info> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
  info: Info,
};

/**
 * Pantalla de suscripción (cliente). Recibe TODO ya resuelto por el servidor
 * (planes de la tabla en centavos, gate, resumen de Stripe) y solo orquesta
 * acciones: contratar (Checkout), cambiar de plan (preview → confirmar),
 * cancelar/reanudar, portal de tarjeta y la confirmación al volver de Stripe.
 */
export function BillingScreen({
  locale,
  dict,
  canManage,
  plans,
  gate,
  summary,
  checkout,
}: {
  locale: string;
  dict: Dictionary;
  canManage: boolean;
  plans: BarberPlanCardDTO[];
  gate: BarberGateDTO;
  summary: BarberBillingSummary;
  checkout: CheckoutReturn;
}) {
  const t = useMemo(() => makeBarberT(dict), [dict]);
  const router = useRouter();

  const [notice, setNotice] = useState<Notice | null>(() =>
    checkout.result === "cancel" ? { tone: "info", text: t("barber.suscripcion.alerts.checkoutCanceled") } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(checkout.result === "success" && Boolean(checkout.sessionId));
  const [changeTarget, setChangeTarget] = useState<BarberPlanCardDTO | null>(null);
  const [preview, setPreview] = useState<BarberChangePreviewDTO | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const stoppedRef = useRef(false);

  const statusKey = billingStatusKey(gate.subscriptionStatus);
  const sub = summary.subscription;
  const hasLive = sub?.live === true;
  const lockedInterval: BarberBillingIntervalUI | null = hasLive && sub ? sub.interval : null;

  // ── Al volver de Stripe Checkout: confirmar contra Stripe y esperar ──
  useEffect(() => {
    if (checkout.result !== "success" || !checkout.sessionId) return;
    stoppedRef.current = false;
    let attempts = 0;
    const run = async () => {
      if (stoppedRef.current) return;
      try {
        const { data } = await postJson("/api/barber/billing/confirm", { sessionId: checkout.sessionId });
        if (data?.active) {
          setConfirming(false);
          setNotice({
            tone: "ok",
            text: t("barber.suscripcion.alerts.confirmed"),
            action: { label: t("barber.suscripcion.alerts.goToPanel"), href: "/barber" },
          });
          router.replace("/barber/suscripcion");
          router.refresh();
          return;
        }
      } catch {
        /* reintenta abajo */
      }
      attempts += 1;
      if (attempts >= 10) {
        setConfirming(false);
        setNotice({ tone: "warn", text: t("barber.suscripcion.alerts.confirmSlow") });
        return;
      }
      setTimeout(run, 3000);
    };
    run();
    return () => {
      stoppedRef.current = true;
    };
    // Solo al montar con el retorno de Stripe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failWith = useCallback(
    (data: any, fallbackKey = "barber.suscripcion.errors.generic") => {
      const code = data?.code;
      if (code === "STRIPE_NOT_CONFIGURED") {
        setNotice({ tone: "warn", text: t("barber.suscripcion.errors.notConfigured") });
        return;
      }
      if (code === "ALREADY_SUBSCRIBED") {
        setNotice({
          tone: "info",
          text: t("barber.suscripcion.errors.alreadySubscribed"),
          action: data?.openInvoiceUrl
            ? { label: t("barber.suscripcion.hero.payOpenInvoice"), href: data.openInvoiceUrl, external: true }
            : undefined,
        });
        return;
      }
      if (code === "UPGRADE_PAYMENT_FAILED") {
        const reason = typeof data?.reason === "string" ? data.reason : "declined";
        setNotice({ tone: "danger", text: `${data?.error ?? ""} ${t(`barber.suscripcion.charge.${reason}`)}`.trim() });
        return;
      }
      setNotice({ tone: "danger", text: typeof data?.error === "string" ? data.error : t(fallbackKey) });
    },
    [t],
  );

  // ── Acciones ─────────────────────────────────────────────────────────
  const contract = useCallback(
    async (planId: BarberPlanCardDTO["id"], interval: BarberBillingIntervalUI) => {
      setBusy(`plan:${planId}`);
      setNotice(null);
      try {
        const { ok, data } = await postJson("/api/barber/billing/checkout", { plan: planId, interval });
        if (ok && data?.url) {
          window.location.href = data.url;
          return;
        }
        failWith(data);
      } catch {
        setNotice({ tone: "danger", text: t("barber.suscripcion.errors.generic") });
      } finally {
        setBusy(null);
      }
    },
    [failWith, t],
  );

  const openChange = useCallback(
    async (plan: BarberPlanCardDTO) => {
      setChangeTarget(plan);
      setPreview(null);
      setPreviewError(null);
      try {
        const { ok, data } = await postJson("/api/barber/billing/change-plan/preview", { plan: plan.id });
        if (ok) setPreview(data as BarberChangePreviewDTO);
        else setPreviewError(typeof data?.error === "string" ? data.error : t("barber.suscripcion.errors.generic"));
      } catch {
        setPreviewError(t("barber.suscripcion.errors.generic"));
      }
    },
    [t],
  );

  const closeChange = useCallback(() => {
    if (busy === "change") return;
    setChangeTarget(null);
    setPreview(null);
    setPreviewError(null);
  }, [busy]);

  const confirmChange = useCallback(async () => {
    if (!changeTarget) return;
    setBusy("change");
    try {
      const { ok, data } = await postJson("/api/barber/billing/change-plan", { plan: changeTarget.id });
      if (ok) {
        setNotice({
          tone: "ok",
          text: t(
            data?.chargedNow ? "barber.suscripcion.alerts.changeDoneCharged" : "barber.suscripcion.alerts.changeDone",
            { plan: changeTarget.name },
          ),
        });
        setChangeTarget(null);
        setPreview(null);
        router.refresh();
      } else {
        setChangeTarget(null);
        setPreview(null);
        failWith(data);
      }
    } catch {
      setNotice({ tone: "danger", text: t("barber.suscripcion.errors.generic") });
    } finally {
      setBusy(null);
    }
  }, [changeTarget, failWith, router, t]);

  const openPortal = useCallback(async () => {
    setBusy("portal");
    try {
      const { ok, data } = await postJson("/api/barber/billing/portal");
      if (ok && data?.url) {
        window.location.href = data.url;
        return;
      }
      failWith(data);
    } catch {
      setNotice({ tone: "danger", text: t("barber.suscripcion.errors.generic") });
    } finally {
      setBusy(null);
    }
  }, [failWith, t]);

  const doCancel = useCallback(async () => {
    setBusy("cancel");
    try {
      const { ok, data } = await postJson("/api/barber/billing/cancel");
      if (ok) {
        setCancelOpen(false);
        setNotice({
          tone: "info",
          text: data?.currentPeriodEndAt
            ? t("barber.suscripcion.alerts.cancelDone", { date: formatBarberDate(data.currentPeriodEndAt, locale) })
            : t("barber.suscripcion.alerts.cancelDoneNoDate"),
        });
        router.refresh();
      } else {
        setCancelOpen(false);
        failWith(data);
      }
    } catch {
      setNotice({ tone: "danger", text: t("barber.suscripcion.errors.generic") });
    } finally {
      setBusy(null);
    }
  }, [failWith, locale, router, t]);

  const doResume = useCallback(async () => {
    setBusy("resume");
    try {
      const { ok, data } = await postJson("/api/barber/billing/resume");
      if (ok) {
        setNotice({ tone: "ok", text: t("barber.suscripcion.alerts.resumeDone") });
        router.refresh();
      } else failWith(data);
    } catch {
      setNotice({ tone: "danger", text: t("barber.suscripcion.errors.generic") });
    } finally {
      setBusy(null);
    }
  }, [failWith, router, t]);

  // ── Avisos de estado ─────────────────────────────────────────────────
  const stateAlert = (() => {
    if (confirming) return null;
    if (statusKey === "pastDue") {
      return (
        <Alert tone="danger" title={t("barber.suscripcion.alerts.pastDueTitle")} body={t("barber.suscripcion.alerts.pastDueBody")}>
          {canManage && summary.configured && (
            <div className="dcbb-alert__actions">
              {sub?.openInvoiceUrl && (
                <a className="dcbb-btn barber-btn-primary" href={sub.openInvoiceUrl} target="_blank" rel="noopener noreferrer">
                  {t("barber.suscripcion.hero.payOpenInvoice")}
                </a>
              )}
              <button type="button" className="dcbb-btn" disabled={busy !== null} onClick={openPortal}>
                {t("barber.suscripcion.hero.manageCard")}
              </button>
            </div>
          )}
        </Alert>
      );
    }
    if (statusKey === "canceled") {
      return <Alert tone="info" title={t("barber.suscripcion.alerts.canceledTitle")} body={t("barber.suscripcion.alerts.canceledBody")} />;
    }
    if (statusKey === "pending" || statusKey === "unknown") {
      return (
        <Alert tone="warn" title={t("barber.suscripcion.alerts.pendingTitle")} body={t("barber.suscripcion.alerts.pendingBody")}>
          {!canManage && <p className="dcbb-alert__body" style={{ marginTop: 6 }}>{t("barber.suscripcion.hero.onlyOwner")}</p>}
          {canManage && !summary.configured && (
            <p className="dcbb-alert__body" style={{ marginTop: 6 }}>{t("barber.suscripcion.hero.notConfigured")}</p>
          )}
        </Alert>
      );
    }
    return null;
  })();

  const overLimitAlerts = (["barbers", "branches"] as const)
    .filter((key) => gate.limits[key].overLimit)
    .map((key) => (
      <Alert
        key={key}
        tone="warn"
        title={t("barber.suscripcion.alerts.overLimitTitle")}
        body={t(key === "barbers" ? "barber.suscripcion.alerts.overLimitBarbers" : "barber.suscripcion.alerts.overLimitBranches", {
          used: gate.limits[key].used,
          max: gate.limits[key].max,
          plan: gate.planName,
        })}
      />
    ));

  const NoticeIcon = notice ? ICON[notice.tone] : null;
  const changeTitleId = "dcbb-change-title";
  const cancelTitleId = "dcbb-cancel-title";
  const previewChargeNow = preview && preview.direction === "upgrade";

  return (
    <div className="dcbb-root">
      <header className="dcbb-header">
        <h1 className="dcbb-title">{t("barber.suscripcion.title")}</h1>
        <p className="dcbb-subtitle">{t("barber.suscripcion.subtitle")}</p>
      </header>

      {confirming && (
        <div className="dcbb-alert" role="status" aria-live="polite">
          <Loader2 size={18} className="dcbb-alert__icon dcbb-spin" aria-hidden />
          <p className="dcbb-alert__title">{t("barber.suscripcion.alerts.confirming")}</p>
        </div>
      )}

      {notice && NoticeIcon && (
        <div className={`dcbb-alert dcbb-alert--${notice.tone === "info" ? "" : notice.tone}`.trim()} role="status" aria-live="polite">
          <NoticeIcon size={18} className="dcbb-alert__icon" aria-hidden />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="dcbb-alert__body" style={{ color: "var(--text-1)" }}>{notice.text}</p>
            {notice.action && (
              <div className="dcbb-alert__actions">
                <a
                  className="dcbb-btn barber-btn-primary"
                  href={notice.action.href}
                  {...(notice.action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {notice.action.label}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {stateAlert}
      {overLimitAlerts}

      <SubscriptionPanel
        t={t}
        locale={locale}
        gate={gate}
        summary={summary}
        canManage={canManage}
        busy={busy}
        onPortal={openPortal}
        onCancel={() => setCancelOpen(true)}
        onResume={doResume}
      />

      <PlanCards
        t={t}
        locale={locale}
        plans={plans}
        currentPlanId={gate.planId}
        canManage={canManage}
        configured={summary.configured}
        hasLiveSubscription={hasLive}
        lockedInterval={lockedInterval}
        busyPlan={busy?.startsWith("plan:") ? busy.slice(5) : null}
        onContract={contract}
        onChange={openChange}
      />

      {canManage && summary.configured && (
        <InvoicesTable t={t} locale={locale} invoices={summary.invoices} failed={summary.failedAttempts} />
      )}

      {/* Cambio de plan: preview → confirmar */}
      <BillingModal open={changeTarget !== null} titleId={changeTitleId} onClose={closeChange}>
        {changeTarget && (
          <>
            <h2 id={changeTitleId} className="dcbb-modal__title">
              {t("barber.suscripcion.change.title", { plan: changeTarget.name })}
            </h2>
            {!preview && !previewError && (
              <p className="dcbb-modal__body">
                <Loader2 size={14} className="dcbb-spin" aria-hidden style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />
                {t("barber.suscripcion.change.loading")}
              </p>
            )}
            {previewError && <p className="dcbb-modal__body" style={{ color: "#b91c1c" }}>{previewError}</p>}
            {preview && (
              <>
                <p className="dcbb-modal__body">
                  {t(preview.direction === "upgrade" ? "barber.suscripcion.change.upgradeExplain" : "barber.suscripcion.change.downgradeExplain")}
                </p>
                {previewChargeNow && preview.unavailable && (
                  <p className="dcbb-modal__body">{t("barber.suscripcion.change.unavailable")}</p>
                )}
                {previewChargeNow && !preview.unavailable && (
                  <>
                    <ul className="dcbb-modal__lines">
                      {preview.lines.map((line, i) => (
                        <li key={i} className="dcbb-modal__line">
                          <span>
                            {line.kind === "credit"
                              ? t("barber.suscripcion.change.creditLine")
                              : line.kind === "charge"
                                ? t("barber.suscripcion.change.chargeLine", { plan: changeTarget.name })
                                : line.description ?? "—"}
                          </span>
                          <span>{formatBarberCents(line.amountCents, preview.currency, locale)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="dcbb-modal__total">
                      <span>{t("barber.suscripcion.change.upgradeNow")}</span>
                      <span>{formatBarberCents(preview.amountDueNowCents, preview.currency, locale)}</span>
                    </div>
                  </>
                )}
                <p className="dcbb-modal__body">
                  {preview.nextBillingDate
                    ? t("barber.suscripcion.change.nextCharge", {
                        date: formatBarberDate(preview.nextBillingDate, locale),
                        amount: formatBarberCents(preview.nextAmountCents, preview.currency, locale),
                      })
                    : t("barber.suscripcion.change.nextChargeNoDate", {
                        amount: formatBarberCents(preview.nextAmountCents, preview.currency, locale),
                      })}
                </p>
                {preview.limitWarnings.length > 0 && (
                  <div className="dcbb-alert dcbb-alert--warn">
                    <AlertTriangle size={16} className="dcbb-alert__icon" aria-hidden />
                    <p className="dcbb-alert__body">
                      {t("barber.suscripcion.change.limitsWarning", {
                        plan: changeTarget.name,
                        details: preview.limitWarnings
                          .map((w) =>
                            t("barber.suscripcion.change.limitDetail", {
                              used: w.used,
                              max: w.max,
                              noun: t(`barber.suscripcion.limits.${w.key}.noun`),
                            }),
                          )
                          .join(" · "),
                      })}
                    </p>
                  </div>
                )}
              </>
            )}
            <div className="dcbb-modal__actions">
              <button type="button" className="dcbb-btn" onClick={closeChange} disabled={busy === "change"}>
                {t("barber.suscripcion.change.back")}
              </button>
              <button
                type="button"
                className="dcbb-btn barber-btn-primary"
                onClick={confirmChange}
                disabled={!preview || busy === "change"}
              >
                {busy === "change" ? <Loader2 size={15} className="dcbb-spin" aria-hidden /> : null}
                {preview && previewChargeNow && !preview.unavailable
                  ? t("barber.suscripcion.change.confirmCharge", {
                      amount: formatBarberCents(preview.amountDueNowCents, preview.currency, locale),
                    })
                  : t("barber.suscripcion.change.confirm")}
              </button>
            </div>
          </>
        )}
      </BillingModal>

      {/* Cancelación al fin del periodo */}
      <BillingModal open={cancelOpen} titleId={cancelTitleId} onClose={() => busy !== "cancel" && setCancelOpen(false)}>
        <h2 id={cancelTitleId} className="dcbb-modal__title">{t("barber.suscripcion.cancelModal.title")}</h2>
        <p className="dcbb-modal__body">
          {sub?.currentPeriodEndAt
            ? t("barber.suscripcion.cancelModal.body", { date: formatBarberDate(sub.currentPeriodEndAt, locale) })
            : t("barber.suscripcion.cancelModal.bodyNoDate")}
        </p>
        <div className="dcbb-modal__actions">
          <button type="button" className="dcbb-btn" onClick={() => setCancelOpen(false)} disabled={busy === "cancel"}>
            {t("barber.suscripcion.cancelModal.keep")}
          </button>
          <button type="button" className="dcbb-btn dcbb-btn--danger" onClick={doCancel} disabled={busy === "cancel"}>
            {busy === "cancel" ? <Loader2 size={15} className="dcbb-spin" aria-hidden /> : null}
            {t("barber.suscripcion.cancelModal.confirm")}
          </button>
        </div>
      </BillingModal>
    </div>
  );
}

function Alert({
  tone,
  title,
  body,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "info";
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const Icon = ICON[tone];
  return (
    <div className={`dcbb-alert ${tone === "info" ? "" : `dcbb-alert--${tone}`}`.trim()} role="status">
      <Icon size={18} className="dcbb-alert__icon" aria-hidden />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="dcbb-alert__title">{title}</p>
        <p className="dcbb-alert__body">{body}</p>
        {children}
      </div>
    </div>
  );
}
