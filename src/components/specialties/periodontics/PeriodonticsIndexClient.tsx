"use client";
// Periodontics — wrapper client de la página index. Monta el botón
// "Iniciar sondaje" + el modal picker. SPEC §6.

import { useState } from "react";
import { Plus } from "lucide-react";
import { PerioPatientList, type PerioPatientRow } from "./PerioPatientList";
import {
  OverdueMaintenanceWidget,
  type OverdueMaintenanceRow,
} from "./OverdueMaintenanceWidget";
import { NewPerioPatientPickerModal } from "./NewPerioPatientPickerModal";

export interface PeriodonticsIndexClientProps {
  patients: PerioPatientRow[];
  overdue: OverdueMaintenanceRow[];
}

export function PeriodonticsIndexClient(props: PeriodonticsIndexClientProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--text-1)",
                margin: 0,
              }}
            >
              Periodoncia
            </h1>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              Pacientes con expediente periodontal · clasificación 2017 AAP/EFP · riesgo Berna.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--brand, #6366f1)",
              background: "var(--brand, #6366f1)",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Plus size={14} aria-hidden /> Iniciar sondaje
          </button>
        </header>

        <OverdueMaintenanceWidget rows={props.overdue} />

        <PerioPatientList patients={props.patients} onStartPerio={() => setPickerOpen(true)} />
      </div>

      <NewPerioPatientPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
