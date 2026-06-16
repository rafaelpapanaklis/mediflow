"use client";

import { useState } from "react";
import {
  MessageCircle, CheckCircle, ExternalLink, Eye, EyeOff, Bot,
} from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import { EmbeddedSignupButton } from "./embedded-signup-button";

interface Props {
  connected:     boolean;
  phoneNumberId: string;
  reminderMsg:   string;
  reminder24h:   boolean;
  reminder1h:    boolean;
  clinicName:    string;
}

export function WhatsAppClient({
  connected: initConnected, phoneNumberId: initPhone,
  reminderMsg: initMsg, reminder24h: init24h, reminder1h: init1h, clinicName,
}: Props) {
  const t = useT();
  const router = useRouter();
  const askConfirm = useConfirm();
  const [connected,  setConnected]  = useState(initConnected);
  const [step,       setStep]       = useState<"intro" | "config" | "done">(initConnected ? "done" : "intro");
  const [loading,    setLoading]    = useState(false);
  const [showToken,  setShowToken]  = useState(false);
  const [form,       setForm]       = useState({ phoneNumberId: initPhone, accessToken: "" });
  const defaultMsg = `Hola {nombre} 👋, te recordamos tu cita en *${clinicName}* el *{fecha}* a las *{hora}h*.\n\nDr/a. {doctor}\n\n_Responde este mensaje si necesitas cambiarla._`;
  const [msg,        setMsg]        = useState(initMsg || defaultMsg);
  const [r24h,       setR24h]       = useState(init24h);
  const [r1h,        setR1h]        = useState(init1h);
  const [savingMsg,  setSavingMsg]  = useState(false);

  async function connect() {
    if (!form.phoneNumberId || !form.accessToken) { toast.error(t("inbox.whatsapp.fillBothFields")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId: form.phoneNumberId, accessToken: form.accessToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConnected(true);
      setStep("done");
      toast.success(`${t("inbox.whatsapp.connectedToast")}${data.displayName ? ` — ${data.displayName}` : ""}`);
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  async function disconnect() {
    if (!(await askConfirm({
      title: t("inbox.whatsapp.disconnectConfirmTitle"),
      description: t("inbox.whatsapp.disconnectConfirmDesc"),
      variant: "warning",
      confirmText: t("inbox.whatsapp.disconnect"),
    }))) return;
    setLoading(true);
    try {
      await fetch("/api/whatsapp/connect", { method: "DELETE" });
      setConnected(false);
      setStep("intro");
      toast.success(t("inbox.whatsapp.disconnectedToast"));
    } catch { toast.error(t("common.genericError")); } finally { setLoading(false); }
  }

  async function saveSettings() {
    setSavingMsg(true);
    try {
      await fetch("/api/clinic", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waReminderMsg: msg, waReminder24h: r24h, waReminder1h: r1h }),
      });
      toast.success(t("inbox.whatsapp.settingsSavedToast"));
    } catch { toast.error(t("common.genericError")); } finally { setSavingMsg(false); }
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: "var(--success-soft)",
            border: "1px solid rgba(16,185,129,0.2)",
            display: "grid", placeItems: "center",
          }}>
            <MessageCircle size={20} style={{ color: "#6ee7b7" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
              WhatsApp Business
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
              {t("inbox.whatsapp.subtitle")}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <BadgeNew tone={connected ? "success" : "danger"} dot>
            {connected ? t("inbox.whatsapp.connected") : t("inbox.whatsapp.disconnected")}
          </BadgeNew>
          <ButtonNew variant="secondary" icon={<Bot size={15} />} onClick={() => router.push("/dashboard/whatsapp/bot")}>
            Configurar bot
          </ButtonNew>
        </div>
      </div>

      {/* INTRO */}
      {step === "intro" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
          <CardNew title={t("inbox.whatsapp.howItWorksTitle")} sub={t("inbox.whatsapp.howItWorksSub")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { n: "1", titleKey: "inbox.whatsapp.step1Title", descKey: "inbox.whatsapp.step1Desc" },
                { n: "2", titleKey: "inbox.whatsapp.step2Title", descKey: "inbox.whatsapp.step2Desc" },
                { n: "3", titleKey: "inbox.whatsapp.step3Title", descKey: "inbox.whatsapp.step3Desc" },
              ].map(s => (
                <div key={s.n} style={{ display: "flex", gap: 12 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: "var(--brand)",
                    display: "grid", placeItems: "center",
                    color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0,
                  }}>
                    {s.n}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{t(s.titleKey)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t(s.descKey)}</div>
                  </div>
                </div>
              ))}
            </div>
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 11, fontWeight: 600, color: "#c4b5fd", textDecoration: "none" }}
            >
              {t("inbox.whatsapp.viewMetaGuide")} <ExternalLink size={12} />
            </a>
          </CardNew>

          <div style={{
            background: "var(--warning-soft)",
            border: "1px solid rgba(245,158,11,0.2)",
            borderRadius: "var(--radius)",
            padding: 14,
            fontSize: 12,
            color: "#fcd34d",
          }}>
            <strong>{t("inbox.whatsapp.requirementsLabel")}</strong> {t("inbox.whatsapp.requirementsBody")}
          </div>

          {/* Embedded Signup: la clínica conecta su WhatsApp sola (recomendado).
              Si faltan los envs de Meta el botón no se renderiza y queda el modo manual. */}
          <EmbeddedSignupButton
            onConnected={() => { setConnected(true); setStep("done"); router.refresh(); }}
          />

          <ButtonNew variant="secondary" onClick={() => setStep("config")}>
            {t("inbox.whatsapp.configureCta")}
          </ButtonNew>
        </div>
      )}

      {/* CONFIG */}
      {step === "config" && (
        <div style={{ maxWidth: 720 }}>
          <CardNew title={t("inbox.whatsapp.connectCardTitle")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="field-new">
                <label className="field-new__label">Phone Number ID <span className="req">*</span></label>
                <input
                  className="input-new mono"
                  placeholder="123456789012345"
                  inputMode="numeric"
                  value={form.phoneNumberId}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "");
                    setForm(f => ({ ...f, phoneNumberId: v }));
                  }}
                />
                <p style={{ fontSize: 10, color: "var(--text-4)" }}>
                  {t("inbox.whatsapp.phoneIdHint")}
                </p>
              </div>

              <div className="field-new">
                <label className="field-new__label">Access Token <span className="req">*</span></label>
                <div style={{ position: "relative" }}>
                  <input
                    className="input-new mono"
                    type={showToken ? "text" : "password"}
                    placeholder="EAAxxxxxxxxx…"
                    value={form.accessToken}
                    onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      background: "transparent", border: "none", color: "var(--text-3)", cursor: "pointer",
                    }}
                  >
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p style={{ fontSize: 10, color: "var(--text-4)" }}>
                  {t("inbox.whatsapp.accessTokenHint")}
                </p>
              </div>

              <div style={{
                background: "var(--info-soft)",
                border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 8, padding: 12,
                fontSize: 11, color: "#93c5fd",
              }}>
                <strong>{t("inbox.whatsapp.noteLabel")}</strong> {t("inbox.whatsapp.tokenNote")}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <ButtonNew variant="ghost" onClick={() => setStep("intro")}>{t("inbox.whatsapp.back")}</ButtonNew>
                <ButtonNew variant="primary" onClick={connect} disabled={loading}>
                  {loading ? t("inbox.whatsapp.verifying") : t("inbox.whatsapp.connectButton")}
                </ButtonNew>
              </div>
            </div>
          </CardNew>
        </div>
      )}

      {/* CONNECTED */}
      {step === "done" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, maxWidth: 1200 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <CardNew title={t("inbox.whatsapp.whenToSendTitle")} sub={t("inbox.whatsapp.whenToSendSub")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {([
                  { key: "24h", labelKey: "inbox.whatsapp.reminder24hLabel", descKey: "inbox.whatsapp.reminder24hDesc", val: r24h, set: setR24h },
                  { key: "1h",  labelKey: "inbox.whatsapp.reminder1hLabel",  descKey: "inbox.whatsapp.reminder1hDesc",  val: r1h,  set: setR1h  },
                ] as const).map(opt => (
                  <div
                    key={opt.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: `1px solid ${opt.val ? "rgba(16,185,129,0.25)" : "var(--border-soft)"}`,
                      background: opt.val ? "var(--success-soft)" : "transparent",
                      transition: "all .15s",
                    }}
                  >
                    <button
                      type="button"
                      aria-label={t(opt.labelKey)}
                      onClick={() => opt.set(!opt.val)}
                      className={`switch ${opt.val ? "switch--on" : ""}`}
                    >
                      <span className="switch__thumb" />
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{t(opt.labelKey)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t(opt.descKey)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardNew>

            <CardNew
              title={t("inbox.whatsapp.reminderMessageTitle")}
              sub={t("inbox.whatsapp.reminderMessageVars")}
            >
              <textarea
                className="input-new"
                style={{ height: 120, paddingTop: 10, resize: "vertical" }}
                value={msg}
                onChange={e => setMsg(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setMsg(defaultMsg)}
                style={{
                  background: "transparent", border: "none",
                  color: "var(--text-3)", fontSize: 11, marginTop: 8,
                  cursor: "pointer", textDecoration: "underline",
                }}
              >
                {t("inbox.whatsapp.resetDefaultMessage")}
              </button>

              <div style={{
                marginTop: 14,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: 12,
              }}>
                <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  {t("inbox.whatsapp.preview")}
                </div>
                <div style={{
                  background: "var(--success)",
                  color: "#fff",
                  fontSize: 12,
                  borderRadius: 16,
                  borderTopLeftRadius: 0,
                  padding: "8px 12px",
                  maxWidth: 280,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}>
                  {msg
                    .replace("{nombre}", "María")
                    .replace("{fecha}", t("inbox.whatsapp.previewSampleDate"))
                    .replace("{hora}", "10:00")
                    .replace("{doctor}", "García")}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <ButtonNew variant="primary" onClick={saveSettings} disabled={savingMsg}>
                  {savingMsg ? t("inbox.whatsapp.saving") : t("inbox.whatsapp.saveSettings")}
                </ButtonNew>
                <ButtonNew variant="danger" onClick={disconnect} disabled={loading}>
                  {t("inbox.whatsapp.disconnect")}
                </ButtonNew>
              </div>
            </CardNew>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <CardNew title={t("common.status")} sub={t("inbox.whatsapp.statusSub")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} style={{ color: "var(--success)" }} />
                  <span style={{ fontSize: 12, color: "var(--text-1)" }}>{t("inbox.whatsapp.webhookReceiving")}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} style={{ color: "var(--success)" }} />
                  <span style={{ fontSize: 12, color: "var(--text-1)" }}>
                    Phone Number ID: <span className="mono">{form.phoneNumberId || "—"}</span>
                  </span>
                </div>
              </div>
            </CardNew>

            <CardNew title={t("inbox.whatsapp.howSentTitle")} sub={t("inbox.whatsapp.howSentSub")}>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
                {t("inbox.whatsapp.howSentBodyBefore")}
                <strong style={{ color: "var(--text-1)" }}> {t("inbox.whatsapp.howSentAgenda")}</strong> {t("inbox.whatsapp.howSentBodyAfter")}
              </div>
            </CardNew>
          </div>
        </div>
      )}
    </div>
  );
}
