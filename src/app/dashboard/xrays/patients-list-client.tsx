"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Users,
  FileImage,
  AlarmClock,
  CircleSlash,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import styles from "./patients-list.module.css";
import piel from "@/components/dashboard/sabina-rx-ia-rediseno/rediseno.module.css";
import { CLASES_REDISENO_LOTE } from "@/components/dashboard/sabina-rx-ia-rediseno/raiz";

/**
 * REDISEÑO (interruptor `menu-dos-niveles`) — «dos pieles, un esqueleto», como
 * en sabina-client.tsx: el JSX es uno y `c` elige las clases de siempre
 * (`patients-list.module.css`, sin tocar) o las piezas del rediseño que
 * comparten Sabina, Radiografías y el Asistente IA.
 */
const CLASES_REDISENO: Record<string, string> = {
  page: piel.listaPagina,
  header: piel.listaCabecera,
  titleRow: piel.listaTituloFila,
  titleIcon: `${piel.iniciales} ${piel.inicialesGrandes}`,
  title: piel.pantallaTitulo,
  subtitle: piel.pantallaSub,
  searchWrap: `${piel.buscador} ${piel.buscadorGrande}`,
  searchIcon: piel.buscadorIcono,
  searchInput: piel.buscadorEntrada,
  layout: piel.listaDisposicion,
  filtersAside: `${piel.tarjeta} ${piel.filtros}`,
  filtersLabel: `${piel.seccionTitulo} ${piel.filtrosTitulo}`,
  filterBtn: piel.filtro,
  filterBtnActive: piel.filtroActivo,
  filterLabel: piel.filtroTexto,
  filterCount: `${piel.contador} ${piel.contadorSuave}`,
  list: piel.filas,
  emptyState: piel.vacio,
  row: piel.filaPaciente,
  avatar: `${piel.iniciales} ${piel.inicialesGrandes}`,
  rowInfo: piel.filaInfo,
  rowName: piel.filaNombre,
  rowMeta: piel.filaMeta,
  rowMetaId: piel.filaFolio,
  rowStats: piel.filaDatos,
  rowCount: piel.filaCuenta,
  rowCountZero: `${piel.filaCuenta} ${piel.filaCuentaCero}`,
  rowDate: piel.filaFecha,
  rowChevron: piel.filaFlecha,
};

interface PatientRow {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber: string;
  dob: string | null;
  gender: string | null;
  xrayCount: number;
  lastXrayAt: string | null;
}

interface Props {
  patients: PatientRow[];
  /** Interruptor `menu-dos-niveles` de la clínica: viste la lista con el rediseño. */
  rediseno?: boolean;
}

type Filter = "all" | "with" | "without" | "recent";

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function getInitials(p: PatientRow): string {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

function formatRelative(iso: string | null, t: ReturnType<typeof useT>): string {
  if (!iso) return t("pages.xrays.noXrays");
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return t("pages.xrays.today");
  if (days === 1) return t("pages.xrays.yesterday");
  if (days < 7) return t("pages.xrays.daysAgo", { count: days });
  if (days < 30) return t("pages.xrays.weeksAgo", { count: Math.floor(days / 7) });
  if (days < 365) return t("pages.xrays.monthsAgo", { count: Math.floor(days / 30) });
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric", month: "short", year: "numeric",
  }).format(date);
}

const RECENT_THRESHOLD_DAYS = 30;
function isRecent(iso: string | null): boolean {
  if (!iso) return false;
  const days = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
  return days <= RECENT_THRESHOLD_DAYS;
}

