"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { UserPlus, Users, X, Check, Ban, Trash2, Pencil } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
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

const fieldStyle: React.CSSProperties = {
  height: 42,
  padding: "0 14px",
  borderRadius: 10,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-1)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-2)",
  marginBottom: 6,
  display: "block",
};

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
    <CardNew
      noPad
      title="Vendedores"
      sub={`${sellers.length} ${sellers.length === 1 ? "vendedor" : "vendedores"} en tu equipo`}
      action={
        <ButtonNew
          variant="primary"
          size="sm"
          icon={<UserPlus size={14} />}
          onClick={() => setShowForm((v) => !v)}
        >
          Agregar vendedor
        </ButtonNew>
      }
    >
      {/* Formulario de alta (inline, plegable) */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            padding: 16,
            borderBottom: "1px solid var(--border-soft)",
            background: "var(--bg-elev-1)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Nombre</label>
              <input name="name" type="text" required style={fieldStyle} placeholder="Nombre del vendedor" />
            </div>
            <div>
              <label style={labelStyle}>Correo</label>
              <input name="email" type="email" required style={fieldStyle} placeholder="correo@ejemplo.com" />
            </div>
            <div>
              <label style={labelStyle}>Contraseña</label>
              <input name="password" type="password" required minLength={8} style={fieldStyle} placeholder="Mínimo 8 caracteres" />
            </div>
            <div>
              <label style={labelStyle}>Teléfono (opcional)</label>
              <input name="phone" type="tel" style={fieldStyle} placeholder="55 1234 5678" />
            </div>
            <div>
              <label style={labelStyle}>% de comisión</label>
              <input
                name="commissionPct"
                type="number"
                required
                min={0}
                max={levelPct}
                step="0.1"
                defaultValue={0}
                style={fieldStyle}
              />
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>
                máx {levelPct}% — tu nivel
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <ButtonNew type="submit" variant="primary" disabled={busyId === "__new__"}>
              {busyId === "__new__" ? "Creando…" : "Crear vendedor"}
            </ButtonNew>
            <ButtonNew type="button" variant="ghost" icon={<X size={14} />} onClick={() => setShowForm(false)}>
              Cancelar
            </ButtonNew>
          </div>
        </form>
      )}

      {/* Estado vacío */}
      {sellers.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Users size={26} />
          </div>
          <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>Aún no tienes vendedores</div>
          <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 360, lineHeight: 1.5 }}>
            Agrega a tu primer vendedor para que empiece a referir clínicas con su propio enlace y % de comisión.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>% comisión</th>
                <th>Clics</th>
                <th>Clínicas</th>
                <th>Pendiente</th>
                <th>Pagado</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => {
                const busy = busyId === s.id;
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ color: "var(--text-1)", fontWeight: 600 }}>{s.name}</div>
                      <div style={{ color: "var(--text-3)", fontSize: 12 }}>{s.email}</div>
                    </td>
                    <td className="mono">
                      {editing === s.id ? (
                        <PctEditor
                          initial={s.commissionPct}
                          max={levelPct}
                          disabled={busy}
                          onSave={(v) => handleSavePct(s.id, v)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{s.commissionPct}%</span>
                      )}
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>{s.clicks}</td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>{s.clinics}</td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>{formatCurrency(s.pendingMxn)}</td>
                    <td className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>{formatCurrency(s.paidMxn)}</td>
                    <td>
                      <BadgeNew tone={s.isActive ? "success" : "neutral"} dot>
                        {s.isActive ? "Activo" : "Inactivo"}
                      </BadgeNew>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {editing !== s.id && (
                          <ButtonNew
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={<Pencil size={13} />}
                            disabled={busy}
                            onClick={() => setEditing(s.id)}
                          >
                            Editar %
                          </ButtonNew>
                        )}
                        <ButtonNew
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon={s.isActive ? <Ban size={13} /> : <Check size={13} />}
                          disabled={busy}
                          onClick={() => handleToggle(s.id, !s.isActive)}
                        >
                          {s.isActive ? "Desactivar" : "Activar"}
                        </ButtonNew>
                        <ButtonNew
                          type="button"
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={13} />}
                          disabled={busy}
                          onClick={() => handleDelete(s.id, s.name)}
                        >
                          Eliminar
                        </ButtonNew>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </CardNew>
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
      <input
        type="number"
        min={0}
        max={max}
        step="0.1"
        value={value}
        autoFocus
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        style={{ ...fieldStyle, height: 32, width: 80, padding: "0 8px" }}
      />
      <button
        type="button"
        className="icon-btn-new"
        aria-label="Guardar"
        disabled={disabled}
        onClick={() => onSave(Number(value))}
      >
        <Check size={13} />
      </button>
      <button type="button" className="icon-btn-new" aria-label="Cancelar" disabled={disabled} onClick={onCancel}>
        <X size={13} />
      </button>
    </div>
  );
}
