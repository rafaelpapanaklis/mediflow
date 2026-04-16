"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, FlaskConical } from "lucide-react";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
}

interface FormulaRecord {
  id: string;
  type: string;
  formula: Record<string, unknown>;
  notes: string | null;
  appliedAt: string;
  appliedBy: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  hair_color: "Color de cabello",
  lash_extension: "Extensión de pestañas",
  brow_tint: "Tinte de cejas",
  herbal: "Herbolaria",
};

export function FormulasClient({ patients }: { patients: Patient[] }) {
  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<string>("");
  const [records, setRecords] = useState<FormulaRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const filteredPatients = useMemo(() => {
    if (!search) return patients;
    const q = search.toLowerCase();
    return patients.filter(p =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)
    );
  }, [patients, search]);

  useEffect(() => {
    if (!selectedPatient) { setRecords([]); return; }
    setLoading(true);
    fetch(`/api/formulas?patientId=${selectedPatient}`)
      .then(r => { if (!r.ok) throw new Error("Error"); return r.json(); })
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => toast.error("Error al cargar fórmulas"))
      .finally(() => setLoading(false));
  }, [selectedPatient]);

  function renderFormula(formula: Record<string, unknown>) {
    return (
      <div className="bg-muted rounded-lg p-3 mt-2">
        {Object.entries(formula).map(([key, value]) => (
          <div key={key} className="flex justify-between text-sm py-0.5">
            <span className="font-medium text-muted-foreground">{key}:</span>
            <span>{String(value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold">Fórmulas</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Historial de fórmulas por paciente</p>
      </div>

      {/* Patient search */}
      <div className="mb-6 space-y-1.5">
        <Label className="text-sm">Buscar paciente</Label>
        <div className="relative max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            className="flex h-11 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Nombre del paciente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Patient list */}
      {!selectedPatient && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {filteredPatients.slice(0, 20).map((p, idx) => (
            <button
              key={p.id}
              onClick={() => { setSelectedPatient(p.id); setSearch(""); }}
              className={`w-full text-left px-5 py-3 hover:bg-muted/10 transition-colors ${idx > 0 ? "border-t border-border/50" : ""}`}
            >
              <span className="text-sm font-medium">{p.firstName} {p.lastName}</span>
            </button>
          ))}
          {filteredPatients.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">Sin resultados</div>
          )}
        </div>
      )}

      {/* Selected patient header */}
      {selectedPatient && (
        <div className="mb-4">
          <button
            onClick={() => setSelectedPatient("")}
            className="text-sm text-brand-600 hover:underline mb-2"
          >
            &larr; Volver a la lista
          </button>
          <h2 className="text-lg font-bold">
            {patients.find(p => p.id === selectedPatient)?.firstName}{" "}
            {patients.find(p => p.id === selectedPatient)?.lastName}
          </h2>
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Cargando fórmulas...</p>}

      {/* Formula records */}
      {selectedPatient && !loading && (
        <div className="space-y-3">
          {records.map(record => (
            <div key={record.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{TYPE_LABELS[record.type] || record.type}</span>
                <span className="text-xs text-muted-foreground">{new Date(record.appliedAt).toLocaleDateString("es-MX")}</span>
              </div>
              {record.appliedBy && <p className="text-xs text-muted-foreground mt-1">Aplicado por: {record.appliedBy}</p>}
              {record.notes && <p className="text-sm text-muted-foreground mt-1">{record.notes}</p>}
              {renderFormula(record.formula as Record<string, unknown>)}
            </div>
          ))}
          {records.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <FlaskConical className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-base font-semibold">Sin fórmulas registradas</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
