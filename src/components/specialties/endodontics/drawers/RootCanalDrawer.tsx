"use client";
// Endodontics — drawer create/update RootCanal. Spec §6.7

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Drawer } from "@/components/ui/design-system/Drawer";
import { upsertRootCanal, isFailure } from "@/app/actions/endodontics";
import {
  CANAL_CANONICAL_NAME,
  OBTURATION_QUALITY,
} from "@/lib/validation/endodontics";
import { labelCanalCanonicalName } from "@/lib/helpers/canalAnatomy";

const QUALITY_LABEL: Record<string, string> = {
  HOMOGENEA: "Homogénea (ideal)",
  ADECUADA: "Adecuada",
  CON_HUECOS: "Con huecos",
  SOBREOBTURADA: "Sobreobturada",
  SUBOBTURADA: "Subobturada",
};

export interface RootCanalDrawerProps {
  open: boolean;
  onClose: () => void;
  treatmentId: string;
  initial?: {
    id?: string;
    canonicalName?: string;
    workingLengthMm?: number;
    coronalReferencePoint?: string;
    masterApicalFileIso?: number;
    masterApicalFileTaper?: number;
    obturationQuality?: string | null;
    notes?: string | null;
  };
}

export function RootCanalDrawer(props: RootCanalDrawerProps) {
  const { open, onClose, treatmentId, initial } = props;
  const [canonical, setCanonical] = useState<typeof CANAL_CANONICAL_NAME[number]>("CONDUCTO_UNICO");
  const [wl, setWl] = useState<string>("");
  const [refPoint, setRefPoint] = useState<string>("");
  const [iso, setIso] = useState<string>("25");
  const [taper, setTaper] = useState<string>("0.06");
  const [apexLocator, setApexLocator] = useState<string>("");
  const [radiographic, setRadiographic] = useState<string>("");
  const [quality, setQuality] = useState<typeof OBTURATION_QUALITY[number] | "">("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCanonical((initial?.canonicalName as typeof CANAL_CANONICAL_NAME[number]) ?? "CONDUCTO_UNICO");
    setWl(initial?.workingLengthMm ? String(initial.workingLengthMm) : "");
    setRefPoint(initial?.coronalReferencePoint ?? "");
    setIso(initial?.masterApicalFileIso ? String(initial.masterApicalFileIso) : "25");
    setTaper(initial?.masterApicalFileTaper ? String(initial.masterApicalFileTaper) : "0.06");
    setApexLocator("");
    setRadiographic("");
    setQuality((initial?.obturationQuality as typeof OBTURATION_QUALITY[number] | undefined) ?? "");
    setNotes(initial?.notes ?? "");
    setSaving(false);
  }, [open, initial]);

  async function submit() {
    if (!wl || Number(wl) < 5 || Number(wl) > 40) {
      toast.error("Longitud de trabajo entre 5 y 40 mm");
      return;
    }
    if (!refPoint.trim()) { toast.error("Punto de referencia coronal requerido"); return; }
    setSaving(true);
    const r = await upsertRootCanal({
      id: initial?.id ?? null,
      treatmentId,
      canonicalName: canonical,
      customLabel: null,
      workingLengthMm: Number(wl),
      coronalReferencePoint: refPoint.trim(),
      masterApicalFileIso: Number(iso),
      masterApicalFileTaper: Number(taper),
      apexLocatorReadingMm: apexLocator ? Number(apexLocator) : null,
      radiographicLengthMm: radiographic ? Number(radiographic) : null,
      apexLocatorBrand: null,
      conductometryFileId: null,
      obturationQuality: quality || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(r)) { toast.error(r.error); return; }
    toast.success(initial?.id ? "Conducto actualizado" : "Conducto registrado");
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={initial?.id ? "Editar conducto" : "Registrar conducto"}
      subtitle="LT, lima maestra, calidad de obturación"
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
            {saving ? "Guardando…" : "Guardar conducto"}
          </button>
        </>
      }
    >
      <div className="pedi-form">
        <div className="pedi-form__grid">
          <label className="pedi-form__field">
            <span>Nombre canónico</span>
            <select value={canonical} onChange={(e) => setCanonical(e.target.value as typeof canonical)}>
              {CANAL_CANONICAL_NAME.map((c) => (
                <option key={c} value={c}>{labelCanalCanonicalName(c)}</option>
              ))}
            </select>
          </label>
          <label className="pedi-form__field">
            <span>LT (mm)</span>
            <input
              type="number"
              step="0.5" min={5} max={40}
              value={wl} onChange={(e) => setWl(e.target.value)}
              placeholder="19.5"
            />
          </label>
        </div>

        <label className="pedi-form__field">
          <span>Punto de referencia coronal</span>
          <input
            type="text"
            maxLength={100}
            value={refPoint}
            onChange={(e) => setRefPoint(e.target.value)}
            placeholder="cúspide MV / borde incisal / etc."
          />
        </label>

        <div className="pedi-form__grid">
          <label className="pedi-form__field">
            <span>Lima maestra ISO</span>
            <input
              type="number" min={10} max={80}
              value={iso} onChange={(e) => setIso(e.target.value)}
            />
          </label>
          <label className="pedi-form__field">
            <span>Conicidad (taper)</span>
            <select value={taper} onChange={(e) => setTaper(e.target.value)}>
              <option value="0.02">.02</option>
              <option value="0.04">.04</option>
              <option value="0.06">.06</option>
              <option value="0.08">.08</option>
              <option value="0.10">.10</option>
              <option value="0.12">.12</option>
            </select>
          </label>
        </div>

        <div className="pedi-form__grid">
          <label className="pedi-form__field">
            <span>Lectura localizador (mm)</span>
            <input
              type="number" step="0.5" min={5} max={40}
              value={apexLocator}
              onChange={(e) => setApexLocator(e.target.value)}
              placeholder="Opcional"
            />
          </label>
          <label className="pedi-form__field">
            <span>LT radiográfica (mm)</span>
            <input
              type="number" step="0.5" min={5} max={40}
              value={radiographic}
              onChange={(e) => setRadiographic(e.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>

        <label className="pedi-form__field">
          <span>Calidad de obturación</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            <option value="">Sin obturar todavía</option>
            {OBTURATION_QUALITY.map((q) => (
              <option key={q} value={q}>{QUALITY_LABEL[q] ?? q}</option>
            ))}
          </select>
        </label>

        <label className="pedi-form__field">
          <span>Notas</span>
          <textarea
            rows={3} maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
    </Drawer>
  );
}
