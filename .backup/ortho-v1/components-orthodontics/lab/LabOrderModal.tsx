"use client";
// Orthodontics — modal de creación de LabOrder con los 5 sub-tipos orto.
// SPEC commit 5. Reusa la action cross-cutting createLabOrder.

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import {
  ORTHO_LAB_SUBTYPES,
  ORTHO_LAB_SUBTYPE_LABELS,
  ORTHO_LAB_TYPE_MAP,
  ORTHO_LAB_REQUIRED_SPEC_FIELDS,
  ORTHO_LAB_DEFAULT_SPEC,
  type OrthoLabSubtype,
} from "@/lib/orthodontics/lab-orders";
import {
  createLabOrder,
  listLabPartners,
} from "@/app/actions/clinical-shared/lab-orders";
import { isFailure } from "@/lib/clinical-shared/result";
import type { LabPartnerDTO } from "@/lib/clinical-shared/lab-orders/types";

export interface LabOrderModalProps {
  patientId: string;
  onClose: () => void;
  onCreated?: (orderId: string, pdfUrl: string) => void;
}

export function LabOrderModal(props: LabOrderModalProps) {
  const [subtype, setSubtype] = useState<OrthoLabSubtype>("alineadores_serie");
  const [partners, setPartners] = useState<LabPartnerDTO[]>([]);
  const [partnerId, setPartnerId] = useState<string>("");
  const [spec, setSpec] = useState<Record<string, string>>(
    ORTHO_LAB_DEFAULT_SPEC.alineadores_serie,
  );
  const [shadeGuide, setShadeGuide] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSpec({ ...ORTHO_LAB_DEFAULT_SPEC[subtype] });
  }, [subtype]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listLabPartners();
      if (cancelled) return;
      if (!isFailure(res)) {
        setPartners(res.data.filter((p) => p.isActive));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requiredFields = ORTHO_LAB_REQUIRED_SPEC_FIELDS[subtype];
  const missing = useMemo(
    () => requiredFields.filter((f) => !spec[f] || spec[f].trim() === ""),
    [requiredFields, spec],
  );

  const submit = async () => {
    if (missing.length > 0) {
      toast.error(`Faltan campos: ${missing.join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await createLabOrder({
        patientId: props.patientId,
        module: "orthodontics",
        partnerId: partnerId || null,
        orderType: ORTHO_LAB_TYPE_MAP[subtype],
        spec,
        toothFdi: null,
        shadeGuide: shadeGuide || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        notes: notes || null,
      });
      if (isFailure(res)) {
        toast.error(res.error);
        return;
      }
      toast.success("Orden de laboratorio creada");
      props.onCreated?.(res.data.id, res.data.pdfUrl);
      props.onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nueva orden de laboratorio"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface-1)",
          color: "var(--text-1)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 18,
        }}
      >
        <header
          style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>Orden de laboratorio · Ortodoncia</h3>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={fieldLabel}>
            <span style={fieldHint}>Tipo de trabajo</span>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value as OrthoLabSubtype)}
              style={inputStyle}
            >
              {ORTHO_LAB_SUBTYPES.map((t) => (
                <option key={t} value={t}>
                  {ORTHO_LAB_SUBTYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldLabel}>
            <span style={fieldHint}>Laboratorio</span>
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              style={inputStyle}
            >
              <option value="">Sin asignar</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <legend style={{ fontSize: 11, color: "var(--text-2)", padding: "0 4px" }}>
              Especificaciones (campos requeridos en {requiredFields.join(", ")})
            </legend>
            {Object.keys(spec).map((key) => (
              <label key={key} style={fieldLabel}>
                <span style={fieldHint}>
                  {key}
                  {requiredFields.includes(key) ? " *" : ""}
                </span>
                <input
                  type="text"
                  value={spec[key]}
                  onChange={(e) => setSpec({ ...spec, [key]: e.target.value })}
                  style={inputStyle}
                  required={requiredFields.includes(key)}
                />
              </label>
            ))}
          </fieldset>

          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ ...fieldLabel, flex: 1 }}>
              <span style={fieldHint}>Color/guía</span>
              <input
                type="text"
                value={shadeGuide}
                onChange={(e) => setShadeGuide(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ ...fieldLabel, flex: 1 }}>
              <span style={fieldHint}>Fecha entrega</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>

          <label style={fieldLabel}>
            <span style={fieldHint}>Notas adicionales</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            />
          </label>
        </div>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 14,
          }}
        >
          <button type="button" onClick={props.onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || missing.length > 0}
            style={{ ...btnPrimary, opacity: missing.length > 0 ? 0.5 : 1 }}
          >
            {submitting ? "Creando…" : "Crear orden + PDF"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};
const fieldHint: React.CSSProperties = { fontSize: 11, color: "var(--text-2)" };
const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--surface-1)",
  color: "var(--text-1)",
  fontSize: 12,
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid var(--brand, #6366f1)",
  background: "var(--brand, #6366f1)",
  color: "white",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-1)",
  fontSize: 12,
  cursor: "pointer",
};
