"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Calendar,
  Phone,
  MessageCircle,
  Star,
  ArrowRight,
  Plus,
  Filter,
  Columns3,
  LayoutGrid,
  Rows3,
  Tag,
  User,
  Download,
  Trash2,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { NewPatientModal } from "@/components/dashboard/new-patient-modal";
import styles from "./patients.module.css";

/* ─── Types ─── */

interface PatientRow {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
  age: number | null;
  gender: "MALE" | "FEMALE" | "OTHER";
  tags: string[];
  isVip: boolean;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  lastVisit: string | null;
  nextAppointment: { id: string; startsAt: string; status: string; type: string } | null;
  balance: number;
  assignedDoctor: { id: string; firstName: string; lastName: string; color: string | null } | null;
  createdAt: string;
}
interface Stats {
  total: number;
  active: number;
  inactive: number;
  archived: number;
  newThisMonth: number;
  newPrevMonth: number;
  newPctDelta: number;
  withDebt: number;
  withDebtAmount: number;
  nextAppointmentsToday: number;
  nextAppointmentsWeek: number;
}
interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
}
interface ApiResponse {
  patients: PatientRow[];
  total: number;
  stats: Stats;
  hasMore: boolean;
  nextCursor: string | null;
}
type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
type QuickFilter = "debt" | "vip" | "nextAppt" | "birthdayWeek" | "noContact6m";
type ViewMode = "list" | "grid";
type SortDir = "asc" | "desc";
type SortCol =
  | "name"
  | "lastVisit"
  | "nextAppointment"
  | "balance"
  | "createdAt"
  | "patientNumber";
type ColumnId =
  | "patient" | "contact" | "lastVisit" | "nextAppointment"
  | "balance" | "doctor" | "tags" | "status";

interface Props {
  currentUser: { id: string; role: string };
  doctors: Doctor[];
}

/* ─── Constantes ─── */

const VIEW_STORAGE_KEY = "mf:patients:view";
const COLUMNS_STORAGE_KEY = "mf:patients:cols";
const PAGE_SIZE = 30;

const ALL_COLUMNS: Array<{ id: ColumnId; label: string; required?: boolean }> = [
  { id: "patient", label: "Paciente", required: true },
  { id: "contact", label: "Contacto" },
  { id: "lastVisit", label: "Última visita" },
  { id: "nextAppointment", label: "Próxima cita" },
  { id: "balance", label: "Saldo" },
  { id: "doctor", label: "Doctor" },
  { id: "tags", label: "Etiquetas" },
  { id: "status", label: "Estado" },
];
const DEFAULT_VISIBLE: ColumnId[] = ALL_COLUMNS.map((c) => c.id);

/* ─── Helpers ─── */

function initials(p: { firstName: string; lastName: string }): string {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}
function formatRelative(iso: string | null): {
  text: string;
  tone: "recent" | "old" | "never" | "future";
} {
  if (!iso) return { text: "Nunca", tone: "never" };
  const date = new Date(iso);
  const diff = date.getTime() - Date.now();
  const absDays = Math.floor(Math.abs(diff) / (1000 * 60 * 60 * 24));
  if (diff > 0) {
    if (absDays === 0) return { text: "Hoy", tone: "future" };
    if (absDays === 1) return { text: "Mañana", tone: "future" };
    if (absDays < 7) return { text: `En ${absDays}d`, tone: "future" };
    if (absDays < 30) return { text: `En ${Math.round(absDays / 7)} sem.`, tone: "future" };
    return { text: new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(date), tone: "future" };
  }
  if (absDays === 0) return { text: "Hoy", tone: "recent" };
  if (absDays === 1) return { text: "Ayer", tone: "recent" };
  if (absDays < 30) return { text: `Hace ${absDays}d`, tone: "recent" };
  if (absDays < 365) return { text: `Hace ${Math.round(absDays / 30)} meses`, tone: "old" };
  return { text: `Hace ${Math.floor(absDays / 365)} años`, tone: "old" };
}
function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}
function highlightMatch(text: string, query: string): ReactNode {
  if (!query.trim() || !text) return text;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>,
  );
}
function getTagClass(tag: string): string {
  const t = tag.toLowerCase();
  if (t === "vip") return styles.tagVip;
  if (t.includes("alerg")) return styles.tagAlergia;
  if (t.includes("crónic") || t.includes("cronic")) return styles.tagCronico;
  if (t.includes("embarazo")) return styles.tagEmbarazo;
  if (t.includes("pediátr") || t.includes("pediatr")) return styles.tagPediatrico;
  if (t === "nuevo") return styles.tagNuevo;
  return "";
}
function readJSONLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
function writeJSONLS(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {/* quota */}
}

function computePages(current: number, total: number): Array<number | "..."> {
  const pages: Array<number | "..."> = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
    return pages;
  }
  pages.push(1);
  if (current > 4) pages.push("...");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 3) pages.push("...");
  pages.push(total);
  return pages;
}

/* ─── Componente principal ─── */

