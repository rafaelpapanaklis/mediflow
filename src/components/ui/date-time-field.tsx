"use client";

import { useEffect, useState } from "react";
import { DateField } from "@/components/ui/date-field";

/**
 * Drop-in de `<input type="datetime-local">` con la fecha como dd/mm/aaaa (el `DateField` del panel,
 * calendario en español) y la hora en 24 h (hh:mm). El `value` y el `target.value` del `onChange` siguen
 * siendo `yyyy-mm-ddThh:mm`, igual que el nativo: quien lo usaba no cambia su lógica. Vacío mientras falte
 * la fecha o la hora. Al elegir solo el día, la hora arranca en 09:00.
 */

const HORA_INICIAL = "09:00";

/** Tecleo tolerante de la hora: solo dígitos, «:» automático, máximo hh:mm. */
function mascaraHora(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

function horaValida(t: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return !!m && +m[1] < 24 && +m[2] < 60;
}

interface Props {
  value: string;
  onChange: (e: { target: { value: string; name: string } }) => void;
  id?: string;
  name?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
}

export function DateTimeField({ value, onChange, id, name = "", min, max, disabled, className, style, ...resto }: Props) {
  const [fecha, setFecha] = useState(value.slice(0, 10));
  const [hora, setHora] = useState(value.slice(11, 16));

  // Lo de fuera manda cuando cambia por su cuenta (p. ej. se reinicia el formulario).
  useEffect(() => {
    if (value === "") return;
    setFecha(value.slice(0, 10));
    setHora(value.slice(11, 16));
  }, [value]);

  function emitir(f: string, h: string) {
    onChange({ target: { value: f && horaValida(h) ? `${f}T${h}` : "", name } });
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", ...style }} className={className}>
      <DateField
        id={id}
        name={name}
        value={fecha}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={resto["aria-label"] ? `${resto["aria-label"]} (día)` : undefined}
        style={{ flex: "1 1 auto", minWidth: 0 }}
        onChange={(e) => {
          const f = e.target.value;
          const h = f && !horaValida(hora) ? HORA_INICIAL : hora;
          setFecha(f);
          setHora(h);
          emitir(f, h);
        }}
      />
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="hh:mm"
        maxLength={5}
        value={hora}
        disabled={disabled}
        aria-label={resto["aria-label"] ? `${resto["aria-label"]} (hora, 24 h)` : "Hora (24 h)"}
        onChange={(e) => {
          const h = mascaraHora(e.target.value);
          setHora(h);
          emitir(fecha, h);
        }}
        style={{ flex: "0 0 68px", width: 68, minHeight: 34, textAlign: "center", border: "1px solid var(--border-soft, var(--pr-borde))", borderRadius: 8, background: "transparent", color: "inherit", font: "inherit" }}
      />
    </div>
  );
}
