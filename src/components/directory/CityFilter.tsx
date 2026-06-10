"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, ChevronDown, Check, X } from "lucide-react";
import { DIRECTORY_CITIES_API, type CityOption, type DirectoryCitiesResponse } from "@/lib/directory/types";

// ─────────────────────────────────────────────────────────────────────────────
// CityFilter — dropdown/typeahead de CIUDADES REALES del directorio (derivadas
// de la DB, nunca hardcodeadas). Se combina con categoría y búsqueda en
// DirectoryExplorer. Estilo BLANCO + VIOLETA (.mfh / CSS vars --b/--v50/--line…),
// 100% responsive y accesible (teclado + aria).
//
// CONTRATO (NO cambiar la firma — DirectoryExplorer depende de ella):
//   · category?  slug de categoría para acotar las ciudades (refetch al cambiar)
//   · value      slug de ciudad seleccionada ("" = todas)
//   · onChange   (citySlug: string) => void   ("" cuando se limpia)
//
// IMPLEMENTACIÓN (A2):
//   1. Al montar y cuando cambia `category`: fetch GET DIRECTORY_CITIES_API
//      (?category=<category> si viene) → setCities(json.cities). AbortController
//      para cancelar en cambios rápidos. Si falla → lista vacía sin romper.
//   2. UI: botón con MapPin + label ("Todas las ciudades" si value==="" o el
//      label de la ciudad seleccionada) + ChevronDown. Al abrir: input de
//      filtrado local (typeahead sobre label) + lista de opciones con conteo
//      ("Guadalajara · 4"). Opción "Todas las ciudades" arriba. Check en la
//      activa. Botón X para limpiar cuando hay value.
//   3. Cerrar al hacer click fuera y con Escape. onChange con el slug elegido.
//   4. Si no hay ciudades, renderiza null (no mostrar un filtro vacío).
// Helper sugerido: const selected = cities.find(c => c.slug === value);
// ─────────────────────────────────────────────────────────────────────────────

export interface CityFilterProps {
  /** Slug de categoría para acotar las ciudades (opcional). */
  category?: string;
  /** Slug de la ciudad seleccionada ("" = todas). */
  value: string;
  /** Callback con el slug elegido ("" al limpiar). */
  onChange: (citySlug: string) => void;
}

export function CityFilter({ category, value, onChange }: CityFilterProps) {
  const [cities, setCities] = useState<CityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 1) Ciudades reales del directorio (acotadas por categoría). Refetch al
  //    cambiar `category`; AbortController para descartar respuestas viejas.
  useEffect(() => {
    const controller = new AbortController();
    const url = `${DIRECTORY_CITIES_API}${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DirectoryCitiesResponse>;
      })
      .then((json) => setCities(json.cities ?? []))
      .catch(() => {
        if (controller.signal.aborted) return;
        setCities([]);
      });
    return () => controller.abort();
  }, [category]);

  // Cerrar al hacer click fuera y con Escape; enfocar el input al abrir.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open]);

  // 4) Sin ciudades → no se muestra un filtro vacío.
  if (cities.length === 0) return null;

  const selected = cities.find((c) => c.slug === value);
  const label = selected ? selected.label : "Todas las ciudades";
  const q = query.trim().toLowerCase();
  const filtered = q ? cities.filter((c) => c.label.toLowerCase().includes(q)) : cities;

  const choose = (slug: string) => {
    onChange(slug);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative" style={{ minWidth: 0 }}>
      <div className="inline-flex max-w-full items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Filtrar por ciudad"
          className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border bg-white px-3.5 py-2 text-[13px] font-semibold no-underline transition hover:border-[color:var(--v200)] hover:bg-[color:var(--tint2)] ${
            selected ? "border-[color:var(--v200)] text-[color:var(--b-ink)]" : "border-[color:var(--line)] text-[color:var(--ink)]"
          }`}
        >
          <MapPin size={15} aria-hidden="true" className="shrink-0 text-[color:var(--b)]" />
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={`shrink-0 text-[color:var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => choose("")}
            aria-label="Quitar filtro de ciudad"
            className="ml-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border-none bg-[color:var(--v50)] p-0 text-[color:var(--b2)] transition hover:bg-[color:var(--v100)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          aria-label="Ciudades"
          className="absolute left-0 top-full z-20 mt-2 w-[min(280px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-[color:var(--line)] bg-white"
          style={{ boxShadow: "var(--sh)" }}
        >
          <div className="border-b border-[color:var(--line2)] p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ciudad…"
              aria-label="Buscar ciudad"
              autoComplete="off"
              className="w-full rounded-lg border border-[color:var(--line)] bg-white px-3 py-2 text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--v200)]"
              style={{ fontFamily: "inherit" }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1" style={{ WebkitOverflowScrolling: "touch" }}>
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => choose("")}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] font-medium text-[color:var(--ink)] transition hover:bg-[color:var(--tint2)]"
            >
              <span className="min-w-0 truncate">Todas las ciudades</span>
              {value === "" && <Check size={15} aria-hidden="true" className="shrink-0 text-[color:var(--b)]" />}
            </button>
            {filtered.map((c) => {
              const active = c.slug === value;
              return (
                <button
                  key={c.slug}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(c.slug)}
                  className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] transition hover:bg-[color:var(--tint2)] ${
                    active ? "font-semibold text-[color:var(--b-ink)]" : "font-medium text-[color:var(--ink)]"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {c.label}
                    <span className="text-[color:var(--muted)]"> · {c.count}</span>
                  </span>
                  {active && <Check size={15} aria-hidden="true" className="shrink-0 text-[color:var(--b)]" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-3.5 py-3 text-center text-[12.5px] text-[color:var(--muted)]">
                Sin ciudades que coincidan.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export type { DirectoryCitiesResponse };
