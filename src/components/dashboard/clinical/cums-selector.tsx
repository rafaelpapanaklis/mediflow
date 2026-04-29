"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, Plus, Pill } from "lucide-react";

interface CumsItem {
  clave: string;
  descripcion: string;
  presentacion: string;
  formaFarmaceutica?: string | null;
  grupoTerapeutico?: string | null;
  cofeprisGroup?: string | null;
}

export interface PrescriptionItemDraft {
  cumsKey: string;
  dosage: string;
  duration?: string;
  quantity?: string;
  notes?: string;
  cums?: CumsItem; // hydrated for display
}

interface Props {
  items: PrescriptionItemDraft[];
  onChange: (items: PrescriptionItemDraft[]) => void;
  disabled?: boolean;
}

/**
 * Combobox para buscar y seleccionar medicamentos del catálogo CUMS.
 * Cada item agregado tiene inputs editables: dosage (req), duration,
 * quantity, notes. Items array se controla externamente.
 */
export function CumsSelector({ items, onChange, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CumsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/catalogs/cums?q=${encodeURIComponent(query)}&limit=20`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.items ?? []);
        }
      } finally { setLoading(false); }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(item: CumsItem) {
    if (items.some((i) => i.cumsKey === item.clave)) {
      setOpen(false); setQuery("");
      return;
    }
    onChange([...items, { cumsKey: item.clave, dosage: "", cums: item }]);
    setOpen(false); setQuery("");
  }

  function update(idx: number, patch: Partial<PrescriptionItemDraft>) {
    onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {items.map((it, idx) => (
            <div
              key={`${it.cumsKey}-${idx}`}
              style={{
                padding: 10,
                background: "var(--bg-elev, #f8fafc)",
                border: "1px solid var(--border-soft, #e2e8f0)",
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pill size={14} aria-hidden style={{ color: "var(--brand, #2563eb)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1, #0f172a)" }}>
                    {it.cums?.descripcion ?? it.cumsKey}
                  </div>
                  {it.cums?.presentacion && (
                    <div style={{ fontSize: 11, color: "var(--text-3, #64748b)" }}>
                      {it.cums.presentacion}
                      {it.cums.cofeprisGroup && (
                        <span style={{ marginLeft: 8, padding: "1px 6px", background: "rgba(220, 38, 38, 0.10)", color: "#b91c1c", borderRadius: 99, fontWeight: 600 }}>
                          COFEPRIS {it.cums.cofeprisGroup}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label="Quitar medicamento"
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3, #94a3b8)" }}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 6 }}>
                <input
                  className="input-new"
                  placeholder="Dosis: 1 tableta cada 8h*"
                  value={it.dosage}
                  onChange={(e) => update(idx, { dosage: e.target.value })}
                  required
                />
                <input
                  className="input-new"
                  placeholder="Duración: 7 días"
                  value={it.duration ?? ""}
                  onChange={(e) => update(idx, { duration: e.target.value })}
                />
                <input
                  className="input-new"
                  placeholder="Cant: 21 tab"
                  value={it.quantity ?? ""}
                  onChange={(e) => update(idx, { quantity: e.target.value })}
                />
              </div>
              <input
                className="input-new"
                placeholder="Notas (opcional, ej: tomar con alimentos)"
                value={it.notes ?? ""}
                onChange={(e) => update(idx, { notes: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ position: "relative" }}>
        <Search size={14} aria-hidden style={{ position: "absolute", top: 12, left: 12, color: "var(--text-3, #94a3b8)" }} />
        <input
          type="text"
          disabled={disabled}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar medicamento por nombre o clave CUMS…"
          style={{
            width: "100%",
            padding: "10px 14px 10px 34px",
            fontSize: 13,
            border: "1px solid var(--border-soft, #cbd5e1)",
            borderRadius: 10,
            background: "var(--bg-elev, #fff)",
            color: "var(--text-1, #0f172a)",
            fontFamily: "inherit",
          }}
        />
      </div>

      {open && (loading || results.length > 0 || query.trim().length >= 2) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0, right: 0,
            maxHeight: 320, overflowY: "auto",
            background: "var(--bg-elev, #fff)",
            border: "1px solid var(--border-strong, #94a3b8)",
            borderRadius: 10, zIndex: 20,
            boxShadow: "0 12px 30px -12px rgba(15,23,42,0.30)",
          }}
        >
          {loading && <div style={{ padding: 12, fontSize: 12, color: "var(--text-3, #94a3b8)" }}>Buscando…</div>}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3, #94a3b8)" }}>Sin resultados.</div>
          )}
          {!loading && results.map((m) => {
            const already = items.some((i) => i.cumsKey === m.clave);
            return (
              <button
                key={m.clave}
                type="button"
                onClick={() => !already && pick(m)}
                disabled={already}
                style={{
                  width: "100%", display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "10px 12px", border: "none",
                  borderTop: "1px solid var(--border-soft, #f1f5f9)",
                  background: already ? "var(--bg-elev-2, #f1f5f9)" : "transparent",
                  textAlign: "left", cursor: already ? "default" : "pointer",
                  fontFamily: "inherit", fontSize: 12,
                  color: already ? "var(--text-3, #94a3b8)" : "var(--text-1, #0f172a)",
                }}
              >
                {already ? <span style={{ fontSize: 11 }}>✓</span> : <Plus size={12} aria-hidden style={{ color: "var(--brand, #2563eb)", marginTop: 2 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{m.descripcion}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3, #94a3b8)", marginTop: 2 }}>
                    {m.presentacion}
                    {m.cofeprisGroup && <span style={{ marginLeft: 6, color: "#b91c1c", fontWeight: 600 }}>· COFEPRIS {m.cofeprisGroup}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
