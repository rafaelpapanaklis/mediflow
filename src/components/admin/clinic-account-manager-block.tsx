"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Bloque "MANAGER ASIGNADO" de la ficha de clínica en /admin (prototipo 1i/1j).
//
// Vive en el tab RESUMEN de /admin/clinics/[id] — ver el comentario de dónde se
// monta en clinic-detail-client.tsx. Dos estados:
//   · con manager → tarjeta + "Cambiar" (selector con buscador) y "Quitar"
//   · sin manager → estado vacío punteado con "Asignar manager"
//
// El catálogo completo SÓLO se carga aquí (admin). Nunca en el panel de la
// clínica: allá viaja únicamente el manager asignado.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Check, Search, UserRound, X } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatSchedule } from "@/lib/account-manager/availability";
import { initialsFromName } from "@/lib/account-manager/types";
import type { AccountManagerAdminRow, AccountManagerDTO } from "@/lib/account-manager/types";

function Avatar({ name, photoUrl, size = 50 }: { name: string; photoUrl: string | null; size?: number }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL externa de Supabase Storage.
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
        color: "#fff",
        fontSize: size * 0.3,
        fontWeight: 700,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {initialsFromName(name)}
    </span>
  );
}

interface Props {
  clinicId: string;
  /** Manager actualmente asignado (resuelto en el server). null = sin asignar. */
  initialManager: AccountManagerDTO | null;
}

export function ClinicAccountManagerBlock({ clinicId, initialManager }: Props) {
  const askConfirm = useConfirm();
  const [manager, setManager] = useState<AccountManagerDTO | null>(initialManager);
  const [picking, setPicking] = useState(false);
  const [catalog, setCatalog] = useState<AccountManagerAdminRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  async function openPicker() {
    setPicking(true);
    setQuery("");
    if (catalog) return; // ya cargado
    try {
      const res = await fetch("/api/admin/account-managers", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? "No se pudo cargar el catálogo de managers");
        setCatalog([]);
        return;
      }
      setCatalog(Array.isArray(json?.managers) ? json.managers : []);
    } catch {
      toast.error("Error de red al cargar los managers");
      setCatalog([]);
    }
  }

  async function assign(row: AccountManagerAdminRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}/account-manager`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountManagerId: row.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? "No se pudo asignar el manager");
        return;
      }
      setManager(row);
      setPicking(false);
      toast.success(`${row.name} quedó asignado a esta clínica`);
    } catch {
      toast.error("Error de red al asignar");
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    const ok = await askConfirm({
      title: "¿Quitar el manager de esta clínica?",
      description:
        "La clínica se quedará sólo con soporte por tickets y su tarjeta volverá a invitar a abrir uno.",
      variant: "warning",
      confirmText: "Quitar manager",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}/account-manager`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? "No se pudo quitar el manager");
        return;
      }
      setManager(null);
      setPicking(false);
      toast.success("Manager quitado");
    } catch {
      toast.error("Error de red al quitar el manager");
    } finally {
      setBusy(false);
    }
  }

  const filtered = (catalog ?? []).filter(m =>
    m.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <CardNew>
      <div className="form-section__title">
        Manager asignado <span className="form-section__rule" />
      </div>

      {manager ? (
        <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
          <Avatar name={manager.name} photoUrl={manager.photoUrl} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text-1)" }}>{manager.name}</span>
              <BadgeNew tone={manager.status === "active" ? "success" : "neutral"} dot>
                {manager.status === "active" ? "ACTIVO" : "PAUSADO"}
              </BadgeNew>
            </div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginTop: 3 }}>
              {manager.whatsappDisplay}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>
              {formatSchedule(manager)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <ButtonNew variant="secondary" size="sm" onClick={openPicker} disabled={busy}>
              Cambiar
            </ButtonNew>
            <ButtonNew variant="ghost" size="sm" onClick={unassign} disabled={busy}>
              <span style={{ color: "var(--danger)" }}>Quitar</span>
            </ButtonNew>
          </div>
        </div>
      ) : (
        <div
          style={{
            border: "1.5px dashed var(--border-soft)",
            borderRadius: "var(--radius-lg)",
            padding: 26,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              background: "var(--brand-soft)",
              color: "var(--brand)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <UserRound size={24} strokeWidth={1.7} aria-hidden />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginTop: 12 }}>
            Sin manager asignado
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 5, lineHeight: 1.5, maxWidth: 380 }}>
            Esta clínica solo tiene soporte por tickets. Su tarjeta invita a abrir un ticket.
          </div>
          <div style={{ marginTop: 16 }}>
            <ButtonNew variant="primary" onClick={openPicker} disabled={busy}>
              Asignar manager
            </ButtonNew>
          </div>
        </div>
      )}

      {/* ── Selector con buscador ─────────────────────────────────────── */}
      {picking && (
        <div className="modal-overlay" onClick={() => { if (!busy) setPicking(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header">
              <div className="modal__title">Asignar manager</div>
              <button
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
                onClick={() => setPicking(false)}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div className="modal__body">
              <div className="field-new" style={{ marginBottom: 12 }}>
                <div style={{ position: "relative" }}>
                  <Search
                    size={14}
                    style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }}
                    aria-hidden
                  />
                  <input
                    className="input-new"
                    style={{ paddingLeft: 32 }}
                    placeholder="Buscar por nombre…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {catalog === null ? (
                <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
                  Cargando managers…
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
                  {catalog.length === 0
                    ? "Todavía no hay managers en el catálogo."
                    : "Ningún manager coincide con la búsqueda."}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {filtered.map(m => {
                    const current = manager?.id === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => assign(m)}
                        disabled={busy}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 11,
                          padding: "9px 10px",
                          borderRadius: "var(--radius)",
                          background: current ? "var(--brand-soft)" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                          width: "100%",
                        }}
                      >
                        <Avatar name={m.name} photoUrl={m.photoUrl} size={36} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{m.name}</span>
                            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{m.whatsappDisplay}</span>
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                            {m.clinicCount > 0 ? `${m.clinicCount} ${m.clinicCount === 1 ? "clínica" : "clínicas"} · ` : ""}
                            {formatSchedule(m)}
                            {m.status === "paused" ? " · pausado" : ""}
                          </span>
                        </span>
                        {current && <Check size={16} strokeWidth={2.5} style={{ color: "var(--brand)" }} aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="modal__footer">
              {manager && (
                <ButtonNew variant="ghost" onClick={unassign} disabled={busy}>
                  <span style={{ color: "var(--danger)" }}>Quitar manager de esta clínica</span>
                </ButtonNew>
              )}
              <ButtonNew variant="secondary" onClick={() => setPicking(false)} disabled={busy}>
                Cerrar
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </CardNew>
  );
}
