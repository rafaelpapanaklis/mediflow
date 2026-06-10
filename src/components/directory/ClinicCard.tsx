"use client";

import Link from "next/link";
import { CalendarCheck, MapPin } from "lucide-react";
import { categoryLabel, type DirectoryClinic } from "@/lib/directory/types";
import { openBookingPopup } from "@/lib/directory/booking-state";
import { formatDistanceEs } from "@/lib/directory/distance";

// ─────────────────────────────────────────────────────────────────────────────
// Card de clínica del directorio público (/descubre). Imágenes remotas con
// <img> plano (dominios variables — no next/image). Paleta del home de venta
// (.mfh) vía CSS vars con fallback literal por si se renderiza fuera del scope.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClinicCardProps {
  clinic: DirectoryClinic;
}

const FALLBACK_THEME = "#7c3aed";

/** "#7c3aed" + "38" → "#7c3aed38" (≈22% alfa). Si no es hex de 6 dígitos, regresa el color tal cual. */
function withAlpha(color: string, alphaHex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alphaHex}` : color;
}

export function ClinicCard({ clinic }: ClinicCardProps) {
  const theme = clinic.themeColor ?? FALLBACK_THEME;
  const initial = clinic.name.trim().charAt(0).toUpperCase() || "C";
  const location =
    clinic.city || clinic.state
      ? [clinic.city, clinic.state].filter(Boolean).join(", ")
      : "México";
  const blurb = clinic.tagline ?? clinic.description;
  const visibleServices = clinic.featuredServices.slice(0, 3);
  const extraServices = clinic.featuredServices.length - visibleServices.length;
  const doctorCount = clinic.doctors.length;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[22px] border border-[var(--line,#e9e7f3)] bg-white shadow-[var(--sh-sm,0_1px_2px_rgba(15,23,42,0.05))] transition duration-200 hover:-translate-y-[3px] hover:shadow-[var(--sh,0_6px_24px_-10px_rgba(15,23,42,0.14))]">
      {/* Cabecera visual: portada o gradiente con el color de la clínica */}
      <div className="h-28 w-full sm:h-32">
        {clinic.coverUrl ? (
          <img
            src={clinic.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              backgroundColor: "var(--v50, #f5f3ff)",
              backgroundImage: `linear-gradient(135deg, ${theme}, ${withAlpha(theme, "38")})`,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Cuerpo */}
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
        {/* Logo flotante sobre el borde inferior de la cabecera */}
        <div className="-mt-6">
          {clinic.logoUrl ? (
            <img
              src={clinic.logoUrl}
              alt=""
              loading="lazy"
              className="h-12 w-12 rounded-xl border-2 border-white bg-white object-cover shadow-[var(--sh,0_6px_24px_-10px_rgba(15,23,42,0.14))]"
            />
          ) : (
            <span
              className="grid h-12 w-12 place-items-center rounded-xl border-2 border-white text-lg font-bold text-white shadow-[var(--sh,0_6px_24px_-10px_rgba(15,23,42,0.14))]"
              style={{ backgroundColor: theme }}
              aria-hidden="true"
            >
              {initial}
            </span>
          )}
        </div>

        <span className="self-start rounded-full bg-[var(--v50,#f5f3ff)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--b-ink,#5b21b6)]">
          {categoryLabel(clinic.category)}
        </span>

        <h3 className="line-clamp-1 text-base font-bold leading-snug text-[var(--ink,#0f172a)]">
          {clinic.name}
        </h3>

        <p className="flex items-center gap-1.5 text-[13px] text-[var(--muted,#64748b)]">
          <MapPin size={14} className="shrink-0 text-[var(--b,#7c3aed)]" aria-hidden="true" />
          <span className="line-clamp-1">{location}</span>
        </p>

        {clinic.distanceKm != null && formatDistanceEs(clinic.distanceKm) && (
          <span className="self-start rounded-full bg-[var(--v50,#f5f3ff)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--b2,#6d28d9)]">
            {formatDistanceEs(clinic.distanceKm)}
          </span>
        )}

        {blurb && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-[var(--body,#475569)]">
            {blurb}
          </p>
        )}

        {visibleServices.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {visibleServices.map((service) => (
              <li
                key={service}
                className="rounded-full border border-[var(--line,#e9e7f3)] px-2 py-0.5 text-[11px] text-[var(--body,#475569)]"
              >
                {service}
              </li>
            ))}
            {extraServices > 0 && (
              <li className="rounded-full border border-[var(--line,#e9e7f3)] px-2 py-0.5 text-[11px] text-[var(--body,#475569)]">
                +{extraServices}
              </li>
            )}
          </ul>
        )}

        {doctorCount > 0 && (
          <p className="text-xs text-[var(--muted,#64748b)]">
            {doctorCount === 1 ? "1 profesional" : `${doctorCount} profesionales`}
          </p>
        )}
      </div>

      {/* Pie: siempre pegado abajo para cards uniformes en el grid */}
      <div className="mt-auto flex gap-2 border-t border-[var(--line2,#eef1f6)] p-4">
        <button
          type="button"
          onClick={() => openBookingPopup(clinic)}
          aria-label={`Reservar cita en ${clinic.name}`}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 active:brightness-95"
          style={{ background: "linear-gradient(180deg, var(--b, #7c3aed), var(--b2, #6d28d9))" }}
        >
          <CalendarCheck size={16} aria-hidden="true" />
          Reservar cita
        </button>
        {clinic.landingActive && (
          <Link
            href={`/${clinic.slug}`}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-[var(--line,#e9e7f3)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink,#0f172a)] transition hover:bg-[var(--tint2,#faf8ff)]"
          >
            Ver clínica
          </Link>
        )}
      </div>
    </article>
  );
}
