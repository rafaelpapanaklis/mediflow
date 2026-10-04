"use client";

/**
 * «Avisar al paciente» al mover una cita (ws1-t1, F14): el hook que pregunta el ajuste de la clínica y la
 * casilla que pintan las cuatro ventanas de mover/editar. Las reglas están en `lib/agenda/aviso-al-reprogramar`.
 *
 * ⛔ SIN CACHÉ de módulo, igual que `usar-politica-bloqueos.ts`: un `Map` sobreviviría a cambiar de clínica
 * activa sin recargar. Se pregunta al abrir la ventana; mientras no contesta (o si falla) es `null` y no se
 * pinta nada: el servidor hace lo de siempre.
 */

import { useEffect, useState } from "react";
import { useLocale } from "@/i18n/i18n-provider";
import {
  estadoDelAvisoReprogramar,
  textosAvisoReprogramar,
  type EstadoAvisoReprogramar,
  type TextosAvisoReprogramar,
} from "@/lib/agenda/aviso-al-reprogramar";

const ESPERA_MAXIMA_MS = 4000;

export function useAvisoAlReprogramar(activo: boolean): EstadoAvisoReprogramar {
  const [estado, setEstado] = useState<EstadoAvisoReprogramar>(null);

  useEffect(() => {
    if (!activo) {
      setEstado(null);
      return;
    }
    let vivo = true;
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), ESPERA_MAXIMA_MS);
    fetch("/api/clinic/me", { credentials: "include", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cuerpo) => {
        if (vivo) setEstado(estadoDelAvisoReprogramar(cuerpo));
      })
      .catch(() => {
        if (vivo) setEstado(null);
      })
      .finally(() => clearTimeout(reloj));
    return () => {
      vivo = false;
      clearTimeout(reloj);
      ctrl.abort();
    };
  }, [activo]);

  return estado;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosAvisoReprogramar(): TextosAvisoReprogramar {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosAvisoReprogramar(locale);
}

export interface CasillaAvisarPacienteProps {
  estado: EstadoAvisoReprogramar;
  /** ¿La hora de inicio cambia? Sin cambio de hora no hay aviso y no se pinta nada. */
  cambiaHora: boolean;
  marcada: boolean;
  onCambiar: (marcada: boolean) => void;
  disabled?: boolean;
  /** Clases opcionales de la ropa de quien la monta; sin ellas, estilos en línea con los tokens del panel. */
  className?: string;
  textoClassName?: string;
}

export function CasillaAvisarPaciente({
  estado,
  cambiaHora,
  marcada,
  onCambiar,
  disabled,
  className,
  textoClassName,
}: CasillaAvisarPacienteProps) {
  const textos = useTextosAvisoReprogramar();
  if (!cambiaHora || estado === null) return null;
  // ws1-t1 (C-101): sin WhatsApp tampoco le llega nada al paciente, y se dice igual que con el aviso apagado.
  if (estado === "apagado" || estado === "sinWhatsApp") {
    return (
      <p
        className={textoClassName}
        style={textoClassName ? undefined : { margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--text-3)" }}
        data-aviso-reprogramar={estado}
      >
        {estado === "apagado" ? textos.apagado : textos.sinWhatsApp}
      </p>
    );
  }
  return (
    <label
      className={className}
      style={
        className
          ? undefined
          : { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-1)", cursor: "pointer" }
      }
      data-aviso-reprogramar="casilla"
    >
      <input
        type="checkbox"
        checked={marcada}
        disabled={disabled}
        onChange={(e) => onCambiar(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: "var(--brand)", flex: "none", margin: 0 }}
      />
      <span>{textos.casilla}</span>
    </label>
  );
}
