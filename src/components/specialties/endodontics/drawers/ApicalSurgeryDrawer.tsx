"use client";
// Endodontics — drawer para registrar cirugía apical. Spec §6.14

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Drawer } from "@/components/ui/design-system/Drawer";
import { createApicalSurgery, isFailure } from "@/app/actions/endodontics";
import {
  RETRO_FILLING_MATERIAL,
  FLAP_TYPE,
} from "@/lib/validation/endodontics";

const RETRO_LABEL: Record<string, string> = {
  MTA: "MTA (Mineral Trióxido Agregado)",
  BIOCERAMIC_PUTTY: "Biocerámico (putty)",
  SUPER_EBA: "Super-EBA",
  IRM: "IRM",
  OTRO: "Otro",
};

const FLAP_LABEL: Record<string, string> = {
  OCHSENBEIN_LUEBKE: "Ochsenbein-Luebke",
  SULCULAR: "Sulcular",
  SEMILUNAR: "Semilunar",
  PAPILAR: "Papilar",
};

export interface ApicalSurgeryDrawerProps {
  open: boolean;
  onClose: () => void;
  treatmentId: string;
}

export function ApicalSurgeryDrawer(props: ApicalSurgeryDrawerProps) {
  const { open, onClose, treatmentId } = props;
  const [interventedRoot, setInterventedRoot] = useState("");
  const [resectedLength, setResectedLength] = useState("");
  const [retroMat, setRetroMat] = useState<typeof RETRO_FILLING_MATERIAL[number]>("MTA");
  const [flap, setFlap] = useState<typeof FLAP_TYPE[number]>("SULCULAR");
  const [suture, setSuture] = useState("");
  const [postOpAt, setPostOpAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setInterventedRoot(""); setResectedLength("");
      setRetroMat("MTA"); setFlap("SULCULAR");
      setSuture(""); setPostOpAt(""); setNotes("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    if (!interventedRoot.trim()) { toast.error("Indica raíz intervenida"); return; }
    const len = Number(resectedLength);
    if (!Number.isFinite(len) || len <= 0 || len > 10) {
      toast.error("Longitud resecada entre 0.5 y 10 mm");
      return;
    }
    setSaving(true);
    const r = await createApicalSurgery({
      treatmentId,
      interventedRoot: interventedRoot.trim(),
      resectedRootLengthMm: len,
      retroFillingMaterial: retroMat,
      flapType: flap,
      sutureType: suture.trim() || null,
      postOpControlAt: postOpAt ? new Date(postOpAt).toISOString() : null,
      intraoperativeFileId: null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(r)) { toast.error(r.error); return; }
    toast.success("Cirugía apical registrada");
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Cirugía apical (apicectomía)"
      subtitle="Solo aplica si treatmentType = APICECTOMIA"
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
            {saving ? "Guardando…" : "Registrar cirugía"}
          </button>
        </>
      }
    >
      <div className="pedi-form">
        <div className="pedi-form__grid">
          <label className="pedi-form__field">
            <span>Raíz intervenida</span>
            <input
              type="text" maxLength={50}
              value={interventedRoot}
              onChange={(e) => setInterventedRoot(e.target.value)}
              placeholder="MV, DV, P, única…"
            />
          </label>
          <label className="pedi-form__field">
            <span>Longitud resecada (mm)</span>
            <input
              type="number" step="0.5" min={0.5} max={10}
              value={resectedLength}
              onChange={(e) => setResectedLength(e.target.value)}
            />
          </label>
        </div>
        <label className="pedi-form__field">
          <span>Material retro-obturación</span>
          <select value={retroMat} onChange={(e) => setRetroMat(e.target.value as typeof retroMat)}>
            {RETRO_FILLING_MATERIAL.map((m) => <option key={m} value={m}>{RETRO_LABEL[m] ?? m}</option>)}
          </select>
        </label>
        <label className="pedi-form__field">
          <span>Tipo de colgajo</span>
          <select value={flap} onChange={(e) => setFlap(e.target.value as typeof flap)}>
            {FLAP_TYPE.map((f) => <option key={f} value={f}>{FLAP_LABEL[f] ?? f}</option>)}
          </select>
        </label>
        <div className="pedi-form__grid">
          <label className="pedi-form__field">
            <span>Sutura</span>
            <input type="text" maxLength={50} value={suture} onChange={(e) => setSuture(e.target.value)} placeholder="Vicryl 4-0, etc." />
          </label>
          <label className="pedi-form__field">
            <span>Control posoperatorio</span>
            <input type="date" value={postOpAt} onChange={(e) => setPostOpAt(e.target.value)} />
          </label>
        </div>
        <label className="pedi-form__field">
          <span>Notas</span>
          <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
    </Drawer>
  );
}