export function PatientsClient({ doctors }: Props) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(null);
  const [view, setView] = useState<ViewMode>("list");
  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [columnsVisible, setColumnsVisible] = useState<ColumnId[]>(DEFAULT_VISIBLE);
  const [colsDropdownOpen, setColsDropdownOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Filtros avanzados aplicados
  const [advAgeMin, setAdvAgeMin] = useState("");
  const [advAgeMax, setAdvAgeMax] = useState("");
  const [advGenders, setAdvGenders] = useState<string[]>([]);
  const [advDoctorId, setAdvDoctorId] = useState("");
  const [advTags, setAdvTags] = useState<string[]>([]);
  const [advHasDebt, setAdvHasDebt] = useState<"any" | "yes" | "no">("any");
  const [advVisitFrom, setAdvVisitFrom] = useState("");
  const [advVisitTo, setAdvVisitTo] = useState("");

  // Drafts del drawer
  const [drDrafts, setDrDrafts] = useState({
    ageMin: "",
    ageMax: "",
    genders: [] as string[],
    doctorId: "",
    tags: [] as string[],
    hasDebt: "any" as "any" | "yes" | "no",
    visitFrom: "",
    visitTo: "",
  });

  // Bulk
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastShiftIndexRef = useRef<number | null>(null);

  // Datos
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal
  const [newPatientOpen, setNewPatientOpen] = useState(false);

  // Navegación J/K
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);

  const searchRef = useRef<HTMLInputElement>(null);

  // Hidratar prefs
  useEffect(() => {
    const v = readJSONLS<ViewMode>(VIEW_STORAGE_KEY, "list");
    if (v === "grid" || v === "list") setView(v);
    const cols = readJSONLS<ColumnId[]>(COLUMNS_STORAGE_KEY, DEFAULT_VISIBLE);
    if (Array.isArray(cols) && cols.length > 0) {
      const safe = ["patient" as ColumnId, ...cols.filter((c) => c !== "patient")];
      setColumnsVisible(safe);
    }
  }, []);

  // Search debounce 150ms
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 150);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Query string para fetch
  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("v", "2");
    sp.set("limit", String(PAGE_SIZE));
    if (search) sp.set("search", search);
    if (statusFilter !== "ALL") sp.set("status", statusFilter);
    if (quickFilter) sp.set("quickFilter", quickFilter);
    if (advAgeMin) sp.set("ageMin", advAgeMin);
    if (advAgeMax) sp.set("ageMax", advAgeMax);
    if (advGenders.length > 0) sp.set("gender", advGenders.join(","));
    if (advDoctorId) sp.set("doctorId", advDoctorId);
    if (advTags.length > 0) sp.set("tags", advTags.join(","));
    if (advHasDebt === "yes") sp.set("hasDebt", "true");
    if (advHasDebt === "no") sp.set("hasDebt", "false");
    if (advVisitFrom) sp.set("visitFrom", advVisitFrom);
    if (advVisitTo) sp.set("visitTo", advVisitTo);
    sp.set("sort", `${sortCol}:${sortDir}`);
    return sp.toString();
  }, [search, statusFilter, quickFilter, advAgeMin, advAgeMax, advGenders, advDoctorId, advTags, advHasDebt, advVisitFrom, advVisitTo, sortCol, sortDir]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/patients?${queryString}&page=${page}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: ApiResponse) => {
        if (cancelled) return;
        setData(json);
        setSelected(new Set());
        setFocusedIdx(-1);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Error al cargar pacientes");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [queryString, page]);

  const handleSort = useCallback((col: SortCol) => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortCol("createdAt");
      setSortDir("desc");
    }
    setPage(1);
  }, [sortCol, sortDir]);

  const toggleView = useCallback(() => {
    setView((v) => {
      const next: ViewMode = v === "list" ? "grid" : "list";
      writeJSONLS(VIEW_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleColumn = useCallback((col: ColumnId) => {
    if (col === "patient") return;
    setColumnsVisible((prev) => {
      const next = prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col];
      writeJSONLS(COLUMNS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const patients = data?.patients ?? [];
  const allSelected = patients.length > 0 && patients.every((p) => selected.has(p.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(patients.map((p) => p.id)));
  };
  const toggleOne = useCallback((id: string, idx: number, withShift: boolean) => {
    if (withShift && lastShiftIndexRef.current !== null) {
      const start = Math.min(lastShiftIndexRef.current, idx);
      const end = Math.max(lastShiftIndexRef.current, idx);
      const ids = patients.slice(start, end + 1).map((p) => p.id);
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((x) => next.add(x));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastShiftIndexRef.current = idx;
    }
  }, [patients]);

  // Atajos teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === "Escape") {
        if (drawerOpen) { setDrawerOpen(false); return; }
        if (colsDropdownOpen) { setColsDropdownOpen(false); return; }
        if (selected.size > 0) { setSelected(new Set()); return; }
        if (search) { setSearchInput(""); searchRef.current?.blur(); return; }
        return;
      }
      if (inInput) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setFocusedIdx((i) => Math.min((data?.patients.length ?? 0) - 1, i + 1));
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(-1, i - 1));
      } else if (e.key === "Enter") {
        if (focusedIdx >= 0 && data?.patients[focusedIdx]) {
          router.push(`/dashboard/patients/${data.patients[focusedIdx].id}`);
        }
      } else if (e.key === " " || e.code === "Space") {
        if (focusedIdx >= 0 && data?.patients[focusedIdx]) {
          e.preventDefault();
          toggleOne(data.patients[focusedIdx].id, focusedIdx, false);
        }
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNewPatientOpen(true);
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        toggleView();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setDrawerOpen(true);
        setDrDrafts({
          ageMin: advAgeMin, ageMax: advAgeMax, genders: advGenders,
          doctorId: advDoctorId, tags: advTags, hasDebt: advHasDebt,
          visitFrom: advVisitFrom, visitTo: advVisitTo,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, colsDropdownOpen, selected.size, search, data, focusedIdx, router, toggleView, toggleOne, advAgeMin, advAgeMax, advGenders, advDoctorId, advTags, advHasDebt, advVisitFrom, advVisitTo]);

  const stats = data?.stats;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, page * PAGE_SIZE);
  const pagesToShow = computePages(page, totalPages);

  const handleStatClick = (kind: "total" | "newMonth" | "debt" | "nextAppt") => {
    if (kind === "total") {
      setStatusFilter("ALL");
      setQuickFilter(null);
    } else if (kind === "newMonth") {
      setStatusFilter("ALL");
      setQuickFilter(null);
    } else if (kind === "debt") {
      setQuickFilter((q) => (q === "debt" ? null : "debt"));
    } else if (kind === "nextAppt") {
      setQuickFilter((q) => (q === "nextAppt" ? null : "nextAppt"));
    }
    setPage(1);
  };

  const bulkArchive = async () => {
    if (selected.size === 0) return;
    if (!confirm(`¿Archivar ${selected.size} pacientes?`)) return;
    const ids = Array.from(selected);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/patients/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ARCHIVED" }),
          }),
        ),
      );
      toast.success(`${ids.length} pacientes archivados`);
      setSelected(new Set());
      setData(null);
      setPage(1);
    } catch {
      toast.error("Error al archivar");
    }
  };

  const bulkExportCsv = () => {
    const rows = patients.filter((p) => selected.has(p.id));
    if (rows.length === 0) return;
    const headers = ["ID", "Nombre", "Teléfono", "Email", "Edad", "Status", "Saldo"];
    const csv = [
      headers.join(","),
      ...rows.map((p) =>
        [p.patientNumber, `"${p.fullName}"`, p.phone ?? "", p.email ?? "", p.age ?? "", p.status, p.balance].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacientes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportados ${rows.length} pacientes`);
  };

  const applyDrawer = () => {
    setAdvAgeMin(drDrafts.ageMin);
    setAdvAgeMax(drDrafts.ageMax);
    setAdvGenders(drDrafts.genders);
    setAdvDoctorId(drDrafts.doctorId);
    setAdvTags(drDrafts.tags);
    setAdvHasDebt(drDrafts.hasDebt);
    setAdvVisitFrom(drDrafts.visitFrom);
    setAdvVisitTo(drDrafts.visitTo);
    setPage(1);
    setDrawerOpen(false);
  };
  const clearDrawer = () => {
    setDrDrafts({ ageMin: "", ageMax: "", genders: [], doctorId: "", tags: [], hasDebt: "any", visitFrom: "", visitTo: "" });
  };

  return (
    <div className={styles.page}>
      <HeroStats
        stats={stats}
        loading={loading && !data}
        onClick={handleStatClick}
        activeFilter={quickFilter}
      />

      <div className={styles.filtersRow}>
        <div className={styles.pillGroup}>
          {([
            { id: "ALL" as const, label: "Todos", count: stats?.total },
            { id: "ACTIVE" as const, label: "Activos", count: stats?.active },
            { id: "INACTIVE" as const, label: "Inactivos", count: stats?.inactive },
            { id: "ARCHIVED" as const, label: "Archivados", count: stats?.archived },
          ]).map((f) => (
            <button
              key={f.id}
              type="button"
              className={`${styles.pill} ${statusFilter === f.id ? styles.pillActive : ""}`}
              onClick={() => { setStatusFilter(f.id); setPage(1); }}
            >
              {f.label}
              {typeof f.count === "number" && (
                <span className={styles.pillCount}>{f.count.toLocaleString()}</span>
              )}
            </button>
          ))}
        </div>
        <span className={styles.pillDivider} aria-hidden />
        <div className={styles.pillGroup}>
          {([
            { id: "debt" as QuickFilter, label: "Con deuda", count: stats?.withDebt },
            { id: "vip" as QuickFilter, label: "VIP" },
            { id: "nextAppt" as QuickFilter, label: "Próxima cita", count: stats?.nextAppointmentsWeek },
            { id: "birthdayWeek" as QuickFilter, label: "Cumple esta semana" },
            { id: "noContact6m" as QuickFilter, label: "Sin contacto 6m" },
          ]).map((q) => (
            <button
              key={q.id}
              type="button"
              className={`${styles.pill} ${styles.pillDashed} ${quickFilter === q.id ? styles.pillActive : ""}`}
              onClick={() => { setQuickFilter((p) => (p === q.id ? null : q.id)); setPage(1); }}
            >
              {q.label}
              {typeof q.count === "number" && (
                <span className={styles.pillCount}>{q.count.toLocaleString()}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={15} aria-hidden className={styles.searchIcon} />
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar paciente, teléfono, email…"
            className={styles.searchInput}
            spellCheck={false}
          />
          {!searchInput && <kbd className={styles.searchKbd}>/</kbd>}
        </div>

        <div className={styles.viewToggle} role="group">
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === "list" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => { setView("list"); writeJSONLS(VIEW_STORAGE_KEY, "list"); }}
            title="Lista (G)"
          >
            <Rows3 size={13} aria-hidden /> Lista
          </button>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === "grid" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => { setView("grid"); writeJSONLS(VIEW_STORAGE_KEY, "grid"); }}
            title="Grid (G)"
          >
            <LayoutGrid size={13} aria-hidden /> Grid
            <kbd>G</kbd>
          </button>
        </div>

        <div className={styles.dropdownWrap}>
          <button type="button" className={styles.btn} onClick={() => setColsDropdownOpen((v) => !v)}>
            <Columns3 size={13} aria-hidden /> Columnas
            <ChevronDown size={11} aria-hidden />
          </button>
          {colsDropdownOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 49 }}
                onClick={() => setColsDropdownOpen(false)}
              />
              <div className={styles.dropdown}>
                <div className={styles.dropdownLabel}>Mostrar columnas</div>
                {ALL_COLUMNS.map((c) => (
                  <label key={c.id} className={styles.dropdownItem}>
                    <input
                      type="checkbox"
                      checked={columnsVisible.includes(c.id)}
                      disabled={c.required}
                      onChange={() => toggleColumn(c.id)}
                    />
                    <span>{c.label}</span>
                    {c.required && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-4)" }}>fija</span>}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            setDrawerOpen(true);
            setDrDrafts({
              ageMin: advAgeMin, ageMax: advAgeMax, genders: advGenders,
              doctorId: advDoctorId, tags: advTags, hasDebt: advHasDebt,
              visitFrom: advVisitFrom, visitTo: advVisitTo,
            });
          }}
          title="Más filtros (F)"
        >
          <Filter size={13} aria-hidden /> Más filtros
        </button>

        <span className={styles.toolbarSpacer} />

        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => setNewPatientOpen(true)}
          title="Nuevo paciente (N)"
        >
          <Plus size={13} aria-hidden /> Nuevo paciente
        </button>
      </div>

      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selected.size} seleccionados</span>
          <button type="button" className={styles.btn} onClick={() => toast("Asignar etiqueta — próximamente")}>
            <Tag size={13} aria-hidden /> Asignar etiqueta
          </button>
          <button type="button" className={styles.btn} onClick={() => toast("Asignar doctor — próximamente")}>
            <User size={13} aria-hidden /> Asignar doctor
          </button>
          <span className={styles.bulkDivider} aria-hidden />
          <button type="button" className={styles.btn} onClick={() => toast("Campaña WhatsApp — próximamente")}>
            <MessageCircle size={13} aria-hidden /> Campaña WhatsApp
          </button>
          <button type="button" className={styles.btn} onClick={bulkExportCsv}>
            <Download size={13} aria-hidden /> Exportar CSV
          </button>
          <span className={styles.bulkDivider} aria-hidden />
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={bulkArchive}>
            <Trash2 size={13} aria-hidden /> Archivar
          </button>
          <span className={styles.toolbarSpacer} />
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setSelected(new Set())}>
            Cancelar
          </button>
        </div>
      )}

      {error ? (
        <div className={styles.empty}>
          <AlertCircle size={28} style={{ marginBottom: 8, color: "var(--red)" }} aria-hidden />
          <div>Error: {error}</div>
        </div>
      ) : view === "list" ? (
        <PatientsTable
          patients={patients}
          loading={loading}
          search={search}
          columnsVisible={columnsVisible}
          selected={selected}
          allSelected={allSelected}
          focusedIdx={focusedIdx}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
          onToggleAll={toggleAll}
          onToggleOne={toggleOne}
        />
      ) : (
        <PatientsGrid
          patients={patients}
          loading={loading}
          search={search}
          selected={selected}
          onToggleOne={toggleOne}
        />
      )}

      {!error && total > 0 && (
        <div className={styles.pagination}>
          <span className={styles.pageInfo}>
            Mostrando {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} de {total.toLocaleString()}
          </span>
          <div className={styles.pageControls}>
            <button type="button" className={styles.pageBtn} disabled={page === 1} onClick={() => setPage(1)} title="Primera">
              <ChevronsLeft size={13} aria-hidden />
            </button>
            <button type="button" className={styles.pageBtn} disabled={page === 1} onClick={() => setPage((p) => p - 1)} title="Anterior">
              <ChevronLeft size={13} aria-hidden />
            </button>
            {pagesToShow.map((p, i) =>
              p === "..." ? (
                <span key={`e-${i}`} className={styles.pageEllipsis}>…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ""}`}
                  onClick={() => setPage(p as number)}
                >
                  {p}
                </button>
              ),
            )}
            <button type="button" className={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} title="Siguiente">
              <ChevronRight size={13} aria-hidden />
            </button>
            <button type="button" className={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage(totalPages)} title="Última">
              <ChevronsRight size={13} aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className={styles.kbdHints}>
        <kbd>/</kbd>buscar · <kbd>J</kbd>/<kbd>K</kbd>navegar · <kbd>↵</kbd>abrir · <kbd>Esc</kbd>limpiar · <kbd>Space</kbd>seleccionar · <kbd>N</kbd>nuevo · <kbd>G</kbd>vista · <kbd>F</kbd>filtros
      </div>

      {drawerOpen && (
        <FilterDrawer
          drafts={drDrafts}
          setDrafts={setDrDrafts}
          doctors={doctors}
          onApply={applyDrawer}
          onClear={clearDrawer}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      <NewPatientModal
        open={newPatientOpen}
        onClose={() => setNewPatientOpen(false)}
        onCreated={() => {
          setNewPatientOpen(false);
          router.refresh();
          setPage(1);
        }}
      />
    </div>
  );
}

