"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Copy,
  Handshake,
  Info,
  Loader2,
  MessageCircle,
  Wallet,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { makeT, type Dictionary, type TFunction } from "@/i18n/t";
import { BarberShareCard } from "./share-card";
import {
  buildBarberShareText,
  describeBarberCommission,
  formatBarberDate,
  formatBarberMoney,
  type BarberAffiliateSummaryDTO,
  type BarberCommissionStatusDTO,
  type BarberReferralStatusDTO,
} from "./shared";

/**
 * Panel del socio (cliente). Recibe TODO ya resuelto por el servidor —
 * incluidas las reglas de la comisión leídas de barber_affiliate_config— y
 * solo orquesta: copiar, compartir, guardar datos de cobro y registrar un
 * código. Aquí NO hay ni un monto ni un porcentaje escrito: todo sale de
 * `summary.terms`.
 */

const REFERRAL_BADGE: Record<BarberReferralStatusDTO, string> = {
  SIGNED_UP: "dcba-badge--neutral",
  PAYING: "dcba-badge--ok",
  CHURNED: "dcba-badge--warn",
};

const COMMISSION_BADGE: Record<BarberCommissionStatusDTO, string> = {
  PENDING: "dcba-badge--warn",
  AVAILABLE: "dcba-badge--brand",
  PAID: "dcba-badge--ok",
};

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export function AfiliadosScreen({
  locale,
  dict,
  summary: initial,
}: {
  locale: string;
  dict: Dictionary;
  summary: BarberAffiliateSummaryDTO;
}) {
  const t = useMemo(() => makeT(dict), [dict]);
  const [summary, setSummary] = useState(initial);

  // El origen lo pone el NAVEGADOR: así la liga funciona igual en localhost,
  // en el preview de Vercel y en el dominio real, sin una env que se queda
  // vieja. En el primer render es "" y por eso el QR espera.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const url = summary.referralPath && origin ? `${origin}${summary.referralPath}` : "";
  const [copied, setCopied] = useState<"link" | "text" | null>(null);

  const shareText = useMemo(
    () => (url ? buildBarberShareText(t, summary.shopName, url) : ""),
    [t, summary.shopName, url],
  );

  const copy = useCallback(async (value: string, which: "link" | "text") => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2200);
    } catch {
      // Sin permiso de portapapeles el texto sigue visible para copiarlo a mano.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/barber/affiliates/summary");
      if (!res.ok) return;
      const data = (await res.json()) as { summary?: BarberAffiliateSummaryDTO };
      if (data.summary) setSummary(data.summary);
    } catch {
      /* un refresco fallido deja los datos que ya se están viendo */
    }
  }, []);

  // ── Bloqueos: el panel explica por qué no hay nada que hacer ──────────
  if (summary.blocker) {
    const isSchema = summary.blocker === "SCHEMA_MISSING";
    return (
      <div className="dcba-root">
        <Header t={t} />
        <div className="dcba-alert dcba-alert--warn" role="status">
          <AlertTriangle size={18} className="dcba-alert__icon" aria-hidden />
          <div>
            <p className="dcba-alert__title">
              {t(isSchema ? "barber.afiliados.blocker.schemaMissingTitle" : "barber.afiliados.blocker.disabledTitle")}
            </p>
            <p className="dcba-alert__body">
              {t(isSchema ? "barber.afiliados.blocker.schemaMissingBody" : "barber.afiliados.blocker.disabledBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { terms, funnel, earnings } = summary;
  const currency = earnings.currency;

  return (
    <div className="dcba-root">
      <Header t={t} />

      <div className="dcba-split">
        {/* ── Liga + QR ─────────────────────────────────────────────── */}
        <section className="dcba-card dcba-link" aria-labelledby="dcba-link-title">
          <div>
            <h2 className="dcba-card__title" id="dcba-link-title">
              {t("barber.afiliados.link.title")}
            </h2>
            <p className="dcba-card__sub">
              {t("barber.afiliados.link.body", { days: terms.attributionDays })}
            </p>
          </div>

          <div className="dcba-link__row">
            <div className="dcba-qrbox">
              {url ? (
                <QRCodeSVG value={url} size={132} level="M" marginSize={0} />
              ) : (
                <div style={{ width: 132, height: 132 }} aria-hidden />
              )}
            </div>

            <div className="dcba-link__body">
              {summary.referralCode ? (
                <span className="dcba-code">{summary.referralCode}</span>
              ) : null}
              <code className="dcba-url">{url || t("barber.afiliados.link.loading")}</code>
              <div className="dcba-actions">
                <button
                  type="button"
                  className="dcba-btn dcba-btn--primary"
                  onClick={() => copy(url, "link")}
                  disabled={!url}
                >
                  {copied === "link" ? (
                    <CheckCircle2 size={15} aria-hidden />
                  ) : (
                    <Copy size={15} aria-hidden />
                  )}
                  {copied === "link"
                    ? t("barber.afiliados.link.copied")
                    : t("barber.afiliados.link.copy")}
                </button>
              </div>
              <p className="dcba-stat__help">{t("barber.afiliados.link.qrBody")}</p>
            </div>
          </div>
        </section>

        {/* ── Reglas del programa (todo leído de la tabla) ───────────── */}
        <section className="dcba-card" aria-labelledby="dcba-terms-title">
          <h2 className="dcba-card__title" id="dcba-terms-title">
            {t("barber.afiliados.terms.title")}
          </h2>
          <p className="dcba-headline">{describeBarberCommission(terms, t)}</p>
          <ul className="dcba-rules">
            <Rule
              icon={<BadgeCheck size={17} className="dcba-rule__icon" aria-hidden />}
              title={t("barber.afiliados.terms.whenTitle")}
              body={t("barber.afiliados.terms.whenBody")}
            />
            <Rule
              icon={<CalendarClock size={17} className="dcba-rule__icon" aria-hidden />}
              title={t("barber.afiliados.terms.holdTitle", { days: terms.holdDays })}
              body={t("barber.afiliados.terms.holdBody", { days: terms.holdDays })}
            />
            <Rule
              icon={<Wallet size={17} className="dcba-rule__icon" aria-hidden />}
              title={t("barber.afiliados.terms.payTitle")}
              body={t("barber.afiliados.terms.payBody")}
            />
          </ul>
          {terms.minPayout > 0 ? (
            <p className="dcba-note">
              {t("barber.afiliados.terms.minPayout", {
                amount: formatBarberMoney(terms.minPayout, terms.currency),
              })}
            </p>
          ) : null}
          {terms.termsUrl ? (
            <p className="dcba-note">
              <a
                className="dcba-link-inline"
                href={terms.termsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("barber.afiliados.terms.seeTerms")}
              </a>
            </p>
          ) : null}
        </section>
      </div>

      {/* ── Embudo ──────────────────────────────────────────────────── */}
      <section aria-labelledby="dcba-funnel-title">
        <h2 className="dcba-card__title" id="dcba-funnel-title" style={{ marginBottom: 12 }}>
          {t("barber.afiliados.funnel.title")}
        </h2>
        <div className="dcba-stats">
          <Stat
            label={t("barber.afiliados.funnel.clicks")}
            value={funnel.clicks.toLocaleString("es-MX")}
            help={t("barber.afiliados.funnel.clicksHelp")}
          />
          <Stat
            label={t("barber.afiliados.funnel.signups")}
            value={funnel.signups.toLocaleString("es-MX")}
            help={t("barber.afiliados.funnel.signupsHelp")}
          />
          <Stat
            label={t("barber.afiliados.funnel.paying")}
            value={funnel.paying.toLocaleString("es-MX")}
            help={t("barber.afiliados.funnel.payingHelp")}
            brand
          />
        </div>
        {funnel.clicks === 0 && funnel.signups === 0 ? (
          <p className="dcba-empty">{t("barber.afiliados.funnel.empty")}</p>
        ) : null}
      </section>

      {/* ── Ganancias ───────────────────────────────────────────────── */}
      <section aria-labelledby="dcba-earn-title">
        <h2 className="dcba-card__title" id="dcba-earn-title" style={{ marginBottom: 12 }}>
          {t("barber.afiliados.earnings.title")}
        </h2>
        <div className="dcba-stats">
          <Stat
            label={t("barber.afiliados.earnings.pending")}
            value={formatBarberMoney(earnings.pending, currency)}
            help={t("barber.afiliados.earnings.pendingHelp")}
          />
          <Stat
            label={t("barber.afiliados.earnings.available")}
            value={formatBarberMoney(earnings.available, currency)}
            help={t("barber.afiliados.earnings.availableHelp")}
            brand
          />
          <Stat
            label={t("barber.afiliados.earnings.paid")}
            value={formatBarberMoney(earnings.paid, currency)}
            help={t("barber.afiliados.earnings.paidHelp")}
          />
        </div>
        <p className="dcba-total">
          {t("barber.afiliados.earnings.total")}:{" "}
          <strong>{formatBarberMoney(earnings.total, currency)}</strong>
        </p>
        {terms.minPayout > 0 ? (
          <p className="dcba-note">
            {earnings.reachesMinPayout
              ? t("barber.afiliados.earnings.readyToPay")
              : t("barber.afiliados.earnings.belowMin", {
                  amount: formatBarberMoney(earnings.missingForMinPayout, currency),
                })}
          </p>
        ) : null}
      </section>

      {/* ── Material para compartir ─────────────────────────────────── */}
      <section className="dcba-card" aria-labelledby="dcba-share-title">
        <h2 className="dcba-card__title" id="dcba-share-title">
          {t("barber.afiliados.share.title")}
        </h2>
        <p className="dcba-card__sub">{t("barber.afiliados.share.body")}</p>

        <div className="dcba-sharegrid">
          <div className="dcba-field">
            <label className="dcba-label" htmlFor="dcba-sharetext">
              {t("barber.afiliados.share.textLabel")}
            </label>
            <textarea
              id="dcba-sharetext"
              className="dcba-sharetext"
              value={shareText}
              readOnly
              rows={5}
            />
            <div className="dcba-actions" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="dcba-btn"
                onClick={() => copy(shareText, "text")}
                disabled={!shareText}
              >
                {copied === "text" ? (
                  <CheckCircle2 size={15} aria-hidden />
                ) : (
                  <Copy size={15} aria-hidden />
                )}
                {copied === "text"
                  ? t("barber.afiliados.share.copied")
                  : t("barber.afiliados.share.copyText")}
              </button>
              <a
                className="dcba-btn dcba-btn--primary"
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!shareText}
              >
                <MessageCircle size={15} aria-hidden />
                {t("barber.afiliados.share.sendWhatsapp")}
              </a>
            </div>
          </div>

          <div className="dcba-field">
            <span className="dcba-label">{t("barber.afiliados.share.imageLabel")}</span>
            <p className="dcba-stat__help" style={{ marginTop: 0, marginBottom: 8 }}>
              {t("barber.afiliados.share.imageBody")}
            </p>
            {url && summary.referralCode ? (
              <BarberShareCard
                url={url}
                shopName={summary.shopName}
                code={summary.referralCode}
                headline={t("barber.afiliados.share.cardHeadline")}
                sub={t("barber.afiliados.share.cardSub", { shop: summary.shopName })}
                cta={t("barber.afiliados.share.cardCta")}
                altText={t("barber.afiliados.share.imageAlt", { shop: summary.shopName })}
                downloadLabel={t("barber.afiliados.share.downloadImage")}
              />
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Barberías recomendadas ──────────────────────────────────── */}
      <section className="dcba-card" aria-labelledby="dcba-refs-title">
        <h2 className="dcba-card__title" id="dcba-refs-title">
          {t("barber.afiliados.referrals.title")}
        </h2>
        {summary.referrals.length === 0 ? (
          <p className="dcba-empty">{t("barber.afiliados.referrals.empty")}</p>
        ) : (
          <div className="dcba-tablewrap">
            <table className="dcba-table">
              <thead>
                <tr>
                  <th scope="col">{t("barber.afiliados.referrals.colName")}</th>
                  <th scope="col">{t("barber.afiliados.referrals.colStatus")}</th>
                  <th scope="col">{t("barber.afiliados.referrals.colSignedUp")}</th>
                  <th scope="col">{t("barber.afiliados.referrals.colFirstPaid")}</th>
                  <th scope="col" className="dcba-num">
                    {t("barber.afiliados.referrals.colEarned")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.referrals.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {r.city ? <span className="dcba-cellsub">{r.city}</span> : null}
                    </td>
                    <td>
                      <span className={`dcba-badge ${REFERRAL_BADGE[r.status]}`}>
                        {t(`barber.afiliados.referrals.status${r.status}`)}
                      </span>
                    </td>
                    <td>{formatBarberDate(r.signedUpAt, locale)}</td>
                    <td>
                      {r.firstPaidAt
                        ? formatBarberDate(r.firstPaidAt, locale)
                        : t("barber.afiliados.referrals.notYet")}
                    </td>
                    <td className="dcba-num">{formatBarberMoney(r.earned, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Comisiones ──────────────────────────────────────────────── */}
      <section className="dcba-card" aria-labelledby="dcba-comm-title">
        <h2 className="dcba-card__title" id="dcba-comm-title">
          {t("barber.afiliados.commissions.title")}
        </h2>
        {summary.commissions.length === 0 ? (
          <p className="dcba-empty">{t("barber.afiliados.commissions.empty")}</p>
        ) : (
          <div className="dcba-tablewrap">
            <table className="dcba-table">
              <thead>
                <tr>
                  <th scope="col">{t("barber.afiliados.commissions.colReferred")}</th>
                  <th scope="col">{t("barber.afiliados.commissions.colPeriod")}</th>
                  <th scope="col">{t("barber.afiliados.commissions.colStatus")}</th>
                  <th scope="col" className="dcba-num">
                    {t("barber.afiliados.commissions.colAmount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.commissions.map((c) => (
                  <tr key={c.id}>
                    <td>{c.referredName}</td>
                    <td>
                      {c.periodKey === "signup"
                        ? t("barber.afiliados.commissions.periodSignup")
                        : c.periodKey}
                    </td>
                    <td>
                      <span className={`dcba-badge ${COMMISSION_BADGE[c.status]}`}>
                        {t(`barber.afiliados.commissions.status${c.status}`)}
                      </span>
                      {c.status === "PENDING" ? (
                        <span className="dcba-cellsub">
                          {t("barber.afiliados.commissions.availableOn", {
                            date: formatBarberDate(c.availableAt, locale),
                          })}
                        </span>
                      ) : null}
                      {c.status === "PAID" ? (
                        <span className="dcba-cellsub">
                          {t("barber.afiliados.commissions.paidOn", {
                            date: formatBarberDate(c.paidAt, locale),
                          })}
                          {c.payoutRef
                            ? ` · ${t("barber.afiliados.commissions.ref", { ref: c.payoutRef })}`
                            : ""}
                          {c.payoutProofUrl ? (
                            <>
                              {" · "}
                              <a
                                className="dcba-link-inline"
                                href={c.payoutProofUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {t("barber.afiliados.commissions.proof")}
                              </a>
                            </>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                    <td className="dcba-num">{formatBarberMoney(c.amount, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PayoutForm t={t} summary={summary} onSaved={setSummary} />
      <IncomingCard t={t} summary={summary} onClaimed={refresh} />
    </div>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────

type T = TFunction;

function Header({ t }: { t: T }) {
  return (
    <header className="dcba-header">
      <h1 className="dcba-title">{t("barber.afiliados.title")}</h1>
      <p className="dcba-subtitle">{t("barber.afiliados.subtitle")}</p>
    </header>
  );
}

function Stat({
  label,
  value,
  help,
  brand,
}: {
  label: string;
  value: string;
  help: string;
  brand?: boolean;
}) {
  return (
    <div className={`dcba-stat${brand ? " dcba-stat--brand" : ""}`}>
      <p className="dcba-stat__label">{label}</p>
      <p className="dcba-stat__value">{value}</p>
      <p className="dcba-stat__help">{help}</p>
    </div>
  );
}

function Rule({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="dcba-rule">
      {icon}
      <div>
        <p className="dcba-rule__title">{title}</p>
        <p className="dcba-rule__body">{body}</p>
      </div>
    </li>
  );
}

function PayoutForm({
  t,
  summary,
  onSaved,
}: {
  t: T;
  summary: BarberAffiliateSummaryDTO;
  onSaved: (s: BarberAffiliateSummaryDTO) => void;
}) {
  const [method, setMethod] = useState(summary.payout.method ?? "");
  const [details, setDetails] = useState(summary.payout.details ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const { ok, data } = await postJson("/api/barber/affiliates/payout", { method, details });
    setBusy(false);
    if (ok && data.summary) {
      onSaved(data.summary as BarberAffiliateSummaryDTO);
      setMsg(t("barber.afiliados.payout.saved"));
    } else {
      setMsg(
        typeof data.error === "string" ? data.error : t("barber.afiliados.payout.error"),
      );
    }
    window.setTimeout(() => setMsg(null), 4000);
  }

  return (
    <section className="dcba-card" aria-labelledby="dcba-payout-title">
      <h2 className="dcba-card__title" id="dcba-payout-title">
        {t("barber.afiliados.payout.title")}
      </h2>
      <p className="dcba-card__sub">{t("barber.afiliados.payout.body")}</p>
      <form className="dcba-form dcba-form--two" onSubmit={save}>
        <div className="dcba-field">
          <label className="dcba-label" htmlFor="dcba-method">
            {t("barber.afiliados.payout.method")}
          </label>
          <input
            id="dcba-method"
            className="dcba-input"
            value={method}
            maxLength={80}
            placeholder={t("barber.afiliados.payout.methodPlaceholder")}
            onChange={(e) => setMethod(e.target.value)}
          />
        </div>
        <div className="dcba-field">
          <label className="dcba-label" htmlFor="dcba-details">
            {t("barber.afiliados.payout.details")}
          </label>
          <input
            id="dcba-details"
            className="dcba-input"
            value={details}
            maxLength={240}
            placeholder={t("barber.afiliados.payout.detailsPlaceholder")}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
        <button type="submit" className="dcba-btn dcba-btn--primary" disabled={busy}>
          {busy ? <Loader2 size={15} className="dcba-spin" aria-hidden /> : null}
          {busy ? t("barber.afiliados.payout.saving") : t("barber.afiliados.payout.save")}
        </button>
      </form>
      <p className="dcba-sr" role="status" aria-live="polite">
        {msg ?? ""}
      </p>
      {msg ? <p className="dcba-note">{msg}</p> : null}
    </section>
  );
}

function IncomingCard({
  t,
  summary,
  onClaimed,
}: {
  t: T;
  summary: BarberAffiliateSummaryDTO;
  onClaimed: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (summary.incoming.referredByName) {
    return (
      <div className="dcba-alert dcba-alert--ok">
        <Handshake size={18} className="dcba-alert__icon" aria-hidden />
        <div>
          <p className="dcba-alert__title">{t("barber.afiliados.claim.referredByTitle")}</p>
          <p className="dcba-alert__body">
            {t("barber.afiliados.claim.referredBy", { shop: summary.incoming.referredByName })}
          </p>
        </div>
      </div>
    );
  }

  if (!summary.incoming.canClaim) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const { data } = await postJson("/api/barber/affiliates/claim", { code });
    setBusy(false);
    setMsg(
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : t("barber.afiliados.errors.generic"),
    );
    if (data.ok) {
      setCode("");
      onClaimed();
    }
  }

  return (
    <section className="dcba-card" aria-labelledby="dcba-claim-title">
      <h2 className="dcba-card__title" id="dcba-claim-title">
        {t("barber.afiliados.claim.title")}
      </h2>
      <p className="dcba-card__sub">{t("barber.afiliados.claim.body")}</p>
      <form className="dcba-form dcba-form--one" onSubmit={submit}>
        <div className="dcba-field">
          <label className="dcba-label" htmlFor="dcba-claimcode">
            {t("barber.afiliados.claim.placeholder")}
          </label>
          <input
            id="dcba-claimcode"
            className="dcba-input dcba-input--code"
            value={code}
            maxLength={8}
            autoComplete="off"
            placeholder={t("barber.afiliados.claim.placeholder")}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <button
          type="submit"
          className="dcba-btn dcba-btn--primary"
          disabled={busy || code.trim().length !== 8}
        >
          {busy ? <Loader2 size={15} className="dcba-spin" aria-hidden /> : null}
          {busy ? t("barber.afiliados.claim.submitting") : t("barber.afiliados.claim.submit")}
        </button>
      </form>
      {msg ? (
        <p className="dcba-note" role="status" aria-live="polite">
          <Info size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
          {msg}
        </p>
      ) : null}
    </section>
  );
}
