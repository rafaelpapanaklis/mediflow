"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MessageCircle,
  Mail,
  Sparkles,
  Mic,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import styles from "./integrations.module.css";

type Status = "ok" | "warn" | "off";

interface ClinicCreds {
  id: string;
  name: string;
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
  twilioWhatsappNumber: string | null;
  postmarkInboundEmail: string | null;
}

interface ServerStatus {
  anthropic: boolean;
  openai: boolean;
  postmarkInbound: boolean;
}

export function IntegrationsClient({
  clinic,
  serverStatus,
}: {
  clinic: ClinicCreds;
  serverStatus: ServerStatus;
}) {
  const t = useT();
  const [twilioSid, setTwilioSid] = useState(clinic.twilioAccountSid ?? "");
  const [twilioToken, setTwilioToken] = useState(clinic.twilioAuthToken ?? "");
  const [twilioNumber, setTwilioNumber] = useState(clinic.twilioWhatsappNumber ?? "");
  const [showToken, setShowToken] = useState(false);
  const [postmarkEmail, setPostmarkEmail] = useState(clinic.postmarkInboundEmail ?? "");
  const [savingTwilio, setSavingTwilio] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);

  const twilioStatus: Status = useMemo(() => {
    if (twilioSid && twilioToken && twilioNumber) return "ok";
    if (twilioSid || twilioToken || twilioNumber) return "warn";
    return "off";
  }, [twilioSid, twilioToken, twilioNumber]);

  const emailStatus: Status = useMemo(() => {
    if (postmarkEmail && serverStatus.postmarkInbound) return "ok";
    if (postmarkEmail || serverStatus.postmarkInbound) return "warn";
    return "off";
  }, [postmarkEmail, serverStatus.postmarkInbound]);

  const aiStatus: Status = serverStatus.anthropic ? "ok" : "off";
  const sttStatus: Status = serverStatus.openai ? "ok" : "off";

  const saveTwilio = useCallback(async () => {
    setSavingTwilio(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          twilioAccountSid: twilioSid || null,
          twilioAuthToken: twilioToken || null,
          twilioWhatsappNumber: twilioNumber || null,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || t("settings.integrations.saveError"));
      }
      toast.success(t("settings.integrations.twilioSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.integrations.saveError"));
    } finally {
      setSavingTwilio(false);
    }
  }, [twilioSid, twilioToken, twilioNumber, t]);

  const saveEmail = useCallback(async () => {
    setSavingEmail(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postmarkInboundEmail: postmarkEmail || null }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || t("settings.integrations.saveError"));
      }
      toast.success(t("settings.integrations.emailSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.integrations.saveError"));
    } finally {
      setSavingEmail(false);
    }
  }, [postmarkEmail, t]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard/settings" className={styles.backLink}>
          <ArrowLeft size={14} aria-hidden /> {t("settings.integrations.backToSettings")}
        </Link>
        <h1 className={styles.title}>{t("settings.integrations.title")}</h1>
        <p className={styles.subtitle}>
          {t("settings.integrations.subtitle")}
        </p>
      </header>

      <div className={styles.grid}>
        {/* ─── WhatsApp / Twilio ─── */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon} data-tone="green">
              <MessageCircle size={18} aria-hidden />
            </div>
            <div className={styles.cardHeaderInfo}>
              <h2 className={styles.cardTitle}>WhatsApp Business</h2>
              <p className={styles.cardDesc}>
                {t("settings.integrations.twilioDesc")}
              </p>
            </div>
            <StatusBadge status={twilioStatus} />
          </div>

          <div className={styles.cardBody}>
            <Field
              label="Twilio Account SID"
              hint={t("settings.integrations.twilioSidHint")}
              value={twilioSid}
              onChange={setTwilioSid}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <Field
              label="Twilio Auth Token"
              hint={t("settings.integrations.twilioTokenHint")}
              value={twilioToken}
              onChange={setTwilioToken}
              placeholder="••••••••••••••••••••••••••••••••"
              type={showToken ? "text" : "password"}
              suffix={
                <button
                  type="button"
                  className={styles.fieldSuffixBtn}
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? t("settings.integrations.hideToken") : t("settings.integrations.showToken")}
                >
                  {showToken ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                </button>
              }
            />
            <Field
              label={t("settings.integrations.whatsappNumberLabel")}
              hint={t("settings.integrations.whatsappNumberHint")}
              value={twilioNumber}
              onChange={setTwilioNumber}
              placeholder="+5215512345678"
            />
            <div className={styles.webhookBlock}>
              <span className={styles.webhookLabel}>{t("settings.integrations.webhookTwilio")}</span>
              <code className={styles.webhookUrl}>
                https://&lt;tu-dominio&gt;/api/webhooks/twilio/whatsapp
              </code>
            </div>
          </div>

          <footer className={styles.cardFooter}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={saveTwilio}
              disabled={savingTwilio}
            >
              <Save size={12} aria-hidden />
              {savingTwilio ? t("common.saving") : t("settings.integrations.saveCredentials")}
            </button>
          </footer>
        </section>

        {/* ─── Email / Postmark ─── */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon} data-tone="blue">
              <Mail size={18} aria-hidden />
            </div>
            <div className={styles.cardHeaderInfo}>
              <h2 className={styles.cardTitle}>{t("settings.integrations.emailTitle")}</h2>
              <p className={styles.cardDesc}>
                {t("settings.integrations.emailDesc")}
              </p>
            </div>
            <StatusBadge status={emailStatus} />
          </div>

          <div className={styles.cardBody}>
            <Field
              label={t("settings.integrations.inboundAddressLabel")}
              hint={t("settings.integrations.inboundAddressHint")}
              value={postmarkEmail}
              onChange={setPostmarkEmail}
              placeholder="clinica-xxx@inbox.mediflow.app"
            />
            <div className={styles.webhookBlock}>
              <span className={styles.webhookLabel}>{t("settings.integrations.webhookPostmark")}</span>
              <code className={styles.webhookUrl}>
                https://&lt;tu-dominio&gt;/api/webhooks/postmark/inbound
              </code>
            </div>
            <div className={styles.envCheckRow}>
              <span className={styles.envCheckLabel}>POSTMARK_INBOUND_SECRET</span>
              {serverStatus.postmarkInbound ? (
                <span className={styles.envCheckOk}>
                  <CheckCircle2 size={11} aria-hidden /> {t("settings.integrations.configured")}
                </span>
              ) : (
                <span className={styles.envCheckOff}>
                  <XCircle size={11} aria-hidden /> {t("settings.integrations.notConfigured")}
                </span>
              )}
            </div>
          </div>

          <footer className={styles.cardFooter}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={saveEmail}
              disabled={savingEmail}
            >
              <Save size={12} aria-hidden />
              {savingEmail ? t("common.saving") : t("settings.integrations.saveAddress")}
            </button>
          </footer>
        </section>

        {/* ─── Anthropic Claude ─── */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon} data-tone="purple">
              <Sparkles size={18} aria-hidden />
            </div>
            <div className={styles.cardHeaderInfo}>
              <h2 className={styles.cardTitle}>{t("settings.integrations.aiTitle")}</h2>
              <p className={styles.cardDesc}>
                {t("settings.integrations.aiDesc")}
              </p>
            </div>
            <StatusBadge status={aiStatus} />
          </div>

          <div className={styles.cardBody}>
            <div className={styles.envCheckRow}>
              <span className={styles.envCheckLabel}>ANTHROPIC_API_KEY</span>
              {serverStatus.anthropic ? (
                <span className={styles.envCheckOk}>
                  <CheckCircle2 size={11} aria-hidden /> {t("settings.integrations.configuredOnServer")}
                </span>
              ) : (
                <span className={styles.envCheckOff}>
                  <XCircle size={11} aria-hidden /> {t("settings.integrations.missingConfigureVercel")}
                </span>
              )}
            </div>
            <p className={styles.cardNote}>
              {t("settings.integrations.aiNotePrefix")}{" "}
              <code>ANTHROPIC_API_KEY</code> {t("settings.integrations.aiNoteSuffix")}
            </p>
          </div>
        </section>

        {/* ─── OpenAI Whisper ─── */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon} data-tone="orange">
              <Mic size={18} aria-hidden />
            </div>
            <div className={styles.cardHeaderInfo}>
              <h2 className={styles.cardTitle}>{t("settings.integrations.sttTitle")}</h2>
              <p className={styles.cardDesc}>
                {t("settings.integrations.sttDesc")}
              </p>
            </div>
            <StatusBadge status={sttStatus} />
          </div>

          <div className={styles.cardBody}>
            <div className={styles.envCheckRow}>
              <span className={styles.envCheckLabel}>OPENAI_API_KEY</span>
              {serverStatus.openai ? (
                <span className={styles.envCheckOk}>
                  <CheckCircle2 size={11} aria-hidden /> {t("settings.integrations.configuredOnServer")}
                </span>
              ) : (
                <span className={styles.envCheckOff}>
                  <XCircle size={11} aria-hidden /> {t("settings.integrations.missingConfigureVercel")}
                </span>
              )}
            </div>
            <p className={styles.cardNote}>
              {t("settings.integrations.sttNote")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const t = useT();
  if (status === "ok") {
    return (
      <span className={`${styles.statusBadge} ${styles.statusOk}`}>
        <CheckCircle2 size={11} aria-hidden /> {t("settings.integrations.statusActive")}
      </span>
    );
  }
  if (status === "warn") {
    return (
      <span className={`${styles.statusBadge} ${styles.statusWarn}`}>
        <AlertTriangle size={11} aria-hidden /> {t("settings.integrations.statusIncomplete")}
      </span>
    );
  }
  return (
    <span className={`${styles.statusBadge} ${styles.statusOff}`}>
      <XCircle size={11} aria-hidden /> {t("settings.integrations.statusDisabled")}
    </span>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = "text",
  suffix,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  suffix?: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldInputWrap}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={styles.fieldInput}
          autoComplete="off"
          spellCheck={false}
        />
        {suffix && <div className={styles.fieldSuffix}>{suffix}</div>}
      </div>
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}
