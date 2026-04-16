"use client";

import { useState } from "react";
import { MessageCircle, CheckCircle, XCircle, ExternalLink, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface Props {
  connected:     boolean;
  phoneNumberId: string;
  reminderMsg:   string;
  reminder24h:   boolean;
  reminder1h:    boolean;
  clinicName:    string;
}

export function WhatsAppClient({ connected: initConnected, phoneNumberId: initPhone, reminderMsg: initMsg, reminder24h: init24h, reminder1h: init1h, clinicName }: Props) {
  const [connected,  setConnected]  = useState(initConnected);
  const [step,       setStep]       = useState<"intro"|"config"|"done">(initConnected ? "done" : "intro");
  const [loading,    setLoading]    = useState(false);
  const [showToken,  setShowToken]  = useState(false);
  const [form,       setForm]       = useState({ phoneNumberId: initPhone, accessToken: "" });
  const [msg,        setMsg]        = useState(initMsg || `Hola {nombre} 👋, te recordamos tu cita en *${clinicName}* el *{fecha}* a las *{hora}h*.\n\nDr/a. {doctor}\n\n_Responde este mensaje si necesitas cambiarla._`);
  const [r24h,       setR24h]       = useState(init24h);
  const [r1h,        setR1h]        = useState(init1h);
  const [savingMsg,  setSavingMsg]  = useState(false);

  async function connect() {
    if (!form.phoneNumberId || !form.accessToken) { toast.error("Completa ambos campos"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId: form.phoneNumberId, accessToken: form.accessToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConnected(true);
      setStep("done");
      toast.success(`✅ WhatsApp conectado${data.displayName ? ` — ${data.displayName}` : ""}`);
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  }

  async function disconnect() {
    if (!confirm("¿Desconectar WhatsApp? Se desactivarán los recordatorios.")) return;
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
      await fetch("/api/clinic", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waReminderMsg: msg, waReminder24h: r24h, waReminder1h: r1h }) });
      toast.success("Configuración guardada");
    } catch { toast.error("Error"); } finally { setSavingMsg(false); }
  }

  const defaultMsg = `Hola {nombre} 👋, te recordamos tu cita en *${clinicName}* el *{fecha}* a las *{hora}h*.\n\nDr/a. {doctor}\n\n_Responde este mensaje si necesitas cambiarla._`;

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold">WhatsApp Recordatorios</h1>
          <p className="text-sm text-muted-foreground">Envía recordatorios automáticos de citas a tus pacientes</p>
        </div>
        {connected && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
            <CheckCircle className="w-3.5 h-3.5" /> Conectado
          </span>
        )}
      </div>

      {/* INTRO */}
      {step === "intro" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-card">
            <h2 className="text-sm font-bold mb-3">¿Cómo funciona?</h2>
            <div className="space-y-3">
              {[
                { n:"1", t:"Crea una cuenta en Meta for Developers", d:"Necesitas una cuenta de Facebook Business y configurar la API de WhatsApp Cloud." },
                { n:"2", t:"Obtén tu Phone Number ID y Access Token", d:"En tu aplicación de Meta, ve a WhatsApp → Configuration y copia ambos valores." },
                { n:"3", t:"Conéctalo aquí", d:"Pega los valores abajo y MediFlow enviará recordatorios automáticos a tus pacientes." },
              ].map(s => (
                <div key={s.n} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">{s.n}</div>
                  <div>
                    <div className="text-sm font-semibold">{s.t}</div>
                    <div className="text-xs text-muted-foreground">{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank"
              className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-brand-600 hover:underline">
              Ver guía oficial de Meta <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            <strong>Requisitos:</strong> Número de teléfono dedicado para WhatsApp Business (no puede ser tu número personal si ya lo usas en WhatsApp). Meta otorga 1,000 conversaciones gratis al mes.
          </div>

          <Button onClick={() => setStep("config")} className="w-full">
            Configurar WhatsApp →
          </Button>
        </div>
      )}

      {/* CONFIG */}
      {step === "config" && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-card space-y-4">
          <h2 className="text-sm font-bold">Conectar WhatsApp Business API</h2>

          <div className="space-y-1.5">
            <Label>Phone Number ID</Label>
            <Input placeholder="Ej: 123456789012345" pattern="[0-9]*" inputMode="numeric"
              value={form.phoneNumberId} onChange={e => {
                const v = e.target.value.replace(/\D/g, "");
                setForm(f => ({ ...f, phoneNumberId: v }));
              }} />
            <p className="text-xs text-muted-foreground">Meta for Developers → Tu app → WhatsApp → Configuration → Phone Number ID</p>
          </div>

          <div className="space-y-1.5">
            <Label>Access Token</Label>
            <div className="relative">
              <Input type={showToken ? "text" : "password"} placeholder="EAAxxxxxxxxx..."
                value={form.accessToken} onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))} />
              <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Meta for Developers → Tu app → WhatsApp → Configuration → Temporary Access Token</p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
            💡 <strong>Nota:</strong> El Access Token temporal expira en 24h. Para producción, genera un token permanente siguiendo la guía de Meta.
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("intro")}>← Atrás</Button>
            <Button onClick={connect} disabled={loading} className="flex-1">
              {loading ? "Verificando…" : "Conectar WhatsApp"}
            </Button>
          </div>
        </div>
      )}

      {/* CONNECTED - Settings */}
      {step === "done" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-card">
            <h2 className="text-sm font-bold mb-4">⏰ Cuándo enviar recordatorios</h2>
            <div className="space-y-3">
              {[
                { key: "24h", label: "24 horas antes de la cita", desc: "El recordatorio principal — muy recomendado", val: r24h, set: setR24h },
                { key: "1h",  label: "1 hora antes de la cita",   desc: "Recordatorio de último momento", val: r1h, set: setR1h },
              ].map(opt => (
                <label key={opt.key} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${opt.val ? "border-emerald-300 bg-emerald-50" : "border-border"}`}>
                  <input type="checkbox" checked={opt.val} onChange={e => opt.set(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5 shadow-card">
            <h2 className="text-sm font-bold mb-2">💬 Mensaje del recordatorio</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Usa <code className="bg-muted px-1 rounded">{"{nombre}"}</code>, <code className="bg-muted px-1 rounded">{"{fecha}"}</code>, <code className="bg-muted px-1 rounded">{"{hora}"}</code>, <code className="bg-muted px-1 rounded">{"{doctor}"}</code> como variables.
            </p>
            <textarea
              className="flex min-h-[120px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              value={msg} onChange={e => setMsg(e.target.value)} />
            <button onClick={() => setMsg(defaultMsg)} className="text-xs text-muted-foreground hover:text-foreground mt-1.5 hover:underline">
              Restablecer mensaje por defecto
            </button>

            {/* Preview */}
            <div className="mt-3 bg-muted border border-border rounded-xl p-3">
              <div className="text-xs font-bold text-muted-foreground mb-2">Vista previa</div>
              <div className="bg-emerald-500 text-white text-xs rounded-2xl rounded-tl-none px-3 py-2 max-w-[260px] leading-relaxed whitespace-pre-wrap">
                {msg.replace("{nombre}", "María").replace("{fecha}", "lunes 28 de abril").replace("{hora}", "10:00").replace("{doctor}", "García")}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={saveSettings} disabled={savingMsg} className="flex-1">
              {savingMsg ? "Guardando…" : "💾 Guardar configuración"}
            </Button>
            <Button variant="outline" onClick={disconnect} disabled={loading} className="text-rose-600 border-rose-200 hover:bg-rose-50">
              <XCircle className="w-4 h-4 mr-1.5" /> Desconectar
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700">
            <strong>¿Cómo se envían?</strong> Los recordatorios se envían automáticamente cuando agendas una cita. También puedes enviar uno manualmente desde la página de <strong>Agenda</strong> haciendo clic en el ícono de WhatsApp junto a cada cita.
          </div>
        </div>
      )}
    </div>
  );
}