/* ─── Sub-componentes ─── */

function HeroStats({
  stats, loading, onClick, activeFilter,
}: {
  stats?: Stats;
  loading: boolean;
  onClick: (kind: "total" | "newMonth" | "debt" | "nextAppt") => void;
  activeFilter: QuickFilter | null;
}) {
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className={styles.heroGrid}>
      <StatCard
        label="Total pacientes"
        icon={Users}
        value={stats ? fmt(stats.total) : loading ? "…" : "0"}
        deltaText={stats ? `+${stats.newThisMonth} este mes` : ""}
        deltaTone="up"
        onClick={() => onClick("total")}
      />
      <StatCard
        label="Nuevos este mes"
        icon={TrendingUp}
        value={stats ? fmt(stats.newThisMonth) : "0"}
        deltaText={
          stats && stats.newPctDelta !== 0
            ? `${stats.newPctDelta > 0 ? "+" : ""}${stats.newPctDelta}% vs mes anterior`
            : "sin cambio"
        }
        deltaTone={stats && stats.newPctDelta < 0 ? "down" : "up"}
        variant="brand"
        onClick={() => onClick("newMonth")}
      />
      <StatCard
        label="Con deuda"
        icon={AlertCircle}
        value={stats ? formatMoney(stats.withDebtAmount) : "$0"}
        deltaText={stats ? `${stats.withDebt} pacientes` : ""}
        deltaTone="down"
        variant="danger"
        active={activeFilter === "debt"}
        onClick={() => onClick("debt")}
      />
      <StatCard
        label="Próximas citas"
        icon={Calendar}
        value={stats ? `${stats.nextAppointmentsToday} / ${stats.nextAppointmentsWeek}` : "0 / 0"}
        deltaText="Hoy / Esta semana"
        deltaTone="up"
        active={activeFilter === "nextAppt"}
        onClick={() => onClick("nextAppt")}
      />
    </div>
  );
}

