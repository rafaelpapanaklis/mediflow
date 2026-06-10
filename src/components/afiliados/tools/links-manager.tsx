"use client";

// Multi-links con campaña: crear, copiar, QR descargable y stats por link.
// Estilo del panel: inline styles con CSS vars (--text-1/2/3, --bg-elev-2,
// --border-soft, --brand-soft, --border-brand, --violet-400, --success) —
// mismo look que referral-links.tsx. 100% responsive (la fila se apila en
// móvil con flexWrap). Toasts con react-hot-toast.
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, Plus, Trash2, MousePointerClick, UserPlus } from "lucide-react";
import { QrDownloadButton } from "@/components/afiliados/tools/qr-download-button";
import type { ToolLink } from "@/app/api/afiliados/links/route";

export type { ToolLink };

const urlInputStyle: React.CSSProperties = {
  flex: "1 1 220px",
  minWidth: 0,
  height: 40,
  padding: "0 12px",
  borderRadius: 10,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-2)",
  fontSize: 12.5,
  outline: "none",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 999,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-3)",
  fontSize: 11.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

function brandButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "0 14px",
    height: 40,
    flexShrink: 0,
    borderRadius: 10,
    border: "1px solid var(--border-brand)",
    background: "var(--brand-soft)",
    color: "var(--violet-400)",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontFamily: "inherit",
    transition: "all .15s",
    whiteSpace: "nowrap",
  };
}

function errorMessage(body: any, fallback: string): string {
  if (body?.error === "tools_not_ready") {
    return "Las herramientas aún no están activas en la base de datos.";
  }
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

export function LinksManager({
  initialLinks,
  ready,
}: {
  initialLinks: ToolLink[];
  ready: boolean; // false = SQL sin correr → deshabilita crear y muestra aviso
}) {
  const [links, setLinks] = useState<ToolLink[]>(initialLinks);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canCreate = ready && !creating && name.trim().length >= 2;

  async function createLink() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/afiliados/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.link) {
        toast.error(errorMessage(body, "No se pudo crear el link"));
        return;
      }
      setLinks((prev) => [...prev, body.link as ToolLink]);
      setName("");
      toast.success("Link creado");
    } catch {
      toast.error("No se pudo crear el link");
    } finally {
      setCreating(false);
    }
  }

  async function copy(link: ToolLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      toast.success("Enlace copiado");
      setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  async function removeLink(link: ToolLink) {
    // Paso 1: armar confirmación (se desarma sola a los 4 s).
    if (confirmingId !== link.id) {
      setConfirmingId(link.id);
      setTimeout(() => setConfirmingId((id) => (id === link.id ? null : id)), 4000);
      return;
    }
    // Paso 2: eliminar de verdad.
    if (deletingId) return;
    setDeletingId(link.id);
    try {
      const res = await fetch(`/api/afiliados/links/${link.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(errorMessage(body, "No se pudo eliminar el link"));
        return;
      }
      setLinks((prev) => prev.filter((x) => x.id !== link.id));
      toast.success("Link eliminado");
    } catch {
      toast.error("No se pudo eliminar el link");
    } finally {
      setDeletingId(null);
      setConfirmingId((id) => (id === link.id ? null : id));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!ready && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(245,158,11,0.35)",
            background: "rgba(245,158,11,0.08)",
            color: "var(--text-2)",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          Disponible en cuanto se active la base de datos (
          <span className="mono">sql/afiliados-ventas.sql</span>).
        </div>
      )}

      {/* Crear link */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void createLink();
        }}
        style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Facebook, WhatsApp, Expo dental..."
          aria-label="Nombre de la campaña"
          maxLength={40}
          disabled={!ready || creating}
          style={{
            ...urlInputStyle,
            color: "var(--text-1)",
            fontSize: 13,
            opacity: ready ? 1 : 0.55,
          }}
        />
        <button type="submit" disabled={!canCreate} style={brandButtonStyle(!canCreate)}>
          <Plus size={15} />
          {creating ? "Creando..." : "Crear link"}
        </button>
      </form>

      {links.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
          Crea tu primer link nombrado para saber qué canal te trae más clínicas.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {links.map((l) => {
            const copied = copiedId === l.id;
            const confirming = confirmingId === l.id;
            const deleting = deletingId === l.id;
            return (
              <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{l.name}</span>
                  <span style={chipStyle}>
                    <MousePointerClick size={12} />
                    {l.clicks} clics
                  </span>
                  <span style={chipStyle}>
                    <UserPlus size={12} />
                    {l.conversions} registros
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
                  <input
                    readOnly
                    value={l.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="mono"
                    style={urlInputStyle}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => void copy(l)}
                      style={{
                        ...brandButtonStyle(false),
                        background: copied
                          ? "var(--success-soft, rgba(52,211,153,0.12))"
                          : "var(--brand-soft)",
                        color: copied ? "var(--success)" : "var(--violet-400)",
                      }}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                    <QrDownloadButton url={l.url} fileName={`qr-${l.campaign}`} />
                    <button
                      type="button"
                      onClick={() => void removeLink(l)}
                      disabled={deleting}
                      aria-label={confirming ? "Confirmar eliminación" : `Eliminar link ${l.name}`}
                      title={confirming ? "Se perderán los clics y registros de este link" : "Eliminar link"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "0 12px",
                        height: 40,
                        flexShrink: 0,
                        borderRadius: 10,
                        border: confirming
                          ? "1px solid rgba(239,68,68,0.55)"
                          : "1px solid var(--border-soft)",
                        background: confirming ? "rgba(239,68,68,0.12)" : "var(--bg-elev-2)",
                        color: confirming ? "#f87171" : "var(--text-3)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: deleting ? "not-allowed" : "pointer",
                        opacity: deleting ? 0.55 : 1,
                        fontFamily: "inherit",
                        transition: "all .15s",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Trash2 size={15} />
                      {confirming ? (deleting ? "Eliminando..." : "¿Eliminar?") : ""}
                    </button>
                  </div>
                </div>
                {confirming && (
                  <p style={{ fontSize: 11.5, color: "#fbbf24", margin: 0, lineHeight: 1.4 }}>
                    Se perderán los clics y registros de este link. Pulsa &quot;¿Eliminar?&quot; otra vez
                    para confirmar.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
