"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /admin/account-managers — catálogo de managers de cuenta (prototipo 1k/1l).
//
// Tabla MANAGER · WHATSAPP · HORARIO · CLÍNICAS · ESTADO + alta/edición en un
// modal con los campos exactos del prototipo (nombre, foto, WhatsApp con
// prefijo +52 fijo, dos horas y píldoras de días L M X J V S D).
//
// Eliminar NO borra clínicas: el FK es ON DELETE SET NULL, así que las que
// tenía asignadas quedan sin manager. La confirmación dice cuántas son.
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import { MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, Upload, X } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatSchedule } from "@/lib/account-manager/availability";
import { digitsOnly, formatWhatsappDisplay, initialsFromName } from "@/lib/account-manager/types";
import type { AccountManagerAdminRow } from "@/lib/account-manager/types";

// Orden del prototipo: L M X J V S D. El valor es el índice de Date.getDay().
const DAY_PILLS: Array<{ label: string; value: number }> = [
  { label: "L", value: 1 },
  { label: "M", value: 2 },
  { label: "X", value: 3 },
  { label: "J", value: 4 },
  { label: "V", value: 5 },
  { label: "S", value: 6 },
  { label: "D", value: 0 },
];

/** 540 → "09:00" (formato que espera <input type="time">). */
function minutesToTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:00" → 540. Devuelve null si el input está vacío o es inválido. */
function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

interface FormState {
  name: string;
  photoUrl: string;
  whatsapp: string;   // sólo los 10 dígitos nacionales; el +52 es fijo.
  start: string;      // "09:00"
  end: string;        // "18:00"
  days: number[];
}

const EMPTY_FORM: FormState = {
  name: "",
  photoUrl: "",
  whatsapp: "",
  start: "09:00",
  end: "18:00",
  days: [1, 2, 3, 4, 5],
};

