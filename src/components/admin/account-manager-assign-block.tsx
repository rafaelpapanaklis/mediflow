"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Bloque "MANAGER ASIGNADO" — pieza COMPARTIDA del admin.
//
// Nació dentro de clinic-account-manager-block.tsx y se extrajo aquí cuando los
// AFILIADOS también empezaron a tener manager de cuenta: la tarjeta, el avatar
// y el selector con buscador son idénticos; lo único que cambia es el endpoint
// que escribe la asignación y la palabra "clínica"/"afiliado" en los textos.
// Duplicar 300 líneas habría dejado dos selectores que se desincronizan.
//
// El catálogo completo (con teléfonos personales) SÓLO se carga aquí, en el
// admin. Al panel de la clínica/afiliado viaja únicamente el manager asignado.
//
// Contrato del endpoint (mismo para clínicas y afiliados):
//   PUT    { accountManagerId: string }  → asigna
//   DELETE                               → quita
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Search, UserRound, X } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatSchedule } from "@/lib/account-manager/availability";
import { initialsFromName } from "@/lib/account-manager/types";
import type { AccountManagerAdminRow, AccountManagerDTO } from "@/lib/account-manager/types";

// ── Avatar (foto o iniciales) ──────────────────────────────────────────────

export function AccountManagerAvatar({
  name,
  photoUrl,
  size = 50,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
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

// ── Selector con buscador ──────────────────────────────────────────────────

interface PickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (row: AccountManagerAdminRow) => void;
  /** Manager ya asignado: se marca con un check en la lista. */
  currentId?: string | null;
  busy?: boolean;
  /** Acción extra en el pie (p. ej. "Quitar manager de este afiliado"). */
  footerExtra?: ReactNode;
}

/**
 * Modal del catálogo. Se mantiene MONTADO aunque esté cerrado (devuelve null)
 * para conservar el catálogo ya descargado: reabrirlo no vuelve a pegarle al
 * API, igual que hacía el `if (catalog) return` de la versión original.
 */
export function AccountManagerPicker({
  open,
  onClose,
  onPick,
  currentId,
  busy,
  footerExtra,
}: PickerProps) {
  const [catalog, setCatalog] = useState<AccountManagerAdminRow[] | null>(null);
  const [query, setQuery] = useState("");
  // Ref y no estado: si el guard viviera en `catalog` el efecto tendría que
  // depender de él y volvería a limpiar el buscador al resolverse el fetch.
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    if (loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/account-managers", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          // 503 con sqlPending = falta correr sql/account-managers.sql.
          toast.error(json?.error ?? "No se pudo cargar el catálogo de managers");
          setCatalog([]);
          return;
        }
        setCatalog(Array.isArray(json?.managers) ? json.managers : []);
      } catch {
        if (cancelled) return;
        toast.error("Error de red al cargar los managers");
        setCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const filtered = (catalog ?? []).filter((m) =>
    m.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal__header">
          <div className="modal__title">Asignar manager</div>
          <button
            type="button"
            className="btn-new btn-new--ghost btn-new--sm"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="modal__body">
          <div className="field-new" style={{ marginBottom: 12 }}>
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-4)",
                }}
                aria-hidden
              />
              <input
                className="input-new"
                style={{ paddingLeft: 32 }}
                placeholder="Buscar por nombre…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
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
              {filtered.map((m) => {
                const current = currentId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPick(m)}
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
                    <AccountManagerAvatar name={m.name} photoUrl={m.photoUrl} size={36} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{m.name}</span>
                        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                          {m.whatsappDisplay}
                        </span>
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
          {footerExtra}
          <ButtonNew variant="secondary" onClick={onClose} disabled={busy}>
            Cerrar
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta completa (estado con manager + estado vacío + selector) ────────

interface BlockProps {
  /** Endpoint que acepta PUT { accountManagerId } y DELETE. */
  endpoint: string;
  /** Manager actualmente asignado (resuelto en el server). null = sin asignar. */
  initialManager: AccountManagerDTO | null;
  /** "esta clínica" | "este afiliado" — se inyecta en toasts y confirmaciones. */
  subject: string;
  /** Frase del estado vacío, bajo "Sin manager asignado". */
  emptyHint: string;
  /** Qué pierde el titular al quitarle el manager (texto del confirm). */
  removeDescription: string;
}

export function AccountManagerAssignBlock({
  endpoint,
  initialManager,
  subject,
  emptyHint,
  removeDescription,
}: BlockProps) {
  const askConfirm = useConfirm();
  const [manager, setManager] = useState<AccountManagerDTO | null>(initialManager);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function assign(row: AccountManagerAdminRow) {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
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
      toast.success(`${row.name} quedó asignado a ${subject}`);
    } catch {
      toast.error("Error de red al asignar");
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    const ok = await askConfirm({
      title: `¿Quitar el manager de ${subject}?`,
      description: removeDescription,
      variant: "warning",
      confirmText: "Quitar manager",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
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

  return (
    <CardNew>
      <div className="form-section__title">
        Manager asignado <span className="form-section__rule" />
      </div>

      {manager ? (
        <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
          <AccountManagerAvatar name={manager.name} photoUrl={manager.photoUrl} />
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
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>{formatSchedule(manager)}</div>
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <ButtonNew variant="secondary" size="sm" onClick={() => setPicking(true)} disabled={busy}>
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
            {emptyHint}
          </div>
          <div style={{ marginTop: 16 }}>
            <ButtonNew variant="primary" onClick={() => setPicking(true)} disabled={busy}>
              Asignar manager
            </ButtonNew>
          </div>
        </div>
      )}

      <AccountManagerPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={assign}
        currentId={manager?.id ?? null}
        busy={busy}
        footerExtra={
          manager ? (
            <ButtonNew variant="ghost" onClick={unassign} disabled={busy}>
              <span style={{ color: "var(--danger)" }}>Quitar manager de {subject}</span>
            </ButtonNew>
          ) : null
        }
      />
    </CardNew>
  );
}
