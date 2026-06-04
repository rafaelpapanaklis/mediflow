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

export function XraysPatientsList({ patients }: Props) {
  const t = useT();
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
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.titleIcon}><FileImage size={18} aria-hidden /></span>
          <div>
            <h1 className={styles.title}>{t("pages.xrays.title")}</h1>
            <p className={styles.subtitle}>
              {t("pages.xrays.subtitle")}
            </p>
          </div>
        </div>
        <div className={styles.searchWrap}>
          <Search size={16} aria-hidden className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t("pages.xrays.searchPatientPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.filtersAside}>
          <div className={styles.filtersLabel}>{t("common.filters")}</div>
          <FilterButton
            active={filter === "all"}
            onClick={() => setFilter("all")}
            icon={Users}
            label={t("pages.xrays.filterAll")}
            count={counts.all}
          />
          <FilterButton
            active={filter === "with"}
            onClick={() => setFilter("with")}
            icon={FileImage}
            label={t("pages.xrays.filterWith")}
            count={counts.with}
          />
          <FilterButton
            active={filter === "recent"}
            onClick={() => setFilter("recent")}
            icon={AlarmClock}
            label={t("pages.xrays.filterRecent", { days: RECENT_THRESHOLD_DAYS })}
            count={counts.recent}
          />
          <FilterButton
            active={filter === "without"}
            onClick={() => setFilter("without")}
            icon={CircleSlash}
            label={t("pages.xrays.filterWithout")}
            count={counts.without}
          />
        </aside>

        <main className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
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
                  className={styles.row}
                >
                  <span className={styles.avatar}>{getInitials(p)}</span>
                  <div className={styles.rowInfo}>
                    <span className={styles.rowName}>
                      {p.firstName} {p.lastName}
                    </span>
                    <span className={styles.rowMeta}>
                      <code className={styles.rowMetaId}>{p.patientNumber}</code>
                      {age !== null && <span>· {t("pages.xrays.yearsOld", { count: age })}</span>}
                      {p.gender && <span>· {p.gender === "MALE" ? "M" : p.gender === "FEMALE" ? "F" : "—"}</span>}
                    </span>
                  </div>
                  <div className={styles.rowStats}>
                    <span className={p.xrayCount > 0 ? styles.rowCount : styles.rowCountZero}>
                      <FileImage size={11} aria-hidden /> {p.xrayCount}
                    </span>
                    <span className={styles.rowDate}>{formatRelative(p.lastXrayAt, t)}</span>
                  </div>
                  <span className={styles.rowChevron} aria-hidden>
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
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className={`${styles.filterBtn} ${active ? styles.filterBtnActive : ""}`}
      onClick={onClick}
    >
      <Icon size={14} aria-hidden />
      <span className={styles.filterLabel}>{label}</span>
      <span className={styles.filterCount}>{count}</span>
    </button>
  );
}
