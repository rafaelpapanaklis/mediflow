"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  DIRECTORY_API,
  type DirectoryClinic,
  type DirectoryClinicsResponse,
} from "@/lib/directory/types";
import { ClinicCard } from "./ClinicCard";

// ─────────────────────────────────────────────────────────────────────────────
// CityClinicsList — listado de clínicas de UNA ciudad+categoría para la página
// programática /descubre/[categoria]/[ciudad].
//
// CLAVE SEO: `initialItems` es la PÁGINA 1 renderizada en el SERVIDOR (llega en
// el HTML). Este componente client solo AÑADE páginas siguientes con "Cargar
// más" (la página NO usa searchParams para no romper el SSG/ISR). El popup de
// reserva lo monta la PÁGINA (BookingPopupController), aquí no.
//
// CONTRATO (la página depende de esta firma):
//   · initialItems  DirectoryClinic[]  (page 1, SSR)
//   · total         number             (total de la combinación)
//   · categorySlug  string             (para el fetch de más páginas)
//   · citySlug      string             (slug de ciudad, para ?city=)
//
// IMPLEMENTACIÓN (A3):
//   1. Estado: items=initialItems, page=1, loading, error.
//   2. Grid: "grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3"
//      con <ClinicCard clinic={c} /> (mismo look que ClinicGrid).
//   3. Si items.length < total: botón "Cargar más clínicas" → fetch
//      `${DIRECTORY_API}?category=${categorySlug}&city=${citySlug}&page=${page+1}`
//      → append json.items, page++. Spinner Loader2 mientras carga. Error →
//      mensaje discreto + reintento. Botón estilo violeta (.mfh vars).
//   4. Mostrar "Mostrando X de N" debajo. Responsive y accesible (aria-busy).
// ─────────────────────────────────────────────────────────────────────────────

export interface CityClinicsListProps {
  /** Página 1 ya renderizada en el servidor (va en el HTML inicial). */
  initialItems: DirectoryClinic[];
  /** Total de clínicas en la combinación categoría+ciudad. */
  total: number;
  /** Slug de categoría (para pedir más páginas a la API). */
  categorySlug: string;
  /** Slug de ciudad (para ?city= en la API). */
  citySlug: string;
}

const GRID_CLASS = "grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3";

export function CityClinicsList({ initialItems, total, categorySlug, citySlug }: CityClinicsListProps) {
  const [items, setItems] = useState<DirectoryClinic[]>(initialItems);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMore = items.length < total;

  async function loadMore() {
    // Evita peticiones duplicadas si ya hay una en curso.
    if (loading) return;
    setLoading(true);
    setError(null);

    const nextPage = page + 1;
    try {
      const res = await fetch(
        `${DIRECTORY_API}?category=${encodeURIComponent(categorySlug)}&city=${encodeURIComponent(
          citySlug,
        )}&page=${nextPage}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json: DirectoryClinicsResponse = await res.json();
      const more = Array.isArray(json.items) ? json.items : [];
      setItems((prev) => [...prev, ...more]);
      setPage(nextPage);
    } catch {
      setError("No pudimos cargar más clínicas. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className={GRID_CLASS}>
        {items.map((c) => (
          <ClinicCard key={c.id} clinic={c} />
        ))}
      </div>

      {hasMore && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            aria-busy={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-[var(--sh-sm,0_1px_2px_rgba(15,23,42,0.05))] transition hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
            style={{ background: "linear-gradient(180deg, var(--b, #7c3aed), var(--b2, #6d28d9))" }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Cargando…
              </>
            ) : (
              "Cargar más clínicas"
            )}
          </button>

          {error && (
            <p className="flex flex-wrap items-center justify-center gap-2 text-center text-[13px] text-[var(--muted,#64748b)]">
              <span>{error}</span>
              <button
                type="button"
                onClick={loadMore}
                className="inline-flex items-center gap-1 font-semibold text-[var(--b2,#6d28d9)] hover:underline"
              >
                <RefreshCw size={13} aria-hidden="true" />
                Reintentar
              </button>
            </p>
          )}

          <p className="text-[13px] text-[var(--muted,#64748b)]">
            Mostrando {items.length} de {total}
          </p>
        </div>
      )}
    </div>
  );
}
