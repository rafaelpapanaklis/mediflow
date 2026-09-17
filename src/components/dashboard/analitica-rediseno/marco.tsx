"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Grid3x3,
  Stethoscope,
  ListChecks,
  AlertCircle,
  Clock,
  DollarSign,
  Route,
  Gem,
  FileBarChart,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_ANALITICA } from "./raiz";
import { PESTANAS, pestanaActiva } from "./pestanas";
import s from "./analitica.module.css";

/** Ícono de cada pestaña (los mismos de `analytics-layout.tsx`, más el de Reportes). */
const ICONO: Readonly<Record<string, LucideIcon>> = {
  overview: BarChart3,
  occupancy: Grid3x3,
  doctors: Stethoscope,
  procedures: ListChecks,
  "no-shows": AlertCircle,
  waiting: Clock,
  costs: DollarSign,
  journey: Route,
  crm: Gem,
  reports: FileBarChart,
};

interface Props {
  children: ReactNode;
  title: string;
  subtitle?: string;
  acciones?: ReactNode;
}

/**
 * El marco del rediseño: raíz con tokens, la fila de pestañas siempre a
 * la vista (se parte en dos renglones si no cabe; nunca esconde una), y la
 * cabecera de sección con título, subtítulo y acciones a la derecha.
 *
 * Cambia respecto a hoy: las pestañas pasan de una columna lateral de 220 px a
 * una fila arriba, como el menú de la ficha de Pacientes. Con eso las tablas
 * anchas (Doctores tiene ocho columnas) y el mapa de calor recuperan esos
 * 220 px en el iPad. Mismos clics: uno por sección, igual que hoy.
 */
export function MarcoAnalitica({ children, title, subtitle, acciones }: Props) {
  const t = useT();
  const pathname = usePathname();
  return (
    <div className={CLASES_ANALITICA}>
      <nav className={s.pestanas} aria-label={t("analytics.layout.sectionsAria")}>
        {PESTANAS.map((p) => {
          const activa = pestanaActiva(p.href, pathname);
          const Icono = ICONO[p.id] ?? BarChart3;
          return (
            <Link
              key={p.id}
              href={p.href}
              aria-current={activa ? "page" : undefined}
              className={`${s.pestana}${activa ? ` ${s.pestanaActiva}` : ""}`}
            >
              <Icono size={16} strokeWidth={1.75} aria-hidden />
              <span>{t(p.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <header className={s.cabecera}>
        <div>
          <h1 className={s.titulo}>{title}</h1>
          {subtitle && <p className={s.subtitulo}>{subtitle}</p>}
        </div>
        {acciones && <div className={s.acciones}>{acciones}</div>}
      </header>

      {children}
    </div>
  );
}
