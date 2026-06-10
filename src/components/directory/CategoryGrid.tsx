import Link from "next/link";
import {
  Activity, Apple, Brain, Eye, Flower2, Footprints, Leaf, Paintbrush,
  ScanFace, Scissors, Smile, Sparkles, Sprout, Stethoscope, Syringe, Waves, Zap,
  type LucideIcon,
} from "lucide-react";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";

// ─────────────────────────────────────────────────────────────────────────────
// Grid/pills de las 17 categorías del directorio. SERVER COMPONENT (sin
// "use client") — solo <Link>s estáticos, cero JS al cliente.
//   · variant "grid" (default — /descubre): tarjetas responsive 2/3/4/6 cols
//     con hover violeta (borde var(--v200) + fondo var(--tint2) + elevación).
//   · variant "pills" (/descubre/[categoria]): fila con overflow-x-auto, pill
//     "Todas" → /descubre y la activa con gradiente violeta var(--b)→var(--b2).
// Colores vía variables de sales.css (los componentes viven bajo `.mfh`).
// ─────────────────────────────────────────────────────────────────────────────

/** Mapa slug → icono lucide (mismo que usa el hero de categoría). */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "dental": Smile,
  "medicina": Stethoscope,
  "nutricion": Apple,
  "psicologia": Brain,
  "dermatologia": ScanFace,
  "medicina-estetica": Syringe,
  "injerto-capilar": Sprout,
  "centro-de-belleza": Sparkles,
  "cejas-y-pestanas": Eye,
  "masajes": Waves,
  "depilacion-laser": Zap,
  "salon-de-cabello": Scissors,
  "medicina-alternativa": Leaf,
  "salon-de-unas": Paintbrush,
  "spa": Flower2,
  "fisioterapia": Activity,
  "podologia": Footprints,
};

export interface CategoryGridProps {
  variant?: "grid" | "pills";
  /** Slug activo (solo variant pills) */
  activeSlug?: string;
}

const PILL_BASE =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] font-semibold no-underline transition";

const PILL_IDLE =
  `${PILL_BASE} border-[color:var(--line)] bg-white text-[color:var(--ink)] hover:border-[color:var(--v200)] hover:bg-[color:var(--tint2)]`;

export function CategoryGrid({ variant = "grid", activeSlug }: CategoryGridProps) {
  if (variant === "pills") {
    return (
      <nav
        aria-label="Categorías del directorio"
        className="flex flex-nowrap items-center gap-2 overflow-x-auto py-1.5"
        style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "thin" }}
      >
        <Link href="/descubre" className={PILL_IDLE} aria-label="Ver todas las categorías">
          Todas
        </Link>
        {DIRECTORY_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICONS[c.slug] ?? Sparkles;
          const active = c.slug === activeSlug;
          if (active) {
            return (
              <Link
                key={c.slug}
                href={`/descubre/${c.slug}`}
                aria-current="page"
                className={`${PILL_BASE} border-transparent text-white`}
                style={{
                  background: "linear-gradient(180deg, var(--b) 0%, var(--b2) 100%)",
                  boxShadow: "var(--sh-b)",
                }}
              >
                <Icon size={14} aria-hidden="true" />
                {c.label}
              </Link>
            );
          }
          return (
            <Link key={c.slug} href={`/descubre/${c.slug}`} className={PILL_IDLE}>
              <Icon size={14} aria-hidden="true" className="text-[color:var(--b)]" />
              {c.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Categorías del directorio"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6"
    >
      {DIRECTORY_CATEGORIES.map((c) => {
        const Icon = CATEGORY_ICONS[c.slug] ?? Sparkles;
        return (
          <Link
            key={c.slug}
            href={`/descubre/${c.slug}`}
            aria-label={`Ver ${c.plural}`}
            className="flex flex-col items-center gap-3 rounded-2xl border border-[color:var(--line)] bg-white p-[18px] text-center no-underline shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[color:var(--v200)] hover:bg-[color:var(--tint2)]"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--v50)] text-[color:var(--b2)]"
            >
              <Icon size={20} strokeWidth={1.9} />
            </span>
            <span className="text-sm font-semibold leading-snug text-[color:var(--ink)]">
              {c.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
