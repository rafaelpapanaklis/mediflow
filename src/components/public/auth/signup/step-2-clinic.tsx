"use client";

import { useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
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

interface ThemedSelectProps {
  value: string;
  onValueChange: (v: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}

function ThemedSelect({
  value,
  onValueChange,
  placeholder,
  options,
  disabled,
}: ThemedSelectProps) {
  const hasValue = !!value;
  return (
    <>
    <Select.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger
        style={{
          width: "100%",
          height: 42,
          padding: "0 14px",
          borderRadius: 10,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid var(--ld-border)",
          color: hasValue ? "var(--ld-fg)" : "var(--ld-fg-muted)",
          fontSize: 14,
          fontFamily: "inherit",
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          textAlign: "left",
        }}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon asChild>
          <ChevronDown size={16} style={{ color: "rgba(245,245,247,0.5)", flexShrink: 0 }} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          style={{
            background: "#111115",
            border: "1px solid var(--ld-border)",
            borderRadius: 10,
            padding: 4,
            zIndex: 9999,
            minWidth: "var(--radix-select-trigger-width)",
            maxHeight: 320,
            boxShadow: "0 12px 40px -12px rgba(0,0,0,0.6)",
          }}
        >
          <Select.Viewport className="themed-select-viewport" style={{ maxHeight: 312, overflowY: "auto" }}>
            {options.map(opt => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="themed-select-item"
                style={{
                  padding: "8px 30px 8px 12px",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "#f5f5f7",
                  cursor: "pointer",
                  outline: "none",
                  userSelect: "none",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
                <Select.ItemIndicator style={{ position: "absolute", right: 10, display: "inline-flex" }}>
                  <Check size={14} style={{ color: "#a78bfa" }} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
    <style jsx global>{`
      .themed-select-item[data-highlighted] {
        background: rgba(124, 58, 237, 0.15);
        color: #fff;
      }
      .themed-select-item[data-state="checked"] {
        background: rgba(124, 58, 237, 0.08);
      }
      .themed-select-viewport {
        scrollbar-width: thin;
        scrollbar-color: rgba(124, 58, 237, 0.4) rgba(255, 255, 255, 0.04);
      }
      .themed-select-viewport::-webkit-scrollbar {
        width: 10px;
      }
      .themed-select-viewport::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.04);
        border-radius: 10px;
        margin: 4px 0;
      }
      .themed-select-viewport::-webkit-scrollbar-thumb {
        background: rgba(124, 58, 237, 0.45);
        border-radius: 10px;
        border: 2px solid #111115;
      }
      .themed-select-viewport::-webkit-scrollbar-thumb:hover {
        background: rgba(124, 58, 237, 0.7);
      }
    `}</style>
    </>
  );
}

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

  const specialtyOptions = SPECIALTY_SLUGS.map(slug => ({
    value: slug,
    label: SPECIALTIES[slug].name,
  }));
  const stateOptions = ESTADOS_MX.map(s => ({ value: s, label: s }));

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
        <ThemedSelect
          value={values.specialty}
          onValueChange={v => onChange({ specialty: v })}
          placeholder="Selecciona una especialidad"
          options={specialtyOptions}
        />
      </FormField>

      <FormField label="Tamaño de la clínica">
        <ThemedSelect
          value={values.clinicSize}
          onValueChange={v => onChange({ clinicSize: v })}
          placeholder="¿Cuántos doctores atienden?"
          options={CLINIC_SIZES}
        />
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
          <ThemedSelect
            value={values.state}
            onValueChange={v => onChange({ state: v })}
            placeholder="Estado"
            options={stateOptions}
          />
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