function Avatar({ name, photoUrl, size = 36 }: { name: string; photoUrl: string | null; size?: number }) {
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
        fontSize: size * 0.32,
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

export function AccountManagersClient({
  initial,
  sqlPending,
}: {
  initial: AccountManagerAdminRow[];
  sqlPending: boolean;
}) {
  const askConfirm = useConfirm();
  const [managers, setManagers] = useState<AccountManagerAdminRow[]>(initial);
  const [editing, setEditing] = useState<AccountManagerAdminRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPhotoFile(null);
    setShowForm(true);
  }

  function openEdit(m: AccountManagerAdminRow) {
    setEditing(m);
    setForm({
      name: m.name,
      photoUrl: m.photoUrl ?? "",
      whatsapp: formatWhatsappDisplay(m.whatsappE164),
      start: minutesToTimeInput(m.startMinutes),
      end: minutesToTimeInput(m.endMinutes),
      days: m.days,
    });
    setPhotoFile(null);
    setMenuFor(null);
    setShowForm(true);
  }

  function toggleDay(value: number) {
    setForm(f => ({
      ...f,
      days: f.days.indexOf(value) === -1
        ? f.days.concat([value]).sort((a, b) => a - b)
        : f.days.filter(d => d !== value),
    }));
  }

  /** Sube la foto al manager ya creado. Devuelve la URL o null (no bloquea). */
  async function uploadPhoto(managerId: string, file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/account-managers/${managerId}/photo`, { method: "POST", body: fd });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.photoUrl) {
      toast.error(json?.error ?? "No se pudo subir la foto (el manager sí se guardó).");
      return null;
    }
    return json.photoUrl as string;
  }

  async function save() {
    const name = form.name.trim();
    if (!name) { toast.error("Escribe el nombre completo"); return; }
    if (digitsOnly(form.whatsapp).length !== 10) {
      toast.error("El WhatsApp debe tener exactamente 10 dígitos");
      return;
    }
    if (form.days.length === 0) { toast.error("Selecciona al menos un día"); return; }

    const startMinutes = timeInputToMinutes(form.start);
    const endMinutes = timeInputToMinutes(form.end);
    if (startMinutes === null || endMinutes === null) { toast.error("Revisa el horario"); return; }
    if (endMinutes <= startMinutes) { toast.error("La hora de cierre debe ser posterior a la de apertura"); return; }

    setSaving(true);
    try {
      const payload = {
        name,
        whatsapp: form.whatsapp,
        days: form.days,
        startMinutes,
        endMinutes,
        photoUrl: form.photoUrl.trim(),
      };
      const url = editing ? `/api/admin/account-managers/${editing.id}` : "/api/admin/account-managers";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.manager) {
        toast.error(json?.error ?? "No se pudo guardar el manager");
        return;
      }

      let saved: AccountManagerAdminRow = json.manager;
      // La foto se sube DESPUÉS de crear: la ruta necesita el id del manager.
      if (photoFile) {
        const photoUrl = await uploadPhoto(saved.id, photoFile);
        if (photoUrl) saved = { ...saved, photoUrl };
      }

      setManagers(prev =>
        editing ? prev.map(m => (m.id === saved.id ? saved : m)) : prev.concat([saved]),
      );
      toast.success(editing ? "Manager actualizado" : "Manager agregado");
      setShowForm(false);
      setPhotoFile(null);
    } catch {
      toast.error("Error de red al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(m: AccountManagerAdminRow) {
    setMenuFor(null);
    const next = m.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/admin/account-managers/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.manager) {
      toast.error(json?.error ?? "No se pudo cambiar el estado");
      return;
    }
    setManagers(prev => prev.map(x => (x.id === m.id ? json.manager : x)));
    toast.success(next === "paused" ? "Manager pausado" : "Manager activado");
  }

  async function remove(m: AccountManagerAdminRow) {
    setMenuFor(null);
    // El aviso tiene que decir el impacto real: las clínicas NO se borran,
    // se quedan sin manager (ON DELETE SET NULL).
    const impact =
      m.clinicCount > 0
        ? ` ${m.clinicCount} ${m.clinicCount === 1 ? "clínica se quedará" : "clínicas se quedarán"} sin manager asignado y su tarjeta volverá a invitar a abrir un ticket.`
        : " No tiene clínicas asignadas.";
    const ok = await askConfirm({
      title: `¿Eliminar a ${m.name}?`,
      description: `Esta acción no se puede deshacer.${impact}`,
      variant: "danger",
      confirmText: "Eliminar manager",
    });
    if (!ok) return;

    const res = await fetch(`/api/admin/account-managers/${m.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(json?.error ?? "No se pudo eliminar");
      return;
    }
    setManagers(prev => prev.filter(x => x.id !== m.id));
    toast.success(
      json?.unassignedClinics > 0
        ? `Manager eliminado · ${json.unassignedClinics} clínica(s) quedaron sin manager`
        : "Manager eliminado",
    );
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <CardNew noPad>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "18px 20px" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)" }}>
              Managers de cuenta
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              Las personas que atienden a tus clínicas por WhatsApp
            </div>
          </div>
          <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
            Agregar manager
          </ButtonNew>
        </div>

        {sqlPending && (
          <div
            style={{
              margin: "0 20px 16px",
              padding: "10px 14px",
              borderRadius: "var(--radius)",
              background: "var(--warning-soft)",
              color: "var(--warning-strong)",
              fontSize: 12.5,
            }}
          >
            Falta aplicar <span className="mono">sql/account-managers.sql</span> en Supabase. Hasta
            entonces no se pueden crear ni asignar managers, y las clínicas ven el estado vacío.
          </div>
        )}

        {managers.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Todavía no hay managers de cuenta.
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>MANAGER</th>
                <th>WHATSAPP</th>
                <th>HORARIO</th>
                <th>CLÍNICAS</th>
                <th>ESTADO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {managers.map(m => (
                <tr key={m.id}>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                      <Avatar name={m.name} photoUrl={m.photoUrl} />
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>{m.name}</span>
                    </span>
                  </td>
                  <td className="mono" style={{ fontWeight: 600 }}>{m.whatsappDisplay}</td>
                  <td>{formatSchedule(m)}</td>
                  <td style={{ fontWeight: 600 }}>
                    {m.clinicCount > 0 ? `${m.clinicCount} ${m.clinicCount === 1 ? "clínica" : "clínicas"}` : "—"}
                  </td>
                  <td>
                    <BadgeNew tone={m.status === "active" ? "success" : "neutral"} dot>
                      {m.status === "active" ? "ACTIVO" : "PAUSADO"}
                    </BadgeNew>
                  </td>
                  <td style={{ position: "relative", textAlign: "right" }}>
                    <button
                      type="button"
                      className="icon-btn-new"
                      aria-label={`Acciones de ${m.name}`}
                      onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {menuFor === m.id && (
                      <>
                        {/* Capa para cerrar al hacer click fuera. */}
                        <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={() => setMenuFor(null)} />
                        <div
                          style={{
                            position: "absolute",
                            right: 8,
                            top: "100%",
                            zIndex: 21,
                            minWidth: 180,
                            background: "var(--bg-elev)",
                            border: "1px solid var(--border-soft)",
                            borderRadius: "var(--radius)",
                            boxShadow: "var(--shadow-3)",
                            padding: 6,
                            textAlign: "left",
                          }}
                        >
                          <button type="button" className="btn-new btn-new--ghost btn-new--sm" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => openEdit(m)}>
                            <Pencil size={13} /> Editar
                          </button>
                          <button type="button" className="btn-new btn-new--ghost btn-new--sm" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => toggleStatus(m)}>
                            {m.status === "active" ? <><Pause size={13} /> Pausar</> : <><Play size={13} /> Activar</>}
                          </button>
                          <button type="button" className="btn-new btn-new--ghost btn-new--sm" style={{ width: "100%", justifyContent: "flex-start", color: "var(--danger)" }} onClick={() => remove(m)}>
                            <Trash2 size={13} /> Eliminar
                          </button>
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardNew>

      {/* ── Modal alta / edición (prototipo 1l) ────────────────────────── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => { if (!saving) setShowForm(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{editing ? "Editar manager" : "Agregar manager"}</div>
              <button
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
                onClick={() => { if (!saving) setShowForm(false); }}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div className="modal__body">
              <div className="field-new" style={{ marginBottom: 16 }}>
                <label className="field-new__label">NOMBRE COMPLETO</label>
                <input
                  className="input-new"
                  maxLength={80}
                  placeholder="Daniela Muñoz"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="field-new" style={{ marginBottom: 16 }}>
                <label className="field-new__label">FOTO</label>
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <Avatar
                    name={form.name || "?"}
                    photoUrl={photoFile ? null : (form.photoUrl || null)}
                    size={54}
                  />
                  <div style={{ minWidth: 0 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0] ?? null;
                        e.target.value = "";
                        setPhotoFile(f);
                      }}
                    />
                    <ButtonNew
                      variant="secondary"
                      size="sm"
                      type="button"
                      icon={<Upload size={14} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {photoFile ? "Cambiar archivo" : "Subir foto"}
                    </ButtonNew>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>
                      {photoFile
                        ? `${photoFile.name} — se sube al guardar`
                        : "Cuadrada, mínimo 200×200 · La verán las clínicas"}
                    </div>
                  </div>
                </div>
                <input
                  className="input-new"
                  style={{ marginTop: 10 }}
                  placeholder="…o pega la URL de una imagen (https://…)"
                  value={form.photoUrl}
                  onChange={e => setForm(f => ({ ...f, photoUrl: e.target.value }))}
                />
              </div>

              <div className="field-new" style={{ marginBottom: 16 }}>
                <label className="field-new__label">WHATSAPP</label>
                <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                  {/* El prefijo +52 es FIJO: sólo se capturan los 10 nacionales. */}
                  <span
                    className="mono"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "0 11px",
                      background: "var(--bg-elev-2)",
                      border: "1px solid var(--border-soft)",
                      borderRight: "none",
                      borderRadius: "var(--radius) 0 0 var(--radius)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--text-3)",
                    }}
                  >
                    +52
                  </span>
                  <input
                    className="input-new mono"
                    style={{ borderRadius: "0 var(--radius) var(--radius) 0" }}
                    inputMode="numeric"
                    placeholder="999 481 7755"
                    value={form.whatsapp}
                    onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                  />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 6 }}>
                  Las clínicas escribirán directo a este número.
                </div>
              </div>

              <div className="field-new">
                <label className="field-new__label">HORARIO DE ATENCIÓN</label>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <input
                    type="time"
                    className="input-new"
                    style={{ flex: 1 }}
                    value={form.start}
                    onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>a</span>
                  <input
                    type="time"
                    className="input-new"
                    style={{ flex: 1 }}
                    value={form.end}
                    onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
                  />
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
                  {DAY_PILLS.map(d => {
                    const on = form.days.indexOf(d.value) !== -1;
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggleDay(d.value)}
                        aria-pressed={on}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: "50%",
                          background: on ? "var(--brand-soft)" : "var(--bg-elev)",
                          border: `1px solid ${on ? "var(--brand)" : "var(--border-soft)"}`,
                          color: on ? "var(--brand)" : "var(--text-4)",
                          fontSize: 11,
                          fontWeight: on ? 700 : 600,
                          cursor: "pointer",
                        }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" type="button" onClick={() => setShowForm(false)} disabled={saving}>
                Cancelar
              </ButtonNew>
              <ButtonNew variant="primary" type="button" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : "Guardar manager"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
