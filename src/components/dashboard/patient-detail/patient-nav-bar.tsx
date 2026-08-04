"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Briefcase, ChevronDown, MoreHorizontal, type LucideIcon } from "lucide-react";
import type { PatientActivityCounts } from "@/lib/clinical-shared/get-patient-activity-counts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildPatientNavItems,
  type PatientNavItem,
  type PatientNavPediatricsConfig,
} from "./patient-nav-items";
import styles from "./patient-detail.module.css";
import { useT } from "@/i18n/i18n-provider";

/** Fallback del gap de la barra si `getComputedStyle` aún no resuelve (SSR /
 *  primer frame). Debe seguir a `.patientNavRow { gap }` en el CSS module. */
const FALLBACK_GAP = 6;

/** `useLayoutEffect` avisa en SSR; en el servidor no hay nada que medir. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface BarItem {
  id: string;
  /** Etiqueta completa — va al `title` y al menú desplegable. */
  label: string;
  /** Etiqueta que se pinta en la barra (corta cuando el item define una). */
  shortLabel: string;
  icon: LucideIcon;
  count?: number;
  badgeTone?: "neutral" | "danger" | "warning" | "success" | "brand";
  disabled?: boolean;
  disabledReason?: string;
  /** Módulo activo en la clínica pero sin registros del paciente. */
  dimmed?: boolean;
  isNew?: boolean;
}

export interface PatientNavBarProps {
  activeTab: string;
  onSelect: (tabId: string) => void;
  counts: {
    historia?: number;
    odontograma?: number;
    historialConsultas?: number;
    evolucion?: number;
    radiografias?: number;
    fotos?: number;
    tratamiento?: number;
    referencias?: number;
    agenda?: number;
    facturacion?: number;
    pediatria?: number;
    periodoncia?: number;
    endodoncia?: number;
    implantes?: number;
    ortodoncia?: number;
  };
  hasBalance: boolean;
  pediatrics?: PatientNavPediatricsConfig;
  showPeriodontics?: boolean;
  showEndodontics?: boolean;
  showImplants?: boolean;
  showOrthodontics?: boolean;
  /** Facturación — requiere el permiso "billing.view". `false` esconde el ítem
   *  (también dentro del desplegable Administrativo). */
  showBilling?: boolean;
  activityCounts?: PatientActivityCounts;
}

/**
 * Barra HORIZONTAL de secciones de la ficha del paciente (escritorio ≥1025px).
 *
 * Sustituye al menú vertical `QuickNav` para devolverle al contenido los 220px
 * de la columna izquierda: en Fotos clínicas, Radiografías u Odontograma esa
 * columna era ancho puro desperdiciado.
 *
 * Consume la MISMA fuente de verdad que la tab bar móvil y el quick-nav —
 * `buildPatientNavItems()` — así que altas, bajas y gating se siguen tocando en
 * un único sitio (patient-nav-items.ts).
 *
 * Dos agrupaciones se hacen aquí, y solo aquí, porque son de PRESENTACIÓN:
 *  · los 3 items `section: "admin"` (Citas, Presupuestos, Facturación) viven en
 *    un desplegable "Administrativo" fijo al final;
 *  · los items clínicos que no caben en el ancho disponible caen a un
 *    desplegable "Más".
 *
 * El corte NO se decide con breakpoints: el ancho útil depende también del
 * sidebar global (colapsado/expandido) y del escalado de Windows, así que se
 * MIDE con ResizeObserver contra una capa espejo invisible (`data-measure`) que
 * conserva el ancho natural de cada botón.
 */
