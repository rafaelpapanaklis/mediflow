"use client";

import { useState } from "react";
import { FormField } from "../form-field";
import { SPECIALTIES, SPECIALTY_SLUGS } from "@/lib/specialty-data";

interface Step2Values {
  clinicName: string;
  specialty: string;
  clinicSize: string;
  city: string;
  state: string;
}

interface Step2ClinicProps {
  values: Step2Values;
  onChange: (values: Partial<Step2Values>) => void;
  onContinue: () => void;
  onBack: () => void;
}

const ESTADOS_MX = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
];

const CLINIC_SIZES: Array<{ value: string; label: string }> = [
  { value: "1", label: "1 doctor · consultorio individual" },
  { value: "2-5", label: "2–5 doctores · clínica pequeña" },
  { value: "6-15", label: "6–15 doctores · clínica mediana" },
  { value: "16+", label: "16+ doctores · multi-sucursal" },
];

const optionStyle: React.CSSProperties = {
  background: "#1a1a1f",
  color: "#f5f5f7",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  padding: "0 36px 0 14px",
  borderRadius: 10,
  background: "#111115",
  border: "1px solid var(--ld-border)",
  color: "var(--ld-fg)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  cursor: "pointer",
  backgroundImage:
    "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='rgba(245,245,247,0.5)' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 14px center",
};

export function Step2Clinic({
  values,
  onChange,
  onContinue,
  onBack,
}: Step2ClinicProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const clinicValid = values.clinicName.trim().length >= 2;
  const canContinue =
    clinicValid && !!values.specialty && !!values.state;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (canContinue) onContinue();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <FormField
        label="Nombre de la clínica"
        placeholder="Clínica Vida"
        autoComplete="organization"
        value={values.clinicName}
        onChange={e => onChange({ clinicName: e.target.value })}
        onBlur={() => setTouched(t => ({ ...t, clinicName: true }))}
        error={
          touched.clinicName && !clinicValid
            ? "Escribe el nombre de tu clínica"
            : undefined
        }
        required
      />

      <FormField
        label="Especialidad principal"
        hint="Podrás agregar más especialidades después, en la configuración."
      >
        <select
          value={values.specialty}
          onChange={e => onChange({ specialty: e.target.value })}
          style={{
            ...selectStyle,
            color: values.specialty ? "var(--ld-fg)" : "var(--ld-fg-muted)",
          }}
        >
          <option value="" disabled style={optionStyle}>
            Selecciona una especialidad
          </option>
          {SPECIALTY_SLUGS.map(slug => (
            <option key={slug} value={slug} style={optionStyle}>
              {SPECIALTIES[slug].name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Tamaño de la clínica">
        <select
          value={values.clinicSize}
          onChange={e => onChange({ clinicSize: e.target.value })}
          style={{
            ...selectStyle,
            color: values.clinicSize ? "var(--ld-fg)" : "var(--ld-fg-muted)",
          }}
        >
          <option value="" disabled style={optionStyle}>
            ¿Cuántos doctores atienden?
          </option>
          {CLINIC_SIZES.map(size => (
            <option key={size.value} value={size.value} style={optionStyle}>
              {size.label}
            </option>
          ))}
        </select>
      </FormField>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <FormField
          label="Ciudad"
          placeholder="Guadalajara"
          autoComplete="address-level2"
          value={values.city}
          onChange={e => onChange({ city: e.target.value })}
        />
        <FormField label="Estado">
          <select
            value={values.state}
            onChange={e => onChange({ state: e.target.value })}
            style={{
              ...selectStyle,
              color: values.state ? "var(--ld-fg)" : "var(--ld-fg-muted)",
            }}
          >
            <option value="" disabled style={optionStyle}>
              Estado
            </option>
            {ESTADOS_MX.map(s => (
              <option key={s} value={s} style={optionStyle}>
                {s}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 8,
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "transparent",
            border: "1px solid var(--ld-border)",
            color: "var(--ld-fg-muted)",
            fontSize: 13,
            fontWeight: 500,
            padding: "0 18px",
            height: 44,
            borderRadius: 10,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ← Atrás
        </button>
        <button
          type="submit"
          disabled={!canContinue}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            background: !canContinue
              ? "rgba(124,58,237,0.4)"
              : "linear-gradient(180deg, #8b5cf6, #7c3aed)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            cursor: !canContinue ? "not-allowed" : "pointer",
            boxShadow: !canContinue
              ? "none"
              : "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
            fontFamily: "inherit",
            transition: "all .15s",
          }}
        >
          Continuar →
        </button>
      </div>
    </form>
  );
}
