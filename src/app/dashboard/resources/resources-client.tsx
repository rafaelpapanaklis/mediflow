"use client";

import { useState, useMemo } from "react";
import { Plus, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface Booking {
  id: string;
  resourceType: string;
  resourceName: string;
  startTime: string;
  endTime: string;
}

export function ResourcesClient({ initialBookings }: { initialBookings: Booking[] }) {
  const [bookings, setBookings] = useState<Booking[]>(initialBookings);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ resourceType: "", resourceName: "", startTime: "", endTime: "" });

  const grouped = useMemo(() => {
    const map: Record<string, Booking[]> = {};
    for (const b of bookings) {
      const key = `${b.resourceType} — ${b.resourceName}`;
      if (!map[key]) map[key] = [];
      map[key].push(b);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [bookings]);

  async function handleAdd() {
    if (!form.resourceType.trim() || !form.resourceName.trim() || !form.startTime || !form.endTime) {
      toast.error("Todos los campos son requeridos");
      return;
    }
    try {
      // Convert time strings (HH:MM) to full ISO datetime using today's date
      const today = new Date().toISOString().split("T")[0];
      const payload = {
        ...form,
        startTime: new Date(`${today}T${form.startTime}:00`).toISOString(),
        endTime: new Date(`${today}T${form.endTime}:00`).toISOString(),
      };
      const res = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setBookings(prev => [...prev, created].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));
      setShowAdd(false);
      setForm({ resourceType: "", resourceName: "", startTime: "", endTime: "" });
      toast.success("Reserva creada");
    } catch {
      toast.error("Error al crear reserva");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta reserva?")) return;
    try {
      await fetch(`/api/resources/${id}`, { method: "DELETE" });
      setBookings(prev => prev.filter(b => b.id !== id));
      toast.success("Reserva eliminada");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  function formatTime(dt: string) {
    return new Date(dt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">Recursos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Reservas del día — {bookings.length} registradas</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-5 h-5 mr-2" /> Nueva reserva
        </Button>
      </div>

      {/* Timeline grouped by resource */}
      {grouped.length > 0 ? (
        <div className="space-y-6">
          {grouped.map(([resourceKey, items]) => (
            <div key={resourceKey}>
              <h2 className="text-base font-bold mb-2">{resourceKey}</h2>
              <div className="bg-white dark:bg-slate-900 border border-border rounded-xl overflow-hidden">
                {items.map((booking, idx) => (
                  <div
                    key={booking.id}
                    className={`flex items-center justify-between px-5 py-3 group hover:bg-muted/10 ${idx > 0 ? "border-t border-border/50" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-8 bg-brand-600 rounded-full" />
                      <div>
                        <p className="text-sm font-bold">
                          {formatTime(booking.startTime)} — {formatTime(booking.endTime)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(booking.id)}
                      className="text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-base font-semibold">Sin reservas para hoy</p>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold">Nueva reserva</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Tipo de recurso *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Consultorio, Equipo, Sala"
                  value={form.resourceType} onChange={e => setForm(f => ({ ...f, resourceType: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Nombre del recurso *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej: Consultorio 1, Láser CO2"
                  value={form.resourceName} onChange={e => setForm(f => ({ ...f, resourceName: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">Hora inicio *</Label>
                  <input type="time"
                    className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
                    value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Hora fin *</Label>
                  <input type="time"
                    className="flex h-11 w-full rounded-xl border border-border bg-white dark:bg-slate-800 px-4 text-base focus:outline-none"
                    value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">Cancelar</Button>
              <Button onClick={handleAdd} className="flex-1 h-11 text-base">Crear reserva</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
