"use client";
import { useMemo, useState } from "react";
import { Search, X, Calculator as CalcIcon } from "lucide-react";
import { CLINICAL_CALCULATORS } from "@/lib/clinical-calculators";
import * as Calculators from "./index";

interface Props { isOpen: boolean; onClose: () => void; defaultSpecialty?: string }

export function CalculatorModal({ isOpen, onClose, defaultSpecialty }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CLINICAL_CALCULATORS.filter(c => {
      const matchQ = !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.specialty.some(s => s.toLowerCase().includes(q));
      const matchSpec = !defaultSpecialty || c.specialty.some(s => s.toLowerCase().includes(defaultSpecialty.toLowerCase()));
      return matchQ && matchSpec;
    });
  }, [search, defaultSpecialty]);

  if (!isOpen) return null;

  const selectedCalc = CLINICAL_CALCULATORS.find(c => c.id === selected);
  const SelectedComponent = selectedCalc ? (Calculators as any)[selectedCalc.component] : null;

  const handleClose = () => {
    setSelected(null);
    setSearch("");
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={handleClose}
    >
      <div
        className="modal modal--wide"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 720,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          background: "var(--bg-elev)",
          borderRadius: 12,
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CalcIcon size={18} color="var(--brand, #7c3aed)" />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Calculadoras clínicas</div>
              <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                {selectedCalc ? selectedCalc.name : `${filtered.length} disponibles`}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="btn-new btn-new--ghost btn-new--sm"
            style={{ padding: 6 }}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {SelectedComponent ? (
            <SelectedComponent onClose={() => setSelected(null)} />
          ) : (
            <>
              <div style={{ position: "relative", marginBottom: 14 }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
                <input
                  className="input-new"
                  style={{ paddingLeft: 36 }}
                  placeholder="Buscar calculadora…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                />
              </div>

              {filtered.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
                  Sin resultados para &quot;{search}&quot;.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {filtered.map(calc => (
                    <button
                      key={calc.id}
                      type="button"
                      onClick={() => setSelected(calc.id)}
                      style={{
                        textAlign: "left",
                        padding: 14,
                        borderRadius: 10,
                        background: "var(--bg-elev-2, rgba(255,255,255,0.03))",
                        border: "1px solid var(--border)",
                        cursor: "pointer",
                        color: "var(--text-1)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{calc.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.4 }}>{calc.description}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {calc.specialty.map(s => (
                          <span
                            key={s}
                            className="tag-new"
                            style={{
                              fontSize: 10,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "rgba(124,58,237,0.12)",
                              color: "var(--brand, #7c3aed)",
                              border: "1px solid rgba(124,58,237,0.25)",
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