export function PatientNavBar({
  activeTab,
  onSelect,
  counts,
  hasBalance,
  pediatrics,
  showPeriodontics,
  showEndodontics,
  showImplants,
  showOrthodontics,
  showBilling,
  activityCounts,
}: PatientNavBarProps) {
  const t = useT();

  const navItems = useMemo(
    () =>
      buildPatientNavItems({
        pediatrics:       pediatrics ?? { state: "hidden" },
        showPeriodontics: Boolean(showPeriodontics),
        showEndodontics:  Boolean(showEndodontics),
        showImplants:     Boolean(showImplants),
        showOrthodontics: Boolean(showOrthodontics),
        showBilling,
      }),
    [pediatrics, showPeriodontics, showEndodontics, showImplants, showOrthodontics, showBilling],
  );

  const countFor: Record<string, number | undefined> = {
    historia:              counts.historia,
    "historial-consultas": counts.historialConsultas,
    odontograma:           counts.odontograma,
    radiografias:          counts.radiografias,
    fotos:                 counts.fotos,
    tratamiento:           counts.tratamiento,
    referencias:           counts.referencias,
    agenda:                counts.agenda,
    facturacion:           counts.facturacion,
    periodoncia:           counts.periodoncia,
    endodoncia:            counts.endodoncia,
    implantes:             counts.implantes,
    ortodoncia:            counts.ortodoncia,
  };

  const toBarItem = (item: PatientNavItem): BarItem => {
    const label = t(item.labelKey);
    const barItem: BarItem = {
      id:             item.id,
      label,
      shortLabel:     item.shortLabelKey ? t(item.shortLabelKey) : label,
      icon:           item.icon,
      count:          countFor[item.id],
      disabled:       item.disabled,
      disabledReason: item.disabledReason,
      isNew:          item.isNew,
    };
    if (item.section === "dental") barItem.badgeTone = "brand";
    if (item.id === "pediatria") {
      const count = activityCounts?.pediatria ?? counts.pediatria ?? 0;
      barItem.count = count > 0 ? count : undefined;
      barItem.dimmed =
        !item.disabled && activityCounts !== undefined && activityCounts.pediatria === 0;
    }
    if (item.id === "facturacion") {
      barItem.badgeTone = hasBalance ? "danger" : "neutral";
    }
    return barItem;
  };

  const mainItems = navItems.filter((i) => i.section !== "admin").map(toBarItem);
  const adminItems = navItems.filter((i) => i.section === "admin").map(toBarItem);

  // ─── Overflow: cuántos items caben ───────────────────────────────────────
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(mainItems.length);

  const mainCount = mainItems.length;
  // Firma del contenido: los anchos cambian cuando cambia una etiqueta, un
  // contador cruza a/desde 0 o aparece un badge. Re-medimos solo entonces.
  const signature = mainItems
    .map((i) => `${i.id}:${i.shortLabel}:${i.count ?? ""}:${i.isNew ? "n" : ""}`)
    .join("|");
  const adminSignature = adminItems.map((i) => `${i.id}:${i.count ?? ""}`).join("|");

  const recalc = useCallback(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const nodes = Array.from(measure.querySelectorAll<HTMLElement>("[data-measure]"));
    // La capa espejo lleva los N items + "Más" + "Administrativo".
    if (nodes.length !== mainCount + 2) return;
    const widths = nodes.map((n) => n.getBoundingClientRect().width);
    const moreWidth = widths[mainCount];
    const adminWidth = widths[mainCount + 1];
    const available = row.getBoundingClientRect().width;
    if (available === 0) return; // ficha en un tab/iframe que Chrome no pinta
    const gap = parseFloat(getComputedStyle(row).columnGap) || FALLBACK_GAP;

    // `k` items visibles + (opcional) "Más" + "Administrativo" (siempre).
    const fits = (k: number, withMore: boolean) => {
      const boxes = k + (withMore ? 1 : 0) + 1;
      const sum =
        widths.slice(0, k).reduce((acc, w) => acc + w, 0) +
        (withMore ? moreWidth : 0) +
        adminWidth;
      // +0.5 de tolerancia: los anchos son fraccionarios y un redondeo a la
      // baja escondía un item que en realidad cabía.
      return sum + gap * Math.max(0, boxes - 1) <= available + 0.5;
    };

    if (fits(mainCount, false)) {
      setVisibleCount(mainCount);
      return;
    }
    let k = mainCount - 1;
    while (k > 0 && !fits(k, true)) k--;
    setVisibleCount(k);
  }, [mainCount]);

  // `activeTab` entra en las deps porque CAMBIA anchos, no solo colores: el item
  // activo va en font-weight 600 (más ancho que 500) y los triggers pasan a
  // "Administrativo · Facturación" / "Más · Referencias". Sin re-medir, entrar a
  // una sección administrativa desbordaba la fila hasta el siguiente resize.
  useIsoLayoutEffect(() => {
    recalc();
  }, [recalc, signature, adminSignature, activeTab]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    // El ancho útil cambia sin que cambie el viewport (sidebar global
    // colapsado/expandido, rail derecho que aparece según el tab) → observamos
    // la fila real, no `window.resize`.
    const ro = new ResizeObserver(() => recalc());
    ro.observe(row);
    return () => ro.disconnect();
  }, [recalc]);

  useEffect(() => {
    // Las webfonts cambian el ancho de cada etiqueta al cargar: si medimos
    // antes, el corte queda calculado con métricas de la fuente de sistema.
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    void document.fonts.ready.then(() => { if (alive) recalc(); });
    return () => { alive = false; };
  }, [recalc]);

  const visibleItems = mainItems.slice(0, visibleCount);
  const overflowItems = mainItems.slice(visibleCount);

  // ─── Estado del desplegable Administrativo ───────────────────────────────
  const activeAdmin = adminItems.find((i) => i.id === activeTab);
  const adminTotal = adminItems.reduce((acc, i) => acc + (i.count ?? 0), 0);
  const adminTone = adminItems.some((i) => i.id === "facturacion" && i.badgeTone === "danger")
    ? "danger"
    : "neutral";
  const adminLabel = t("patients.quickNav.administrative");
  const adminButtonLabel = activeAdmin ? `${adminLabel} · ${activeAdmin.label}` : adminLabel;

  const overflowActive = overflowItems.some((i) => i.id === activeTab);
  const activeOverflow = overflowItems.find((i) => i.id === activeTab);
  const overflowHasSignal = overflowItems.some((i) => (i.count ?? 0) > 0 || i.isNew);
  const moreLabel = t("patients.navBar.more");

  const itemClasses = (item: BarItem, isActive: boolean) =>
    [
      styles.patientNavItem,
      isActive ? styles.patientNavItemActive : "",
      item.disabled ? styles.patientNavItemDisabled : "",
      item.dimmed && !item.disabled && !isActive ? styles.patientNavItemDimmed : "",
    ]
      .filter(Boolean)
      .join(" ");

  const renderItem = (item: BarItem, opts: { measuring?: boolean } = {}) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    const isDisabled = item.disabled === true;
    return (
      <button
        key={item.id}
        type="button"
        data-measure={opts.measuring ? "" : undefined}
        className={itemClasses(item, isActive)}
        onClick={() => { if (!isDisabled) onSelect(item.id); }}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-hidden={opts.measuring || undefined}
        tabIndex={opts.measuring ? -1 : undefined}
        // La etiqueta corta solo se pinta; el nombre completo del módulo
        // siempre está disponible en el tooltip.
        title={isDisabled ? item.disabledReason : item.label}
        aria-label={item.shortLabel === item.label ? undefined : item.label}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden />
        <span className={styles.patientNavItemLabel}>{item.shortLabel}</span>
        {item.isNew && (
          <span className={styles.patientNavNewBadge}>{t("patients.quickNav.newBadge")}</span>
        )}
        {item.count !== undefined && item.count > 0 && (
          <span
            className={`${styles.patientNavCount} ${styles[`tone-${item.badgeTone ?? "neutral"}`] ?? ""}`}
          >
            {item.count}
          </span>
        )}
      </button>
    );
  };

  /** Botón "Más ▾" — el trigger real y su espejo de medición comparten pintura. */
  const renderMoreButton = (opts: { measuring?: boolean } = {}) => (
    <button
      type="button"
      data-measure={opts.measuring ? "" : undefined}
      className={[
        styles.patientNavItem,
        styles.patientNavTrigger,
        overflowActive ? styles.patientNavItemActive : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={opts.measuring || undefined}
      tabIndex={opts.measuring ? -1 : undefined}
      title={activeOverflow ? `${moreLabel} · ${activeOverflow.label}` : t("patients.navBar.moreAria")}
    >
      <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden />
      <span className={styles.patientNavItemLabel}>
        {activeOverflow ? `${moreLabel} · ${activeOverflow.shortLabel}` : moreLabel}
      </span>
      {overflowHasSignal && !overflowActive && (
        <span className={styles.patientNavDot} aria-hidden />
      )}
      <ChevronDown size={13} strokeWidth={2} aria-hidden className={styles.patientNavChevron} />
    </button>
  );

  /** Botón "Administrativo ▾" — idem: se pinta igual en la barra y en el espejo. */
  const renderAdminButton = (opts: { measuring?: boolean } = {}) => (
    <button
      type="button"
      data-measure={opts.measuring ? "" : undefined}
      className={[
        styles.patientNavItem,
        styles.patientNavTrigger,
        activeAdmin ? styles.patientNavItemActive : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={opts.measuring || undefined}
      tabIndex={opts.measuring ? -1 : undefined}
      title={adminButtonLabel}
    >
      {activeAdmin ? (
        <activeAdmin.icon size={15} strokeWidth={1.75} aria-hidden />
      ) : (
        <Briefcase size={15} strokeWidth={1.75} aria-hidden />
      )}
      <span className={styles.patientNavItemLabel}>{adminButtonLabel}</span>
      {/* Sin el total, "Facturación 1" se perdía al plegar las 3 secciones. */}
      {adminTotal > 0 && (
        <span
          className={`${styles.patientNavCount} ${styles[`tone-${adminTone}`] ?? ""}`}
          aria-label={t("patients.navBar.pendingAria", { count: adminTotal })}
        >
          {adminTotal}
        </span>
      )}
      <ChevronDown size={13} strokeWidth={2} aria-hidden className={styles.patientNavChevron} />
    </button>
  );

  const renderMenuItem = (item: BarItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    const isDisabled = item.disabled === true;
    return (
      <DropdownMenuItem
        key={item.id}
        disabled={isDisabled}
        // Radix cierra el menú solo tras `onSelect`; nada de stopPropagation
        // en el portal (rompe el cierre por clic fuera).
        onSelect={() => { if (!isDisabled) onSelect(item.id); }}
        className={`${styles.patientNavMenuItem} ${isActive ? styles.patientNavMenuItemActive : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden />
        <span className={styles.patientNavMenuLabel}>{item.label}</span>
        {item.isNew && (
          <span className={styles.patientNavNewBadge}>{t("patients.quickNav.newBadge")}</span>
        )}
        {item.count !== undefined && item.count > 0 && (
          <span
            className={`${styles.patientNavCount} ${styles[`tone-${item.badgeTone ?? "neutral"}`] ?? ""}`}
          >
            {item.count}
          </span>
        )}
      </DropdownMenuItem>
    );
  };

  return (
    <div className={styles.patientNavSticky}>
      <nav className={styles.patientNavBar} aria-label={t("patients.tabs.sectionsAria")}>
        <div className={styles.patientNavRow} ref={rowRef}>
          {visibleItems.map((item) => renderItem(item))}

          {overflowItems.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{renderMoreButton()}</DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={styles.patientNavMenu}>
                {overflowItems.map(renderMenuItem)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {adminItems.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{renderAdminButton()}</DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={styles.patientNavMenu}>
                {adminItems.map(renderMenuItem)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Capa espejo: fuera de flujo e invisible, conserva el ancho NATURAL de
            cada botón (la fila real recorta). De aquí salen las medidas del
            corte; nunca es navegable ni la ve un lector de pantalla. */}
        <div className={styles.patientNavMeasure} ref={measureRef} aria-hidden>
          {mainItems.map((item) => renderItem(item, { measuring: true }))}
          {renderMoreButton({ measuring: true })}
          {renderAdminButton({ measuring: true })}
        </div>
      </nav>
    </div>
  );
}
