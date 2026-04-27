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
        const t = await res.text().catch(() => "");
        throw new Error(t || "Error al guardar");
      }
      toast.success("Credenciales WhatsApp guardadas");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingTwilio(false);
    }
  }, [twilioSid, twilioToken, twilioNumber]);

  const saveEmail = useCallback(async () => {
    setSavingEmail(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postmarkInboundEmail: postmarkEmail || null }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || "Error al guardar");
      }
      toast.success("Dirección de correo guardada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingEmail(false);
    }
  }, [postmarkEmail]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard/settings" className={styles.backLink}>
          <ArrowLeft size={14} aria-hidden /> Configuración
        </Link>
        <h1 className={styles.title}>Integraciones</h1>
        <p className={styles.subtitle}>
          Conecta los servicios externos que alimentan el inbox unificado y el
          asistente clínico de IA. Cada clínica tiene credenciales propias —
          un número de WhatsApp, un correo entrante.
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
                Vía Twilio Conversations. Las pacientes te escriben a un solo
                número de la clínica y el inbox unificado lo enruta al staff.
              </p>
            </div>
            <StatusBadge status={twilioStatus} />
          </div>

          <div className={styles.cardBody}>
            <Field
              label="Twilio Account SID"
              hint="Identificador de tu cuenta Twilio (empieza con AC…)"
              value={twilioSid}
              onChange={setTwilioSid}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <Field
              label="Twilio Auth Token"
              hint="Mantenlo privado — nunca lo compartas en chats o screenshots."
              value={twilioToken}
              onChange={setTwilioToken}
              placeholder="••••••••••••••••••••••••••••••••"
              type={showToken ? "text" : "password"}
              suffix={
                <button
                  type="button"
                  className={styles.fieldSuffixBtn}
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                >
                  {showToken ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                </button>
              }
            />
            <Field
              label="Número WhatsApp (E.164)"
              hint="Formato internacional con +. Ejemplo: +5215512345678"
              value={twilioNumber}
              onChange={setTwilioNumber}
              placeholder="+5215512345678"
            />
            <div className={styles.webhookBlock}>
              <span className={styles.webhookLabel}>Webhook a configurar en Twilio</span>
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
              {savingTwilio ? "Guardando…" : "Guardar credenciales"}
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
              <h2 className={styles.cardTitle}>Email entrante</h2>
              <p className={styles.cardDesc}>
                Vía Postmark Inbound Parse. La clínica recibe correos en una
                dirección dedicada y aparecen como threads en el inbox.
              </p>
            </div>
            <StatusBadge status={emailStatus} />
          </div>

          <div className={styles.cardBody}>
            <Field
              label="Dirección entrante de la clínica"
              hint="Ejemplo: clinica-aurora@inbox.mediflow.app"
              value={postmarkEmail}
              onChange={setPostmarkEmail}
              placeholder="clinica-xxx@inbox.mediflow.app"
            />
            <div className={styles.webhookBlock}>
              <span className={styles.webhookLabel}>Webhook a configurar en Postmark</span>
              <code className={styles.webhookUrl}>
                https://&lt;tu-dominio&gt;/api/webhooks/postmark/inbound
              </code>
            </div>
            <div className={styles.envCheckRow}>
              <span className={styles.envCheckLabel}>POSTMARK_INBOUND_SECRET</span>
              {serverStatus.postmarkInbound ? (
                <span className={styles.envCheckOk}>
                  <CheckCircle2 size={11} aria-hidden /> configurado
                </span>
              ) : (
                <span className={styles.envCheckOff}>
                  <XCircle size={11} aria-hidden /> no configurado
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
              {savingEmail ? "Guardando…" : "Guardar dirección"}
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
              <h2 className={styles.cardTitle}>Asistente clínico (Claude)</h2>
              <p className={styles.cardDesc}>
                Anthropic Claude potencia el asistente clínico, audio-to-SOAP
                y análisis de radiografías. Configurada por administrador a
                nivel plataforma.
              </p>
            </div>
            <StatusBadge status={aiStatus} />
          </div>

          <div className={styles.cardBody}>
            <div className={styles.envCheckRow}>
              <span className={styles.envCheckLabel}>ANTHROPIC_API_KEY</span>
              {serverStatus.anthropic ? (
                <span className={styles.envCheckOk}>
                  <CheckCircle2 size={11} aria-hidden /> configurada en servidor
                </span>
              ) : (
                <span className={styles.envCheckOff}>
                  <XCircle size={11} aria-hidden /> falta — configúrala en Vercel
                </span>
              )}
            </div>
            <p className={styles.cardNote}>
              Esta integración es a nivel plataforma, no por clínica. Para
              activarla añade <code>ANTHROPIC_API_KEY</code> en las env vars
              del proyecto y haz un redeploy.
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
              <h2 className={styles.cardTitle}>Transcripción de voz (Whisper)</h2>
              <p className={styles.cardDesc}>
                OpenAI Whisper transcribe audio a texto para voice input del
                asistente y para crear notas SOAP automáticamente desde
                grabaciones de consulta.
              </p>
            </div>
            <StatusBadge status={sttStatus} />
          </div>

          <div className={styles.cardBody}>
            <div className={styles.envCheckRow}>
              <span className={styles.envCheckLabel}>OPENAI_API_KEY</span>
              {serverStatus.openai ? (
                <span className={styles.envCheckOk}>
                  <CheckCircle2 size={11} aria-hidden /> configurada en servidor
                </span>
              ) : (
                <span className={styles.envCheckOff}>
                  <XCircle size={11} aria-hidden /> falta — configúrala en Vercel
                </span>
              )}
            </div>
            <p className={styles.cardNote}>
              Mientras no esté configurada, audio-to-SOAP devolverá un mock y
              el voice input estará deshabilitado.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "ok") {
    return (
      <span className={`${styles.statusBadge} ${styles.statusOk}`}>
        <CheckCircle2 size={11} aria-hidden /> Activa
      </span>
    );
  }
  if (status === "warn") {
    return (
      <span className={`${styles.statusBadge} ${styles.statusWarn}`}>
        <AlertTriangle size={11} aria-hidden /> Incompleta
      </span>
    );
  }
  return (
    <span className={`${styles.statusBadge} ${styles.statusOff}`}>
      <XCircle size={11} aria-hidden /> Desactivada
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
