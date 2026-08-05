"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import toast from "react-hot-toast";
import { UserPlus, Users, X, Check, Ban, Trash2, Pencil } from "lucide-react";
import { PanelCard, Chip, EmptyState } from "@/components/afiliados/ui/panel-ui";
import { formatCurrency } from "@/lib/utils";

export interface SellerRowWithStats {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  commissionPct: number;
  isActive: boolean;
  hasLogin: boolean;
  createdAt: string;
  clicks: number;
  clinics: number;
  pendingMxn: number;
  paidMxn: number;
}

// Los encabezados de `.dcafp-table` van a la izquierda por defecto; las cuatro
// columnas de cifras se alinean a la derecha para que los dígitos formen
// columna con las celdas (.dcafp-td--num / --money ya lo hacen).
const numTh: CSSProperties = { textAlign: "right" };

export function TeamManager({
  initial,
  levelPct,
}: {
  initial: SellerRowWithStats[];
  levelPct: number;
}) {
  const [sellers, setSellers] = useState<SellerRowWithStats[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Alta de vendedor ────────────────────────────────────────────────
  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const phone = String(fd.get("phone") ?? "").trim();
    const commissionPct = Number(fd.get("commissionPct"));

    if (!name) return toast.error("El nombre es requerido.");
    if (!email) return toast.error("El correo es requerido.");
    if (password.length < 8) return toast.error("La contraseña debe tener al menos 8 caracteres.");
    if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > levelPct) {
      return toast.error(`El porcentaje debe estar entre 0 y ${levelPct}%.`);
    }

    setBusyId("__new__");
    try {
      const res = await fetch("/api/afiliados/equipo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, phone: phone || undefined, commissionPct }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo crear el vendedor.");
      setSellers((prev) => [...prev, json.seller as SellerRowWithStats]);
      toast.success("Vendedor agregado");
      setShowForm(false);
      form.reset();
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo crear el vendedor.");
    } finally {
      setBusyId(null);
    }
  }

  // ── Guardar % editado ───────────────────────────────────────────────
  async function handleSavePct(id: string, value: number) {
    if (!Number.isFinite(value) || value < 0 || value > levelPct) {
      return toast.error(`El porcentaje debe estar entre 0 y ${levelPct}%.`);
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/afiliados/equipo/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionPct: value }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo actualizar.");
      setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, commissionPct: value } : s)));
      toast.success("Comisión actualizada");
      setEditing(null);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo actualizar.");
    } finally {
      setBusyId(null);
    }
  }

  // ── Activar / desactivar ────────────────────────────────────────────
  async function handleToggle(id: string, isActive: boolean) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/afiliados/equipo/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo actualizar.");
      setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, isActive } : s)));
      toast.success(isActive ? "Vendedor activado" : "Vendedor desactivado");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo actualizar.");
    } finally {
      setBusyId(null);
    }
  }

  // ── Eliminar ────────────────────────────────────────────────────────
  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`¿Eliminar a ${name}? Esta acción no se puede deshacer.`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/afiliados/equipo/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({} as any));
      if (res.status === 409) {
        toast.error(json?.error ?? "El vendedor tiene historial; desactívalo en lugar de eliminarlo.");
        return;
      }
      if (!res.ok) throw new Error(json?.error ?? "No se pudo eliminar.");
      setSellers((prev) => prev.filter((s) => s.id !== id));
      toast.success("Vendedor eliminado");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo eliminar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PanelCard
      flush
      title="Vendedores"
      sub={`${sellers.length} ${sellers.length === 1 ? "vendedor" : "vendedores"} en tu equipo`}
      action={
        <button
          type="button"
          className="dcafp-btn dcafp-btn--primary dcafp-btn--sm"
          aria-expanded={showForm}
          onClick={() => setShowForm((v) => !v)}
        >
          <UserPlus size={14} />
          Agregar vendedor
        </button>
      }
    >
      {/* Formulario de alta (inline, plegable) */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            padding: "16px 22px 18px",
            marginTop: 14,
            borderTop: "1px solid var(--dcafp-line-soft)",
            borderBottom: "1px solid var(--dcafp-line)",
            background: "var(--dcafp-surface-2)",
          }}
        >
          <div className="dcafp-autogrid dcafp-autogrid--sm">
            <div style={{ minWidth: 0 }}>
              <label className="dcafp-label" htmlFor="tm-name">
                Nombre
              </label>
              <input
                id="tm-name"
                className="dcafp-input"
                name="name"
                type="text"
                required
                placeholder="Nombre del vendedor"
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <label className="dcafp-label" htmlFor="tm-email">
                Correo
              </label>
              <input
                id="tm-email"
                className="dcafp-input"
                name="email"
                type="email"
                required
                placeholder="correo@ejemplo.com"
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <label className="dcafp-label" htmlFor="tm-password">
                Contraseña
              </label>
              <input
                id="tm-password"
                className="dcafp-input"
                name="password"
                type="password"
                required
                minLength={8}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <label className="dcafp-label" htmlFor="tm-phone">
                Teléfono (opcional)
              </label>
              <input
                id="tm-phone"
                className="dcafp-input"
                name="phone"
                type="tel"
                placeholder="55 1234 5678"
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <label className="dcafp-label" htmlFor="tm-pct">
                % de comisión
              </label>
              <input
                id="tm-pct"
                className="dcafp-input dcafp-nums"
                name="commissionPct"
                type="number"
                required
                min={0}
                max={levelPct}
                step="0.1"
                defaultValue={0}
                aria-describedby="tm-pct-hint"
              />
              <p className="dcafp-hint" id="tm-pct-hint" style={{ marginTop: 5 }}>
                máx {levelPct}% — tu nivel
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="submit" className="dcafp-btn dcafp-btn--primary" disabled={busyId === "__new__"}>
              {busyId === "__new__" ? "Creando…" : "Crear vendedor"}
            </button>
            <button type="button" className="dcafp-btn dcafp-btn--ghost" onClick={() => setShowForm(false)}>
              <X size={14} />
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Estado vacío */}
      {sellers.length === 0 ? (
        <div style={{ padding: showForm ? "18px 22px 22px" : "6px 22px 22px" }}>
          <EmptyState
            icon={<Users size={22} />}
            title="Aún no tienes vendedores"
            action={
              showForm ? null : (
                <button
                  type="button"
                  className="dcafp-btn dcafp-btn--outline"
                  onClick={() => setShowForm(true)}
                >
                  <UserPlus size={15} />
                  Agregar vendedor
                </button>
              )
            }
          >
            Agrega a tu primer vendedor para que empiece a referir clínicas con su propio enlace y % de
            comisión. Tú ves sus clics, sus clínicas y lo que ha generado, y te quedas con el resto de tu
            nivel como override.
          </EmptyState>
        </div>
      ) : (
        <div className="dcafp-scrollx" style={{ marginTop: showForm ? 0 : 12 }}>
          <table className="dcafp-table">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>% comisión</th>
                <th style={numTh}>Clics</th>
                <th style={numTh}>Clínicas</th>
                <th style={numTh}>Pendiente</th>
                <th style={numTh}>Pagado</th>
                <th>Estado</th>
                <th style={numTh}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => {
                const busy = busyId === s.id;
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 650, color: "var(--dcafp-ink)" }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: "var(--dcafp-ink-3)" }}>{s.email}</div>
                    </td>
                    <td>
                      {editing === s.id ? (
                        <PctEditor
                          initial={s.commissionPct}
                          max={levelPct}
                          disabled={busy}
                          onSave={(v) => handleSavePct(s.id, v)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <span className="dcafp-nums" style={{ fontWeight: 700, color: "var(--dcafp-ink)" }}>
                          {s.commissionPct}%
                        </span>
                      )}
                    </td>
                    <td className="dcafp-td--num dcafp-td--muted">{s.clicks}</td>
                    <td className="dcafp-td--num dcafp-td--muted">{s.clinics}</td>
                    <td className="dcafp-td--num dcafp-td--muted">{formatCurrency(s.pendingMxn)}</td>
                    <td className="dcafp-td--money">{formatCurrency(s.paidMxn)}</td>
                    <td>
                      <Chip tone={s.isActive ? "ok" : "neutral"} dot sm>
                        {s.isActive ? "Activo" : "Inactivo"}
                      </Chip>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {editing !== s.id && (
                          <button
                            type="button"
                            className="dcafp-btn dcafp-btn--sm dcafp-btn--ghost"
                            disabled={busy}
                            onClick={() => setEditing(s.id)}
                          >
                            <Pencil size={13} />
                            Editar %
                          </button>
                        )}
                        <button
                          type="button"
                          className="dcafp-btn dcafp-btn--sm dcafp-btn--ghost"
                          disabled={busy}
                          onClick={() => handleToggle(s.id, !s.isActive)}
                        >
                          {s.isActive ? <Ban size={13} /> : <Check size={13} />}
                          {s.isActive ? "Desactivar" : "Activar"}
                        </button>
                        <button
                          type="button"
                          className="dcafp-btn dcafp-btn--sm dcafp-btn--danger"
                          disabled={busy}
                          onClick={() => handleDelete(s.id, s.name)}
                        >
                          <Trash2 size={13} />
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

// Editor inline del % de comisión (input + guardar/cancelar).
function PctEditor({
  initial,
  max,
  disabled,
  onSave,
  onCancel,
}: {
  initial: number;
  max: number;
  disabled: boolean;
  onSave: (v: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(String(initial));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {/* Sin <label> visible: la columna ya dice "% comisión", así que la
          etiqueta accesible viaja en aria-label. */}
      <input
        className="dcafp-input dcafp-nums"
        type="number"
        min={0}
        max={max}
        step="0.1"
        value={value}
        autoFocus
        disabled={disabled}
        aria-label="Porcentaje de comisión del vendedor"
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 88, flex: "0 0 auto" }}
      />
      {/* `.dcafp-iconbtn` no trae estado :disabled en panel.css — el apagado va
          inline para no inventar una clase nueva. */}
      <button
        type="button"
        className="dcafp-iconbtn"
        aria-label="Guardar porcentaje"
        disabled={disabled}
        style={{ opacity: disabled ? 0.55 : 1 }}
        onClick={() => onSave(Number(value))}
      >
        <Check size={16} />
      </button>
      <button
        type="button"
        className="dcafp-iconbtn"
        aria-label="Cancelar edición"
        disabled={disabled}
        style={{ opacity: disabled ? 0.55 : 1 }}
        onClick={onCancel}
      >
        <X size={16} />
      </button>
    </div>
  );
}
