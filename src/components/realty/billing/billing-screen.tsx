"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CreditCard, ExternalLink, Info } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { RealtyPlanCards } from "./plan-cards";
import { RealtyUsagePanel } from "./usage-panel";
import { RealtyInvoicesTable } from "./invoices-table";
import {
  formatCentsMXN,
  limitsOverTargetPlan,
  shortDate,
  stateKey,
  stateTone,
  type BillingTone,
  type RealtyBillingScreenData,
  type RealtyPlanCardDTO,
} from "./shared";
import "./billing.css";

/**
 * Pantalla de SUSCRIPCIÓN de una cuenta de inmuebles.
 *
 * ⚠️ ALCANCE DEL DICCIONARIO — convención B: el servidor baja el sub-árbol YA
 * RECORTADO (`getRealtyDict(locale).realty.billing`) y aquí NO se antepone
 * ningún prefijo: `t("plans.title")`, nunca `t("realty.billing.plans.title")`.
 * Cruzar las dos convenciones aplica el prefijo dos veces y la pantalla pinta
 * la llave cruda (el bug del modal de cobro de barber, que se veía "sin
 * opciones"). Por eso `makeRealtyT(dict)` va SIN segundo argumento.
 *
 * 🔴 CERO PRECIOS: todo importe viene en `data` desde `realty_plan_configs`.
 */
type ModalState =
  | { kind: "none" }
  | { kind: "change"; plan: RealtyPlanCardDTO }
  | { kind: "cancel" };

interface Preview {
  loading: boolean;
  direction: "upgrade" | "downgrade" | "same" | null;
  dueTodayCents: number | null;
  unavailable: boolean;
}

const EMPTY_PREVIEW: Preview = {
  loading: true,
  direction: null,
  dueTodayCents: null,
  unavailable: false,
};

async function postJson(
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, data };
}

