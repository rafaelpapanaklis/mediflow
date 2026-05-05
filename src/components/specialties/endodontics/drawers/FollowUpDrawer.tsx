"use client";
// Endodontics — drawer cerrar control de seguimiento. Spec §6.10

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Drawer } from "@/components/ui/design-system/Drawer";
import { completeFollowUp, isFailure } from "@/app/actions/endodontics";
import { FOLLOW_UP_CONCLUSION } from "@/lib/validation/endodontics";

const CONCLUSION_LABEL: Record<string, string> = {
  EXITO: "Éxito (PAI ≤ 2, sin síntomas, lesión cicatrizada)",
  EN_CURACION: "En curación (PAI 2-3, mejora visible)",
  FRACASO: "Fracaso (PAI ≥ 4 o síntomas persistentes)",
  INCIERTO: "Incierto (datos insuficientes para concluir)",
};

export interface FollowUpDrawerProps {
  open: boolean;
  onClose: () => void;
  followUpId: string;
  milestoneLabel: string;
}

export function FollowUpDrawer(props: FollowUpDrawerProps) {
  const { open, onClose, followUpId, milestoneLabel } = props;
  const [paiScore, setPaiScore] = useState<number>(2);
  const [symptomsPresent, setSymptomsPresent] = useState(false);
  const [conclusion, setConclusion] = useState<typeof FOLLOW_UP_CONCLUSION[number]>("EXITO");
  const [recommendedAction, setRecommendedAction] = useState("");
  const [performedAt, setPerformedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setPaiScore(2);
      setSymptomsPresent(false);
      setConclusion("EXITO");
      setRecommendedAction("");
      setPerformedAt(new Date().toISOString().slice(0, 10));
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    setSaving(true);
    const r = await completeFollowUp({
      followUpId,
      performedAt: new Date(performedAt).toISOString(),
      paiScore,
      symptomsPresent,
      conclusion,
      recommendedAction: recommendedAction.trim() || null,
    });
    setSaving(false);
    if (isFailure(r)) { toast.error(r.error); return; }
    toast.success("Control cerrado");
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Control ${milestoneLabel}`}
      subtitle="Cerrar seguimiento con PAI + conclusión"
      width="md"
      footer={
        <>
          <button type="button" className="pedi-btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Cerrar control"}
          </button>
        </>
      }
    >
      <div className="pedi-form">
        <label className="pedi-form__field">
          <span>Fecha del control</span>
          <input
            type="date"
            value={performedAt}
            onChange={(e) => setPerformedAt(e.target.value)}
          />
        </label>

        <fieldset className="pedi-form__fieldset">
          <legend>PAI Score (Periapical Index)</legend>
          <div className="pedi-form__pillgroup">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`pedi-pill ${paiScore === n ? "is-active" : ""}`}
                onClick={() => setPaiScore(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <small className="pedi-form__hint">
            1: estructura ósea normal · 2: cambios pequeños · 3: cambios con
            pérdida de mineral · 4: lesión radiolúcida · 5: lesión expansiva.
          </small>
        </fieldset>

        <label className="pedi-checkbox">
          <input
            type="checkbox"
            checked={symptomsPresent}
            onChange={(e) => setSymptomsPresent(e.target.checked)}
          />
          <span>Paciente refiere síntomas</span>
        </label>

        <label className="pedi-form__field">
          <span>Conclusión</span>
          <select
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value as typeof conclusion)}
          >
            {FOLLOW_UP_CONCLUSION.map((c) => (
              <option key={c} value={c}>{CONCLUSION_LABEL[c] ?? c}</option>
            ))}
          </select>
        </label>

        <label className="pedi-form__field">
          <span>Acción recomendada (opcional)</span>
          <textarea
            rows={3}
            maxLength={1000}
            value={recommendedAction}
            onChange={(e) => setRecommendedAction(e.target.value)}
            placeholder="Ej. siguiente control en 12m, considerar retratamiento, derivar…"
          />
        </label>
      </div>
    </Drawer>
  );
}