function StatCard({
  label, icon: Icon, value, deltaText, deltaTone, variant, active, onClick,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  deltaText: string;
  deltaTone: "up" | "down";
  variant?: "brand" | "danger";
  active?: boolean;
  onClick: () => void;
}) {
  const DeltaIcon = deltaTone === "up" ? TrendingUp : TrendingDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        styles.statCard,
        variant === "brand" ? styles.statCardBrand : "",
        variant === "danger" ? styles.statCardDanger : "",
        active ? styles.statCardActive : "",
      ].filter(Boolean).join(" ")}
    >
      <span className={styles.statCardLabel}>
        <Icon size={11} aria-hidden /> {label}
      </span>
      <span className={`${styles.statCardValue} ${styles.mono}`}>{value}</span>
      <span
        className={[
          styles.statCardDelta,
          deltaTone === "up" ? styles.statCardDeltaUp : "",
          deltaTone === "down" ? styles.statCardDeltaDown : "",
        ].filter(Boolean).join(" ")}
      >
        <DeltaIcon size={11} aria-hidden /> {deltaText}
      </span>
    </button>
  );
}

function PatientsTable({
  patients, loading, search, columnsVisible, selected, allSelected,
  focusedIdx, sortCol, sortDir, onSort, onToggleAll, onToggleOne,
}: {
  patients: PatientRow[];
  loading: boolean;
  search: string;
  columnsVisible: ColumnId[];
  selected: Set<string>;
  allSelected: boolean;
  focusedIdx: number;
  sortCol: SortCol;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
  onToggleAll: () => void;
  onToggleOne: (id: string, idx: number, withShift: boolean) => void;
}) {
  if (loading && patients.length === 0) {
    return (
      <div className={styles.tableWrap}>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className={styles.skeletonRow} />)}
      </div>
    );
  }
  if (patients.length === 0) {
    return (
      <div className={styles.tableWrap}>
        <div className={styles.empty}>
          <Users size={28} style={{ opacity: 0.3, marginBottom: 8 }} aria-hidden />
          <div>Sin pacientes que coincidan con los filtros.</div>
        </div>
      </div>
    );
  }
  const visibleCol = (id: ColumnId) => columnsVisible.includes(id);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colCheckbox}>
              <span
                className={`${styles.checkbox} ${allSelected ? styles.checkboxChecked : ""}`}
                role="checkbox"
                aria-checked={allSelected}
                onClick={onToggleAll}
              >
                {allSelected && "✓"}
              </span>
            </th>
            {visibleCol("patient") && <SortHeader label="Paciente" col="name" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("contact") && <th>Contacto</th>}
            {visibleCol("lastVisit") && <SortHeader label="Última visita" col="lastVisit" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("nextAppointment") && <SortHeader label="Próxima cita" col="nextAppointment" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("balance") && <SortHeader label="Saldo" col="balance" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("doctor") && <th>Doctor</th>}
            {visibleCol("tags") && <th>Etiquetas</th>}
            {visibleCol("status") && <th>Estado</th>}
            <th className={styles.colActions}></th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p, idx) => (
            <PatientRowComp
              key={p.id}
              patient={p}
              idx={idx}
              search={search}
              columnsVisible={columnsVisible}
              isSelected={selected.has(p.id)}
              isFocused={focusedIdx === idx}
              onToggle={onToggleOne}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label, col, sortCol, sortDir, onSort,
}: {
  label: string;
  col: SortCol;
  sortCol: SortCol;
  sortDir: SortDir;
  onSort: (c: SortCol) => void;
}) {
  const isActive = sortCol === col;
  return (
    <th
      className={`${styles.thSortable} ${isActive ? styles.thSorted : ""}`}
      onClick={() => onSort(col)}
    >
      {label}
      <ChevronDown
        size={11}
        aria-hidden
        className={`${styles.sortIcon} ${isActive ? styles.sortIconActive : ""} ${isActive && sortDir === "asc" ? styles.sortIconDesc : ""}`}
      />
    </th>
  );
}

