"use client";

import { useState } from "react";
import { Plus, X, Search, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface Exercise {
  id: string;
  name: string;
  description: string | null;
  category: string;
  emoji: string;
  quantity: number;     // used as sets
  minQuantity: number;  // used as reps
  unit: string;         // used as muscle group
}

export function ExercisesClient({ initialExercises }: { initialExercises: Exercise[] }) {
  const [exercises, setExercises] = useState<Exercise[]>(initialExercises);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", muscleGroup: "", sets: 3, reps: 12 });

  const filtered = exercises.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.unit.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd() {
    if (!form.name.trim()) { toast.error("El nombre es requerido"); return; }
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: "exercise_library",
          emoji: "🏋️",
          quantity: form.sets,
          minQuantity: form.reps,
          unit: form.muscleGroup || "General",
        }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setExercises(prev => [...prev, created]);
      setShowAdd(false);
      setForm({ name: "", description: "", muscleGroup: "", sets: 3, reps: 12 });
      toast.success("Ejercicio agregado");
    } catch {
      toast.error("Error al agregar ejercicio");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este ejercicio?")) return;
    try {
      const res = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      setExercises(prev => prev.filter(e => e.id !== id));
      toast.success("Ejercicio eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">Biblioteca de Ejercicios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{exercises.length} ejercicios registrados</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-5 h-5 mr-2" /> Agregar ejercicio
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          className="flex h-11 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="Buscar ejercicio o grupo muscular..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(exercise => (
            <div key={exercise.id} className="bg-card border border-border rounded-xl p-5 group">
              <div className="flex items-start justify-between">
                <h3 className="text-base font-bold">{exercise.name}</h3>
                <button onClick={() => handleDelete(exercise.id)} className="text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {exercise.description && <p className="text-sm text-muted-foreground mt-1">{exercise.description}</p>}
              <div className="mt-3 flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-brand-500/15 text-brand-700 border border-brand-300">
                  {exercise.unit}
                </span>
                <span className="text-sm text-muted-foreground">
                  {exercise.quantity} series x {exercise.minQuantity} reps
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Dumbbell className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-base font-semibold">
            {search ? "Sin resultados" : "Sin ejercicios registrados"}
          </p>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold">Agregar ejercicio</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Nombre del ejercicio *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Sentadilla búlgara"
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Descripción</Label>
                <textarea className="flex min-h-[70px] w-full rounded-xl border border-border bg-card px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                  placeholder="Instrucciones o notas"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Grupo muscular</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Piernas, Espalda, Core"
                  value={form.muscleGroup} onChange={e => setForm(f => ({ ...f, muscleGroup: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">Series</Label>
                  <input type="number" min="1"
                    className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={form.sets} onChange={e => setForm(f => ({ ...f, sets: parseInt(e.target.value) || 1 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Repeticiones</Label>
                  <input type="number" min="1"
                    className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                    value={form.reps} onChange={e => setForm(f => ({ ...f, reps: parseInt(e.target.value) || 1 }))} />
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">Cancelar</Button>
              <Button onClick={handleAdd} className="flex-1 h-11 text-base">Agregar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
