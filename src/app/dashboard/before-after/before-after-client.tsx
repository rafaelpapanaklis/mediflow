"use client";

import { useState, useEffect } from "react";
import { Plus, Image, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  _count: { beforeAfterPhotos: number };
}

interface Photo {
  id: string;
  category: string;
  angle: string;
  url: string;
  notes: string | null;
  takenAt: string;
}

export function BeforeAfterClient({ patients }: { patients: Patient[] }) {
  const [selectedPatient, setSelectedPatient] = useState<string>("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category: "before", angle: "front", url: "", notes: "" });

  useEffect(() => {
    if (!selectedPatient) { setPhotos([]); return; }
    setLoading(true);
    fetch(`/api/before-after?patientId=${selectedPatient}`)
      .then(r => { if (!r.ok) throw new Error("Error"); return r.json(); })
      .then(data => setPhotos(Array.isArray(data) ? data : []))
      .catch(() => toast.error("Error al cargar fotos"))
      .finally(() => setLoading(false));
  }, [selectedPatient]);

  async function handleAdd() {
    if (!form.url.trim()) { toast.error("La URL es requerida"); return; }
    if (!selectedPatient) { toast.error("Selecciona un paciente"); return; }
    try {
      const res = await fetch("/api/before-after", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: selectedPatient, ...form }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setPhotos(prev => [created, ...prev]);
      setShowAdd(false);
      setForm({ category: "before", angle: "front", url: "", notes: "" });
      toast.success("Foto agregada");
    } catch {
      toast.error("Error al agregar foto");
    }
  }

  const beforePhotos = photos.filter(p => p.category === "before");
  const afterPhotos = photos.filter(p => p.category === "after");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">Antes y Después</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Registro fotográfico de tratamientos</p>
        </div>
        <Button onClick={() => setShowAdd(true)} disabled={!selectedPatient}>
          <Plus className="w-5 h-5 mr-2" /> Agregar foto
        </Button>
      </div>

      {/* Patient selector */}
      <div className="mb-6 space-y-1.5">
        <Label className="text-sm">Paciente</Label>
        <select
          className="flex h-11 w-full max-w-md rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          value={selectedPatient}
          onChange={e => setSelectedPatient(e.target.value)}
        >
          <option value="">Seleccionar paciente...</option>
          {patients.map(p => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName} ({p._count.beforeAfterPhotos} fotos)
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Cargando fotos...</p>}

      {!loading && selectedPatient && photos.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Image className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-base font-semibold">Sin fotos registradas</p>
        </div>
      )}

      {/* Side-by-side comparison */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-lg font-bold mb-3">Antes</h2>
            <div className="space-y-3">
              {beforePhotos.map(photo => (
                <div key={photo.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <img src={photo.url} alt="Antes" className="w-full h-48 object-cover" />
                  <div className="p-3">
                    <p className="text-sm font-medium">{photo.angle}</p>
                    {photo.notes && <p className="text-sm text-muted-foreground">{photo.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(photo.takenAt).toLocaleDateString("es-MX")}</p>
                  </div>
                </div>
              ))}
              {beforePhotos.length === 0 && <p className="text-sm text-muted-foreground">Sin fotos de antes</p>}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold mb-3">Después</h2>
            <div className="space-y-3">
              {afterPhotos.map(photo => (
                <div key={photo.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <img src={photo.url} alt="Después" className="w-full h-48 object-cover" />
                  <div className="p-3">
                    <p className="text-sm font-medium">{photo.angle}</p>
                    {photo.notes && <p className="text-sm text-muted-foreground">{photo.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(photo.takenAt).toLocaleDateString("es-MX")}</p>
                  </div>
                </div>
              ))}
              {afterPhotos.length === 0 && <p className="text-sm text-muted-foreground">Sin fotos de después</p>}
            </div>
          </div>
        </div>
      )}

      {/* Add Photo Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-bold">Agregar foto</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Categoría</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                  value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="before">Antes</option>
                  <option value="after">Después</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Ángulo</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                  value={form.angle} onChange={e => setForm(f => ({ ...f, angle: e.target.value }))}>
                  <option value="front">Frontal</option>
                  <option value="left">Izquierda</option>
                  <option value="right">Derecha</option>
                  <option value="top">Superior</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">URL de la imagen *</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="https://ejemplo.com/foto.jpg"
                  value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Notas</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Opcional"
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
