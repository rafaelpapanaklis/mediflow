"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Search, X, Plus, Pill, ShieldAlert, Loader2, PlusCircle } from "lucide-react";
import { isAbortError } from "@/lib/fetch-safe";
import { detectarControlado, type Controlado } from "@/lib/clinical/controlados";
import { caracterNoPermitido, FORMAS_FARMACEUTICAS, LIMITES_PROPIO, VIAS } from "@/lib/clinical/medicamentos-propios.contrato";
import { useT } from "@/i18n/i18n-provider";

interface CumsItem {
  clave: string;
  descripcion: string;
  presentacion: string;
  formaFarmaceutica?: string | null;
  grupoTerapeutico?: string | null;
  cofeprisGroup?: string | null;
  /** ws1-t10: de la lista propia de la clínica. */
  propio?: boolean;
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

// Las formas farmacéuticas y las vías (valor en español, etiqueta traducida)
// viven en el contrato: el servidor solo acepta esos valores.
export { FORMAS_FARMACEUTICAS, VIAS };

const inputStyle: CSSProperties = { width: "100%" };
const etiqueta: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-2)", marginBottom: 4 };
const chipPropio: CSSProperties = {
  marginLeft: 6, padding: "1px 6px", borderRadius: 99, fontSize: 10, fontWeight: 700,
  background: "var(--brand-soft)", color: "var(--brand)", whiteSpace: "nowrap",
};
const chipCofepris: CSSProperties = {
  marginLeft: 6, padding: "1px 6px", borderRadius: 99, fontSize: 10, fontWeight: 700,
  background: "var(--danger-soft)", color: "var(--danger)", whiteSpace: "nowrap",
};
const btnBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8,
  fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)", color: "var(--text-1)",
};
const btnPrimario: CSSProperties = { ...btnBase, background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" };

/**
 * Combobox para buscar y seleccionar medicamentos: el catálogo global (CUMS) +
 * la lista propia de la clínica. Cada item agregado tiene inputs editables:
 * dosage (req), duration, quantity, notes. Items array se controla externamente.
 *
 * ws1-t10 · «Agregar medicamento que no está»: si lo que busca el doctor no
 * aparece, lo da de alta aquí mismo (nombre, concentración, forma, vía y
 * presentación opcional); se guarda en la lista de SU clínica y entra a la
 * receta. CANDADO: un controlado (grupos COFEPRIS I, II, III) no se puede
 * agregar a mano — la pantalla lo avisa al escribirlo y el servidor lo rechaza
 * (422); se manda al catálogo, donde la receta pide el folio.
 */
export function CumsSelector({ items, onChange, disabled }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CumsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [puedeAgregar, setPuedeAgregar] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Alta de un medicamento propio
  const [agregando, setAgregando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [concentracion, setConcentracion] = useState("");
  const [forma, setForma] = useState<string>("Tableta");
  const [via, setVia] = useState<string>("Oral");
  const [presentacion, setPresentacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [controladoServidor, setControladoServidor] = useState<Controlado | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setBuscado(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Patrón abortable (ver src/lib/fetch-safe.ts) — mismo caso que Cie10Selector:
    // la receta se escribe dentro de un modal que puede cerrarse a media búsqueda.
    const ctrl = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/catalogs/cums?q=${encodeURIComponent(query)}&limit=20`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (!ctrl.signal.aborted) {
            setResults(data.items ?? []);
            setPuedeAgregar(data.puedeAgregar === true);
            setBuscado(true);
          }
        }
      } catch (err) {
        if (!isAbortError(err)) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      ctrl.abort();
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

  function abrirAlta() {
    setNombre(query.trim());
    setConcentracion(""); setForma("Tableta"); setVia("Oral"); setPresentacion("");
    setErrorAlta(null); setControladoServidor(null);
    setAgregando(true);
    setOpen(false);
  }

  function cerrarAlta() {
    setAgregando(false);
    setErrorAlta(null); setControladoServidor(null);
  }

  /** Vuelve al buscador con el nombre del controlado: ahí está, con su folio. */
  function buscarEnCatalogo(nombreControlado: string) {
    cerrarAlta();
    setQuery(nombreControlado);
    setOpen(true);
  }

  // El candado, en la pantalla: avisa mientras escribe. La regla la impone el servidor.
  const controladoLocal = agregando ? detectarControlado(nombre, concentracion, presentacion, forma, via) : null;
  const faltanDatos = nombre.trim().length < 2 || !concentracion.trim() || !forma || !via;
  // v2: solo caracteres permitidos (letras latinas, dígitos y `. , % / + - ( ) :`);
  // el servidor responde 400 a lo demás ANTES de mirar el candado, y la
  // pantalla sigue el mismo orden: primero el carácter, luego el controlado.
  const caracterRaro = agregando ? [nombre, concentracion, presentacion].map(caracterNoPermitido).find(Boolean) ?? null : null;
  const controlado = caracterRaro ? null : (controladoServidor ?? controladoLocal);

  async function guardarAlta() {
    if (guardando || controlado || caracterRaro) return;
    if (faltanDatos) {
      setErrorAlta(t("clinical.cumsSelector.form.errorRequired"));
      return;
    }
    setGuardando(true);
    setErrorAlta(null);
    try {
      const res = await fetch("/api/catalogs/cums/propios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, concentracion, forma, via, presentacion: presentacion || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.medicamento) {
        pick({ ...data.medicamento, propio: true });
        cerrarAlta();
        return;
      }
      if (res.status === 422 && data?.controlado) {
        setControladoServidor(data.controlado);
        return;
      }
      if (res.status === 503) {
        setPuedeAgregar(false);
        setErrorAlta(t("clinical.cumsSelector.form.errorSinSql"));
        return;
      }
      if (res.status === 400) {
        setErrorAlta(t(data?.motivo === "caracteres" ? "clinical.cumsSelector.form.errorChars" : "clinical.cumsSelector.form.errorRequired", { char: "" }));
        return;
      }
      setErrorAlta(t("clinical.cumsSelector.form.errorGeneric"));
    } catch {
      setErrorAlta(t("clinical.cumsSelector.form.errorGeneric"));
    } finally {
      setGuardando(false);
    }
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
                background: "var(--bg-elev)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pill size={14} aria-hidden style={{ color: "var(--brand)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)" }}>
                    {it.cums?.descripcion ?? it.cumsKey}
                    {it.cums?.propio && <span style={chipPropio}>{t("clinical.cumsSelector.ownBadge")}</span>}
                  </div>
                  {it.cums?.presentacion && (
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {it.cums.presentacion}
                      {it.cums.cofeprisGroup && (
                        <span style={chipCofepris}>{t("clinical.cumsSelector.cofeprisBadge", { group: it.cums.cofeprisGroup })}</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label={t("clinical.cumsSelector.remove")}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)" }}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
                <input
                  className="input-new"
                  placeholder={t("clinical.cumsSelector.dosagePlaceholder")}
                  value={it.dosage}
                  onChange={(e) => update(idx, { dosage: e.target.value })}
                  required
                  style={{ gridColumn: "span 2" }}
                />
                <input
                  className="input-new"
                  placeholder={t("clinical.cumsSelector.durationPlaceholder")}
                  value={it.duration ?? ""}
                  onChange={(e) => update(idx, { duration: e.target.value })}
                />
                <input
                  className="input-new"
                  placeholder={t("clinical.cumsSelector.quantityPlaceholder")}
                  value={it.quantity ?? ""}
                  onChange={(e) => update(idx, { quantity: e.target.value })}
                />
              </div>
              <input
                className="input-new"
                placeholder={t("clinical.cumsSelector.notesPlaceholder")}
                value={it.notes ?? ""}
                onChange={(e) => update(idx, { notes: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {/* Alta de un medicamento propio */}
      {agregando && (
        <div
          data-testid="alta-medicamento"
          style={{
            marginBottom: 12, padding: 12, borderRadius: 10,
            border: "1px solid var(--border-strong)", background: "var(--bg-elev)",
            display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{t("clinical.cumsSelector.form.title")}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{t("clinical.cumsSelector.form.hint")}</div>
            </div>
            <button type="button" onClick={cerrarAlta} aria-label={t("common.close")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
              <X size={14} aria-hidden />
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <label style={{ gridColumn: "1 / -1" }}>
              <span style={etiqueta}>{t("clinical.cumsSelector.form.name")} *</span>
              <input
                className="input-new"
                style={inputStyle}
                value={nombre}
                maxLength={LIMITES_PROPIO.nombre}
                onChange={(e) => { setNombre(e.target.value); setControladoServidor(null); }}
                placeholder={t("clinical.cumsSelector.form.namePlaceholder")}
                autoFocus
              />
            </label>
            <label>
              <span style={etiqueta}>{t("clinical.cumsSelector.form.strength")} *</span>
              <input
                className="input-new"
                style={inputStyle}
                value={concentracion}
                maxLength={LIMITES_PROPIO.concentracion}
                onChange={(e) => { setConcentracion(e.target.value); setControladoServidor(null); }}
                placeholder={t("clinical.cumsSelector.form.strengthPlaceholder")}
              />
            </label>
            <label>
              <span style={etiqueta}>{t("clinical.cumsSelector.form.form")} *</span>
              <select className="input-new" style={inputStyle} value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS_FARMACEUTICAS.map(([clave, valor]) => (
                  <option key={clave} value={valor}>{t(`clinical.cumsSelector.forms.${clave}`)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={etiqueta}>{t("clinical.cumsSelector.form.route")} *</span>
              <select className="input-new" style={inputStyle} value={via} onChange={(e) => setVia(e.target.value)}>
                {VIAS.map(([clave, valor]) => (
                  <option key={clave} value={valor}>{t(`clinical.cumsSelector.routes.${clave}`)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={etiqueta}>{t("clinical.cumsSelector.form.presentation")}</span>
              <input
                className="input-new"
                style={inputStyle}
                value={presentacion}
                maxLength={LIMITES_PROPIO.presentacion}
                onChange={(e) => { setPresentacion(e.target.value); setControladoServidor(null); }}
                placeholder={t("clinical.cumsSelector.form.presentationPlaceholder")}
              />
            </label>
          </div>

          {controlado && (
            <div
              role="alert"
              data-testid="candado-controlado"
              style={{
                display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8,
                background: "var(--danger-soft)", border: "1px solid var(--danger-border-strong)", color: "var(--danger)", fontSize: 12,
              }}
            >
              <ShieldAlert size={16} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <strong>{t("clinical.cumsSelector.controlled.title", { name: controlado.nombre, group: controlado.grupo })}</strong>
                <span style={{ color: "var(--text-2)" }}>{t("clinical.cumsSelector.controlled.body")}</span>
                <button type="button" onClick={() => buscarEnCatalogo(controlado.nombre)} style={{ ...btnBase, alignSelf: "flex-start", padding: "6px 10px" }}>
                  <Search size={13} aria-hidden />
                  {t("clinical.cumsSelector.controlled.search", { name: controlado.nombre })}
                </button>
              </div>
            </div>
          )}

          {caracterRaro && (
            <div role="alert" data-testid="caracter-no-permitido" style={{ fontSize: 12, color: "var(--danger)" }}>
              {t("clinical.cumsSelector.form.errorChars", { char: caracterRaro })}
            </div>
          )}

          {errorAlta && !controlado && !caracterRaro && (
            <div role="alert" style={{ fontSize: 12, color: "var(--danger)" }}>{errorAlta}</div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={cerrarAlta} style={btnBase} disabled={guardando}>
              {t("clinical.cumsSelector.form.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void guardarAlta()}
              style={{ ...btnPrimario, opacity: controlado || caracterRaro || guardando ? 0.6 : 1, cursor: controlado || caracterRaro ? "not-allowed" : "pointer" }}
              disabled={!!controlado || !!caracterRaro || guardando}
              aria-disabled={!!controlado || !!caracterRaro || guardando}
            >
              {guardando ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <PlusCircle size={13} aria-hidden />}
              {guardando ? t("clinical.cumsSelector.form.saving") : t("clinical.cumsSelector.form.save")}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ position: "relative" }}>
        <Search size={14} aria-hidden style={{ position: "absolute", top: 12, left: 12, color: "var(--text-3)" }} />
        <input
          type="text"
          disabled={disabled}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={t("clinical.cumsSelector.searchPlaceholder")}
          aria-label={t("clinical.cumsSelector.searchPlaceholder")}
          style={{
            width: "100%",
            padding: "10px 14px 10px 34px",
            fontSize: 13,
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
            background: "var(--bg-elev)",
            color: "var(--text-1)",
            fontFamily: "inherit",
          }}
        />
      </div>

      {open && !agregando && (loading || results.length > 0 || query.trim().length >= 2) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0, right: 0,
            maxHeight: 320, overflowY: "auto",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10, zIndex: 20,
            boxShadow: "0 12px 30px -12px rgba(15,23,42,0.30)",
          }}
        >
          {loading && <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)" }}>{t("clinical.cumsSelector.searching")}</div>}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)" }}>{t("clinical.cumsSelector.noResults")}</div>
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
                  borderTop: "1px solid var(--border-soft)",
                  background: already ? "var(--bg-elev-2)" : "transparent",
                  textAlign: "left", cursor: already ? "default" : "pointer",
                  fontFamily: "inherit", fontSize: 12,
                  color: already ? "var(--text-3)" : "var(--text-1)",
                }}
              >
                {already ? <span style={{ fontSize: 11 }}>✓</span> : <Plus size={12} aria-hidden style={{ color: "var(--brand)", marginTop: 2 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {m.descripcion}
                    {m.propio && <span style={chipPropio}>{t("clinical.cumsSelector.ownBadge")}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    {m.presentacion}
                    {m.cofeprisGroup && <span style={{ marginLeft: 6, color: "var(--danger)", fontWeight: 600 }}>· {t("clinical.cumsSelector.cofeprisBadge", { group: m.cofeprisGroup })}</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {!loading && buscado && puedeAgregar && !disabled && (
            <button
              type="button"
              onClick={abrirAlta}
              data-testid="agregar-medicamento"
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", border: "none", borderTop: "1px solid var(--border-soft)",
                background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 700,
                textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                position: "sticky", bottom: 0,
              }}
            >
              <PlusCircle size={14} aria-hidden />
              {t("clinical.cumsSelector.addMissing")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
