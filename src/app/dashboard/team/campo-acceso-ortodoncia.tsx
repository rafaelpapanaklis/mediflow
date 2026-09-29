"use client";

// Equipo — «¿Solo dental o también ortodoncista?» (ws1-t3, 28-sep-2026).
//
// Es la pregunta del alta y de la edición de un DOCTOR cuando la sede tiene el
// módulo de Ortodoncia. Contestarla decide UNA cosa: si esa persona tiene la
// llave «Acceso al módulo de Ortodoncia» (specialties.orthodontics). Qué hace
// dentro del módulo lo siguen decidiendo sus demás permisos.
//
// Los textos viven aquí y no en los diccionarios a propósito: los diccionarios
// los toca a la vez otra pantalla y este bloque es autocontenido (es/en).

import { useLocale } from "@/i18n/i18n-provider";
import type { AccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";

export type RespuestaAcceso = AccesoOrtodoncia | "";

const TEXTOS = {
  es: {
    titulo: "¿Solo dental o también ortodoncista?",
    solo: "Solo dental",
    soloDesc: "Sin acceso al módulo de Ortodoncia.",
    tambien: "También ortodoncista",
    tambienDesc: "Con acceso al módulo y su especialidad queda «Ortodoncia».",
    ayudaAlta: "Se puede cambiar después en Equipo → Permisos.",
    soloDueno: "Solo el dueño de la clínica puede cambiar este acceso (Equipo → Permisos).",
  },
  en: {
    titulo: "Dental only, or also an orthodontist?",
    solo: "Dental only",
    soloDesc: "No access to the Orthodontics module.",
    tambien: "Also an orthodontist",
    tambienDesc: "With access to the module, and their specialty is set to “Orthodontics”.",
    ayudaAlta: "You can change this later in Team → Permissions.",
    soloDueno: "Only the clinic owner can change this access (Team → Permissions).",
  },
} as const;

export function CampoAccesoOrtodoncia({
  valor,
  onChange,
  puedeCambiar,
  esEdicion,
  acento,
  acentoSuave,
  bordeSuave,
}: {
  valor: RespuestaAcceso;
  onChange: (v: AccesoOrtodoncia) => void;
  /** En el alta, quien da de alta; en la edición, solo el dueño (los permisos son suyos). */
  puedeCambiar: boolean;
  esEdicion: boolean;
  acento: string;
  acentoSuave: string;
  bordeSuave: string;
}) {
  const x = useLocale().startsWith("en") ? TEXTOS.en : TEXTOS.es;
  const opciones: { v: AccesoOrtodoncia; nombre: string; desc: string }[] = [
    { v: "solo_dental", nombre: x.solo, desc: x.soloDesc },
    { v: "ortodoncista", nombre: x.tambien, desc: x.tambienDesc },
  ];
  return (
    <div className="space-y-1.5" data-acceso-ortodoncia>
      <div className="text-xs font-semibold" id="acceso-ortodoncia-titulo">{x.titulo}</div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="acceso-ortodoncia-titulo">
        {opciones.map((o) => {
          const activa = valor === o.v;
          return (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={activa}
              disabled={!puedeCambiar}
              data-acceso={o.v}
              onClick={() => onChange(o.v)}
              className="flex flex-col items-center p-3 text-center"
              style={{
                borderRadius: "var(--radius)",
                border: `2px solid ${activa ? acento : bordeSuave}`,
                background: activa ? acentoSuave : "transparent",
                opacity: puedeCambiar ? 1 : 0.65,
                cursor: puedeCambiar ? "pointer" : "not-allowed",
                transition: "border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease)",
              }}
            >
              <span className="text-sm font-bold">{o.nombre}</span>
              <span className="text-xs text-muted-foreground mt-0.5 leading-tight">{o.desc}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{puedeCambiar ? (esEdicion ? "" : x.ayudaAlta) : x.soloDueno}</p>
    </div>
  );
}
