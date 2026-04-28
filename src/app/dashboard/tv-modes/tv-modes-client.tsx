"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Copy, ExternalLink, Tv, X, Save } from "lucide-react";
import toast from "react-hot-toast";

interface TVDisplay {
  id: string;
  name: string;
  mode: "OPERATIONAL" | "MARKETING" | "HYBRID";
  config: TVDisplayConfig;
  publicSlug: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TVDisplayConfig {
  // MARKETING
  promotions?: Array<{ title: string; description: string; durationSec: number }>;
  testimonials?: Array<{ author: string; text: string }>;
  // HYBRID
  showWaitTimes?: boolean;
  // Both
  brandLogo?: string | null;
  brandColor?: string | null;
}

const MODE_LABELS = {
  OPERATIONAL: "Operativo (sala de espera)",
  MARKETING:   "Marketing (carrusel)",
  HYBRID:      "Hybrid (split 60/40)",
};

const MODE_DESCRIPTIONS = {
  OPERATIONAL: "Muestra turnos en tiempo real, llamada de pacientes, tiempos.",
  MARKETING:   "Carrusel de promociones + testimonios + branding clínica.",
  HYBRID:      "Split: arriba turnos, abajo carrusel de marketing.",
};

const EMPTY_CONFIG: TVDisplayConfig = {
  promotions: [],
  testimonials: [],
  showWaitTimes: true,
  brandLogo: null,
  brandColor: null,
};

export function TvModesClient() {
  const [displays, setDisplays] = useState<TVDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TVDisplay | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { refetch(); }, []);

