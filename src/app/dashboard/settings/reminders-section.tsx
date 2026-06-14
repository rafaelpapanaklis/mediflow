"use client";

// Sección "Recordatorios" de /dashboard/settings: recordatorios automáticos
// de citas (WhatsApp/email) configurables por clínica.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/i18n-provider";
import toast from "react-hot-toast";
import {
  ALLOWED_REMINDER_OFFSETS,
  DEFAULT_REMINDER_TEMPLATE,
  getEffectiveReminderSettings,
  type ReminderChannel,
  type ReminderSettings,
} from "@/lib/reminders/config";
import { RecallSection } from "./recall-section";

// Etiqueta i18n de cada momento permitido (minutos antes de la cita).
const OFFSET_LABEL_KEYS: Record<number, string> = {
  2880: "settings.reminders.offset48h",
  1440: "settings.reminders.offset24h",
  240:  "settings.reminders.offset4h",
  120:  "settings.reminders.offset2h",
  60:   "settings.reminders.offset1h",
};

// sanitizeReminderSettings (server) recorta a 4 momentos; la UI no deja elegir más
// para que lo guardado sea exactamente lo que el usuario ve.
const MAX_OFFSETS = 4;

// Link de ejemplo para el preview (el real lo genera el cron por cita).
const SAMPLE_LINK = "https://…/cita/abc/confirmar";

export function RemindersSection({ clinic }: { clinic: any }) {
  const t = useT();
  const [form, setForm] = useState<ReminderSettings>(() =>
    getEffectiveReminderSettings(clinic ?? {}),
  );
  const [saving, setSaving] = useState(false);

  const includesWhatsApp = form.channel === "whatsapp" || form.channel === "both";
  const includesEmail    = form.channel === "email"    || form.channel === "both";
  const waConnected      = Boolean(clinic?.waConnected);

  function toggleOffset(min: number) {
    setForm(f => {
      if (f.offsets.includes(min)) return { ...f, offsets: f.offsets.filter(o => o !== min) };
      if (f.offsets.length >= MAX_OFFSETS) return f;
      return { ...f, offsets: [...f.offsets, min].sort((a, b) => b - a) };
    });
  }

  // Preview con valores de ejemplo — mismas sustituciones (y alias legacy) que
  // renderReminderTemplate en @/lib/reminders/config.
  let preview = form.template
    .replaceAll("{paciente}", "María")
    .replaceAll("{nombre}", "María")
    .replaceAll("{clinica}", clinic?.name || "Clínica Dental")
    .replaceAll("{clinicName}", clinic?.name || "Clínica Dental")
    .replaceAll("{fecha}", t("settings.reminders.previewSampleDate"))
    .replaceAll("{hora}", "10:00")
    .replaceAll("{doctor}", "Dr/a. García")
    .replaceAll("{doctorName}", "Dr/a. García")
    .replaceAll("{link}", SAMPLE_LINK);
  if (!preview.includes(SAMPLE_LINK)) {
    // El backend siempre agrega el link si la plantilla no lo incluye (en español,
    // porque el mensaje al paciente viaja en español) — el preview lo refleja.
    preview += `\n\nConfirma tu asistencia aquí: ${SAMPLE_LINK}`;
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reminderSettings: {
            enabled: form.enabled,
            offsets: form.offsets,
            channel: form.channel,
            template: form.template,
          },
        }),
      });
      if (!res.ok) throw new Error();
      toast.success(t("settings.reminders.savedToast"));
    } catch {
      toast.error(t("settings.reminders.saveErrorToast"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
    <div className="bg-card border border-border rounded-2xl p-6 shadow-card max-w-lg space-y-4">
      <div>
        <h2 className="text-base font-bold">{t("settings.reminders.title")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t("settings.reminders.subtitle")}</p>
      </div>

      {/* Toggle activar/desactivar */}
      <div className={`flex items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-colors ${form.enabled ? "border-emerald-500 bg-emerald-600/10" : "border-border bg-transparent"}`}>
        <div className="min-w-0">
          <div className={`text-sm font-bold ${form.enabled ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"}`}>
            {t("settings.reminders.enabledLabel")}
          </div>
          <div className="text-xs mt-0.5 text-muted-foreground">
            {t("settings.reminders.enabledDesc")}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("settings.reminders.enabledLabel")}
          onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
          className={`switch ${form.enabled ? "switch--on" : ""}`}
        >
          <span className="switch__thumb" />
        </button>
      </div>

      {/* Momentos de envío */}
      <div className="space-y-1.5">
        <Label>{t("settings.reminders.offsetsLabel")}</Label>
        <div className="flex flex-wrap gap-2">
          {ALLOWED_REMINDER_OFFSETS.map(min => {
            const active = form.offsets.includes(min);
            const blocked = !active && form.offsets.length >= MAX_OFFSETS;
            return (
              <button
                key={min}
                type="button"
                onClick={() => toggleOffset(min)}
                disabled={blocked}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-brand-600/15 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800"
                    : "bg-transparent text-muted-foreground border-border hover:border-brand-300"
                } ${blocked ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                {t(OFFSET_LABEL_KEYS[min])}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-muted-foreground">{t("settings.reminders.offsetsHint")}</div>
        {form.offsets.length === 0 && (
          <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
            {t("settings.reminders.noOffsetsWarning")}
          </div>
        )}
      </div>

      {/* Canal */}
      <div className="space-y-1.5">
        <Label>{t("settings.reminders.channelLabel")}</Label>
        <select
          className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
          value={form.channel}
          onChange={e => setForm(f => ({ ...f, channel: e.target.value as ReminderChannel }))}
        >
          <option value="whatsapp">{t("settings.reminders.channelWhatsapp")}</option>
          <option value="email">{t("settings.reminders.channelEmail")}</option>
          <option value="both">{t("settings.reminders.channelBoth")}</option>
        </select>
        {includesWhatsApp && !waConnected && (
          <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
            {t("settings.reminders.waNotConnectedWarning")}{" "}
            <a href="/dashboard/whatsapp" className="font-semibold underline">
              {t("settings.reminders.waConnectLink")}
            </a>
          </div>
        )}
        {includesEmail && (
          <div className="text-[11px] text-muted-foreground">
            {t("settings.reminders.emailOnlyNote")}
          </div>
        )}
      </div>

      {/* Plantilla del mensaje */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label>{t("settings.reminders.templateLabel")}</Label>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, template: DEFAULT_REMINDER_TEMPLATE }))}
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            {t("settings.reminders.restoreDefaultBtn")}
          </button>
        </div>
        <textarea
          className="flex w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none resize-y"
          rows={5}
          value={form.template}
          onChange={e => setForm(f => ({ ...f, template: e.target.value }))}
        />
        <div className="text-[11px] text-muted-foreground">
          {t("settings.reminders.templateVarsHint")}
        </div>
      </div>

      {/* Preview burbuja WhatsApp (mismo patrón que whatsapp-client) */}
      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          {t("settings.reminders.previewLabel")}
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

      {/* Nota fija: link público de confirmación */}
      <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
        {t("settings.reminders.confirmLinkNote")}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={saving}>
          {saving ? t("common.saving") : t("common.saveChanges")}
        </Button>
      </div>
    </div>

    {/* Recall genérico (reactivación de pacientes) — WS1-T8 */}
    <RecallSection clinic={clinic} />
    </div>
  );
}
