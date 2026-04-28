"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Trash2, Pencil, Plus, X } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { formatRelativeDate } from "@/lib/format";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Announcement {
  id: string;
  message: string;
  type: string;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  info:        "Info",
  warning:     "Advertencia",
  success:     "Éxito",
  maintenance: "Mantenimiento",
};

type Tone = "info" | "warning" | "success" | "danger" | "brand" | "neutral";
function typeTone(t: string): Tone {
  if (t === "warning")     return "warning";
  if (t === "success")     return "success";
  if (t === "maintenance") return "danger";
  return "info";
}

export function AnnouncementsClient({ initial }: { initial: Announcement[] }) {
  const askConfirm = useConfirm();
  const [list, setList] = useState<Announcement[]>(initial);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ message: "", type: "info", active: true, endsAt: "" });

  function openCreate() {
    setEditing(null);
    setForm({ message: "", type: "info", active: true, endsAt: "" });
    setShowModal(true);
  }

  function openEdit(a: Announcement) {
    setEditing(a);
    setForm({
      message: a.message,
      type: a.type,
      active: a.active,
      endsAt: a.endsAt ? a.endsAt.slice(0, 10) : "",
    });
    setShowModal(true);
  }

  async function submit() {
    if (!form.message.trim()) { toast.error("Mensaje requerido"); return; }
    setSaving(true);
    try {
      if (editing) {
        const res = await fetch(`/api/admin/announcements/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: form.message,
            type: form.type,
            active: form.active,
            endsAt: form.endsAt || null,
          }),
        });
        if (!res.ok) throw new Error();
        const updated = await res.json();
        setList(prev => prev.map(x => (x.id === editing.id ? updated : x)));
        toast.success("Guardado");
      } else {
        const res = await fetch("/api/admin/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: form.message.trim(),
            type: form.type,
            endsAt: form.endsAt || null,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Error");
        const created = await res.json();
        setList(prev => [created, ...prev]);
        toast.success("Anuncio creado");
      }
      setShowModal(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a: Announcement) {
    try {
      const res = await fetch(`/api/admin/announcements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !a.active }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setList(prev => prev.map(x => (x.id === a.id ? updated : x)));
    } catch { toast.error("Error al actualizar"); }
  }

  async function remove(id: string) {
    if (!(await askConfirm({
      title: "¿Eliminar anuncio?",
      description: "El anuncio dejará de mostrarse a todas las clínicas inmediatamente.",
      variant: "danger",
      confirmText: "Eliminar",
    }))) return;
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setList(prev => prev.filter(x => x.id !== id));
      toast.success("Anuncio eliminado");
    } catch { toast.error("Error al eliminar"); }
  }

  const active = list.filter(a => a.active);
  const inactive = list.filter(a => !a.active);

  function renderRow(a: Announcement, muted = false) {
    return (
      <div key={a.id} className="list-row" style={muted ? { opacity: 0.6 } : undefined}>
        <BadgeNew tone={typeTone(a.type)} dot>
          {TYPE_LABELS[a.type] ?? a.type}
        </BadgeNew>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "var(--text-1)", whiteSpace: "pre-wrap" }}>{a.message}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
            {formatRelativeDate(a.createdAt)}
            {a.endsAt ? ` → ${new Date(a.endsAt).toLocaleDateString("es-MX")}` : " → Sin fin"}
          </div>
        </div>
        <ButtonNew
          size="sm"
          variant="ghost"
          icon={<Pencil size={13} />}
          onClick={() => openEdit(a)}
        >
          Editar
        </ButtonNew>
        <ButtonNew
          size="sm"
          variant="ghost"
          onClick={() => toggleActive(a)}
        >
          {a.active ? "Desactivar" : "Activar"}
        </ButtonNew>
        <ButtonNew
          size="sm"
          variant="ghost"
          icon={<Trash2 size={13} />}
          onClick={() => remove(a.id)}
          style={{ color: "var(--danger)" }}
          aria-label="Eliminar"
        >
          Eliminar
        </ButtonNew>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Anuncios globales
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            Se muestran a todas las clínicas dentro del dashboard. Pueden ser descartados por el usuario.
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
          Nuevo anuncio
        </ButtonNew>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <CardNew noPad title={`Anuncios activos (${active.length})`}>
          {active.length === 0 ? (
            <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              Sin anuncios activos
            </div>
          ) : (
            <div>{active.map(a => renderRow(a, false))}</div>
          )}
        </CardNew>

        <CardNew noPad title={`Anuncios inactivos (${inactive.length})`}>
          {inactive.length === 0 ? (
            <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              Sin anuncios inactivos
            </div>
          ) : (
            <div>{inactive.map(a => renderRow(a, true))}</div>
          )}
        </CardNew>
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">
                {editing ? "Editar anuncio" : "Nuevo anuncio"}
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal__body">
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <div className="form-section__title">
                    Contenido
                    <span className="form-section__rule" />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="field-new">
                      <label className="field-new__label">
                        Mensaje <span className="req">*</span>
                      </label>
                      <textarea
                        rows={3}
                        className="input-new"
                        placeholder="Ej: El 25 de abril habrá mantenimiento programado de 2 a 4 AM."
                        value={form.message}
                        onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="field-new">
                        <label className="field-new__label">Tipo</label>
                        <select
                          className="input-new"
                          value={form.type}
                          onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                        >
                          {Object.entries(TYPE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field-new">
                        <label className="field-new__label">Termina (opcional)</label>
                        <input
                          type="date"
                          className="input-new"
                          value={form.endsAt}
                          onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))}
                        />
                      </div>
                    </div>
                    {editing && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                        <input
                          type="checkbox"
                          checked={form.active}
                          onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                        />
                        Activo
                      </label>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" onClick={() => setShowModal(false)}>
                Cancelar
              </ButtonNew>
              <ButtonNew variant="primary" onClick={submit} disabled={saving}>
                {saving ? "Guardando…" : editing ? "Guardar" : "Crear anuncio"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
