"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, SearchX, Building2, RefreshCw } from "lucide-react";
import type { DirectoryClinic } from "@/lib/directory/types";
import { ClinicCard } from "./ClinicCard";

// ─────────────────────────────────────────────────────────────────────────────
// Grid de resultados del directorio: skeletons, estados vacíos, error y
// paginación. El heading/contador de resultados lo pinta DirectoryExplorer.
// Paleta del home de venta (.mfh) vía CSS vars con fallback literal.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClinicGridProps {
  /** null = primera carga aún sin datos (muestra skeletons si loading) */
  items: DirectoryClinic[] | null;
  loading: boolean;
  error: string | null;
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  /** Plural de la categoría activa (ej. "clínicas dentales") para el vacío */
  categoryLabel?: string;
  /** Búsqueda activa, para el estado "sin resultados" */
  searchQuery?: string;
}

const GRID_CLASS = "grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3";

const PAGE_BTN_CLASS =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--line,#e9e7f3)] bg-white px-3.5 py-2 text-sm font-medium text-[var(--ink,#0f172a)] transition hover:bg-[var(--tint2,#faf8ff)] disabled:pointer-events-none disabled:opacity-40";

const ICON_BADGE_CLASS =
  "grid h-12 w-12 place-items-center rounded-full bg-[var(--v50,#f5f3ff)] text-[var(--b2,#6d28d9)]";

/** Placeholder con la misma silueta de la ClinicCard (cabecera, logo, líneas, pie). */
function SkeletonCard() {
  return (
    <div
      className="overflow-hidden rounded-[22px] border border-[var(--line,#e9e7f3)] bg-white"
      aria-hidden="true"
    >
      <div className="h-28 animate-pulse bg-[var(--v50,#f5f3ff)] sm:h-32" />
      <div className="flex flex-col gap-2.5 px-4 pb-4">
        <div className="-mt-6 h-12 w-12 animate-pulse rounded-xl border-2 border-white bg-[var(--line2,#eef1f6)]" />
        <div className="h-5 w-24 animate-pulse rounded-full bg-[var(--line2,#eef1f6)]" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--line2,#eef1f6)]" />
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-[var(--line2,#eef1f6)]" />
        <div className="h-3.5 w-full animate-pulse rounded bg-[var(--line2,#eef1f6)]" />
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-[var(--line2,#eef1f6)]" />
      </div>
      <div className="border-t border-[var(--line2,#eef1f6)] p-4">
        <div className="h-10 w-full animate-pulse rounded-xl bg-[var(--line2,#eef1f6)]" />
      </div>
    </div>
  );
}

function EmptyState({ categoryLabel, searchQuery }: { categoryLabel?: string; searchQuery?: string }) {
  if (searchQuery) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <span className={ICON_BADGE_CLASS}>
          <SearchX size={22} aria-hidden="true" />
        </span>
        <h3 className="text-lg font-bold text-[var(--ink,#0f172a)]">
          Sin resultados para «{searchQuery}»
        </h3>
        <p className="text-sm text-[var(--muted,#64748b)]">Prueba con otro nombre o ciudad.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <span className={ICON_BADGE_CLASS}>
        <Building2 size={22} aria-hidden="true" />
      </span>
      <h3 className="text-lg font-bold text-[var(--ink,#0f172a)]">
        {categoryLabel ? `Aún no hay ${categoryLabel} en el directorio` : "Aún no hay clínicas publicadas"}
      </h3>
      <p className="text-sm text-[var(--muted,#64748b)]">
        Muy pronto verás clínicas aquí. ¿Tienes una? Publícala gratis.
      </p>
      <a
        href="/signup"
        className="mt-1 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 active:brightness-95"
        style={{ background: "linear-gradient(180deg, var(--b, #7c3aed), var(--b2, #6d28d9))" }}
      >
        Publicar mi clínica
      </a>
      <Link
        href="/descubre"
        className="text-sm font-semibold text-[var(--b2,#6d28d9)] hover:underline"
      >
        Ver todas las categorías
      </Link>
    </div>
  );
}

export function ClinicGrid(props: ClinicGridProps) {
  const { items, loading, error, page, totalPages, onPageChange, onRetry, categoryLabel, searchQuery } = props;
  const list = items ?? [];

  // 1) Primera carga sin datos previos → skeletons con la silueta de la card.
  if (loading && list.length === 0) {
    return (
      <div className={GRID_CLASS} role="status" aria-busy="true">
        <span className="sr-only">Cargando clínicas…</span>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  // 2) Error de carga → tarjeta centrada con reintento.
  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-[22px] border border-[var(--line,#e9e7f3)] bg-white px-6 py-12 text-center shadow-[var(--sh-sm,0_1px_2px_rgba(15,23,42,0.05))]">
        <span className={`${ICON_BADGE_CLASS} mx-auto`}>
          <RefreshCw size={22} aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-lg font-bold text-[var(--ink,#0f172a)]">
          No pudimos cargar el directorio
        </h3>
        <p className="mt-1 text-sm text-[var(--muted,#64748b)]">
          Revisa tu conexión e intenta de nuevo.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--v200,#ddd6fe)] bg-[var(--v50,#f5f3ff)] px-4 py-2 text-sm font-semibold text-[var(--b2,#6d28d9)] transition hover:bg-[var(--v100,#ede9fe)]"
        >
          <RefreshCw size={15} aria-hidden="true" />
          Reintentar
        </button>
      </div>
    );
  }

  // 3) Sin resultados (sin error, sin loading) → estado vacío.
  if (list.length === 0) {
    return <EmptyState categoryLabel={categoryLabel} searchQuery={searchQuery} />;
  }

  // 4) Resultados. Si está recargando (cambio de página/búsqueda) se atenúa sin desmontar.
  return (
    <div
      className={`transition-opacity duration-200 ${loading ? "pointer-events-none opacity-60" : ""}`}
      aria-busy={loading}
    >
      <div className={GRID_CLASS}>
        {list.map((c) => (
          <ClinicCard key={c.id} clinic={c} />
        ))}
      </div>

      {totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Paginación del directorio">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className={PAGE_BTN_CLASS}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Anterior
          </button>
          <span className="text-[13px] text-[var(--muted,#64748b)]">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className={PAGE_BTN_CLASS}
          >
            Siguiente
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
