"use client";

import { useState } from "react";
import {
  MessageCircle, CheckCircle, ExternalLink, Eye, EyeOff,
} from "lucide-react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
    if (!form.phoneNumberId || !form.accessToken) { toast.error("Completa ambos campos"); return; }
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
      toast.success(`WhatsApp conectado${data.displayName ? ` — ${data.displayName}` : ""}`);
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  async function disconnect() {
    if (!(await askConfirm({
      title: "¿Desconectar WhatsApp?",
      description: "Se desactivarán los recordatorios automáticos. Puedes reconectar en cualquier momento.",
      variant: "warning",
      confirmText: "Desconectar",
    }))) return;
    setLoading(true);
    try {
      await fetch("/api/whatsapp/connect", { method: "DELETE" });
      setConnected(false);
      setStep("intro");
      toast.success("WhatsApp desconectado");
    } catch { toast.error("Error"); } finally { setLoading(false); }
  }

  async function saveSettings() {
    setSavingMsg(true);
    try {
      await fetch("/api/clinic", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waReminderMsg: msg, waReminder24h: r24h, waReminder1h: r1h }),
      });
      toast.success("Configuración guardada");
    } catch { toast.error("Error"); } finally { setSavingMsg(false); }
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
              Recordatorios automáticos y mensajería con pacientes
            </p>
          </div>
        </div>
        <BadgeNew tone={connected ? "success" : "danger"} dot>
          {connected ? "Conectado" : "Desconectado"}
        </BadgeNew>
      </div>

      {/* INTRO */}
      {step === "intro" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
          <CardNew title="¿Cómo funciona?" sub="Conexión con Meta WhatsApp Business Cloud API">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { n: "1", t: "Crea una cuenta en Meta for Developers", d: "Necesitas una cuenta de Facebook Business y configurar la API de WhatsApp Cloud." },
                { n: "2", t: "Obtén tu Phone Number ID y Access Token", d: "En tu aplicación de Meta, ve a WhatsApp → Configuration y copia ambos valores." },
                { n: "3", t: "Conéctalo aquí", d: "Pega los valores abajo y MediFlow enviará recordatorios automáticos." },
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{s.t}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 11, fontWeight: 600, color: "#c4b5fd", textDecoration: "none" }}
            >
              Ver guía oficial de Meta <ExternalLink size={12} />
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
            <strong>Requisitos:</strong> Número de teléfono dedicado para WhatsApp Business (no puede ser tu número personal si ya lo usas). Meta otorga 1,000 conversaciones gratis al mes.
          </div>

          <ButtonNew variant="primary" onClick={() => setStep("config")}>
            Configurar WhatsApp →
          </ButtonNew>
        </div>
      )}

      {/* CONFIG */}
      {step === "config" && (
        <div style={{ maxWidth: 720 }}>
          <CardNew title="Conectar WhatsApp Business API">
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
                  Meta → Tu app → WhatsApp → Configuration → Phone Number ID
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
                  Meta → Tu app → WhatsApp → Configuration → Temporary Access Token
                </p>
              </div>

              <div style={{
                background: "var(--info-soft)",
                border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 8, padding: 12,
                fontSize: 11, color: "#93c5fd",
              }}>
                <strong>Nota:</strong> El Access Token temporal expira en 24h. Para producción, genera un token permanente siguiendo la guía de Meta.
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <ButtonNew variant="ghost" onClick={() => setStep("intro")}>← Atrás</ButtonNew>
                <ButtonNew variant="primary" onClick={connect} disabled={loading}>
                  {loading ? "Verificando…" : "Conectar WhatsApp"}
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
            <CardNew title="Cuándo enviar recordatorios" sub="Automático al crear una cita">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {([
                  { key: "24h", label: "24 horas antes de la cita", desc: "El recordatorio principal — muy recomendado", val: r24h, set: setR24h },
                  { key: "1h",  label: "1 hora antes de la cita",   desc: "Recordatorio de último momento",             val: r1h,  set: setR1h  },
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
                      aria-label={opt.label}
                      onClick={() => opt.set(!opt.val)}
                      className={`switch ${opt.val ? "switch--on" : ""}`}
                    >
                      <span className="switch__thumb" />
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{opt.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardNew>

            <CardNew
              title="Mensaje del recordatorio"
              sub="Variables: {nombre}, {fecha}, {hora}, {doctor}"
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
                Restablecer mensaje por defecto
              </button>

              <div style={{
                marginTop: 14,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: 12,
              }}>
                <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Vista previa
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
                    .replace("{fecha}", "lunes 28 de abril")
                    .replace("{hora}", "10:00")
                    .replace("{doctor}", "García")}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <ButtonNew variant="primary" onClick={saveSettings} disabled={savingMsg}>
                  {savingMsg ? "Guardando…" : "Guardar configuración"}
                </ButtonNew>
                <ButtonNew variant="danger" onClick={disconnect} disabled={loading}>
                  Desconectar
                </ButtonNew>
              </div>
            </CardNew>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <CardNew title="Estado" sub="Conexión WhatsApp">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} style={{ color: "var(--success)" }} />
                  <span style={{ fontSize: 12, color: "var(--text-1)" }}>Webhook recibiendo eventos</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} style={{ color: "var(--success)" }} />
                  <span style={{ fontSize: 12, color: "var(--text-1)" }}>
                    Phone Number ID: <span className="mono">{form.phoneNumberId || "—"}</span>
                  </span>
                </div>
              </div>
            </CardNew>

            <CardNew title="¿Cómo se envían?" sub="Envíos automáticos y manuales">
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
                Los recordatorios se envían automáticamente cuando agendas una cita. También puedes enviar uno manualmente desde la
                <strong style={{ color: "var(--text-1)" }}> Agenda</strong> haciendo clic en el ícono de WhatsApp junto a cada cita.
              </div>
            </CardNew>
          </div>
        </div>
      )}
    </div>
  );
}
