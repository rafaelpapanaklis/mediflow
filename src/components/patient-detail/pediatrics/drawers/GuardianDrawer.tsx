"use client";
// Pediatrics — drawer registrar tutor responsable. Spec: §1.5.1, §4.A.8

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CaptureDrawer } from "./CaptureDrawer";
import { addGuardian, isFailure } from "@/app/actions/pediatrics";

const PARENTESCO_OPTIONS = [
  { k: "madre",        label: "Madre" },
  { k: "padre",        label: "Padre" },
  { k: "tutor_legal",  label: "Tutor legal" },
  { k: "abuelo",       label: "Abuelo" },
  { k: "abuela",       label: "Abuela" },
  { k: "tio",          label: "Tío" },
  { k: "tia",          label: "Tía" },
  { k: "hermano",      label: "Hermano" },
  { k: "hermana",      label: "Hermana" },
  { k: "otro",         label: "Otro" },
] as const;

export interface GuardianDrawerProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  defaultPrincipal?: boolean;
}

export function GuardianDrawer(props: GuardianDrawerProps) {
  const { open, onClose, patientId, defaultPrincipal } = props;
  const [fullName, setFullName] = useState("");
  const [parentesco, setParentesco] = useState<typeof PARENTESCO_OPTIONS[number]["k"]>("madre");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [address, setAddress] = useState("");
  const [ineUrl, setIneUrl] = useState("");
  const [esResponsableLegal, setEsResponsableLegal] = useState(true);
  const [principal, setPrincipal] = useState(defaultPrincipal ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setFullName(""); setParentesco("madre"); setPhone(""); setEmail("");
      setBirthDate(""); setAddress(""); setIneUrl("");
      setEsResponsableLegal(true); setPrincipal(defaultPrincipal ?? false);
      setSaving(false);
    }
  }, [open, defaultPrincipal]);

  async function submit() {
    if (!fullName.trim()) { toast.error("Nombre requerido"); return; }
    if (!phone.trim()) { toast.error("Teléfono requerido"); return; }
    setSaving(true);
    const result = await addGuardian({
      patientId,
      fullName: fullName.trim(),
      parentesco,
      phone: phone.trim(),
      email: email.trim() || null,
      birthDate: birthDate ? new Date(birthDate).toISOString() : null,
      address: address.trim() || null,
      ineUrl: ineUrl.trim() || null,
      esResponsableLegal,
      principal,
    });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Tutor agregado");
    onClose();
  }

  return (
    <CaptureDrawer
      open={open}
      onClose={onClose}
      title="Tutor responsable"
      subtitle="Datos del adulto que firma consentimientos"
      saving={saving}
      saveDisabled={!fullName.trim() || !phone.trim()}
      onSubmit={submit}
    >
      <label className="pedi-form__field">
        <span>Nombre completo *</span>
        <input
          type="text"
          maxLength={120}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </label>

      <label className="pedi-form__field">
        <span>Parentesco</span>
        <select value={parentesco} onChange={(e) => setParentesco(e.target.value as typeof parentesco)}>
          {PARENTESCO_OPTIONS.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
        </select>
      </label>

      <div className="pedi-form__grid">
        <label className="pedi-form__field">
          <span>Teléfono *</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+52 999 123 4567"
            required
          />
        </label>
        <label className="pedi-form__field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>

      <label className="pedi-form__field">
        <span>Fecha de nacimiento</span>
        <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      </label>

      <label className="pedi-form__field">
        <span>Dirección</span>
        <input
          type="text"
          maxLength={300}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>

      <label className="pedi-form__field">
        <span>URL del INE / identificación (opcional)</span>
        <input
          type="url"
          value={ineUrl}
          onChange={(e) => setIneUrl(e.target.value)}
          placeholder="https://…"
        />
      </label>

      <div className="pedi-form__row-checks">
        <label className="pedi-checkbox">
          <input
            type="checkbox"
            checked={esResponsableLegal}
            onChange={(e) => setEsResponsableLegal(e.target.checked)}
          />
          <span>Es responsable legal</span>
        </label>
        <label className="pedi-checkbox">
          <input
            type="checkbox"
            checked={principal}
            onChange={(e) => setPrincipal(e.target.checked)}
          />
          <span>Tutor principal</span>
        </label>
      </div>
    </CaptureDrawer>
  );
}
