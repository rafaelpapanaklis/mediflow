"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FileEdit, Save, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NOTES_MAX = 5000;
const AUTO_SAVE_DELAY_MS = 3000;

function formatNumber(n: number): string {
  return n.toLocaleString("es-MX");
}

interface Props {
  fileId: string;
  initialDoctorNotes: string | null;
  initialDoctorNotesUpdatedAt: Date | string | null;
}

/**
 * Bloque de "MIS NOTAS" para un PatientFile específico.
 * Vive en la vista preview principal de xrays-client.tsx — NO en el Dialog de análisis IA.
 * Auto-save con debounce 3s + botón manual + contador 5000 + timestamp relativo.
 */
export function XrayNotesSection({
  fileId, initialDoctorNotes, initialDoctorNotesUpdatedAt,
}: Props) {
  const initialStr = initialDoctorNotes ?? "";
  const initialDate = initialDoctorNotesUpdatedAt
    ? (typeof initialDoctorNotesUpdatedAt === "string"
        ? new Date(initialDoctorNotesUpdatedAt)
        : initialDoctorNotesUpdatedAt)
    : null;

  const [draft, setDraft]                 = useState(initialStr);
  const [saving, setSaving]               = useState(false);
  const [lastSavedAt, setLastSavedAt]     = useState<Date | null>(initialDate);
  const [lastSavedValue, setLastSavedValue] = useState(initialStr);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset cuando cambia el fileId (por si el parent no usa key={fileId})
  useEffect(() => {
    setDraft(initialStr);
    setLastSavedValue(initialStr);
    setLastSavedAt(initialDate);
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const isDirty = draft !== lastSavedValue;
  const charsLeft = NOTES_MAX - draft.length;
  const overLimit = draft.length > NOTES_MAX;

  const save = useCallback(async (value: string) => {
    if (value.length > NOTES_MAX) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/xrays/${fileId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ doctorNotes: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Error al guardar");
      }
      const data = (await res.json()) as { doctorNotes: string; doctorNotesUpdatedAt: string | null };
      const updatedAt = data.doctorNotesUpdatedAt ? new Date(data.doctorNotesUpdatedAt) : null;
      setLastSavedValue(data.doctorNotes);
      setLastSavedAt(updatedAt);
      toast.success("Notas guardadas");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudieron guardar las notas. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }, [fileId]);

  // Auto-save con debounce
  useEffect(() => {
    if (!isDirty || overLimit) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      save(draft);
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    };
  }, [draft, isDirty, overLimit, save]);

  const handleManualSave = () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    save(draft);
  };

  const relativeTime = lastSavedAt
    ? formatDistanceToNow(lastSavedAt, { addSuffix: true, locale: es })
    : null;

  const charCounterClass = overLimit
    ? "text-rose-400"
    : charsLeft < 200
      ? "text-amber-400"
      : "text-muted-foreground";

  return (
    <section className="rounded-2xl border border-white/10 bg-card/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          <FileEdit className="h-3 w-3" />
          Mis notas
        </h4>
        {relativeTime && (
          <span className="text-[11px] text-muted-foreground">
            Última edición: {relativeTime}
          </span>
        )}
      </div>

      <label htmlFor={`xray-notes-${fileId}`} className="sr-only">
        Mis notas sobre la radiografía
      </label>
      <textarea
        id={`xray-notes-${fileId}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Anota aquí lo que observas en la radiografía antes o después de ver el análisis IA..."
        rows={4}
        maxLength={NOTES_MAX + 200}
        aria-describedby={`xray-notes-counter-${fileId}`}
        className={cn(
          "w-full resize-y rounded-xl border bg-[#05070F] px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40",
          overLimit ? "border-rose-500/40" : "border-white/10",
        )}
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <span
          id={`xray-notes-counter-${fileId}`}
          className={cn("text-[11px] font-medium", charCounterClass)}
          aria-live="polite"
        >
          {formatNumber(draft.length)} / {formatNumber(NOTES_MAX)} caracteres
        </span>
        <Button
          variant={isDirty ? "default" : "ghost"}
          size="sm"
          disabled={!isDirty || overLimit || saving}
          onClick={handleManualSave}
          className="gap-1.5"
          aria-label="Guardar notas manualmente"
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Guardar notas
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