export function RealtyBillingScreen({
  dict,
  locale,
  data,
  checkout,
}: {
  dict: Dictionary;
  locale: string;
  data: RealtyBillingScreenData;
  checkout: { result: "success" | "cancel" | null; sessionId: string | null };
}) {
  // `makeRealtyT` devuelve una FUNCIÓN NUEVA en cada render: sin memo, todo
  // hook que la lleve en sus dependencias se rehace en cada render (y un
  // useEffect con fetch entra en bucle infinito).
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [preview, setPreview] = useState<Preview>(EMPTY_PREVIEW);
  const [notice, setNotice] = useState<{ tone: BillingTone; text: string } | null>(
    checkout.result === "cancel" ? { tone: "neutral", text: t("notice.checkoutCanceled") } : null,
  );
  const [confirming, setConfirming] = useState(checkout.result === "success");
  const stoppedRef = useRef(false);

  const dateLocale = locale === "en" ? "en-US" : "es-MX";

  // ── Al volver de Stripe: confirmar contra Stripe sin esperar al webhook.
  //    Sin esto la cuenta ve "pendiente" unos segundos y algunos pagan dos veces.
  useEffect(() => {
    if (checkout.result !== "success" || !checkout.sessionId) return;
    stoppedRef.current = false;
    let attempts = 0;

    const run = async () => {
      if (stoppedRef.current) return;
      try {
        const { data: res } = await postJson("/api/realty/billing/confirm", {
          sessionId: checkout.sessionId,
        });
        if (res?.active) {
          setConfirming(false);
          router.replace("/inmobiliaria/suscripcion");
          router.refresh();
          return;
        }
      } catch {
        /* reintenta abajo */
      }
      attempts += 1;
      if (attempts >= 10) {
        setConfirming(false);
        setNotice({ tone: "warning", text: t("notice.confirmSlow") });
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

  const fail = useCallback(
    (res: { ok: boolean; data: any }) => {
      setNotice({
        tone: "danger",
        text: res.data?.error ?? t("errors.generic"),
      });
    },
    [t],
  );

  // ── ¿Hay una suscripción viva a la que cambiarle el plan, o hay que
  //    arrancar un checkout nuevo? ──
  const hasLiveSubscription =
    !!data.subscription &&
    ["active", "trialing", "past_due", "unpaid"].includes(data.subscription.status);

  const pickPlan = useCallback(
    async (plan: RealtyPlanCardDTO) => {
      if (!data.canManage || busy) return;
      setNotice(null);
      if (!hasLiveSubscription) {
        setBusy(true);
        const res = await postJson("/api/realty/billing/checkout", {
          plan: plan.id,
          interval: "month",
        });
        setBusy(false);
        if (res.ok && res.data?.url) {
          window.location.href = res.data.url;
          return;
        }
        fail(res);
        return;
      }
      setModal({ kind: "change", plan });
      setPreview(EMPTY_PREVIEW);
      const res = await postJson("/api/realty/billing/change-plan/preview", {
        plan: plan.id,
      });
      if (res.ok && res.data) {
        setPreview({
          loading: false,
          direction: res.data.direction ?? null,
          dueTodayCents: res.data.dueTodayCents ?? null,
          unavailable: !!res.data.unavailable,
        });
      } else {
        setPreview({ loading: false, direction: null, dueTodayCents: null, unavailable: true });
      }
    },
    [busy, data.canManage, fail, hasLiveSubscription],
  );

  const confirmChange = useCallback(async () => {
    if (modal.kind !== "change") return;
    setBusy(true);
    const res = await postJson("/api/realty/billing/change-plan", { plan: modal.plan.id });
    setBusy(false);
    setModal({ kind: "none" });
    if (!res.ok) {
      fail(res);
      return;
    }
    router.refresh();
  }, [fail, modal, router]);

  const openPortal = useCallback(async () => {
    setBusy(true);
    const res = await postJson("/api/realty/billing/portal");
    setBusy(false);
    if (res.ok && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    fail(res);
  }, [fail]);

  const doCancel = useCallback(async () => {
    setBusy(true);
    const res = await postJson("/api/realty/billing/cancel");
    setBusy(false);
    setModal({ kind: "none" });
    if (!res.ok) {
      fail(res);
      return;
    }
    router.refresh();
  }, [fail, router]);

  const doResume = useCallback(async () => {
    setBusy(true);
    const res = await postJson("/api/realty/billing/resume");
    setBusy(false);
    if (!res.ok) {
      fail(res);
      return;
    }
    router.refresh();
  }, [fail, router]);

  // ── Avisos de estado ─────────────────────────────────────────────────
  const notices: { tone: BillingTone; text: string }[] = [];
  if (!data.stripeConfigured) {
    notices.push({ tone: "warning", text: t("notice.notConfigured") });
  } else if (data.stripeUnreachable) {
    notices.push({ tone: "warning", text: t("notice.stripeUnreachable") });
  }
  const sKey = stateKey(data.subscriptionStatus);
  if (confirming) {
    notices.push({ tone: "neutral", text: t("notice.confirming") });
  } else if (sKey === "pending_payment") {
    notices.push({ tone: "warning", text: t("notice.pendingPayment") });
  } else if (sKey === "past_due" || sKey === "unpaid") {
    notices.push({ tone: "danger", text: t("notice.pastDue") });
  } else if (sKey === "suspended") {
    notices.push({ tone: "danger", text: t("notice.suspended") });
  } else if (sKey === "canceled") {
    notices.push({ tone: "warning", text: t("notice.canceled") });
  }
  if (!data.canManage) {
    notices.push({ tone: "neutral", text: t("notice.readOnly") });
  }
  if (notice) notices.push(notice);

  // 🔴 Con Stripe sin responder NO se ofrece contratar ni cambiar de plan: el
  // servidor no puede comprobar si ya hay una suscripción viva, y asumir que
  // no la hay es exactamente cómo se crea una SEGUNDA y se cobra dos veces.
  // El aviso de arriba ya explica al usuario por qué está en pausa.
  const canPay = data.canManage && data.stripeConfigured && !data.stripeUnreachable;

  const sub = data.subscription;
  const nextCharge =
    sub && !sub.cancelAtPeriodEnd && sub.currentPeriodEndAt
      ? shortDate(sub.currentPeriodEndAt, dateLocale)
      : null;

  return (
    <>
      <div className="dcrb realty-shell">
        <header className="dcrb-head">
          <h1 className="dcrb-title">{t("title")}</h1>
          <p className="dcrb-sub">{t("subtitle")}</p>
        </header>

        {notices.map((n, i) => (
          <div
            key={`${n.tone}-${i}`}
            className={`dcrb-notice${
              n.tone === "danger"
                ? " dcrb-notice--danger"
                : n.tone === "warning"
                  ? " dcrb-notice--warning"
                  : " dcrb-notice--info"
            }`}
          >
            {n.tone === "neutral" ? (
              <Info size={15} className="dcrb-notice__icon" aria-hidden />
            ) : (
              <AlertTriangle size={15} className="dcrb-notice__icon" aria-hidden />
            )}
            <span>{n.text}</span>
          </div>
        ))}

        {/* ── Resumen ─────────────────────────────────────────────────── */}
        <section className="dcrb-card">
          <div className="dcrb-hero">
            <div>
              <div className="dcrb-label">{t("account.planLabel")}</div>
              <div className="dcrb-planname">{data.planName}</div>
              {sub?.unitAmountCents != null ? (
                <div className="dcrb-price">
                  {t("account.chargedAmount", {
                    amount: `${formatCentsMXN(sub.unitAmountCents)} ${
                      sub.interval === "year" ? t("account.perYear") : t("account.perMonth")
                    }`,
                  })}
                </div>
              ) : null}
            </div>

            <div className="dcrb-fields">
              <div>
                <div className="dcrb-label">{t("account.statusLabel")}</div>
                <div className="dcrb-value" style={{ marginTop: 4 }}>
                  <span
                    className={`dcrb-badge${
                      stateTone(data.subscriptionStatus) === "success"
                        ? " dcrb-badge--success"
                        : stateTone(data.subscriptionStatus) === "warning"
                          ? " dcrb-badge--warning"
                          : stateTone(data.subscriptionStatus) === "danger"
                            ? " dcrb-badge--danger"
                            : ""
                    }`}
                  >
                    {t(`state.${sKey}`)}
                  </span>
                </div>
              </div>
              <div>
                <div className="dcrb-label">{t("account.nextCharge")}</div>
                <div className="dcrb-value">{nextCharge ?? t("account.nextChargeNone")}</div>
              </div>
            </div>
          </div>

          {sub?.cancelAtPeriodEnd ? (
            <p className="dcrb-cardhint">
              {t("account.cancelScheduled", {
                date: shortDate(sub.currentPeriodEndAt, dateLocale),
              })}
            </p>
          ) : null}
          {sub?.trialEndsAt && sub.status === "trialing" ? (
            <p className="dcrb-cardhint">
              {t("account.trialUntil", { date: shortDate(sub.trialEndsAt, dateLocale) })}
            </p>
          ) : null}
        </section>

        <RealtyUsagePanel t={t} limits={data.limits} />

        {/* ── Planes ──────────────────────────────────────────────────── */}
        <section className="dcrb-card">
          <header className="dcrb-cardhead">
            <h2 className="dcrb-cardtitle">{t("plans.title")}</h2>
            <p className="dcrb-cardhint">{t("plans.hint")}</p>
          </header>
          <RealtyPlanCards
            t={t}
            plans={data.plans}
            currentPlanId={data.planId}
            canManage={canPay}
            busy={busy}
            hasSubscription={hasLiveSubscription}
            onPick={pickPlan}
          />
        </section>

        {/* ── Cuenta de cobro ─────────────────────────────────────────── */}
        {data.canManage ? (
          <section className="dcrb-card">
            <header className="dcrb-cardhead">
              <h2 className="dcrb-cardtitle">{t("manage.title")}</h2>
            </header>
            <div className="dcrb-manage">
              <div className="dcrb-manage__item">
                <button
                  type="button"
                  className="dcrb-btn dcrb-btn--ghost"
                  disabled={busy || !data.hasCustomer || !data.stripeConfigured}
                  onClick={openPortal}
                >
                  <CreditCard size={14} aria-hidden />
                  {t("manage.payMethod")}
                </button>
                <span className="dcrb-manage__hint">{t("manage.payMethodHint")}</span>
              </div>

              {sub?.openInvoiceUrl ? (
                <div className="dcrb-manage__item">
                  <a
                    className="dcrb-btn dcrb-btn--primary"
                    href={sub.openInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={14} aria-hidden />
                    {t("manage.openInvoice")}
                  </a>
                </div>
              ) : null}

              {hasLiveSubscription ? (
                <div className="dcrb-manage__item">
                  {sub?.cancelAtPeriodEnd ? (
                    <>
                      <button
                        type="button"
                        className="dcrb-btn dcrb-btn--ghost"
                        disabled={busy}
                        onClick={doResume}
                      >
                        {t("manage.resume")}
                      </button>
                      <span className="dcrb-manage__hint">{t("manage.resumeHint")}</span>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="dcrb-btn dcrb-btn--danger"
                        disabled={busy}
                        onClick={() => setModal({ kind: "cancel" })}
                      >
                        {t("manage.cancel")}
                      </button>
                      <span className="dcrb-manage__hint">{t("manage.cancelHint")}</span>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {data.canManage ? (
          <RealtyInvoicesTable
            t={t}
            invoices={data.invoices}
            unavailable={data.stripeUnreachable}
            locale={locale}
          />
        ) : null}
      </div>

      {/* 🔴 Los modales viven FUERA de .dcrb: `container-type` crea contención
          y atraparía a position:fixed dentro de la tarjeta. */}
      {modal.kind === "change" ? (
        <div
          className="dcrb-backdrop realty-shell"
          role="dialog"
          aria-modal="true"
          aria-label={t("modal.changeTitle", { plan: modal.plan.name })}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal({ kind: "none" });
          }}
        >
          <div className="dcrb-modal">
            <h3 className="dcrb-modal__title">
              {t("modal.changeTitle", { plan: modal.plan.name })}
            </h3>
            {/* `direction` es null mientras carga Y cuando el preview falla.
                Colapsarlo a "subida" hacía que una BAJADA dijera "se cobra hoy
                la diferencia": el usuario confirmaba esperando un cargo que no
                existía. Sin dirección, no se afirma nada sobre el cobro. */}
            <p className="dcrb-modal__body">
              {preview.direction === "downgrade"
                ? `${t("modal.changeDowngrade")} ${t("modal.keepsDate")}`
                : preview.direction === "upgrade"
                  ? `${t("modal.changeUpgrade")} ${t("modal.keepsDate")}`
                  : t("modal.keepsDate")}
            </p>
            {!preview.loading &&
            (preview.direction === "upgrade" || preview.direction === null) ? (
              preview.dueTodayCents === null ? (
                <p className="dcrb-modal__body">{t("modal.dueTodayUnknown")}</p>
              ) : (
                <p className="dcrb-modal__amount">
                  {t("modal.dueToday", { amount: formatCentsMXN(preview.dueTodayCents) })}
                </p>
              )
            ) : null}
            {limitsOverTargetPlan(data.limits, modal.plan).length > 0 ? (
              <p className="dcrb-modal__body">{t("modal.overLimit")}</p>
            ) : null}
            <div className="dcrb-modal__foot">
              <button
                type="button"
                className="dcrb-btn dcrb-btn--ghost dcrb-btn--auto"
                disabled={busy}
                onClick={() => setModal({ kind: "none" })}
              >
                {t("modal.back")}
              </button>
              <button
                type="button"
                className="dcrb-btn dcrb-btn--primary dcrb-btn--auto"
                disabled={busy || preview.loading}
                onClick={confirmChange}
              >
                {t("modal.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal.kind === "cancel" ? (
        <div
          className="dcrb-backdrop realty-shell"
          role="dialog"
          aria-modal="true"
          aria-label={t("modal.cancelTitle")}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal({ kind: "none" });
          }}
        >
          <div className="dcrb-modal">
            <h3 className="dcrb-modal__title">{t("modal.cancelTitle")}</h3>
            <p className="dcrb-modal__body">
              {sub?.currentPeriodEndAt
                ? t("modal.cancelBody", {
                    date: shortDate(sub.currentPeriodEndAt, dateLocale),
                  })
                : t("modal.cancelBodyNoDate")}
            </p>
            <div className="dcrb-modal__foot">
              <button
                type="button"
                className="dcrb-btn dcrb-btn--ghost dcrb-btn--auto"
                disabled={busy}
                onClick={() => setModal({ kind: "none" })}
              >
                {t("modal.cancelKeep")}
              </button>
              <button
                type="button"
                className="dcrb-btn dcrb-btn--danger dcrb-btn--auto"
                disabled={busy}
                onClick={doCancel}
              >
                {t("modal.cancelConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
