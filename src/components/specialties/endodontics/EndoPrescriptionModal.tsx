"use client";
// EndoPrescriptionModal — modal "Generar receta" pre-cargado al cerrar
// un TC. Lista las 3 plantillas pos-TC (basic / absceso / cirugía
// apical), permite editar items y exporta vía portapapeles. onConfirm
// entrega el payload editable al caller para postear a
// POST /api/prescriptions cuando se requiera NOM-024 + QR oficial.
//
// Usa la API canónica de main: PrescriptionItem con drugName,
// presentation, dosage, duration, route, notes.

import { useMemo, useState } from "react";
import { Pill, Copy, Check, X } from "lucide-react";
import {
  ENDO_POST_TC_BASIC_TEMPLATE,
  ENDO_POST_TC_ABSCESO_TEMPLATE,
  ENDO_POST_CIRUGIA_APICAL_TEMPLATE,
  type PrescriptionItem,
  type PrescriptionTemplate,
} from "@/lib/prescriptions/templates";

const ENDO_TEMPLATES: readonly PrescriptionTemplate[] = [
  ENDO_POST_TC_BASIC_TEMPLATE,
  ENDO_POST_TC_ABSCESO_TEMPLATE,
  ENDO_POST_CIRUGIA_APICAL_TEMPLATE,
];

export interface EndoPrescriptionModalProps {
  open: boolean;
  patientName: string;
  toothFdi: number;
  initialTemplateKey?: string;
  onConfirm?: (payload: { indications: string; items: PrescriptionItem[] }) => void;
  onClose: () => void;
}

export function EndoPrescriptionModal(props: EndoPrescriptionModalProps) {
  const [selectedKey, setSelectedKey] = useState<string>(
    props.initialTemplateKey ?? ENDO_POST_TC_BASIC_TEMPLATE.key,
  );
  const selected = useMemo(
    () => ENDO_TEMPLATES.find((t) => t.key === selectedKey) ?? ENDO_TEMPLATES[0]!,
    [selectedKey],
  );
  const [indications, setIndications] = useState(selected.indications);
  const [items, setItems] = useState<PrescriptionItem[]>(selected.items);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(t: PrescriptionTemplate) {
    setSelectedKey(t.key);
    setIndications(t.indications);
    setItems(t.items.map((it) => ({ ...it })));
    setError(null);
  }

  function updateItem(idx: number, patch: Partial<PrescriptionItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { drugName: "", presentation: "", dosage: "", duration: "", route: "Vía oral" },
    ]);
  }

  async function copyToClipboard() {
    setError(null);
    try {
      const txt = formatRecipeForClipboard({
        patientName: props.patientName,
        toothFdi: props.toothFdi,
        indications,
        items,
      });
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("No se pudo copiar al portapapeles.");
    }
  }

  if (!props.open) return null;

  return (
    <div role="dialog" aria-modal="true" onClick={props.onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <header style={header}>
          <strong style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <Pill size={16} /> Generar receta · {props.patientName} · pieza {props.toothFdi}
          </strong>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" style={iconBtn}>
            <X size={18} />
          </button>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", flex: 1, minHeight: 0 }}>
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 8,
              borderRight: "1px solid var(--border)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {ENDO_TEMPLATES.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => applyTemplate(t)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor:
                      t.key === selectedKey ? "var(--accent, #2563eb)" : "transparent",
                    background:
                      t.key === selectedKey ? "var(--surface-2)" : "transparent",
                    color: "var(--text-1)",
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{t.label}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{t.key}</span>
                </button>
              </li>
            ))}
          </ol>

          <div
            style={{
              padding: 14,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>{selected.description}</p>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--text-2)" }}>Indicaciones generales</span>
              <textarea
                value={indications}
                onChange={(e) => setIndications(e.target.value)}
                rows={5}
                style={textareaStyle}
              />
            </label>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <strong style={{ fontSize: 13 }}>Medicamentos</strong>
                <button type="button" onClick={addItem} style={btnSecondary}>
                  + Agregar
                </button>
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {items.map((it, i) => (
                  <li
                    key={i}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: 8,
                      background: "var(--surface-1)",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 6,
                    }}
                  >
                    <Field label="Medicamento">
                      <input
                        value={it.drugName}
                        onChange={(e) => updateItem(i, { drugName: e.target.value })}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Presentación">
                      <input
                        value={it.presentation}
                        onChange={(e) => updateItem(i, { presentation: e.target.value })}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Dosis">
                      <input
                        value={it.dosage}
                        onChange={(e) => updateItem(i, { dosage: e.target.value })}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Duración">
                      <input
                        value={it.duration}
                        onChange={(e) => updateItem(i, { duration: e.target.value })}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Vía">
                      <input
                        value={it.route}
                        onChange={(e) => updateItem(i, { route: e.target.value })}
                        style={inputStyle}
                      />
                    </Field>
                    <Field label="Notas" cols={2}>
                      <textarea
                        value={it.notes ?? ""}
                        onChange={(e) => updateItem(i, { notes: e.target.value })}
                        rows={2}
                        style={textareaStyle}
                      />
                    </Field>
                    <div style={{ gridColumn: "1 / span 2", textAlign: "right" }}>
                      <button type="button" onClick={() => removeItem(i)} style={btnDanger}>
                        Quitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {error ? (
              <div role="alert" style={{ color: "var(--danger, #dc2626)", fontSize: 12 }}>
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <footer style={footer}>
          <button type="button" onClick={copyToClipboard} style={btnSecondary}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiado" : "Copiar receta"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (props.onConfirm) props.onConfirm({ indications, items });
              props.onClose();
            }}
            style={btnPrimary}
          >
            Confirmar
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field(props: { label: string; cols?: number; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        color: "var(--text-2)",
        gridColumn: props.cols ? `1 / span ${props.cols}` : undefined,
      }}
    >
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function formatRecipeForClipboard(args: {
  patientName: string;
  toothFdi: number;
  indications: string;
  items: PrescriptionItem[];
}): string {
  const lines = [
    `Paciente: ${args.patientName}`,
    `Pieza dental: ${args.toothFdi}`,
    "",
    "Medicamentos:",
    ...args.items.map(
      (it, idx) =>
        `${idx + 1}. ${it.drugName} ${it.presentation} — ${it.dosage} · ${it.route} · ${it.duration}${
          it.notes ? `\n   Notas: ${it.notes}` : ""
        }`,
    ),
    "",
    "Indicaciones:",
    args.indications,
  ];
  return lines.join("\n");
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9100,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};
const modal: React.CSSProperties = {
  width: "min(820px, 100%)",
  maxHeight: "90vh",
  background: "var(--surface-1)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
};
const footer: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
  padding: "10px 14px",
  borderTop: "1px solid var(--border)",
};
const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--surface-1)",
  color: "var(--text-1)",
  fontSize: 13,
};
const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "inherit",
  resize: "vertical",
};
const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  background: "var(--accent, #2563eb)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  background: "var(--surface-2)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  ...btnSecondary,
  color: "var(--danger, #dc2626)",
};