export function XraysPatientsList({ patients, rediseno = false }: Props) {
  const t = useT();
  const c: Record<string, string> = rediseno ? CLASES_REDISENO : styles;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    let withRx = 0, recent = 0, without = 0;
    for (const p of patients) {
      if (p.xrayCount > 0) withRx++; else without++;
      if (isRecent(p.lastXrayAt)) recent++;
    }
    return { all: patients.length, with: withRx, without, recent };
  }, [patients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = patients;
    if (filter === "with") list = list.filter((p) => p.xrayCount > 0);
    else if (filter === "without") list = list.filter((p) => p.xrayCount === 0);
    else if (filter === "recent") list = list.filter((p) => isRecent(p.lastXrayAt));

    if (q) {
      list = list.filter(
        (p) =>
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
          p.patientNumber.toLowerCase().includes(q),
      );
    }
    return list;
  }, [patients, search, filter]);

  return (
    <div className={rediseno ? `${CLASES_REDISENO_LOTE} ${c.page}` : c.page}>
      <header className={c.header}>
        <div className={c.titleRow}>
          <span className={c.titleIcon}><FileImage size={18} aria-hidden /></span>
          <div>
            <h1 className={c.title}>{t("pages.xrays.title")}</h1>
            <p className={c.subtitle}>
              {t("pages.xrays.subtitle")}
            </p>
          </div>
        </div>
        <div className={c.searchWrap}>
          <Search size={16} aria-hidden className={c.searchIcon} />
          <input
            type="text"
            className={c.searchInput}
            placeholder={t("pages.xrays.searchPatientPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      </header>

      <div className={c.layout}>
        <aside className={c.filtersAside}>
          <div className={c.filtersLabel}>{t("common.filters")}</div>
          <FilterButton
            c={c}
            active={filter === "all"}
            onClick={() => setFilter("all")}
            icon={Users}
            label={t("pages.xrays.filterAll")}
            count={counts.all}
          />
          <FilterButton
            c={c}
            active={filter === "with"}
            onClick={() => setFilter("with")}
            icon={FileImage}
            label={t("pages.xrays.filterWith")}
            count={counts.with}
          />
          <FilterButton
            c={c}
            active={filter === "recent"}
            onClick={() => setFilter("recent")}
            icon={AlarmClock}
            label={t("pages.xrays.filterRecent", { days: RECENT_THRESHOLD_DAYS })}
            count={counts.recent}
          />
          <FilterButton
            c={c}
            active={filter === "without"}
            onClick={() => setFilter("without")}
            icon={CircleSlash}
            label={t("pages.xrays.filterWithout")}
            count={counts.without}
          />
        </aside>

        <main className={c.list}>
          {filtered.length === 0 ? (
            <div className={c.emptyState}>
              <FileImage size={42} aria-hidden style={{ opacity: 0.3, marginBottom: 12 }} />
              <h3>{t("common.noResults")}</h3>
              <p>{search ? t("pages.xrays.emptyAdjustSearch") : t("pages.xrays.emptyNoMatch")}</p>
            </div>
          ) : (
            filtered.map((p) => {
              const age = ageFromDob(p.dob);
              return (
                <Link
                  key={p.id}
                  href={`/dashboard/xrays/${p.id}`}
                  className={c.row}
                >
                  <span className={c.avatar}>{getInitials(p)}</span>
                  <div className={c.rowInfo}>
                    <span className={c.rowName}>
                      {p.firstName} {p.lastName}
                    </span>
                    <span className={c.rowMeta}>
                      <code className={c.rowMetaId}>{p.patientNumber}</code>
                      {age !== null && <span>· {t("pages.xrays.yearsOld", { count: age })}</span>}
                      {p.gender && <span>· {p.gender === "MALE" ? "M" : p.gender === "FEMALE" ? "F" : "—"}</span>}
                    </span>
                  </div>
                  <div className={c.rowStats}>
                    <span className={p.xrayCount > 0 ? c.rowCount : c.rowCountZero}>
                      <FileImage size={11} aria-hidden /> {p.xrayCount}
                    </span>
                    <span className={c.rowDate}>{formatRelative(p.lastXrayAt, t)}</span>
                  </div>
                  <span className={c.rowChevron} aria-hidden>
                    <ArrowRight size={14} />
                  </span>
                </Link>
              );
            })
          )}
        </main>
      </div>
    </div>
  );
}

function FilterButton({
  c = styles,
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  c?: Record<string, string>;
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className={`${c.filterBtn} ${active ? c.filterBtnActive : ""}`}
      onClick={onClick}
    >
      <Icon size={14} aria-hidden />
      <span className={c.filterLabel}>{label}</span>
      <span className={c.filterCount}>{count}</span>
    </button>
  );
}
