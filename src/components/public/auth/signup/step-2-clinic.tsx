"use client";

import { useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { FormField } from "../form-field";
import { SPECIALTIES, SPECIALTY_SLUGS } from "@/lib/specialty-data";
import { mxTenDigits } from "@/lib/phone-mx";
import { botonFantasma, botonPrimario } from "./estilos";

// El campo se pide como teléfono de contacto (no como WhatsApp), así que el
// error también: MX_PHONE_ERROR habla de WhatsApp y lo usan otras superficies.
const PHONE_ERROR = "Escribe tu teléfono a 10 dígitos";

interface Step2Values {
  clinicName: string;
  specialty: string;
  clinicSize: string;
  city: string;
  state: string;
  phone: string;
}

interface Step2ClinicProps {
  values: Step2Values;
  onChange: (values: Partial<Step2Values>) => void;
  onContinue: () => void;
  onBack: () => void;
  /**
   * Pide aquí el WhatsApp cuando el usuario NUNCA vio el paso 1 (entró con
   * Google, o por un enlace con ?step=2). Sin esto, esos registros se completan
   * sin teléfono y la clínica que no paga queda sin forma de contacto.
   */
  showPhone?: boolean;
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
  { value: "1", label: "1 dentista · consultorio individual" },
  { value: "2-5", label: "2–5 dentistas · clínica pequeña" },
  { value: "6-15", label: "6–15 dentistas · clínica mediana" },
  { value: "16+", label: "16+ dentistas · multi-sucursal" },
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
    {/* Siempre controlado: con «value || undefined» pasaba de no controlado a controlado al elegir (aviso de React). Radix 2 enseña el placeholder con "". */}
    <Select.Root value={value || ""} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger
        className="themed-select-trigger"
        style={{
          width: "100%",
          height: 42,
          padding: "0 14px",
          borderRadius: 10,
          background: "#ffffff",
          border: "1px solid var(--ld-border)",
          color: hasValue ? "var(--ld-fg)" : "#94a3b8",
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
          <ChevronDown size={16} style={{ color: "var(--ld-fg-muted)", flexShrink: 0 }} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        {/* OJO: el Content renderiza en un portal FUERA de .landing-theme —
            los tokens --ld-* no existen aquí; colores light en literal. */}
        <Select.Content
          position="popper"
          sideOffset={6}
          style={{
            background: "#ffffff",
            border: "1px solid #e6e8f0",
            borderRadius: 10,
            padding: 4,
            zIndex: 9999,
            minWidth: "var(--radix-select-trigger-width)",
            maxHeight: 320,
            overflow: "hidden",
            boxShadow: "0 12px 40px -12px rgba(15,23,42,0.28)",
          }}
        >
          <Select.ScrollUpButton
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 24,
              background: "linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.9) 100%)",
              color: "#64748b",
              fontSize: 10,
              cursor: "default",
            }}
          >
            <ChevronUp size={14} />
          </Select.ScrollUpButton>
          <Select.Viewport className="themed-select-viewport">
            {options.map(opt => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="themed-select-item"
                style={{
                  padding: "8px 30px 8px 12px",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "#0f172a",
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
                  <Check size={14} style={{ color: "#2563eb" }} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 24,
              background: "linear-gradient(0deg, #ffffff 0%, rgba(255,255,255,0.9) 100%)",
              color: "#64748b",
              fontSize: 10,
              cursor: "default",
            }}
          >
            <ChevronDown size={14} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
    <style jsx global>{`
      .themed-select-trigger:focus-visible {
        border-color: #2563eb !important;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
      }
      .themed-select-item[data-highlighted] {
        background: #eff6ff;
        color: #1e3a8a;
      }
      .themed-select-item[data-state="checked"] {
        background: #eff6ff;
      }
      .themed-select-viewport {
        scrollbar-width: thin;
        scrollbar-color: rgba(37, 99, 235, 0.35) rgba(15, 23, 42, 0.05);
      }
      .themed-select-viewport::-webkit-scrollbar {
        width: 10px;
      }
      .themed-select-viewport::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.05);
        border-radius: 10px;
        margin: 4px 0;
      }
      .themed-select-viewport::-webkit-scrollbar-thumb {
        background: rgba(37, 99, 235, 0.35);
        border-radius: 10px;
        border: 2px solid #ffffff;
      }
      .themed-select-viewport::-webkit-scrollbar-thumb:hover {
        background: rgba(37, 99, 235, 0.55);
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
  showPhone = false,
}: Step2ClinicProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const clinicValid = values.clinicName.trim().length >= 2;
  const phoneValid = !showPhone || mxTenDigits(values.phone) !== null;
  const canContinue =
    clinicValid && !!values.specialty && !!values.state && phoneValid;

  // Solo odontología por ahora: el software es dental. Se filtra AQUÍ (no en
  // specialty-data, que usan otras pantallas); el valor sigue siendo el mismo
  // slug que el alta acepta hoy (odontologia-general, ortodoncia, endodoncia,
  // periodoncia → categoría DENTAL en signup-form).
  const specialtyOptions = SPECIALTY_SLUGS.filter(slug => SPECIALTIES[slug].category === "Dental").map(slug => ({
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

      {showPhone && (
        <FormField
          label="Número de teléfono"
          type="tel"
          inputMode="numeric"
          placeholder="55 1234 5678"
          autoComplete="tel"
          hint="Te escribimos por aquí para ayudarte a configurar tu clínica."
          value={values.phone}
          onChange={e => onChange({ phone: e.target.value })}
          onBlur={() => setTouched(t => ({ ...t, phone: true }))}
          error={touched.phone && !phoneValid ? PHONE_ERROR : undefined}
          required
        />
      )}

      <FormField
        label="Especialidad dental principal"
        hint="Podrás agregar más especialidades después, en la configuración."
      >
        <ThemedSelect
          value={values.specialty}
          onValueChange={v => onChange({ specialty: v })}
          placeholder="Selecciona tu especialidad"
          options={specialtyOptions}
        />
      </FormField>

      <FormField label="Tamaño de la clínica">
        <ThemedSelect
          value={values.clinicSize}
          onValueChange={v => onChange({ clinicSize: v })}
          placeholder="¿Cuántos dentistas atienden?"
          options={CLINIC_SIZES}
        />
      </FormField>

      <div className="dca-2col">
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

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button type="button" onClick={onBack} className="dca-btn-ghost" style={botonFantasma()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Atrás
        </button>
        <button
          type="submit"
          disabled={!canContinue}
          className="dca-btn-primary"
          style={botonPrimario(!canContinue, { flex: 1 })}
        >
          Continuar
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