function PatientRowComp({
  patient: p, idx, search, columnsVisible, isSelected, isFocused, onToggle,
}: {
  patient: PatientRow;
  idx: number;
  search: string;
  columnsVisible: ColumnId[];
  isSelected: boolean;
  isFocused: boolean;
  onToggle: (id: string, idx: number, withShift: boolean) => void;
}) {
  const router = useRouter();
  const visibleCol = (id: ColumnId) => columnsVisible.includes(id);
  const lastVisit = formatRelative(p.lastVisit);
  const nextApt = p.nextAppointment ? formatRelative(p.nextAppointment.startsAt) : null;

  const handleRowClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-row]")) return;
    if (target.tagName === "INPUT" || target.tagName === "BUTTON" || target.closest("button") || target.closest("a")) return;
    router.push(`/dashboard/patients/${p.id}`);
  };

  return (
    <tr
      className={`${isSelected ? styles.rowSelected : ""} ${isFocused ? styles.rowFocused : ""}`}
      onClick={handleRowClick}
      style={{ cursor: "pointer" }}
    >
      <td className={styles.colCheckbox} data-no-row>
        <span
          className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ""}`}
          role="checkbox"
          aria-checked={isSelected}
          onClick={(e) => { e.stopPropagation(); onToggle(p.id, idx, e.shiftKey); }}
        >
          {isSelected && "✓"}
        </span>
      </td>
      {visibleCol("patient") && (
        <td>
          <div className={styles.patientCell}>
            <span className={styles.avatar}>
              {initials(p)}
              {p.isVip && <span className={styles.vipBadge}><Star size={8} fill="currentColor" /></span>}
            </span>
            <span className={styles.patientInfo}>
              <span className={styles.patientName}>{highlightMatch(p.fullName, search)}</span>
              <span className={styles.patientMeta}>
                {p.patientNumber}
                {p.age != null && ` · ${p.age} años`}
                {p.gender !== "OTHER" && ` · ${p.gender === "MALE" ? "M" : "F"}`}
              </span>
            </span>
          </div>
        </td>
      )}
      {visibleCol("contact") && (
        <td>
          <div className={styles.contactCell}>
            {p.phone && <div className={styles.contactPhone}>{highlightMatch(p.phone, search)}</div>}
            {p.email && <div className={styles.contactEmail}>{highlightMatch(p.email, search)}</div>}
          </div>
        </td>
      )}
      {visibleCol("lastVisit") && (
        <td className={lastVisit.tone === "recent" ? styles.visitRecent : lastVisit.tone === "old" ? styles.visitOld : styles.visitNever}>
          {lastVisit.text}
        </td>
      )}
      {visibleCol("nextAppointment") && (
        <td className={nextApt ? styles.upcomingApt : styles.visitNever}>
          {nextApt ? nextApt.text : "—"}
        </td>
      )}
      {visibleCol("balance") && (
        <td className={p.balance > 0 ? styles.balanceNegative : styles.balanceZero}>
          {p.balance > 0 ? formatMoney(p.balance) : "—"}
        </td>
      )}
      {visibleCol("doctor") && (
        <td>
          {p.assignedDoctor ? (
            <div className={styles.doctorCell}>
              <span
                className={styles.doctorAvatar}
                style={{ background: p.assignedDoctor.color ?? "var(--brand)" }}
              >
                {p.assignedDoctor.firstName[0] ?? ""}
              </span>
              <span className={styles.doctorName}>Dr/a. {p.assignedDoctor.lastName}</span>
            </div>
          ) : (
            <span className={styles.visitNever}>—</span>
          )}
        </td>
      )}
      {visibleCol("tags") && (
        <td>
          <div className={styles.tagsCell}>
            {p.tags.slice(0, 3).map((t) => (
              <span key={t} className={`${styles.tag} ${getTagClass(t)}`}>{t}</span>
            ))}
            {p.tags.length > 3 && <span className={styles.tag}>+{p.tags.length - 3}</span>}
          </div>
        </td>
      )}
      {visibleCol("status") && (
        <td>
          <span className={`${styles.statusPill} ${
            p.status === "ACTIVE" ? styles.statusActive :
            p.status === "INACTIVE" ? styles.statusInactive : styles.statusArchived
          }`}>
            {p.status === "ACTIVE" ? "Activo" : p.status === "INACTIVE" ? "Inactivo" : "Archivado"}
          </span>
        </td>
      )}
      <td className={styles.colActions} data-no-row>
        <div className={styles.actions}>
          {p.phone && (
            <a
              href={`https://wa.me/${p.phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.actionBtn} ${styles.actionWa}`}
              title="WhatsApp"
              onClick={(e) => e.stopPropagation()}
            >
              <MessageCircle size={13} aria-hidden />
            </a>
          )}
          {p.phone && (
            <a
              href={`tel:${p.phone}`}
              className={`${styles.actionBtn} ${styles.actionCall}`}
              title="Llamar"
              onClick={(e) => e.stopPropagation()}
            >
              <Phone size={13} aria-hidden />
            </a>
          )}
          <Link
            href={`/dashboard/agenda?newAppointment=1&patientId=${p.id}`}
            className={`${styles.actionBtn} ${styles.actionCal}`}
            title="Agendar"
            onClick={(e) => e.stopPropagation()}
          >
            <Calendar size={13} aria-hidden />
          </Link>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionVip} ${p.isVip ? styles.actionVipActive : ""}`}
            title={p.isVip ? "Quitar VIP" : "Marcar VIP"}
            onClick={(e) => {
              e.stopPropagation();
              const newTags = p.isVip ? p.tags.filter((t) => t !== "VIP") : [...p.tags, "VIP"];
              fetch(`/api/patients/${p.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tags: newTags }),
              })
                .then((r) => { if (r.ok) toast.success(p.isVip ? "VIP removido" : "Marcado VIP"); })
                .catch(() => toast.error("Error"));
            }}
          >
            <Star size={13} fill={p.isVip ? "currentColor" : "none"} aria-hidden />
          </button>
          <Link
            href={`/dashboard/patients/${p.id}`}
            className={styles.actionView}
            onClick={(e) => e.stopPropagation()}
          >
            Ver <ArrowRight size={11} aria-hidden />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function PatientsGrid({
  patients, loading, search, selected, onToggleOne,
}: {
  patients: PatientRow[];
  loading: boolean;
  search: string;
  selected: Set<string>;
  onToggleOne: (id: string, idx: number, withShift: boolean) => void;
}) {
  if (loading && patients.length === 0) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.skeletonRow} style={{ height: 200, borderRadius: 14 }} />
        ))}
      </div>
    );
  }
  if (patients.length === 0) {
    return (
      <div className={styles.empty}>
        <Users size={28} style={{ opacity: 0.3, marginBottom: 8 }} aria-hidden />
        <div>Sin pacientes que coincidan con los filtros.</div>
      </div>
    );
  }
  return (
    <div className={styles.grid}>
      {patients.map((p, idx) => {
        const lastVisit = formatRelative(p.lastVisit);
        const nextApt = p.nextAppointment ? formatRelative(p.nextAppointment.startsAt) : null;
        const isSelected = selected.has(p.id);
        return (
          <Link
            key={p.id}
            href={`/dashboard/patients/${p.id}`}
            className={`${styles.gridCard} ${isSelected ? styles.gridCardSelected : ""}`}
          >
            <div className={styles.gridTop}>
              <span className={`${styles.avatar} ${styles.avatarLg}`}>
                {initials(p)}
                {p.isVip && <span className={styles.vipBadge}><Star size={9} fill="currentColor" /></span>}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className={styles.gridName}>{highlightMatch(p.fullName, search)}</h3>
                <span className={styles.gridMeta}>
                  {p.patientNumber}
                  {p.age != null && ` · ${p.age} años`}
                  {p.gender !== "OTHER" && ` · ${p.gender === "MALE" ? "M" : "F"}`}
                </span>
              </div>
              <span
                className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ""}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleOne(p.id, idx, e.shiftKey); }}
                role="checkbox"
                aria-checked={isSelected}
              >
                {isSelected && "✓"}
              </span>
            </div>
            {p.tags.length > 0 && (
              <div className={styles.gridTags}>
                {p.tags.slice(0, 3).map((t) => (
                  <span key={t} className={`${styles.tag} ${getTagClass(t)}`}>{t}</span>
                ))}
              </div>
            )}
            <div className={styles.gridInfo}>
              <div className={styles.gridInfoCell}>
                <span className={styles.gridInfoLabel}>Próxima cita</span>
                <span className={styles.gridInfoValue} style={nextApt ? { color: "var(--brand)", fontWeight: 700 } : { color: "var(--text-3)" }}>
                  {nextApt ? nextApt.text : "—"}
                </span>
              </div>
              <div className={styles.gridInfoCell}>
                <span className={styles.gridInfoLabel}>Última visita</span>
                <span className={styles.gridInfoValue} style={{ color: lastVisit.tone === "recent" ? "var(--green)" : "var(--text-2)" }}>
                  {lastVisit.text}
                </span>
              </div>
              <div className={styles.gridInfoCell}>
                <span className={styles.gridInfoLabel}>Saldo</span>
                <span className={`${styles.gridInfoValue} ${styles.mono}`} style={p.balance > 0 ? { color: "var(--red)", fontWeight: 700 } : { color: "var(--text-4)" }}>
                  {p.balance > 0 ? formatMoney(p.balance) : "—"}
                </span>
              </div>
              <div className={styles.gridInfoCell}>
                <span className={styles.gridInfoLabel}>Doctor</span>
                <span className={styles.gridInfoValue}>
                  {p.assignedDoctor ? `Dr/a. ${p.assignedDoctor.lastName}` : "—"}
                </span>
              </div>
            </div>
            <div className={styles.gridActions}>
              {p.phone && (
                <a
                  href={`https://wa.me/${p.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.actionBtn} ${styles.actionWa}`}
                  onClick={(e) => e.stopPropagation()}
                  title="WhatsApp"
                >
                  <MessageCircle size={13} aria-hidden />
                </a>
              )}
              {p.phone && (
                <a
                  href={`tel:${p.phone}`}
                  className={`${styles.actionBtn} ${styles.actionCall}`}
                  onClick={(e) => e.stopPropagation()}
                  title="Llamar"
                >
                  <Phone size={13} aria-hidden />
                </a>
              )}
              <span style={{ flex: 1 }} />
              <span className={styles.actionView}>
                Ver <ArrowRight size={11} aria-hidden />
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

interface DrawerDrafts {
  ageMin: string;
  ageMax: string;
  genders: string[];
  doctorId: string;
  tags: string[];
  hasDebt: "any" | "yes" | "no";
  visitFrom: string;
  visitTo: string;
}

function FilterDrawer({
  drafts, setDrafts, doctors, onApply, onClear, onClose,
}: {
  drafts: DrawerDrafts;
  setDrafts: (d: DrawerDrafts) => void;
  doctors: Doctor[];
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const toggleArray = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <>
      <div className={styles.drawerBackdrop} onClick={onClose} />
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-drawer-title"
      >
        <header className={styles.drawerHeader}>
          <h3 id="filter-drawer-title" className={styles.drawerTitle}>Filtros avanzados</h3>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={onClose} aria-label="Cerrar">
            <X size={14} aria-hidden />
          </button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>Edad</span>
            <div className={styles.rangeRow}>
              <input
                type="number"
                className={styles.drawerInput}
                placeholder="Mín"
                value={drafts.ageMin}
                onChange={(e) => setDrafts({ ...drafts, ageMin: e.target.value })}
              />
              <span style={{ color: "var(--text-3)" }}>–</span>
              <input
                type="number"
                className={styles.drawerInput}
                placeholder="Máx"
                value={drafts.ageMax}
                onChange={(e) => setDrafts({ ...drafts, ageMax: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>Género</span>
            <div className={styles.checkRow}>
              {[
                { v: "MALE", l: "Masculino" },
                { v: "FEMALE", l: "Femenino" },
                { v: "OTHER", l: "Otro" },
              ].map((g) => (
                <button
                  key={g.v}
                  type="button"
                  className={`${styles.checkPill} ${drafts.genders.includes(g.v) ? styles.checkPillActive : ""}`}
                  onClick={() => setDrafts({ ...drafts, genders: toggleArray(drafts.genders, g.v) })}
                >
                  {g.l}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>Doctor asignado</span>
            <select
              className={styles.drawerInput}
              value={drafts.doctorId}
              onChange={(e) => setDrafts({ ...drafts, doctorId: e.target.value })}
            >
              <option value="">Todos los doctores</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  Dr/a. {d.firstName} {d.lastName}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>Etiquetas clínicas</span>
            <div className={styles.checkRow}>
              {["VIP", "Alergia", "Crónico", "Embarazo", "Pediátrico", "Nuevo"].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.checkPill} ${drafts.tags.includes(t) ? styles.checkPillActive : ""}`}
                  onClick={() => setDrafts({ ...drafts, tags: toggleArray(drafts.tags, t) })}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>Última visita — desde / hasta</span>
            <div className={styles.rangeRow}>
              <input
                type="date"
                className={styles.drawerInput}
                value={drafts.visitFrom}
                onChange={(e) => setDrafts({ ...drafts, visitFrom: e.target.value })}
              />
              <span style={{ color: "var(--text-3)" }}>–</span>
              <input
                type="date"
                className={styles.drawerInput}
                value={drafts.visitTo}
                onChange={(e) => setDrafts({ ...drafts, visitTo: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>Saldo</span>
            <select
              className={styles.drawerInput}
              value={drafts.hasDebt}
              onChange={(e) => setDrafts({ ...drafts, hasDebt: e.target.value as "any" | "yes" | "no" })}
            >
              <option value="any">Cualquiera</option>
              <option value="yes">Con deuda</option>
              <option value="no">En cero</option>
            </select>
          </div>
        </div>
        <div className={styles.drawerFooter}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClear} style={{ flex: 1 }}>
            Limpiar
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onApply} style={{ flex: 2 }}>
            Aplicar filtros
          </button>
        </div>
      </aside>
    </>
  );
}
