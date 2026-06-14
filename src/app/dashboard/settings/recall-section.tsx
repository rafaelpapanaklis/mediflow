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
    <div className="bg-card border border-border rounded-2xl p-6 shadow-card max-w-lg space-y-4">
      <div>
        <h2 className="text-base font-bold">Reactivación de pacientes (recall)</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Avísale automáticamente a los pacientes que llevan tiempo sin venir que les toca su
          limpieza o revisión. Sólo se contacta a quienes ya tuvieron una consulta y no tienen
          cita futura agendada.
        </p>
      </div>

      {/* Toggle activar/desactivar */}
      <div
        className={`flex items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-colors ${
          form.enabled ? "border-emerald-500 bg-emerald-600/10" : "border-border bg-transparent"
        }`}
      >
        <div className="min-w-0">
          <div
            className={`text-sm font-bold ${
              form.enabled ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
            }`}
          >
            Reactivación automática
          </div>
          <div className="text-xs mt-0.5 text-muted-foreground">
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
        <Label>¿Cada cuánto se considera "por reactivar"?</Label>
        <div className="flex flex-wrap gap-2">
          {INTERVAL_OPTIONS.map((opt) => {
            const active = form.intervalDays === opt.days;
            return (
              <button
                key={opt.days}
                type="button"
                onClick={() => setForm((f) => ({ ...f, intervalDays: opt.days }))}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-brand-600/15 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800"
                    : "bg-transparent text-muted-foreground border-border hover:border-brand-300"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Tiempo sin venir desde la última consulta completada.
        </div>
      </div>

      {/* Canal */}
      <div className="space-y-1.5">
        <Label>Canal</Label>
        <select
          className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
          value={form.channel}
          onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as ReminderChannel }))}
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="both">WhatsApp y email</option>
        </select>
        {includesWhatsApp && !waConnected && (
          <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
            WhatsApp no está conectado en esta clínica.{" "}
            <a href="/dashboard/whatsapp" className="font-semibold underline">
              Conectar WhatsApp
            </a>
          </div>
        )}
        {includesEmail && (
          <div className="text-[11px] text-muted-foreground">
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
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            Restaurar predeterminado
          </button>
        </div>
        <textarea
          className="flex w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none resize-y"
          rows={5}
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
        />
        <div className="text-[11px] text-muted-foreground">
          Variables disponibles: {"{nombre}"} y {"{clinica}"}.
        </div>
      </div>

      {/* Preview burbuja */}
      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
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
          className="text-xs font-semibold text-brand-700 dark:text-brand-300 underline disabled:opacity-40 disabled:no-underline"
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
