"use client";

// ═══════════════════════════════════════════════════════════════════════
// Teléfono con país para los formularios DEL PANEL (Clientes, Fila, Nueva
// visita). El del registro (phone-country-input.tsx) vive con los estilos
// de la landing (--ld-*) y un desplegable propio; aquí va un <select>
// nativo pegado al campo, con las clases del formulario que lo usa: en el
// celular sale la rueda del sistema y no hay nada que mantener.
//
// México va primero y por omisión: con MX el campo se comporta EXACTO como
// antes (soloDigitosTelefono, 10 dígitos). La regla de qué se guarda vive
// en src/lib/barber/telefono-panel.ts (la misma que valida el servidor).
// ═══════════════════════════════════════════════════════════════════════
import type { Ref } from "react";
import { BARBER_PHONE_COUNTRIES, barberPhoneFlag } from "@/lib/barber/phone-countries";
import { soloDigitosTelefono } from "@/lib/barber/phone-format";

export interface TelefonoConPaisProps {
  iso: string;
  onIsoChange: (iso: string) => void;
  value: string;
  onValueChange: (value: string) => void;
  /** Clase del <select> y del <input> del formulario que lo usa. */
  selectClassName?: string;
  inputClassName?: string;
  /** aria-label del país («País del teléfono»). */
  countryLabel: string;
  /** aria-label del número cuando el campo no tiene <label> propio. */
  inputLabel?: string;
  /** Placeholder para México y para otro país. */
  placeholderMx?: string;
  placeholderOther?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  inputId?: string;
}

export function TelefonoConPais(props: TelefonoConPaisProps) {
  const iso = props.iso || "MX";
  const mx = iso === "MX";
  return (
    <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
      <select
        className={props.selectClassName}
        aria-label={props.countryLabel}
        value={iso}
        onChange={(e) => props.onIsoChange(e.target.value)}
        style={{ flex: "0 0 auto", width: "auto", minWidth: 0, paddingRight: 24 }}
      >
        {BARBER_PHONE_COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso} title={c.name}>
            {`${barberPhoneFlag(c.iso)} +${c.dial}`}
          </option>
        ))}
      </select>
      <input
        id={props.inputId}
        ref={props.inputRef}
        className={props.inputClassName}
        aria-label={props.inputLabel}
        value={props.value}
        autoFocus={props.autoFocus}
        inputMode="tel"
        autoComplete="tel"
        placeholder={mx ? props.placeholderMx : props.placeholderOther}
        // México: lo de siempre (dígitos, sin recortar a ciegas). Otro país:
        // solo dígitos, tope E.164 (15).
        onChange={(e) =>
          props.onValueChange(mx ? soloDigitosTelefono(e.target.value) : e.target.value.replace(/\D/g, "").slice(0, 15))
        }
        style={{ flex: "1 1 auto", minWidth: 0 }}
      />
    </div>
  );
}
