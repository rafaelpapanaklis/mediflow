"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Trash2, Pencil, Check, X, Plus } from "lucide-react";

interface Announcement {
  id: string;
  message: string;
  type: string;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
}

const TYPE_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  info:        { bg: "bg-blue-900/40",    border: "border-blue-700",    text: "text-blue-300",    label: "Info" },
  warning:     { bg: "bg-amber-900/40",   border: "border-amber-700",   text: "text-amber-300",   label: "Advertencia" },
  success:     { bg: "bg-emerald-900/40", border: "border-emerald-700", text: "text-emerald-300", label: "Éxito" },
  maintenance: { bg: "bg-rose-900/40",    border: "border-rose-700",    text: "text-rose-300",    label: "Mantenimiento" },
};

export function AnnouncementsClient({ initial }: { initial: Announcement[] }) {
  const [list, setList] = useState<Announcement[]>(initial);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ message: "", type: "info", endsAt: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ message: "", type: "info", active: true, endsAt: "" });

  async function create() {
    if (!form.message.trim()) { toast.error("Mensaje requerido"); return; }
    setSaving(true);
    try {
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
      setForm({ message: "", type: "info", endsAt: "" });
      toast.success("Anuncio creado");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
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
    if (!confirm("¿Eliminar este anuncio?")) return;
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setList(prev => prev.filter(x => x.id !== id));
      toast.success("Anuncio eliminado");
    } catch { toast.error("Error al eliminar"); }
  }

  function startEdit(a: Announcement) {
    setEditing(a.id);
    setEditDraft({
      message: a.message,
      type: a.type,
      active: a.active,
      endsAt: a.endsAt ? a.endsAt.slice(0, 10) : "",
    });
  }

  async function saveEdit(id: string) {
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: editDraft.message,
          type: editDraft.type,
          active: editDraft.active,
          endsAt: editDraft.endsAt || null,
        }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setList(prev => prev.map(x => (x.id === id ? updated : x)));
      setEditing(null);
      toast.success("Guardado");
    } catch { toast.error("Error al guardar"); }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Anuncios globales</h1>
        <p className="text-slate-400 text-sm">Se muestran a todas las clínicas dentro del dashboard. Pueden ser descartados por el usuario.</p>
      </div>

      {/* New announcement */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-bold">Nuevo anuncio</h2>
        <textarea
          rows={3}
          value={form.message}
          onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
          placeholder="Ej: El 25 de abril habrá mantenimiento programado de 2 a 4 AM."
          className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600/50"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Tipo</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
            >
              {Object.entries(TYPE_STYLES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Termina (opcional)</label>
            <input
              type="date"
              value={form.endsAt}
              onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={create}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold py-2 rounded-lg text-sm disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {saving ? "Creando…" : "Crear anuncio"}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700">
          <h2 className="font-bold text-sm">Anuncios ({list.length})</h2>
        </div>
        {list.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">Sin anuncios</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {list.map(a => {
              const s = TYPE_STYLES[a.type] ?? TYPE_STYLES.info;
              const isEditing = editing === a.id;
              return (
                <div key={a.id} className="px-5 py-4">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        rows={2}
                        value={editDraft.message}
                        onChange={e => setEditDraft(d => ({ ...d, message: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-2"
                      />
                      <div className="flex gap-2 flex-wrap">
                        <select
                          value={editDraft.type}
                          onChange={e => setEditDraft(d => ({ ...d, type: e.target.value }))}
                          className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1"
                        >
                          {Object.entries(TYPE_STYLES).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={editDraft.endsAt}
                          onChange={e => setEditDraft(d => ({ ...d, endsAt: e.target.value }))}
                          className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2 py-1"
                        />
                        <label className="flex items-center gap-1 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={editDraft.active}
                            onChange={e => setEditDraft(d => ({ ...d, active: e.target.checked }))}
                          />
                          Activo
                        </label>
                        <button
                          onClick={() => saveEdit(a.id)}
                          className="ml-auto flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded-lg"
                        >
                          <Check className="w-3 h-3" /> Guardar
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold px-3 py-1 rounded-lg"
                        >
                          <X className="w-3 h-3" /> Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-4">
                      <div className={`flex-1 ${s.bg} ${s.border} border rounded-lg px-3 py-2`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold uppercase ${s.text}`}>{s.label}</span>
                          {!a.active && <span className="text-[10px] font-bold text-slate-500 uppercase">(pausado)</span>}
                          <span className="text-[10px] text-slate-500">
                            {new Date(a.createdAt).toLocaleDateString("es-MX")}
                            {a.endsAt && ` → ${new Date(a.endsAt).toLocaleDateString("es-MX")}`}
                          </span>
                        </div>
                        <p className="text-sm text-slate-200 whitespace-pre-wrap">{a.message}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => toggleActive(a)}
                          className={`px-2 py-1 rounded-lg text-xs font-bold border ${a.active ? "bg-emerald-900/40 text-emerald-300 border-emerald-700" : "bg-slate-800 text-slate-400 border-slate-700"}`}
                        >
                          {a.active ? "Activo" : "Pausado"}
                        </button>
                        <button
                          onClick={() => startEdit(a)}
                          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
                          aria-label="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => remove(a.id)}
                          className="p-2 rounded-lg hover:bg-rose-900/40 text-slate-400 hover:text-rose-400"
                          aria-label="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
