"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { X, Send, MessageCircle, Mail } from "lucide-react";
import {
  WHATSAPP_TEMPLATES,
  EMAIL_TEMPLATES,
  renderTemplate,
  type TemplateChannel,
} from "@/lib/admin-templates";
import { ButtonNew } from "@/components/ui/design-system/button-new";

interface Props {
  clinicId: string;
  clinicName: string;
  channel: TemplateChannel;
  onClose: () => void;
}

export function SendMessageModal({ clinicId, clinicName, channel, onClose }: Props) {
  const templates = channel === "whatsapp" ? WHATSAPP_TEMPLATES : EMAIL_TEMPLATES;

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [subject, setSubject]   = useState(templates[0]?.subject ?? "");
  const [body, setBody]         = useState(templates[0]?.body ?? "");
  const [amount, setAmount]     = useState("");
  const [dueDate, setDueDate]   = useState("");
  const [sending, setSending]   = useState(false);
  const [instructions, setInstructions] = useState<string | null>(null);

  const current = useMemo(() => templates.find(t => t.id === templateId), [templates, templateId]);

  function applyTemplate(id: string) {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    setTemplateId(id);
    setSubject(tpl.subject ?? "");
    setBody(tpl.body);
  }

  async function send() {
    setSending(true);
    setInstructions(null);
    try {
      const vars = { clinicName, amount, dueDate };
      const finalBody    = renderTemplate(body, vars);
      const finalSubject = renderTemplate(subject, vars);

      const url = channel === "whatsapp"
        ? `/api/admin/clinics/${clinicId}/send-whatsapp`
        : `/api/admin/clinics/${clinicId}/send-email`;

      const payload: any = channel === "whatsapp"
        ? { message: finalBody }
        : { subject: finalSubject, body: finalBody };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 503) {
        const data = await res.json();
        setInstructions(data.instructions ?? "Configurar primero");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Error al enviar");
      }
      toast.success("Enviado");
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  }

  const title = channel === "whatsapp" ? "Enviar WhatsApp" : "Enviar Email";
  const ChannelIcon = channel === "whatsapp" ? MessageCircle : Mail;
  const preview = renderTemplate(body, { clinicName, amount, dueDate });
  const previewSubject = renderTemplate(subject, { clinicName, amount, dueDate });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "var(--brand-soft)",
              display: "grid", placeItems: "center",
              color: "var(--brand)",
            }}>
              <ChannelIcon size={16} />
            </div>
            <div>
              <div className="modal__title">{title} — {clinicName}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                Se enviará desde la cuenta oficial de MediFlow.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-new btn-new--ghost btn-new--sm"
            aria-label="Cerrar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal__body">
          {instructions ? (
            <div style={{
              padding: 14,
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--warning)", margin: 0 }}>
                Configurar primero
              </h3>
              <p style={{
                fontSize: 12,
                color: "var(--text-2)",
                whiteSpace: "pre-wrap",
                margin: 0,
                lineHeight: 1.6,
              }}>{instructions}</p>
              <button
                type="button"
                onClick={() => setInstructions(null)}
                className="btn-new btn-new--ghost btn-new--sm"
                style={{ alignSelf: "flex-start" }}
              >
                Volver
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Template picker as tags */}
              <div className="field-new">
                <label className="field-new__label">Plantilla</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {templates.map(t => {
                    const active = t.id === templateId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t.id)}
                        className="tag-new"
                        style={active ? {
                          background: "var(--brand-soft)",
                          borderColor: "var(--brand)",
                          color: "var(--brand)",
                        } : undefined}
                        aria-pressed={active}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}>
                <div className="field-new">
                  <label className="field-new__label">Monto {"{{amount}}"}</label>
                  <input
                    className="input-new"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="99"
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Fecha {"{{dueDate}}"}</label>
                  <input
                    className="input-new"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    placeholder="30 abr"
                  />
                </div>
              </div>

              {channel === "email" && current?.subject && (
                <div className="field-new">
                  <label className="field-new__label">Asunto</label>
                  <input
                    className="input-new"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                  />
                </div>
              )}

              <div className="field-new">
                <label className="field-new__label">Mensaje</label>
                <textarea
                  rows={6}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  className="input-new mono"
                  style={{ resize: "vertical", minHeight: 120 }}
                />
              </div>

              <div style={{
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: 12,
              }}>
                <div style={{
                  fontSize: 10,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 600,
                  marginBottom: 6,
                }}>Preview</div>
                {channel === "email" && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>
                    Asunto: {previewSubject}
                  </div>
                )}
                <div style={{
                  fontSize: 12,
                  color: "var(--text-2)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                }}>{preview}</div>
              </div>
            </div>
          )}
        </div>

        {!instructions && (
          <div className="modal__footer">
            <ButtonNew variant="ghost" onClick={onClose}>Cancelar</ButtonNew>
            <ButtonNew
              variant="primary"
              onClick={send}
              disabled={sending || !body.trim()}
              icon={<Send size={14} />}
            >
              {sending ? "Enviando…" : "Enviar"}
            </ButtonNew>
          </div>
        )}
      </div>
    </div>
  );
}
