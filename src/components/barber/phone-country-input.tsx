"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BARBER_PHONE_COUNTRIES,
  barberPhoneCountry,
  barberPhoneFlag,
} from "@/lib/barber/phone-countries";

/**
 * Teléfono con selector de país — bandera, nombre y lada, México primero.
 *
 * Antes esto era un input pelado con placeholder "10 dígitos": quien no
 * fuera de México no tenía cómo darse de alta con su número real.
 *
 * DÓNDE VIVE LA REGLA: no aquí. El largo válido, la lada y qué se guarda lo
 * decide normalizeBarberPhone de @/lib/barber/phone-countries — el MISMO
 * módulo que valida el endpoint. Este componente solo captura: guarda en
 * `value` los dígitos del número LOCAL y en `iso` el país.
 *
 * ESTILO: variables --ld-* y estilos en línea, como el resto del formulario
 * de registro (ese archivo no usa Tailwind; aquí tampoco se mete).
 *
 * TECLADO (el desplegable es un listbox de verdad, no un div con onClick):
 *   · el botón abre con Enter, Espacio o ↓/↑ y anuncia aria-expanded
 *   · dentro: ↑ ↓ Inicio Fin mueven, Enter/Espacio eligen, Esc cierra y
 *     devuelve el foco al botón, Tab cierra y sigue de largo
 *   · clic fuera cierra
 */

interface PhoneCountryInputProps {
  label: string;
  /** ISO-2 del país seleccionado. */
  iso: string;
  onIsoChange: (iso: string) => void;
  /** SOLO los dígitos del número local (sin lada). */
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  disabled?: boolean;
}

/** Tope duro de captura: E.164 no admite más de 15 dígitos en total. */
const MAX_DIGITOS = 15;

export function PhoneCountryInput({
  label,
  iso,
  onIsoChange,
  value,
  onValueChange,
  error,
  hint,
  required,
  disabled,
}: PhoneCountryInputProps) {
  const uid = useId();
  const inputId = `${uid}-tel`;
  const listId = `${uid}-paises`;
  const msgId = `${uid}-msg`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const country = barberPhoneCountry(iso);
  const selectedIndex = Math.max(
    0,
    BARBER_PHONE_COUNTRIES.findIndex((c) => c.iso === country.iso),
  );

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);

  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Clic fuera → cerrar. pointerdown y no click: si el usuario arrastra
  // desde dentro de la lista y suelta afuera, un handler de click cerraría
  // el desplegable a media selección.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Al abrir, el foco entra a la lista (es quien lleva las flechas) y la
  // opción activa se trae a la vista sin mover la página.
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    listRef.current
      ?.querySelector<HTMLLIElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function abrir() {
    if (disabled) return;
    setActive(selectedIndex);
    setOpen(true);
  }

  function cerrar(devolverFoco = true) {
    setOpen(false);
    if (devolverFoco) buttonRef.current?.focus();
  }

  function elegir(index: number) {
    const elegido = BARBER_PHONE_COUNTRIES[index];
    if (elegido) onIsoChange(elegido.iso);
    cerrar();
  }

  function onBotonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      // preventDefault: si no, el <button> sintetiza además su click y el
      // desplegable se abriría y cerraría en la misma tecla.
      e.preventDefault();
      abrir();
    }
  }

  function onListaKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const ultimo = BARBER_PHONE_COUNTRIES.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i >= ultimo ? 0 : i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i <= 0 ? ultimo : i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(ultimo);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        elegir(active);
        break;
      case "Escape":
        e.preventDefault();
        cerrar();
        break;
      case "Tab":
        // Tab NO se intercepta: cierra y deja al foco seguir su camino.
        setOpen(false);
        break;
    }
  }

  const bordeError = error ? "rgba(220,38,38,0.55)" : "var(--ld-border)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={inputId}
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--ld-fg, #0f172a)",
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </label>

      <div ref={boxRef} style={{ position: "relative", display: "flex", gap: 8 }}>
        {/* ── Disparador: bandera + lada. La lada se ve SIEMPRE y a la
            izquierda del número, y no se puede teclear a mano. ── */}
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => (open ? cerrar(false) : abrir())}
          onKeyDown={onBotonKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`País: ${country.name}, lada +${country.dial}`}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 42,
            padding: "0 10px",
            borderRadius: 10,
            background: "#ffffff",
            border: `1px solid ${bordeError}`,
            color: "var(--ld-fg)",
            fontSize: 14,
            fontFamily: "inherit",
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "border-color .15s, box-shadow .15s",
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
            {barberPhoneFlag(country.iso)}
          </span>
          <span style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>+{country.dial}</span>
          <Chevron open={open} />
        </button>

        {/* ── Número local: SOLO dígitos. El focus ring y el borde rojo los
            pinta globals.css (.landing-theme input) vía aria-invalid. ── */}
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          required={required}
          disabled={disabled}
          value={value}
          onChange={(e) => onValueChange(e.target.value.replace(/\D/g, "").slice(0, MAX_DIGITOS))}
          placeholder={`${country.len} dígitos`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? msgId : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            height: 42,
            padding: "0 14px",
            borderRadius: 10,
            background: "#ffffff",
            border: "1px solid var(--ld-border)",
            color: "var(--ld-fg)",
            fontSize: 14,
            fontFamily: "inherit",
            outline: "none",
            transition: "border-color .15s, box-shadow .15s",
          }}
        />

        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="País"
            aria-activedescendant={optionId(active)}
            onKeyDown={onListaKeyDown}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 40,
              width: "min(300px, 100%)",
              maxHeight: 264,
              overflowY: "auto",
              margin: 0,
              padding: 4,
              listStyle: "none",
              borderRadius: 12,
              background: "#ffffff",
              border: "1px solid var(--ld-border)",
              boxShadow: "0 14px 34px rgba(15,23,42,0.16)",
              outline: "none",
            }}
          >
            {BARBER_PHONE_COUNTRIES.map((c, i) => {
              const seleccionado = c.iso === country.iso;
              const activo = i === active;
              return (
                <li
                  key={c.iso}
                  id={optionId(i)}
                  role="option"
                  aria-selected={seleccionado}
                  data-active={activo}
                  onClick={() => elegir(i)}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 10px",
                    borderRadius: 8,
                    fontSize: 13.5,
                    cursor: "pointer",
                    color: "var(--ld-fg)",
                    background: activo ? "rgba(190,122,60,0.14)" : "transparent",
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
                    {barberPhoneFlag(c.iso)}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: seleccionado ? 600 : 400,
                    }}
                  >
                    {c.name}
                  </span>
                  <span style={{ color: "var(--ld-fg-muted)", fontSize: 12.5 }}>+{c.dial}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? (
        <div id={msgId} role="alert" style={{ fontSize: 11, color: "#dc2626", lineHeight: 1.4 }}>
          {error}
        </div>
      ) : hint ? (
        <div id={msgId} style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        color: "var(--ld-fg-muted)",
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform .15s",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
