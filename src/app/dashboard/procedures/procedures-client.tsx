"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { formatCurrency } from "@/lib/utils";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Clock,
  Tag,
  Info,
  Power,
} from "lucide-react";

interface Procedure {
  id: string;
  name: string;
  code: string | null;
  category: string;
  basePrice: number;
  duration: number | null;
  description: string | null;
  isActive: boolean;
}

interface Props {
  initialProcedures: Procedure[];
}

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "general", label: "General" },
  { value: "dental", label: "Dental" },
  { value: "aesthetic", label: "Estética" },
  { value: "laboratory", label: "Laboratorio" },
  { value: "consultation", label: "Consulta" },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.value, c.label])
);

interface FormState {
  name: string;
  code: string;
  category: string;
  basePrice: string;
  duration: string;
  description: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  category: "general",
  basePrice: "",
  duration: "",
  description: "",
  isActive: true,
};

export function ProceduresClient({ initialProcedures }: Props) {
  const [procedures, setProcedures] = useState<Procedure[]>(initialProcedures);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Procedure | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return procedures;
    return procedures.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [procedures, search]);

  const grouped = useMemo(() => {
    const map: Record<string, Procedure[]> = {};
    for (const p of filtered) {
      (map[p.category] ??= []).push(p);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(p: Procedure) {
    setEditing(p);
    setForm({
      name: p.name,
      code: p.code ?? "",
      category: p.category,
      basePrice: String(p.basePrice),
      duration: p.duration != null ? String(p.duration) : "",
      description: p.description ?? "",
      isActive: p.isActive,
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("El nombre es requerido");
      return;
    }
    const price = Number(form.basePrice);
    if (Number.isNaN(price) || price < 0) {
      toast.error("Precio inválido");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        category: form.category,
        basePrice: price,
        duration: form.duration ? Number(form.duration) : null,
        description: form.description.trim() || null,
        isActive: form.isActive,
      };

      if (editing) {
        const res = await fetch(`/api/procedures/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "Error al actualizar");
        }
        const updated: Procedure = await res.json();
        setProcedures((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        );
        toast.success("Procedimiento actualizado");
      } else {
        const res = await fetch("/api/procedures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "Error al crear");
        }
        const created: Procedure = await res.json();
        setProcedures((prev) => [created, ...prev]);
        toast.success("Procedimiento creado");
      }
      setModalOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Procedure) {
    const next = !p.isActive;
    // optimistic
    setProcedures((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, isActive: next } : x))
    );
    try {
      const res = await fetch(`/api/procedures/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? "Activado" : "Desactivado");
    } catch {
      // revert
      setProcedures((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, isActive: p.isActive } : x))
      );
      toast.error("Error al actualizar estado");
    }
  }

  async function handleDelete(p: Procedure) {
    if (!confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`))
      return;
    try {
      const res = await fetch(`/api/procedures/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setProcedures((prev) => prev.filter((x) => x.id !== p.id));
      toast.success("Procedimiento eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  const activeCount = procedures.filter((p) => p.isActive).length;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-foreground">
            Catálogo de Procedimientos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {procedures.length} procedimiento{procedures.length === 1 ? "" : "s"}{" "}
            · {activeCount} activo{activeCount === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm rounded-xl shadow-card transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuevo procedimiento
        </button>
      </div>

      {/* Info banner */}
      <div className="flex gap-3 p-4 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/40 rounded-2xl">
        <Info className="w-5 h-5 text-brand-600 dark:text-brand-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-brand-900 dark:text-brand-100 leading-relaxed">
          Estos procedimientos aparecen como opciones en el expediente dental.
          Cuando el doctor marque procedimientos en una consulta, se creará
          automáticamente una factura borrador con estos precios.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, código o categoría..."
          className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
        />
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl shadow-card p-12 text-center">
          <Tag className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {procedures.length === 0
              ? "Aún no tienes procedimientos. Crea el primero para comenzar."
              : "No se encontraron procedimientos con ese criterio."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <div
              key={category}
              className="bg-card border border-border rounded-2xl shadow-card overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-border bg-muted/50">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABEL[category] ?? category}
                  <span className="ml-2 text-muted-foreground font-semibold">
                    ({items.length})
                  </span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="px-5 py-3">Nombre</th>
                      <th className="px-3 py-3">Código SAT</th>
                      <th className="px-3 py-3 text-right">Precio</th>
                      <th className="px-3 py-3">Duración</th>
                      <th className="px-3 py-3">Estado</th>
                      <th className="px-5 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr
                        key={p.id}
                        className={`border-b border-border last:border-0 hover:bg-muted transition-colors ${
                          !p.isActive ? "opacity-60" : ""
                        }`}
                      >
                        <td className="px-5 py-3">
                          <div className="font-semibold text-foreground">
                            {p.name}
                          </div>
                          {p.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {p.description}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground font-mono text-xs">
                          {p.code ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-bold text-foreground whitespace-nowrap">
                          {formatCurrency(p.basePrice)}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                          {p.duration ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {p.duration} min
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                              p.isActive
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {p.isActive ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(p)}
                              title="Editar"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => toggleActive(p)}
                              title={p.isActive ? "Desactivar" : "Activar"}
                              className={`p-1.5 rounded-lg transition-colors ${
                                p.isActive
                                  ? "text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                  : "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                              }`}
                            >
                              <Power className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
                              title="Eliminar"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">
                {editing ? "Editar procedimiento" : "Nuevo procedimiento"}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Limpieza dental"
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    Código SAT
                  </label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    Categoría
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    Precio base MXN <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.basePrice}
                    onChange={(e) =>
                      setForm({ ...form, basePrice: e.target.value })
                    }
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    Duración (min)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.duration}
                    onChange={(e) =>
                      setForm({ ...form, duration: e.target.value })
                    }
                    placeholder="Opcional"
                    className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                  Descripción
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={3}
                  placeholder="Opcional"
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 resize-none"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-border text-brand-600 focus:ring-brand-500/40"
                />
                <span className="text-sm font-semibold text-muted-foreground">
                  Activo
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
                >
                  {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
