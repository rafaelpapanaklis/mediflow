"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Phone, Mail, Users, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getInitials, avatarColor, formatDate } from "@/lib/utils";
import { NewPatientModal } from "@/components/dashboard/new-patient-modal";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:   "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700",
  INACTIVE: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
};

export function PatientsClient({ patients, total, page, totalPages, search: initialSearch }: {
  patients: any[]; total: number; page: number; totalPages: number; search: string;
}) {
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch]   = useState(initialSearch);
  const router = useRouter();
  const debounceRef = useRef<NodeJS.Timeout>();

  const filtered = patients; // Server-side filtered

  function navigateSearch(value: string) {
    const params = new URLSearchParams();
    if (value) params.set("search", value);
    params.set("page", "1");
    router.push(`/dashboard/patients?${params.toString()}`);
  }

  function handleSearch(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigateSearch(value), 350);
  }

  function goToPage(p: number) {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("page", String(p));
    router.push(`/dashboard/patients?${params.toString()}`);
  }

  function handleCreated(patient: any) {
    router.refresh();
    setShowNew(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">{total} pacientes registrados</p>
        </div>
        <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />Nuevo paciente</Button>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nombre, teléfono o expediente…" value={search} onChange={e => handleSearch(e.target.value)} />
      </div>

      <div className="rounded-xl border border-border bg-white dark:bg-slate-900 shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Paciente","Contacto","Expediente","Citas","Última visita","Estado",""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide first:pl-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center">
                <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">{search ? "Sin resultados" : "No hay pacientes aún"}</p>
                {!search && <Button size="sm" className="mt-3" onClick={() => setShowNew(true)}>Agregar primer paciente</Button>}
              </td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3">
                  <Link href={`/dashboard/patients/${p.id}`} className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full ${avatarColor(p.id)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`}>
                      {getInitials(p.firstName, p.lastName)}
                    </div>
                    <div>
                      <div className="font-semibold hover:text-brand-600 transition-colors">{p.firstName} {p.lastName}</div>
                      <div className="text-xs text-muted-foreground">{p.gender === "M" ? "Masculino" : p.gender === "F" ? "Femenino" : "Otro"}{p.dob ? ` · ${new Date().getFullYear() - new Date(p.dob).getFullYear()} años` : ""}</div>
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <div className="flex flex-col gap-0.5">
                    {p.phone && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="w-3 h-3" />{p.phone}</span>}
                    {p.email && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="w-3 h-3" />{p.email}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{p.patientNumber}</td>
                <td className="px-4 py-3 text-center font-bold">{p._count?.appointments ?? 0}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{p.appointments?.[0] ? formatDate(p.appointments[0].date) : "Nunca"}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status] ?? STATUS_COLORS.ACTIVE}`}>
                    {p.status === "ACTIVE" ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/patients/${p.id}`} className="text-xs font-semibold text-brand-600 hover:underline">Ver →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages} · {total} pacientes
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
            </Button>
            {/* Page number pills */}
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-semibold transition-colors ${
                      pageNum === page
                        ? "bg-brand-600 text-white"
                        : "bg-white dark:bg-slate-900 border border-border hover:bg-muted text-foreground"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Siguiente <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      <NewPatientModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
    </div>
  );
}
