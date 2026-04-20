"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Plus, Download, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { NewPatientModal } from "@/components/dashboard/new-patient-modal";
import { formatRelativeDate, ageFromDob } from "@/lib/format";

interface Props {
  patients:     any[];
  total:        number;
  activeCount:  number;
  page:         number;
  totalPages:   number;
  search:       string;
  statusFilter: string;
}

const STATUS_FILTERS = [
  { value: "all",      label: "Todos" },
  { value: "active",   label: "Activos" },
  { value: "inactive", label: "Inactivos" },
  { value: "archived", label: "Archivados" },
];

function patientStatusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "ACTIVE")   return "success";
  if (status === "INACTIVE") return "warning";
  return "neutral";
}

function patientStatusLabel(status: string): string {
  if (status === "ACTIVE")   return "Activo";
  if (status === "INACTIVE") return "Inactivo";
  if (status === "ARCHIVED") return "Archivado";
  return status;
}

export function PatientsClient({ patients, total, activeCount, page, totalPages, search: initialSearch, statusFilter }: Props) {
  const router = useRouter();
  const [search, setSearch]   = useState(initialSearch);
  const [showNew, setShowNew] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();

  function navigate(params: Record<string, string | undefined>) {
    const q = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      search, status: statusFilter, page: "1", ...params,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "all" && v !== "") q.set(k, v);
    }
    router.push(`/dashboard/patients${q.toString() ? `?${q}` : ""}`);
  }

  function handleSearch(v: string) {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ search: v || undefined, page: "1" }), 350);
  }

  function goToPage(p: number) { navigate({ page: String(p) }); }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>Pacientes</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {total.toLocaleString("es-MX")} pacientes · {activeCount.toLocaleString("es-MX")} activos
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/api/patients/export" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <ButtonNew variant="secondary" icon={<Download size={14} />}>Exportar</ButtonNew>
          </a>
          <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
            Nuevo paciente
          </ButtonNew>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono, expediente…"
          />
        </div>
        <div className="segment-new">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => navigate({ status: f.value, page: "1" })}
              className={`segment-new__btn ${statusFilter === f.value ? "segment-new__btn--active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <CardNew noPad>
        {patients.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <Users size={32} style={{ color: "var(--text-4)", margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-3)", fontSize: 13 }}>
              {search ? "Sin resultados" : "No hay pacientes todavía"}
            </p>
            {!search && (
              <div style={{ marginTop: 12 }}>
                <ButtonNew variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
                  Agregar primer paciente
                </ButtonNew>
              </div>
            )}
          </div>
        ) : (
          <>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Contacto</th>
                  <th>Expedientes</th>
                  <th>Última visita</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {patients.map(p => {
                  const lastVisit = p.appointments?.[0]?.date;
                  const age = ageFromDob(p.dob);
                  const fullName = `${p.firstName} ${p.lastName}`;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link
                          href={`/dashboard/patients/${p.id}`}
                          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
                        >
                          <AvatarNew name={fullName} size="sm" />
                          <div>
                            <div style={{ fontWeight: 500, color: "var(--text-1)" }}>{fullName}</div>
                            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                              #{p.patientNumber}
                              {age !== null ? ` · ${age}a` : ""}
                              {p.gender === "M" ? " · M" : p.gender === "F" ? " · F" : ""}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td>
                        <div style={{ color: "var(--text-1)" }}>{p.phone || "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{p.email || "—"}</div>
                      </td>
                      <td className="mono" style={{ color: "var(--text-2)" }}>
                        {p._count?.records ?? 0}
                      </td>
                      <td style={{ color: "var(--text-2)" }}>
                        {formatRelativeDate(lastVisit)}
                      </td>
                      <td>
                        <BadgeNew tone={patientStatusTone(p.status)} dot>
                          {patientStatusLabel(p.status)}
                        </BadgeNew>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link
                          href={`/dashboard/patients/${p.id}`}
                          style={{ textDecoration: "none", color: "var(--brand)", fontSize: 11, fontWeight: 600 }}
                        >
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination">
                <div className="pagination__info">
                  Página <strong style={{ color: "var(--text-2)" }}>{page}</strong> de {totalPages} · {total} pacientes
                </div>
                <div className="pagination__pages">
                  <button
                    type="button"
                    className="pagination__btn"
                    disabled={page <= 1}
                    onClick={() => goToPage(page - 1)}
                    aria-label="Página anterior"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5)         pageNum = i + 1;
                    else if (page <= 3)          pageNum = i + 1;
                    else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else                         pageNum = page - 2 + i;
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => goToPage(pageNum)}
                        className={`pagination__btn ${pageNum === page ? "pagination__btn--active" : ""}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="pagination__btn"
                    disabled={page >= totalPages}
                    onClick={() => goToPage(page + 1)}
                    aria-label="Página siguiente"
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </CardNew>

      <NewPatientModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { router.refresh(); setShowNew(false); }} />
    </div>
  );
}
