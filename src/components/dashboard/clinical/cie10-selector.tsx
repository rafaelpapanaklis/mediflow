"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, Star, Plus } from "lucide-react";

interface Cie10Code {
  code: string;
  description: string;
  chapter: string;
}

interface Diagnosis {
  id: string;
  cie10Code: string;
  isPrimary: boolean;
  note: string | null;
  cie10?: Cie10Code;
}

interface Props {
  diagnoses: Diagnosis[];
  onAdd: (input: { cie10Code: string; isPrimary: boolean; note?: string }) => Promise<void>;
  onRemove: (dxId: string) => Promise<void>;
  disabled?: boolean;
}

/**
 * Combobox para buscar y seleccionar códigos CIE-10. Muestra los dx ya
 * agregados arriba con chip por código + estrella si es primario + ✕ para
 * remover. Abajo, input con búsqueda async a /api/catalogs/cie10.
 */
export function Cie10Selector({ diagnoses, onAdd, onRemove, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Cie10Code[]>([]);
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
        const res = await fetch(`/api/catalogs/cie10?q=${encodeURIComponent(query)}&limit=20`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.codes ?? []);
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
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

  async function pick(code: Cie10Code) {
    if (diagnoses.some((d) => d.cie10Code === code.code)) {
      setOpen(false); setQuery("");
      return;
    }
    await onAdd({
      cie10Code: code.code,
      isPrimary: diagnoses.length === 0, // primero agregado = primario por default
    });
    setOpen(false); setQuery("");
  }

  async function togglePrimary(dx: Diagnosis) {
    if (dx.isPrimary) return; // already primary, nothing to do
    await onAdd({ cie10Code: dx.cie10Code, isPrimary: true });
    // Caller re-fetches; simpler than handling state locally
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Selected diagnoses */}
      {diagnoses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {diagnoses.map((dx) => (
            <div
              key={dx.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                background: dx.isPrimary ? "rgba(124, 58, 237, 0.08)" : "var(--bg-elev, #f8fafc)",
                border: `1px solid ${dx.isPrimary ? "rgba(124, 58, 237, 0.30)" : "var(--border-soft, #e2e8f0)"}`,
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <button
                type="button"
                onClick={() => togglePrimary(dx)}
                title={dx.isPrimary ? "Diagnóstico primario" : "Marcar como primario"}
                aria-pressed={dx.isPrimary}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: dx.isPrimary ? "default" : "pointer",
                  color: dx.isPrimary ? "#7c3aed" : "var(--text-3, #94a3b8)",
                }}
              >
                <Star size={13} fill={dx.isPrimary ? "currentColor" : "none"} aria-hidden />
              </button>
              <code style={{
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                fontWeight: 700,
                color: "var(--text-1, #0f172a)",
                minWidth: 56,
              }}>
                {dx.cie10Code}
              </code>
              <span style={{ flex: 1, color: "var(--text-2, #475569)" }}>
                {dx.cie10?.description ?? ""}
              </span>
              <button
                type="button"
                onClick={() => onRemove(dx.id)}
                aria-label={`Quitar ${dx.cie10Code}`}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-3, #94a3b8)",
                }}
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search input */}
      <div style={{ position: "relative" }}>
        <Search
          size={14}
          aria-hidden
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            color: "var(--text-3, #94a3b8)",
          }}
        />
        <input
          type="text"
          disabled={disabled}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar diagnóstico CIE-10 por código o descripción…"
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

      {/* Results dropdown */}
      {open && (loading || results.length > 0 || query.trim().length >= 2) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 280,
            overflowY: "auto",
            background: "var(--bg-elev, #fff)",
            border: "1px solid var(--border-strong, #94a3b8)",
            borderRadius: 10,
            zIndex: 20,
            boxShadow: "0 12px 30px -12px rgba(15,23,42,0.30)",
          }}
        >
          {loading && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3, #94a3b8)" }}>
              Buscando…
            </div>
          )}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3, #94a3b8)" }}>
              Sin resultados. Intenta otra palabra clave.
            </div>
          )}
          {!loading && results.map((c) => {
            const already = diagnoses.some((d) => d.cie10Code === c.code);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => !already && pick(c)}
                disabled={already}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: "none",
                  borderTop: "1px solid var(--border-soft, #f1f5f9)",
                  background: already ? "var(--bg-elev-2, #f1f5f9)" : "transparent",
                  textAlign: "left",
                  cursor: already ? "default" : "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  color: already ? "var(--text-3, #94a3b8)" : "var(--text-1, #0f172a)",
                }}
                onMouseEnter={(e) => { if (!already) e.currentTarget.style.background = "var(--bg-elev-2, #f1f5f9)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = already ? "var(--bg-elev-2, #f1f5f9)" : "transparent"; }}
              >
                {already ? (
                  <span style={{ color: "var(--text-3, #94a3b8)", fontSize: 11 }}>✓</span>
                ) : (
                  <Plus size={12} aria-hidden style={{ color: "var(--brand, #2563eb)" }} />
                )}
                <code style={{
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontWeight: 700,
                  minWidth: 56,
                }}>
                  {c.code}
                </code>
                <span style={{ flex: 1 }}>{c.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
