"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface Props { open: boolean; onClose: () => void; onCreated: (patient: any) => void; }

export function NewPatientModal({ open, onClose, onCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", gender: "OTHER", dob: "", address: "", allergies: "", notes: "", isChild: false });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName) { toast.error("Nombre y apellido requeridos"); return; }
    setLoading(true);
    try {
      const dupeCheck = await fetch(`/api/patients?search=${encodeURIComponent(form.firstName + " " + form.lastName)}`);
      if (dupeCheck.ok) {
        const existing = await dupeCheck.json();
        if (Array.isArray(existing) && existing.length > 0) {
          const confirmed = window.confirm(`Ya existe un paciente con nombre "${form.firstName} ${form.lastName}". ¿Deseas crear otro de todos modos?`);
          if (!confirmed) { setLoading(false); return; }
        }
      }
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, isChild: form.isChild, allergies: form.allergies ? form.allergies.split(",").map(s => s.trim()).filter(Boolean) : [] }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const patient = await res.json();
      onCreated(patient);
      setForm({ firstName:"", lastName:"", email:"", phone:"", gender:"OTHER", dob:"", address:"", allergies:"", notes:"", isChild:false });
      toast.success(`Paciente ${patient.firstName} creado`);
    } catch (err: any) {
      toast.error(err.message ?? "Error al crear paciente");
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-foreground font-bold">Nuevo paciente</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Nombre *</Label><Input placeholder="Ana" value={form.firstName} onChange={e => set("firstName", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Apellido *</Label><Input placeholder="García" value={form.lastName} onChange={e => set("lastName", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" placeholder="ana@email.com" value={form.email} onChange={e => set("email", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Teléfono</Label><Input placeholder="+52 55..." value={form.phone} onChange={e => set("phone", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Fecha de nacimiento</Label><Input type="date" value={form.dob} onChange={e => set("dob", e.target.value)} /></div>
            <div className="space-y-1.5">
            <Label>Tipo de paciente</Label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm(f => ({ ...f, isChild: false }))}
                className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-colors ${!form.isChild ? "bg-brand-600 text-white border-brand-600" : "border-border text-foreground hover:bg-muted"}`}>
                🦷 Adulto
              </button>
              <button type="button" onClick={() => setForm(f => ({ ...f, isChild: true }))}
                className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-colors ${form.isChild ? "bg-amber-500 text-white border-amber-500" : "border-border text-foreground hover:bg-muted"}`}>
                🧒 Niño (dentición temporal)
              </button>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Género</Label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20" value={form.gender} onChange={e => set("gender", e.target.value)}>
                <option value="M">Masculino</option><option value="F">Femenino</option><option value="OTHER">Otro</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Dirección</Label><Input placeholder="Calle, Col., Ciudad" value={form.address} onChange={e => set("address", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Alergias (separadas por comas)</Label><Input placeholder="Penicilina, Látex..." value={form.allergies} onChange={e => set("allergies", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Notas</Label>
            <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Motivo de consulta, antecedentes…" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={loading} onClick={handleSubmit as any}>{loading ? "Guardando…" : "Crear paciente"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
