"use client";

// Equipo — «Módulos de especialidades» (ws1-t2, 29-sep-2026).
//
// Una casilla por módulo. Hoy solo «Ortodoncia»: marcarla y guardar deja a esa
// persona como doctor del módulo (aparece como doctor tratante, se le asignan
// casos y hace lo que sus Permisos le permitan). Es el MISMO permiso por
// persona que se ve en Equipo → Permisos; la lógica vive en
// `@/lib/team/modulos-especialidades`.
//
// Los textos viven aquí y no en los diccionarios a propósito: los diccionarios
// los toca a la vez otra pantalla y este bloque es autocontenido (es/en).

import { useLocale } from "@/i18n/i18n-provider";
import {
  MODULOS_ESPECIALIDADES,
  estadoDeCasilla,
  respuestaDeCasilla,
  type ModuloEspecialidadId,
  type RespuestaModulo,
} from "@/lib/team/modulos-especialidades";
import type { AccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";

const TEXTOS = {
  es: {
    titulo: "Módulos de especialidades",
    modulos: {
      ortodoncia: {
        nombre: "Ortodoncia",
        desc: "Aparece como doctor tratante y se le pueden asignar casos. Crear, cobrar y firmar lo decide Equipo → Permisos.",
      },
    },
    sinModulo: "Contrata el módulo para activarla",
    soloDueno: "Solo el dueño de la clínica puede cambiar este acceso (Equipo → Permisos).",
    ayudaAlta: "Se puede cambiar después en Equipo → Editar.",
  },
  en: {
    titulo: "Specialty modules",
    modulos: {
      ortodoncia: {
        nombre: "Orthodontics",
        desc: "Shows up as a treating doctor and can be assigned cases. Creating, charging and signing are set in Team → Permissions.",
      },
    },
    sinModulo: "Get the module to turn it on",
    soloDueno: "Only the clinic owner can change this access (Team → Permissions).",
    ayudaAlta: "You can change this later in Team → Edit.",
  },
} as const;

export function ModulosEspecialidades({
  respuestas,
  onChange,
  contratados,
  puedeCambiar,
  esEdicion,
  acento,
  bordeSuave,
}: {
  /** Lo que el formulario lleva por módulo. Hoy solo Ortodoncia. */
  respuestas: Record<ModuloEspecialidadId, RespuestaModulo>;
  onChange: (modulo: ModuloEspecialidadId, respuesta: AccesoOrtodoncia) => void;
  /** Qué módulos tiene contratados la sede. */
  contratados: Record<ModuloEspecialidadId, boolean>;
  /** En el alta, quien da de alta; en la edición, solo el dueño (los permisos son suyos). */
  puedeCambiar: boolean;
  esEdicion: boolean;
  acento: string;
  bordeSuave: string;
}) {
  const x = useLocale().startsWith("en") ? TEXTOS.en : TEXTOS.es;
  return (
    <div className="space-y-1.5" data-modulos-especialidades>
      <div className="text-xs font-semibold" id="modulos-especialidades-titulo">{x.titulo}</div>
      <div className="space-y-2" role="group" aria-labelledby="modulos-especialidades-titulo">
        {MODULOS_ESPECIALIDADES.map((m) => {
          const estado = estadoDeCasilla({
            contratado: contratados[m.id],
            puedeCambiar,
            respuesta: respuestas[m.id],
          });
          const t = x.modulos[m.id];
          const idAyuda = `modulo-${m.id}-ayuda`;
          return (
            <label
              key={m.id}
              data-modulo={m.id}
              className="flex items-start gap-3 p-3"
              style={{
                borderRadius: "var(--radius)",
                border: `1px solid ${estado.marcada ? acento : bordeSuave}`,
                opacity: estado.deshabilitada ? 0.65 : 1,
                cursor: estado.deshabilitada ? "not-allowed" : "pointer",
                transition: "border-color var(--dur-1) var(--ease)",
              }}
            >
              <input
                type="checkbox"
                checked={estado.marcada}
                disabled={estado.deshabilitada}
                aria-describedby={idAyuda}
                onChange={(e) => onChange(m.id, respuestaDeCasilla(e.target.checked))}
                style={{ width: 18, height: 18, marginTop: 1, accentColor: acento, flexShrink: 0 }}
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold">{t.nombre}</span>
                <span id={idAyuda} className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  {estado.motivo === "sin_modulo" ? x.sinModulo : t.desc}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {!esEdicion && puedeCambiar ? <p className="text-xs text-muted-foreground">{x.ayudaAlta}</p> : null}
      {esEdicion && !puedeCambiar && Object.values(contratados).some(Boolean) ? <p className="text-xs text-muted-foreground">{x.soloDueno}</p> : null}
    </div>
  );
}
