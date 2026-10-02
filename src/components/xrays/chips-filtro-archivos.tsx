"use client";

import {
  CLAVE_ETAPA,
  CLAVE_GRUPO,
  ETAPAS_ORTODONCIA,
  GRUPOS_ARCHIVO,
  SIN_FILTRO,
  contarPorEtapa,
  contarPorGrupo,
  type FiltroArchivos,
} from "@/lib/uploads/categorias-archivo";
import { useT } from "@/i18n/i18n-provider";

interface Clases {
  fila?: string;
  chip?: string;
  chipActivo?: string;
}

const FILA = "flex flex-wrap items-center gap-1.5";
const CHIP =
  "inline-flex items-center gap-1 h-8 px-3 rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)]";
const CHIP_ACTIVO = "!bg-[var(--brand)] !text-white !border-transparent hover:!bg-[var(--violet-700)]";

/**
 * Chips «Todos · Radiografías · Fotos · PDF/documentos · Ortodoncia» (+ etapa).
 * Solo salen los grupos que tienen algo (un chip en cero es un callejón sin
 * salida), y nada si todo cae en un solo grupo: no hay qué filtrar. El grupo
 * activo se queda visible aunque se vacíe (se borró el último, se cambió su
 * tipo) para poder quitar el filtro.
 */
export function ChipsFiltroArchivos({
  archivos,
  filtro,
  onChange,
  clases,
}: {
  archivos: Array<{ category: string }>;
  filtro: FiltroArchivos;
  onChange: (f: FiltroArchivos) => void;
  clases?: Clases;
}) {
  const t = useT();
  const porGrupo = contarPorGrupo(archivos);
  const visibles = GRUPOS_ARCHIVO.filter((g) => porGrupo[g] > 0 || filtro.grupo === g);
  if (visibles.length < 2 && !filtro.grupo) return null;
  const fila = clases?.fila ?? FILA;
  const chip = (activo: boolean) => `${clases?.chip ?? CHIP} ${activo ? (clases?.chipActivo ?? CHIP_ACTIVO) : ""}`;
  const porEtapa = contarPorEtapa(archivos);
  const etapas = ETAPAS_ORTODONCIA.filter((e) => porEtapa[e] > 0);

  return (
    <div className="space-y-1.5" role="group" aria-label={t("patients.xrays.filtro.aria")}>
      <div className={fila}>
        <button type="button" className={chip(!filtro.grupo)} aria-pressed={!filtro.grupo} onClick={() => onChange(SIN_FILTRO)}>
          {t("patients.xrays.filtro.todos")} <span className="tabular-nums opacity-80">{archivos.length}</span>
        </button>
        {visibles.map((g) => (
          <button
            key={g}
            type="button"
            className={chip(filtro.grupo === g)}
            aria-pressed={filtro.grupo === g}
            onClick={() => onChange({ grupo: filtro.grupo === g ? null : g, etapa: null })}
          >
            {t(CLAVE_GRUPO[g])} <span className="tabular-nums opacity-80">{porGrupo[g]}</span>
          </button>
        ))}
      </div>
      {filtro.grupo === "ortodoncia" && etapas.length > 0 && (
        <div className={fila}>
          <button type="button" className={chip(!filtro.etapa)} aria-pressed={!filtro.etapa} onClick={() => onChange({ grupo: "ortodoncia", etapa: null })}>
            {t("patients.xrays.filtro.todasEtapas")}
          </button>
          {etapas.map((e) => (
            <button
              key={e}
              type="button"
              className={chip(filtro.etapa === e)}
              aria-pressed={filtro.etapa === e}
              onClick={() => onChange({ grupo: "ortodoncia", etapa: filtro.etapa === e ? null : e })}
            >
              {t(CLAVE_ETAPA[e])} <span className="tabular-nums opacity-80">{porEtapa[e]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