  async function refetch() {
    setLoading(true);
    try {
      const res = await fetch("/api/tv-displays");
      if (!res.ok) throw new Error();
      const j = await res.json();
      setDisplays(j.displays);
    } catch {
      toast.error("Error al cargar pantallas TV");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(d: TVDisplay) {
    if (!confirm(`¿Eliminar "${d.name}"? La URL ${d.publicSlug} dejará de funcionar.`)) return;
    try {
      const res = await fetch(`/api/tv-displays/${d.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Pantalla eliminada");
      refetch();
    } catch {
      toast.error("Error al eliminar");
    }
  }

  async function toggleActive(d: TVDisplay) {
    try {
      const res = await fetch(`/api/tv-displays/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !d.active }),
      });
      if (!res.ok) throw new Error();
      refetch();
    } catch {
      toast.error("Error al actualizar");
    }
  }

  function copyUrl(slug: string) {
    const url = `${window.location.origin}/tv/${slug}`;
    navigator.clipboard.writeText(url).then(() => toast.success("URL copiada"));
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1200, margin: "0 auto", fontFamily: "var(--font-sora, 'Sora', sans-serif)" }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(18px, 1.5vw, 24px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Pantallas TV
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            Gestiona pantallas para sala de espera. Cada una tiene su URL pública.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{
            padding: "8px 14px", fontSize: 13, fontWeight: 700,
            background: "var(--brand)", color: "#fff",
            border: "1px solid var(--brand)", borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
            display: "inline-flex", alignItems: "center", gap: 6,
            boxShadow: "0 6px 18px -6px rgba(124, 58, 237, 0.5)",
          }}
        >
          <Plus size={14} aria-hidden /> Crear pantalla
        </button>
      </header>

      {loading ? (
        <Box>Cargando…</Box>
      ) : displays.length === 0 ? (
        <Box>
          <Tv size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} aria-hidden />
          <strong style={{ color: "var(--text-2)", display: "block" }}>Sin pantallas configuradas</strong>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 6 }}>
            Crea tu primera pantalla y obtén un URL público para mostrarla en una TV de sala.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{
              marginTop: 14, padding: "8px 14px", fontSize: 13, fontWeight: 700,
              background: "var(--brand)", color: "#fff",
              border: "1px solid var(--brand)", borderRadius: 8,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            + Crear primera pantalla
          </button>
        </Box>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {displays.map((d) => (
            <div
              key={d.id}
              style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border-soft)",
                borderRadius: 14,
                padding: 18,
                opacity: d.active ? 1 : 0.6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>{d.name}</h3>
                    {!d.active && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", background: "var(--bg-elev-2)", padding: "2px 8px", borderRadius: 999 }}>
                        INACTIVA
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                    {MODE_LABELS[d.mode]} · {MODE_DESCRIPTIONS[d.mode]}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <IconBtn label="Editar" onClick={() => setEditing(d)} icon={<Pencil size={13} aria-hidden />} />
                  <IconBtn label="Eliminar" onClick={() => handleDelete(d)} icon={<Trash2 size={13} aria-hidden />} danger />
                </div>
              </div>

              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                color: "var(--text-2)",
                marginBottom: 10,
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  /tv/{d.publicSlug}
                </span>
                <button
                  type="button"
                  onClick={() => copyUrl(d.publicSlug)}
                  title="Copiar URL pública"
                  aria-label="Copiar URL pública"
                  style={{ width: 26, height: 26, display: "grid", placeItems: "center", background: "transparent", border: "1px solid var(--border-soft)", borderRadius: 6, color: "var(--text-3)", cursor: "pointer" }}
                >
                  <Copy size={11} aria-hidden />
                </button>
                <a
                  href={`/tv/${d.publicSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir vista pública"
                  aria-label="Abrir vista pública"
                  style={{ width: 26, height: 26, display: "grid", placeItems: "center", background: "transparent", border: "1px solid var(--border-soft)", borderRadius: 6, color: "var(--text-3)", textDecoration: "none" }}
                >
                  <ExternalLink size={11} aria-hidden />
                </a>
              </div>

              <button
                type="button"
                onClick={() => toggleActive(d)}
                style={{
                  fontSize: 11, fontWeight: 600,
                  background: "transparent", color: d.active ? "#dc2626" : "#10b981",
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  padding: 0,
                }}
              >
                {d.active ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
        </div>
      )}

      {creating && <TvDisplayModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch(); }} />}
      {editing && <TvDisplayModal display={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refetch(); }} />}
    </div>
  );
}

function TvDisplayModal({
  display,
  onClose,
  onSaved,
}: {
  display?: TVDisplay;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(display?.name ?? "");
  const [mode, setMode] = useState<"OPERATIONAL" | "MARKETING" | "HYBRID">(display?.mode ?? "OPERATIONAL");
  const [config, setConfig] = useState<TVDisplayConfig>(display?.config ?? EMPTY_CONFIG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!name.trim()) {
      toast.error("Nombre requerido");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(display ? `/api/tv-displays/${display.id}` : "/api/tv-displays", {
        method: display ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mode, config }),
      });
      if (!res.ok) throw new Error();
      toast.success(display ? "Pantalla actualizada" : "Pantalla creada");
      onSaved();
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function addPromo() {
    setConfig({
      ...config,
      promotions: [...(config.promotions ?? []), { title: "", description: "", durationSec: 8 }],
    });
  }
  function removePromo(idx: number) {
    setConfig({
      ...config,
      promotions: (config.promotions ?? []).filter((_, i) => i !== idx),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tv-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(5, 5, 10, 0.72)",
        WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)",
        display: "grid", placeItems: "center",
        zIndex: 100, padding: 24,
      }}
    >
      <div
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 540,
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 id="tv-modal-title" style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            {display ? `Editar ${display.name}` : "Nueva pantalla TV"}
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{
            width: 28, height: 28, display: "grid", placeItems: "center",
            background: "transparent", border: "1px solid var(--border-soft)",
            borderRadius: 7, color: "var(--text-3)", cursor: "pointer",
          }}>
            <X size={13} aria-hidden />
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <Field label="Nombre">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. TV recepción principal"
              className="input-new"
            />
          </Field>

          <Field label="Modo">
            <select value={mode} onChange={(e) => setMode(e.target.value as "OPERATIONAL" | "MARKETING" | "HYBRID")} className="input-new">
              <option value="OPERATIONAL">Operativo (sala de espera)</option>
              <option value="MARKETING">Marketing (carrusel)</option>
              <option value="HYBRID">Hybrid (split 60/40)</option>
            </select>
            <span style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>
              {MODE_DESCRIPTIONS[mode]}
            </span>
          </Field>

          {(mode === "MARKETING" || mode === "HYBRID") && (
            <>
              <Field label="Color de marca (hex)">
                <input
                  type="text"
                  value={config.brandColor ?? ""}
                  onChange={(e) => setConfig({ ...config, brandColor: e.target.value })}
                  placeholder="#7c3aed"
                  className="input-new mono"
                />
              </Field>
              <Field label="URL del logo (opcional)">
                <input
                  type="url"
                  value={config.brandLogo ?? ""}
                  onChange={(e) => setConfig({ ...config, brandLogo: e.target.value })}
                  placeholder="https://…"
                  className="input-new mono"
                />
              </Field>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Promociones (carrusel)
                  </span>
                  <button type="button" onClick={addPromo} style={{
                    fontSize: 11, fontWeight: 600, color: "var(--brand)",
                    background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                  }}>
                    + Agregar
                  </button>
                </div>
                {(config.promotions ?? []).map((p, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px auto", gap: 6, marginBottom: 6 }}>
                    <input
                      type="text"
                      value={p.title}
                      onChange={(e) => {
                        const promos = [...(config.promotions ?? [])];
                        promos[idx] = { ...promos[idx]!, title: e.target.value };
                        setConfig({ ...config, promotions: promos });
                      }}
                      placeholder="Título"
                      className="input-new"
                      style={{ fontSize: 12 }}
                    />
                    <input
                      type="text"
                      value={p.description}
                      onChange={(e) => {
                        const promos = [...(config.promotions ?? [])];
                        promos[idx] = { ...promos[idx]!, description: e.target.value };
                        setConfig({ ...config, promotions: promos });
                      }}
                      placeholder="Descripción"
                      className="input-new"
                      style={{ fontSize: 12 }}
                    />
                    <input
                      type="number"
                      min={3}
                      max={30}
                      value={p.durationSec}
                      onChange={(e) => {
                        const promos = [...(config.promotions ?? [])];
                        promos[idx] = { ...promos[idx]!, durationSec: Number(e.target.value) || 8 };
                        setConfig({ ...config, promotions: promos });
                      }}
                      placeholder="seg"
                      className="input-new mono"
                      style={{ fontSize: 12 }}
                    />
                    <button type="button" onClick={() => removePromo(idx)} aria-label="Quitar promoción" style={{
                      width: 28, height: 28, display: "grid", placeItems: "center",
                      background: "transparent", border: "1px solid var(--border-soft)",
                      borderRadius: 6, color: "#dc2626", cursor: "pointer",
                    }}>
                      <Trash2 size={11} aria-hidden />
                    </button>
                  </div>
                ))}
                {(config.promotions ?? []).length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-4)", padding: 8, textAlign: "center" }}>
                    Sin promociones — agrega al menos una para el carrusel.
                  </div>
                )}
              </div>
            </>
          )}

          {(mode === "HYBRID") && (
            <Field label="Mostrar tiempos de espera estimados">
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={config.showWaitTimes ?? true}
                  onChange={(e) => setConfig({ ...config, showWaitTimes: e.target.checked })}
                />
                Sí, calcula tiempo de espera por paciente check-in
              </label>
            </Field>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-soft)", background: "var(--bg-elev-2)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={{
            padding: "8px 14px", fontSize: 13, fontWeight: 600,
            background: "transparent", color: "var(--text-2)",
            border: "1px solid var(--border-strong)", borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: 700,
            background: "var(--brand)", color: "#fff",
            border: "1px solid var(--brand)", borderRadius: 8,
            cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <Save size={13} aria-hidden />
            {saving ? "Guardando…" : (display ? "Actualizar" : "Crear")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function IconBtn({ label, onClick, icon, danger }: { label: string; onClick: () => void; icon: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 30, height: 30, display: "grid", placeItems: "center",
        background: "transparent",
        border: "1px solid var(--border-soft)",
        borderRadius: 7,
        color: danger ? "#dc2626" : "var(--text-3)",
        cursor: "pointer",
      }}
    >
      {icon}
    </button>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--bg-elev)",
      border: "1px solid var(--border-soft)",
      borderRadius: 14,
      padding: 40,
      textAlign: "center",
      color: "var(--text-2)",
      fontSize: 13,
    }}>{children}</div>
  );
}
