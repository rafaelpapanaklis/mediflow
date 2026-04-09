"use client";

import { useState } from "react";
import { Plus, X, ChevronRight, Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface PipelineItem {
  id: string;
  name: string;        // patient name
  description: string | null; // type of orthotic
  category: string;    // "orthotics_<stage>"
  emoji: string;
  quantity: number;
  minQuantity: number;
  unit: string;        // days tracking info
  createdAt: string;
}

const STAGES = [
  { key: "evaluacion",    label: "Evaluación" },
  { key: "molde",         label: "Molde" },
  { key: "laboratorio",   label: "En laboratorio" },
  { key: "listo",         label: "Listo" },
  { key: "entregado",     label: "Entregado" },
  { key: "ajuste",        label: "Ajuste" },
];

const STAGE_COLORS: Record<string, string> = {
  evaluacion:  "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
  molde:       "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
  laboratorio: "border-purple-400 bg-purple-50 dark:bg-purple-950/30",
  listo:       "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
  entregado:   "border-slate-400 bg-slate-50 dark:bg-slate-800/50",
  ajuste:      "border-rose-400 bg-rose-50 dark:bg-rose-950/30",
};

function getStage(category: string): string {
  return category.replace("orthotics_", "");
}

function getDaysInStage(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

export function OrthoticsClient({ initialItems }: { initialItems: PipelineItem[] }) {
  const [items, setItems] = useState<PipelineItem[]>(initialItems);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ patientName: "", type: "", notes: "" });

  async function handleAdd() {
    if (!form.patientName.trim() || !form.type.trim()) {
      toast.error("Nombre del paciente y tipo son requeridos");
      return;
    }
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.patientName,
          description: form.type,
          category: "orthotics_evaluacion",
          emoji: "🦶",
          quantity: 0,
          minQuantity: 0,
          unit: form.notes || "Sin notas",
        }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setItems(prev => [...prev, created]);
      setShowAdd(false);
      setForm({ patientName: "", type: "", notes: "" });
      toast.success("Orden creada");
    } catch {
      toast.error("Error al crear orden");
    }
  }

  async function advanceStage(item: PipelineItem) {
    const currentStage = getStage(item.category);
    const currentIdx = STAGES.findIndex(s => s.key === currentStage);
    if (currentIdx === -1 || currentIdx >= STAGES.length - 1) {
      toast.error("Ya está en la última etapa");
      return;
    }
    const nextStage = STAGES[currentIdx + 1].key;
    try {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: `orthotics_${nextStage}` }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, category: updated.category } : i));
      toast.success(`Avanzado a: ${STAGES[currentIdx + 1].label}`);
    } catch {
      toast.error("Error al avanzar etapa");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta orden?")) return;
    try {
      await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      setItems(prev => prev.filter(i => i.id !== id));
      toast.success("Orden eliminada");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">Pipeline Ortopédicos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{items.length} órdenes en proceso</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-5 h-5 mr-2" /> Nueva orden
        </Button>
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {STAGES.map(stage => {
          const stageItems = items.filter(i => getStage(i.category) === stage.key);
          return (
            <div key={stage.key} className="min-h-[200px]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold">{stage.label}</h3>
                <span className="text-xs font-bold bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full">{stageItems.length}</span>
              </div>
              <div className="space-y-2">
                {stageItems.map(item => {
                  const days = getDaysInStage(item.createdAt);
                  const currentIdx = STAGES.findIndex(s => s.key === stage.key);
                  const isLast = currentIdx >= STAGES.length - 1;

                  return (
                    <div key={item.id} className={`border-2 rounded-xl p-3 group ${STAGE_COLORS[stage.key] || "border-border"}`}>
                      <div className="flex items-start justify-between">
                        <p className="text-sm font-bold leading-tight">{item.name}</p>
                        <button onClick={() => handleDelete(item.id)} className="text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {item.description && <p className="text-xs text-muted-foreground mt-1">{item.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {days === 0 ? "Hoy" : `${days} día${days > 1 ? "s" : ""}`} en esta etapa
                      </p>
                      {!isLast && (
                        <button
                          onClick={() => advanceStage(item)}
                          className="mt-2 flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors"
                        >
                          Avanzar <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {stageItems.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-xs">Vacío</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="text-center py-16 text-muted-foreground mt-4">
          <Footprints className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-base font-semibold">Sin órdenes de ortopédicos</p>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold">Nueva orden ortopédica</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Nombre del paciente *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Nombre completo"
                  value={form.patientName} onChange={e => setForm(f => ({ ...f, patientName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Tipo de ortopédico *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Plantilla, Férula, Órtesis"
                  value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Notas</Label>
                <textarea className="flex min-h-[70px] w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                  placeholder="Observaciones adicionales"
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">Cancelar</Button>
              <Button onClick={handleAdd} className="flex-1 h-11 text-base">Crear orden</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
