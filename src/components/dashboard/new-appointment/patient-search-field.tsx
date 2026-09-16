"use client";

import { PatientCombobox } from "./patient-combobox";
import { useAparienciaNueva } from "./apariencia";
import nc from "./nueva-cita.module.css";

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
  const nueva = useAparienciaNueva();
  if (nueva) {
    // Con la ropa nueva el error va en el borde del propio buscador.
    return (
      <div className={nc.campoPaciente} data-error={error ? "" : undefined}>
        <PatientCombobox value={value} onChange={onChange} />
      </div>
    );
  }
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
