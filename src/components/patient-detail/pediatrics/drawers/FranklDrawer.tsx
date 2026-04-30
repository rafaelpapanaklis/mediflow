"use client";
// Pediatrics — drawer captura de Frankl/Venham (3 clics). Spec: §1.14, §3.6 (atajos 1-4)

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { captureBehavior, isFailure } from "@/app/actions/pediatrics";
import { FRANKL_LABELS, FRANKL_SHORT_LABELS, VENHAM_LABELS, type FranklValue } from "@/lib/pediatrics/frankl";

export interface FranklDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  appointmentId?: string;
}

export function FranklDrawer(props: FranklDrawerProps) {
  const { open, onClose, patientId, appointmentId } = props;
  const [scale, setScale] = useState<"frankl" | "venham">("frankl");
  const [value, setValue] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setScale("frankl"); setValue(null); setNotes(""); setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (scale !== "frankl") return;
      if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        setValue(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, scale]);

  async function submit() {
    if (value == null) return;
    setSaving(true);
    const result = await captureBehavior({
      patientId,
      scale,
      value,
      appointmentId: appointmentId ?? null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Frankl registrado");
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Capturar conducta"
      subtitle="Escala Frankl o Venham · 3 clics para guardar"
      saving={saving}
      saveDisabled={value == null}
      onSubmit={submit}
    >
      <fieldset className="pedi-form__fieldset">
        <legend>Escala</legend>
        <div className="pedi-form__pillgroup">
          {(["frankl", "venham"] as const).map((s) => (
            <button
              type="button"
              key={s}
              className={`pedi-pill ${scale === s ? "is-active" : ""}`}
              onClick={() => { setScale(s); setValue(null); }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="pedi-form__fieldset">
        <legend>Valor</legend>
        {scale === "frankl" ? (
          <div className="pedi-form__franklgrid">
            {([1, 2, 3, 4] as FranklValue[]).map((v) => (
              <button
                type="button"
                key={v}
                className={`pedi-frankl-option pedi-frankl-option--${v} ${value === v ? "is-active" : ""}`}
                onClick={() => setValue(v)}
              >
                <span className="pedi-frankl-option__digit">{v}</span>
                <span className="pedi-frankl-option__label">{FRANKL_SHORT_LABELS[v]}</span>
                <span className="pedi-frankl-option__hint">{FRANKL_LABELS[v]}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="pedi-form__venhamlist">
            {Object.entries(VENHAM_LABELS).map(([k, label]) => {
              const v = Number(k);
              return (
                <button
                  type="button"
                  key={k}
                  className={`pedi-pill ${value === v ? "is-active" : ""}`}
                  onClick={() => setValue(v)}
                >
                  <span className="pedi-form__monodigit">{k}</span>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <label className="pedi-form__field">
        <span>Notas (opcional)</span>
        <textarea
          rows={3}
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Cooperación con apoyo, requiere preparación, etc."
        />
      </label>
    </CaptureDrawer>
  );
}
