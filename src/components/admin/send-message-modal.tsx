"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { X, Send } from "lucide-react";
import {
  WHATSAPP_TEMPLATES,
  EMAIL_TEMPLATES,
  renderTemplate,
  type TemplateChannel,
} from "@/lib/admin-templates";

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
  const preview = renderTemplate(body, { clinicName, amount, dueDate });
  const previewSubject = renderTemplate(subject, { clinicName, amount, dueDate });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">{title} — {clinicName}</h2>
            <p className="text-xs text-slate-500">Se enviará desde la cuenta oficial de MediFlow.</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {instructions ? (
          <div className="bg-amber-950/40 border border-amber-700 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-bold text-amber-300">Configurar primero</h3>
            <p className="text-xs text-amber-200 whitespace-pre-wrap">{instructions}</p>
            <button onClick={() => setInstructions(null)} className="text-xs font-bold text-amber-300 underline">Volver</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Plantilla</label>
              <select
                value={templateId}
                onChange={e => applyTemplate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Monto {"{{amount}}"}</label>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="99"
                  className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Fecha {"{{dueDate}}"}</label>
                <input
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  placeholder="30 abr"
                  className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
                />
              </div>
            </div>

            {channel === "email" && current?.subject && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">Asunto</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
                />
              </div>
            )}

            <div>
              <label className="text-xs text-slate-400 block mb-1">Mensaje</label>
              <textarea
                rows={6}
                value={body}
                onChange={e => setBody(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 font-mono"
              />
            </div>

            <div className="bg-slate-950 border border-slate-700 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Preview</div>
              {channel === "email" && <div className="text-xs font-bold text-white mb-1">Asunto: {previewSubject}</div>}
              <div className="text-xs text-slate-200 whitespace-pre-wrap">{preview}</div>
            </div>

            <button
              onClick={send}
              disabled={sending || !body.trim()}
              className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold py-2.5 rounded-lg text-sm disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
