"use client";

// Sección "Reactivación de pacientes (recall)" de /dashboard/settings.
// Config del recall genérico ("te toca tu limpieza"): toggle + intervalo +
// canal + plantilla con preview. Guarda en Clinic.reminderSettings.recall vía
// PATCH /api/settings (el server mezcla con la config de recordatorios de cita).
// Texto en español hardcodeado (sin i18n) — patrón de otros componentes del panel.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import {
  getRecallSettings,
  DEFAULT_RECALL_MESSAGE,
  type RecallSettings,
  type ReminderChannel,
} from "@/lib/reminders/config";

const INTERVAL_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 90, label: "3 meses" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "12 meses" },
];

export function RecallSection({ clinic }: { clinic: any }) {
  const [form, setForm] = useState<RecallSettings>(() => getRecallSettings(clinic ?? {}));
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const includesWhatsApp = form.channel === "whatsapp" || form.channel === "both";
  const includesEmail = form.channel === "email" || form.channel === "both";
  const waConnected = Boolean(clinic?.waConnected);

  const preview = form.message
    .replaceAll("{nombre}", "María")
    .replaceAll("{paciente}", "María")
    .replaceAll("{clinica}", clinic?.name || "Clínica Dental")
    .replaceAll("{clinicName}", clinic?.name || "Clínica Dental");

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recall: {
            enabled: form.enabled,
            intervalDays: form.intervalDays,
            channel: form.channel,
            message: form.message,
          },
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Configuración de reactivación guardada");
    } catch {
      toast.error("No se pudo guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/recall/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudo ejecutar");
      toast.success(
        `Barrido listo: ${data.queuedWhatsapp} por WhatsApp · ${data.sentEmail} por email · ` +
          `${data.due} por reactivar · ${data.skipped} omitidos`,
        { duration: 7000 },
      );
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo ejecutar el barrido");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card max-w-lg space-y-4" style={{ padding: 24 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>Reactivación de pacientes (recall)</h2>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
          Avísale automáticamente a los pacientes que llevan tiempo sin venir que les toca su
          limpieza o revisión. Sólo se contacta a quienes ya tuvieron una consulta y no tienen
          cita futura agendada.
        </p>
      </div>

      {/* Toggle activar/desactivar */}
      <div
        className="flex items-center justify-between gap-4 p-4 transition-colors"
        style={{
          borderRadius: "var(--radius-lg)",
          border: `2px solid ${form.enabled ? "var(--success)" : "var(--border-soft)"}`,
          background: form.enabled ? "var(--success-soft)" : "transparent",
        }}
      >
        <div className="min-w-0">
          <div style={{ fontSize: 13.5, fontWeight: 600, color: form.enabled ? "var(--success-strong)" : "var(--text-1)" }}>
            Reactivación automática
          </div>
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--text-3)" }}>
            Un barrido diario busca pacientes por reactivar y les envía el recordatorio.
          </div>
        </div>
        <button
          type="button"
          aria-label="Activar reactivación automática"
          onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
          className={`switch ${form.enabled ? "switch--on" : ""}`}
        >
          <span className="switch__thumb" />
        </button>
      </div>

      {/* Intervalo */}
      <div className="space-y-1.5">
        <Label>¿Cada cuánto se considera &quot;por reactivar&quot;?</Label>
        <div className="flex flex-wrap gap-2">
          {INTERVAL_OPTIONS.map((opt) => {
            const active = form.intervalDays === opt.days;
            return (
              <button
                key={opt.days}
                type="button"
                onClick={() => setForm((f) => ({ ...f, intervalDays: opt.days }))}
                aria-pressed={active}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                style={{
                  border: `1px solid ${active ? "var(--brand-soft)" : "var(--border-soft)"}`,
                  background: active ? "var(--brand-soft)" : "transparent",
                  color: active ? "var(--brand)" : "var(--text-3)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          Tiempo sin venir desde la última consulta completada.
        </div>
      </div>

      {/* Canal */}
      <div className="space-y-1.5">
        <Label>Canal</Label>
        <select
          className="input-new"
          value={form.channel}
          onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as ReminderChannel }))}
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="both">WhatsApp y email</option>
        </select>
        {includesWhatsApp && !waConnected && (
          <div style={{ fontSize: 12, color: "var(--warning-strong)", background: "var(--warning-soft)", border: "1px solid var(--warning-border-strong)", borderRadius: "var(--radius)", padding: 12 }}>
            WhatsApp no está conectado en esta clínica.{" "}
            <a href="/dashboard/whatsapp" className="font-semibold underline">
              Conectar WhatsApp
            </a>
          </div>
        )}
        {includesEmail && (
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            El email requiere tener configurado el proveedor de correo (Resend).
          </div>
        )}
      </div>

      {/* Plantilla del mensaje */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label>Mensaje</Label>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, message: DEFAULT_RECALL_MESSAGE }))}
            className="underline"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            Restaurar predeterminado
          </button>
        </div>
        <textarea
          className="input-new resize-y"
          style={{ height: "auto", padding: "10px 12px" }}
          rows={5}
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
        />
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          Variables disponibles: {"{nombre}"} y {"{clinica}"}.
        </div>
      </div>

      {/* Preview burbuja */}
      <div style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-soft)", background: "var(--bg-elev-2)", padding: 12 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8 }}>
          Vista previa
        </div>
        <div
          style={{
            background: "var(--success)",
            color: "#fff",
            fontSize: 12,
            borderRadius: 16,
            borderTopLeftRadius: 0,
            padding: "8px 12px",
            maxWidth: 280,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {preview}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
        <button
          type="button"
          onClick={runNow}
          disabled={running || !form.enabled}
          className="text-xs font-semibold underline disabled:opacity-40 disabled:no-underline"
          style={{ color: "var(--brand)" }}
          title={form.enabled ? "Ejecuta el barrido ahora para esta clínica" : "Activa la reactivación primero"}
        >
          {running ? "Ejecutando…" : "Ejecutar barrido ahora"}
        </button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}
