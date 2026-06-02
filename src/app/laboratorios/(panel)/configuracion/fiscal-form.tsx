"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Receipt, FileText } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import type { DentalLabFiscalDataDTO } from "@/lib/laboratorios/types";

// Catálogos SAT (subconjunto de los más usados). El form envía code + label;
// las columnas Prisma son planas (taxRegimeCode/Label, cfdiUseCode/Label).
const TAX_REGIMES: { code: string; label: string }[] = [
  { code: "601", label: "General de Ley Personas Morales" },
  { code: "603", label: "Personas Morales con Fines no Lucrativos" },
  { code: "605", label: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { code: "606", label: "Arrendamiento" },
  { code: "612", label: "Personas Físicas con Actividades Empresariales y Profesionales" },
  { code: "621", label: "Incorporación Fiscal" },
  { code: "626", label: "Régimen Simplificado de Confianza" },
];

const CFDI_USES: { code: string; label: string }[] = [
  { code: "G01", label: "Adquisición de mercancías" },
  { code: "G03", label: "Gastos en general" },
  { code: "I01", label: "Construcciones" },
  { code: "I04", label: "Equipo de cómputo y accesorios" },
  { code: "I08", label: "Otra maquinaria y equipo" },
  { code: "P01", label: "Por definir" },
  { code: "S01", label: "Sin efectos fiscales" },
];

// Incluye el valor inicial aunque no esté en el catálogo, para no perderlo.
function withInitial(
  options: { code: string; label: string }[],
  initial: { code: string; label: string } | null,
) {
  if (!initial || !initial.code || options.some((o) => o.code === initial.code)) return options;
  return [{ code: initial.code, label: initial.label || initial.code }, ...options];
}

export function FiscalForm({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: DentalLabFiscalDataDTO | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [legalName, setLegalName] = useState(initial?.legalName ?? "");
  const [rfc, setRfc] = useState(initial?.rfc ?? "");
  const [regimeCode, setRegimeCode] = useState(initial?.taxRegime.code ?? "");
  const [zipCode, setZipCode] = useState(initial?.zipCode ?? "");
  const [cfdiCode, setCfdiCode] = useState(initial?.cfdiUse.code ?? "");
  const [state, setState] = useState(initial?.state ?? "");

  const regimeOptions = withInitial(TAX_REGIMES, initial?.taxRegime ?? null);
  const cfdiOptions = withInitial(CFDI_USES, initial?.cfdiUse ?? null);

  async function save() {
    const rfcTrim = rfc.trim().toUpperCase();
    if (!legalName.trim()) return toast.error("La razón social es requerida.");
    if (rfcTrim.length < 12 || rfcTrim.length > 13) return toast.error("El RFC debe tener 12 o 13 caracteres.");
    if (!regimeCode) return toast.error("Selecciona un régimen fiscal.");
    if (!cfdiCode) return toast.error("Selecciona un uso de CFDI.");
    if (!/^\d{5}$/.test(zipCode.trim())) return toast.error("El código postal debe tener 5 dígitos.");

    const regime = regimeOptions.find((o) => o.code === regimeCode);
    const cfdi = cfdiOptions.find((o) => o.code === cfdiCode);

    setSaving(true);
    try {
      const res = await fetch("/api/laboratorios/fiscal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: legalName.trim(),
          rfc: rfcTrim,
          taxRegimeCode: regimeCode,
          taxRegimeLabel: regime?.label ?? regimeCode,
          zipCode: zipCode.trim(),
          cfdiUseCode: cfdiCode,
          cfdiUseLabel: cfdi?.label ?? cfdiCode,
          state: state.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudieron guardar los datos fiscales.");
      }
      toast.success("Datos fiscales guardados");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardNew>
      <div className="form-section__title">
        <Receipt size={13} style={{ color: "var(--violet-400)" }} /> Datos fiscales{" "}
        <span className="form-section__rule" />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 12px",
          marginBottom: 14,
          borderRadius: "var(--radius)",
          background: "var(--info-soft)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <FileText size={15} style={{ color: "var(--info)", flexShrink: 0, marginTop: 1 }} />
        <p style={{ color: "var(--text-2)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          Se usan para emitir las facturas de tus servicios a las clínicas.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field-new">
          <label className="field-new__label">Razón social</label>
          <input
            className="input-new"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            disabled={!canEdit || saving}
            placeholder="Nombre o razón social ante el SAT"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label">RFC</label>
            <input
              className="input-new mono"
              value={rfc}
              onChange={(e) => setRfc(e.target.value)}
              disabled={!canEdit || saving}
              maxLength={13}
              placeholder="RFC con homoclave"
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Código postal</label>
            <input
              className="input-new mono"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              disabled={!canEdit || saving}
              maxLength={5}
              inputMode="numeric"
              placeholder="5 dígitos"
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label">Régimen fiscal</label>
            <select
              className="input-new"
              value={regimeCode}
              onChange={(e) => setRegimeCode(e.target.value)}
              disabled={!canEdit || saving}
            >
              <option value="">Selecciona…</option>
              {regimeOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.code} — {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Uso de CFDI</label>
            <select
              className="input-new"
              value={cfdiCode}
              onChange={(e) => setCfdiCode(e.target.value)}
              disabled={!canEdit || saving}
            >
              <option value="">Selecciona…</option>
              {cfdiOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.code} — {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-new">
          <label className="field-new__label">Estado</label>
          <input
            className="input-new"
            value={state}
            onChange={(e) => setState(e.target.value)}
            disabled={!canEdit || saving}
            placeholder="Opcional"
          />
        </div>
      </div>

      {canEdit && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <ButtonNew variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar datos fiscales"}
          </ButtonNew>
        </div>
      )}
    </CardNew>
  );
}
