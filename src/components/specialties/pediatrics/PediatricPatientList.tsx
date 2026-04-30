"use client";
// Pediatrics — lista filtrable cliente-side de pacientes pediátricos. Spec: §7 (sprint 2)

import { useMemo, useState } from "react";
import { Plus, Search, Baby } from "lucide-react";
import { PediatricPatientCard, type PediatricPatientCardData } from "./PediatricPatientCard";
import { NewPediatricPatientDialog } from "./NewPediatricPatientDialog";

export interface PediatricPatientListProps {
  patients: PediatricPatientCardData[];
}

export function PediatricPatientList({ patients }: PediatricPatientListProps) {
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      if (p.fullName.toLowerCase().includes(q)) return true;
      if (p.primaryGuardianName?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [patients, query]);

  return (
    <div className="ped-list">
      <header className="ped-list__header">
        <div>
          <h1 className="ped-list__title">Odontopediatría</h1>
          <p className="ped-list__subtitle">Pacientes 0–18 años con expediente pediátrico activo o elegible.</p>
        </div>
        <button
          type="button"
          className="pedi-btn pedi-btn--brand"
          onClick={() => setDialogOpen(true)}
        >
          <Plus size={14} aria-hidden /> Nuevo paciente pediátrico
        </button>
      </header>

      <div className="ped-list__toolbar">
        <label className="ped-list__search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            placeholder="Buscar por nombre o tutor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar paciente pediátrico"
          />
        </label>
        <span className="ped-list__count">
          {filtered.length === patients.length
            ? `${patients.length} ${patients.length === 1 ? "paciente" : "pacientes"}`
            : `${filtered.length} de ${patients.length}`}
        </span>
      </div>

      {patients.length === 0 ? (
        <div className="ped-list__empty">
          <div className="ped-list__empty-icon" aria-hidden>
            <Baby size={48} />
          </div>
          <h2>Sin pacientes pediátricos todavía</h2>
          <p>
            Aún no hay menores de 18 con expediente en esta clínica. Crea el primero
            para empezar a capturar Frankl, CAMBRA, hábitos y consentimientos.
          </p>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={() => setDialogOpen(true)}
          >
            <Plus size={14} aria-hidden /> Crear primer paciente pediátrico
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="ped-list__empty ped-list__empty--soft">
          <p>Sin coincidencias para “{query}”.</p>
        </div>
      ) : (
        <ul className="ped-list__grid">
          {filtered.map((p) => (
            <li key={p.id}>
              <PediatricPatientCard patient={p} />
            </li>
          ))}
        </ul>
      )}

      <NewPediatricPatientDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
