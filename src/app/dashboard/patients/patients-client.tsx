"use client";

import { useState } from "react";
import { Search, Plus, Phone, Mail, Users, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getInitials, avatarColor, formatDate } from "@/lib/utils";
import { NewPatientModal } from "@/components/dashboard/new-patient-modal";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  INACTIVE: "bg-amber-50 text-amber-700 border-amber-200",
};

export function PatientsClient({ patients: initial }: { patients: any[] }) {
  const router = useRouter();
  const [patients, setPatients] = useState(initial);
  const [search, setSearch]     = useState("");
  const [showNew, setShowNew]   = useState(false);

  const filtered = patients.filter(p => {
    const q = search.toLowerCase();
    return (
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.phone?.includes(q) ||
      p.patientNumber.includes(q)
    );
  });

  async function handleCreated(patient: any) {
    setPatients(prev => [patient, ...prev]);
    toast.success(`Paciente ${patient.firstName} agregado`);
    setShowNew(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">{patients.length} pacientes registrados</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" />
          Nuevo paciente
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nombre, teléfono o expediente…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-white shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Paciente","Contacto","Expediente","Citas","Último contacto","Estado"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide first:pl-5 last:pr-5 hidden sm:table-cell first:block">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center">
                  <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">
                    {search ? "Sin resultados para tu búsqueda" : "No hay pacientes aún"}
                  </p>
                  {!search && (
                    <Button size="sm" className="mt-3" onClick={() => setShowNew(true)}>Agregar primer paciente</Button>
                  )}
                </td>
              </tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => window.location.href = `/dashboard/patients/${p.id}`}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full ${avatarColor(p.id)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}>
                      {getInitials(p.firstName, p.lastName)}
                    </div>
                    <div>
                      <div className="font-semibold">{p.firstName} {p.lastName}</div>
                      <div className="text-xs text-muted-foreground">{p.gender === "M" ? "Masculino" : p.gender === "F" ? "Femenino" : "Otro"}{p.dob ? ` · ${new Date().getFullYear() - new Date(p.dob).getFullYear()} años` : ""}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <div className="flex flex-col gap-0.5">
                    {p.phone && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="w-3 h-3" />{p.phone}</span>}
                    {p.email && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="w-3 h-3" />{p.email}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell font-mono text-xs text-muted-foreground">#{p.patientNumber}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-center">
                  <span className="text-sm font-bold">{p._count?.appointments ?? 0}</span>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">
                  {p.appointments?.[0] ? formatDate(p.appointments[0].date) : "Nunca"}
                </td>
                <td className="px-5 py-3 hidden sm:table-cell">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status] ?? STATUS_COLORS.ACTIVE}`}>
                    {p.status === "ACTIVE" ? "Activo" : "Inactivo"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewPatientModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
    </div>
  );
}
