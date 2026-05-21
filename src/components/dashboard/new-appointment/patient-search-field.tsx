"use client";

import { PatientCombobox } from "./patient-combobox";

interface Props {
  value: { id: string; name: string } | null;
  onChange: (patient: { id: string; name: string } | null) => void;
  error?: boolean;
}

/**
 * Wrapper estilizado sobre PatientCombobox (rediseño popup Nueva cita).
 * Reusa íntegra la lógica de búsqueda/selección y "crear paciente" del
 * combobox; solo añade el borde de error de la validación obligatoria.
 */
export function PatientSearchField({ value, onChange, error }: Props) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${error ? "var(--danger)" : "transparent"}`,
        transition: "border-color 0.12s",
      }}
    >
      <PatientCombobox value={value} onChange={onChange} />
    </div>
  );
}
