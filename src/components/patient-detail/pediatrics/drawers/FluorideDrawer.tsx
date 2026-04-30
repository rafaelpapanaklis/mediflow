"use client";
// Pediatrics — drawer aplicación de flúor. Spec: §1.12, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { applyFluoride, isFailure } from "@/app/actions/pediatrics";

const PRODUCTS = [
  { k: "barniz_5pct_naf", label: "Barniz 5% NaF" },
  { k: "gel_apf",         label: "Gel APF" },
  { k: "sdf",             label: "SDF (diamino fluoruro de plata)" },
  { k: "fosfato_acido",   label: "Fosfato ácido" },
] as const;

const ALL_FDIS = [
  51, 52, 53, 54, 55, 61, 62, 63, 64, 65,
  71, 72, 73, 74, 75, 81, 82, 83, 84, 85,
  16, 26, 36, 46,
];

export interface FluorideDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
}

export function FluorideDrawer(props: FluorideDrawerProps) {
  const { open, onClose, patientId } = props;
  const [product, setProduct] = useState<typeof PRODUCTS[number]["k"]>("barniz_5pct_naf");
  const [teeth, setTeeth] = useState<number[]>([]);
  const [lotNumber, setLotNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setProduct("barniz_5pct_naf");
      setTeeth([]);
      setLotNumber("");
      setNotes("");
      setSaving(false);
    }
  }, [open]);

  function toggle(fdi: number) {
    setTeeth((s) => s.includes(fdi) ? s.filter((x) => x !== fdi) : [...s, fdi]);
  }

  async function submit() {
    if (teeth.length === 0) { toast.error("Selecciona al menos un diente"); return; }
    setSaving(true);
    const result = await applyFluoride({
      patientId,
      product,
      appliedTeeth: teeth,
      lotNumber: lotNumber.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success(`Flúor aplicado en ${teeth.length} ${teeth.length === 1 ? "diente" : "dientes"}`);
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Aplicación de flúor"
      width="lg"
      saving={saving}
      saveDisabled={teeth.length === 0}
      onSubmit={submit}
    >
      <fieldset className="pedi-form__fieldset">
        <legend>Producto</legend>
        <div className="pedi-form__pillgroup pedi-form__pillgroup--wrap">
          {PRODUCTS.map((p) => (
            <button
              key={p.k}
              type="button"
              className={`pedi-pill ${product === p.k ? "is-active" : ""}`}
              onClick={() => setProduct(p.k)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="pedi-form__fieldset">
        <legend>Dientes aplicados ({teeth.length})</legend>
        <p className="pedi-form__hint">Click para alternar. Tap targets de 32px cumplen WCAG.</p>
        <div className="pedi-form__teethgrid">
          {ALL_FDIS.map((fdi) => (
            <button
              key={fdi}
              type="button"
              className={`pedi-tooth-toggle ${teeth.includes(fdi) ? "is-active" : ""}`}
              onClick={() => toggle(fdi)}
              aria-pressed={teeth.includes(fdi)}
            >
              {fdi}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="pedi-form__field">
        <span>Lote (opcional)</span>
        <input
          type="text"
          maxLength={60}
          value={lotNumber}
          onChange={(e) => setLotNumber(e.target.value)}
          placeholder="Lot 24A-031"
        />
      </label>

      <label className="pedi-form__field">
        <span>Notas (opcional)</span>
        <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </CaptureDrawer>
  );
}
