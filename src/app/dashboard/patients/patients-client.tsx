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
  Upload,
  Trash2,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Building2,
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { NewPatientModal } from "@/components/dashboard/new-patient-modal";
import { ImportWizard } from "@/components/import/import-wizard";
import { DateField } from "@/components/ui/date-field";
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
  source: string | null;
  lifecycleStage: string | null;
  /**
   * MULTI-CLÍNICA · FASE 2 — nombre de la sede de ORIGEN cuando el paciente
   * viene prestado de otra sucursal vinculada. null para los propios. Lo
   * resuelve el server (/api/patients?v=2); el cliente sólo lo pinta.
   */
  originClinicName?: string | null;
  createdAt: string;
}

/**
 * MULTI-CLÍNICA · FASE 2 — chip "este paciente es de la sede X".
 *
 * Sólo aparece cuando el paciente viene prestado de otra sucursal vinculada,
 * para que el doctor sepa de dónde salió el expediente que está viendo.
 * Estilo alineado con el chip "Prospecto" de la vista grid; responsive por
 * `maxWidth: 100%` + ellipsis (los nombres de sede pueden ser largos).
 */
function BranchOriginBadge({ name }: { name: string }) {
  const t = useT();
  return (
    <span
      title={t("patients.row.fromBranch", { name })}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        marginTop: 3,
        maxWidth: "100%",
        fontSize: 10,
        fontWeight: 700,
        color: "var(--text-3)",
        border: "1px solid var(--border-strong)",
        borderRadius: 6,
        padding: "1px 6px",
        lineHeight: 1.5,
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      <Building2 size={9} style={{ flexShrink: 0 }} aria-hidden />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
    </span>
  );
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

// Fuentes de adquisición — mismos valores que el modal de nuevo paciente.
// Son valores funcionales (se envían a la API como filtro), en español.
const SOURCE_OPTIONS = [
  "Recomendación",
  "Google",
  "Instagram/Facebook",
  "Pasó por la clínica",
  "Sitio web",
  "Otro",
];

// `labelKey` resuelve vía t(labelKey) en tiempo de render (nunca t() en módulo).
const ALL_COLUMNS: Array<{ id: ColumnId; labelKey: string; required?: boolean }> = [
  { id: "patient", labelKey: "patients.list.colPatient", required: true },
  { id: "contact", labelKey: "patients.list.colContact" },
  { id: "lastVisit", labelKey: "patients.list.colLastVisit" },
  { id: "nextAppointment", labelKey: "patients.list.colNextAppointment" },
  { id: "balance", labelKey: "patients.list.colBalance" },
  { id: "doctor", labelKey: "patients.list.colDoctor" },
  { id: "tags", labelKey: "patients.list.colTags" },
  { id: "status", labelKey: "patients.list.colStatus" },
];
const DEFAULT_VISIBLE: ColumnId[] = ALL_COLUMNS.map((c) => c.id);

// Rampa violeta suave para avatares de iniciales (solo presentación):
// tinte determinístico por índice de fila, como AV_TINTS del prototipo.
const AVATAR_TINTS = [styles.avatarT0, styles.avatarT1, styles.avatarT2, styles.avatarT3];

/* ─── Helpers ─── */

function initials(p: { firstName: string; lastName: string }): string {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}
// Recibe `t` (no se llama t() en módulo): el texto relativo se localiza en render.
function formatRelative(iso: string | null, t: TFunction): {
  text: string;
  tone: "recent" | "old" | "never" | "future";
} {
  if (!iso) return { text: t("patients.relative.never"), tone: "never" };
  const date = new Date(iso);
  const diff = date.getTime() - Date.now();
  const absDays = Math.floor(Math.abs(diff) / (1000 * 60 * 60 * 24));
  if (diff > 0) {
    if (absDays === 0) return { text: t("patients.relative.today"), tone: "future" };
    if (absDays === 1) return { text: t("patients.relative.tomorrow"), tone: "future" };
    if (absDays < 7) return { text: t("patients.relative.inDays", { days: absDays }), tone: "future" };
    if (absDays < 30) return { text: t("patients.relative.inWeeks", { weeks: Math.round(absDays / 7) }), tone: "future" };
    return { text: new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(date), tone: "future" };
  }
  if (absDays === 0) return { text: t("patients.relative.today"), tone: "recent" };
  if (absDays === 1) return { text: t("patients.relative.yesterday"), tone: "recent" };
  if (absDays < 30) return { text: t("patients.relative.daysAgo", { days: absDays }), tone: "recent" };
  if (absDays < 365) return { text: t("patients.relative.monthsAgo", { months: Math.round(absDays / 30) }), tone: "old" };
  return { text: t("patients.relative.yearsAgo", { years: Math.floor(absDays / 365) }), tone: "old" };
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
  const t = useT();
  const router = useRouter();
  const askConfirm = useConfirm();

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
  const [advSource, setAdvSource] = useState("");

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
    source: "",
  });

  // Bulk
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastShiftIndexRef = useRef<number | null>(null);

  // Datos
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bump para forzar un refetch de la lista client-fetched sin cambiar filtros/página.
  const [reloadKey, setReloadKey] = useState(0);

  // Modal
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importAssisted, setImportAssisted] = useState(false);

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
    if (advSource) sp.set("source", advSource);
    sp.set("sort", `${sortCol}:${sortDir}`);
    return sp.toString();
  }, [search, statusFilter, quickFilter, advAgeMin, advAgeMax, advGenders, advDoctorId, advTags, advHasDebt, advVisitFrom, advVisitTo, advSource, sortCol, sortDir]);

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
        setError(err instanceof Error ? err.message : t("patients.list.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [queryString, page, reloadKey, t]);

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

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Toggle VIP con update OPTIMISTA: la lista es client-fetched, así que
  // reflejamos el cambio en `data` al instante y revertimos si el PATCH falla.
  const handleToggleVip = useCallback((patientId: string) => {
    const target = data?.patients.find((p) => p.id === patientId);
    if (!target) return;
    const willBeVip = !target.isVip;
    const newTags = target.isVip
      ? target.tags.filter((t) => t !== "VIP")
      : [...target.tags, "VIP"];
    setData((prev) =>
      prev
        ? { ...prev, patients: prev.patients.map((p) => (p.id === patientId ? { ...p, isVip: willBeVip, tags: newTags } : p)) }
        : prev,
    );
    fetch(`/api/patients/${patientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: newTags }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        toast.success(willBeVip ? t("patients.list.markedVip") : t("patients.list.vipRemoved"));
      })
      .catch(() => {
        setData((prev) =>
          prev
            ? { ...prev, patients: prev.patients.map((p) => (p.id === patientId ? { ...p, isVip: target.isVip, tags: target.tags } : p)) }
            : prev,
        );
        toast.error(t("patients.list.vipError"));
      });
  }, [data, t]);

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
          visitFrom: advVisitFrom, visitTo: advVisitTo, source: advSource,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, colsDropdownOpen, selected.size, search, data, focusedIdx, router, toggleView, toggleOne, advAgeMin, advAgeMax, advGenders, advDoctorId, advTags, advHasDebt, advVisitFrom, advVisitTo, advSource]);

  const stats = data?.stats;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, page * PAGE_SIZE);
  const pagesToShow = computePages(page, totalPages);

  // ¿Hay algún filtro/búsqueda activo? Si no, y total === 0, la clínica está
  // vacía de verdad → mostramos el CTA grande de "Importar mi clínica".
  const anyFilterActive =
    Boolean(search) ||
    statusFilter !== "ALL" ||
    quickFilter !== null ||
    Boolean(advAgeMin) || Boolean(advAgeMax) || advGenders.length > 0 ||
    Boolean(advDoctorId) || advTags.length > 0 || advHasDebt !== "any" ||
    Boolean(advVisitFrom) || Boolean(advVisitTo) || Boolean(advSource);
  const showEmptyClinic = !loading && !error && total === 0 && !anyFilterActive;

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
    if (!(await askConfirm({
      title: t("patients.bulk.archiveConfirmTitle", { count: selected.size }),
      description: t("patients.bulk.archiveConfirmDescription"),
      variant: "warning",
      confirmText: t("patients.bulk.archiveConfirmText"),
    }))) return;
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
      toast.success(t("patients.bulk.archivedToast", { count: ids.length }));
      setSelected(new Set());
      setData(null);
      setPage(1);
    } catch {
      toast.error(t("patients.bulk.archiveError"));
    }
  };

  const bulkExportCsv = () => {
    const rows = patients.filter((p) => selected.has(p.id));
    if (rows.length === 0) return;
    const headers = [
      t("patients.export.colId"),
      t("patients.export.colName"),
      t("patients.export.colPhone"),
      t("patients.export.colEmail"),
      t("patients.export.colAge"),
      t("patients.export.colStatus"),
      t("patients.export.colBalance"),
    ];
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
    toast.success(t("patients.export.successToast", { count: rows.length }));
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
    setAdvSource(drDrafts.source);
    setPage(1);
    setDrawerOpen(false);
  };
  const clearDrawer = () => {
    setDrDrafts({ ageMin: "", ageMax: "", genders: [], doctorId: "", tags: [], hasDebt: "any", visitFrom: "", visitTo: "", source: "" });
  };

  return (
    <div className={styles.page}>
      <div className={styles.filtersRow}>
        <div className={styles.pillGroup}>
          {([
            { id: "ALL" as const, label: t("common.all"), count: stats?.total },
            { id: "ACTIVE" as const, label: t("patients.statusFilter.active"), count: stats?.active },
            { id: "INACTIVE" as const, label: t("patients.statusFilter.inactive"), count: stats?.inactive },
            { id: "ARCHIVED" as const, label: t("patients.statusFilter.archived"), count: stats?.archived },
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
            { id: "debt" as QuickFilter, label: t("patients.quickFilter.withDebt"), count: stats?.withDebt },
            { id: "vip" as QuickFilter, label: t("patients.quickFilter.vip") },
            { id: "nextAppt" as QuickFilter, label: t("patients.quickFilter.nextAppointment"), count: stats?.nextAppointmentsWeek },
            { id: "birthdayWeek" as QuickFilter, label: t("patients.quickFilter.birthdayWeek") },
            { id: "noContact6m" as QuickFilter, label: t("patients.quickFilter.noContact6m") },
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
          <Search size={15} strokeWidth={1.75} aria-hidden className={styles.searchIcon} />
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("patients.toolbar.searchPlaceholder")}
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
            title={t("patients.toolbar.viewListTitle")}
          >
            <Rows3 size={13} strokeWidth={1.75} aria-hidden /> {t("patients.toolbar.viewList")}
          </button>
          <button
            type="button"
            className={`${styles.viewToggleBtn} ${view === "grid" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => { setView("grid"); writeJSONLS(VIEW_STORAGE_KEY, "grid"); }}
            title={t("patients.toolbar.viewGridTitle")}
          >
            <LayoutGrid size={13} strokeWidth={1.75} aria-hidden /> {t("patients.toolbar.viewGrid")}
            <kbd>G</kbd>
          </button>
        </div>

        <div className={styles.dropdownWrap}>
          <button type="button" className={styles.btn} onClick={() => setColsDropdownOpen((v) => !v)}>
            <Columns3 size={13} strokeWidth={1.75} aria-hidden /> {t("patients.toolbar.columns")}
            <ChevronDown size={11} strokeWidth={1.75} aria-hidden />
          </button>
          {colsDropdownOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 49 }}
                onClick={() => setColsDropdownOpen(false)}
              />
              <div className={styles.dropdown}>
                <div className={styles.dropdownLabel}>{t("patients.toolbar.showColumns")}</div>
                {ALL_COLUMNS.map((c) => {
                  const inputId = `col-toggle-${c.id}`;
                  return (
                    <label key={c.id} htmlFor={inputId} className={styles.dropdownItem}>
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={columnsVisible.includes(c.id)}
                        disabled={c.required}
                        onChange={() => toggleColumn(c.id)}
                      />
                      <span>{t(c.labelKey)}</span>
                      {c.required && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-4)" }}>{t("patients.toolbar.columnFixed")}</span>}
                    </label>
                  );
                })}
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
              visitFrom: advVisitFrom, visitTo: advVisitTo, source: advSource,
            });
          }}
          title={t("patients.toolbar.moreFiltersTitle")}
        >
          <Filter size={13} strokeWidth={1.75} aria-hidden /> {t("patients.toolbar.moreFilters")}
        </button>

        <span className={styles.toolbarSpacer} />

        <button
          type="button"
          className={styles.btn}
          onClick={() => { setImportAssisted(false); setImportOpen(true); }}
          title={t("shell.importClinic.launch")}
        >
          <Upload size={13} strokeWidth={1.75} aria-hidden /> {t("shell.importClinic.launch")}
        </button>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => setNewPatientOpen(true)}
          title={t("patients.toolbar.newPatientTitle")}
        >
          <Plus size={13} strokeWidth={1.75} aria-hidden /> {t("patients.toolbar.newPatient")}
        </button>
      </div>

      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{t("patients.bulk.selectedCount", { count: selected.size })}</span>
          <button type="button" className={styles.btn} onClick={() => toast(t("patients.bulk.assignTagSoon"))}>
            <Tag size={13} strokeWidth={1.75} aria-hidden /> {t("patients.bulk.assignTag")}
          </button>
          <button type="button" className={styles.btn} onClick={() => toast(t("patients.bulk.assignDoctorSoon"))}>
            <User size={13} strokeWidth={1.75} aria-hidden /> {t("patients.bulk.assignDoctor")}
          </button>
          <span className={styles.bulkDivider} aria-hidden />
          <button type="button" className={styles.btn} onClick={() => toast(t("patients.bulk.whatsappCampaignSoon"))}>
            <MessageCircle size={13} strokeWidth={1.75} aria-hidden /> {t("patients.bulk.whatsappCampaign")}
          </button>
          <button type="button" className={styles.btn} onClick={bulkExportCsv}>
            <Download size={13} strokeWidth={1.75} aria-hidden /> {t("patients.bulk.exportCsv")}
          </button>
          <span className={styles.bulkDivider} aria-hidden />
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={bulkArchive}>
            <Trash2 size={13} strokeWidth={1.75} aria-hidden /> {t("patients.bulk.archive")}
          </button>
          <span className={styles.toolbarSpacer} />
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setSelected(new Set())}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {error ? (
        <div className={styles.empty}>
          <AlertCircle size={28} strokeWidth={1.75} style={{ marginBottom: 8, color: "var(--danger)" }} aria-hidden />
          <div>{t("patients.list.errorPrefix", { message: error })}</div>
        </div>
      ) : showEmptyClinic ? (
        <ImportClinicEmpty
          onImport={() => { setImportAssisted(false); setImportOpen(true); }}
          onAssisted={() => { setImportAssisted(true); setImportOpen(true); }}
        />
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
          onToggleVip={handleToggleVip}
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
            {t("patients.pagination.showing", { from: pageStart.toLocaleString(), to: pageEnd.toLocaleString(), total: total.toLocaleString() })}
          </span>
          <div className={styles.pageControls}>
            <button type="button" className={styles.pageBtn} disabled={page === 1} onClick={() => setPage(1)} title={t("patients.pagination.first")}>
              <ChevronsLeft size={13} strokeWidth={1.75} aria-hidden />
            </button>
            <button type="button" className={styles.pageBtn} disabled={page === 1} onClick={() => setPage((p) => p - 1)} title={t("common.previous")}>
              <ChevronLeft size={13} strokeWidth={1.75} aria-hidden />
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
            <button type="button" className={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} title={t("common.next")}>
              <ChevronRight size={13} strokeWidth={1.75} aria-hidden />
            </button>
            <button type="button" className={styles.pageBtn} disabled={page === totalPages} onClick={() => setPage(totalPages)} title={t("patients.pagination.last")}>
              <ChevronsRight size={13} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className={styles.kbdHints}>
        <kbd>/</kbd>{t("patients.kbdHints.search")} · <kbd>J</kbd>/<kbd>K</kbd>{t("patients.kbdHints.navigate")} · <kbd>↵</kbd>{t("patients.kbdHints.open")} · <kbd>Esc</kbd>{t("patients.kbdHints.clear")} · <kbd>Space</kbd>{t("patients.kbdHints.select")} · <kbd>N</kbd>{t("patients.kbdHints.new")} · <kbd>G</kbd>{t("patients.kbdHints.view")} · <kbd>F</kbd>{t("patients.kbdHints.filters")}
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
          setPage(1);
          // Lista client-fetched: router.refresh() no recarga las filas; forzamos refetch.
          reload();
        }}
      />

      <ImportWizard
        open={importOpen}
        startInAssisted={importAssisted}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          setPage(1);
          reload();
        }}
      />
    </div>
  );
}

/* ─── Sub-componentes ─── */

function ImportClinicEmpty({ onImport, onAssisted }: { onImport: () => void; onAssisted: () => void }) {
  const t = useT();
  return (
    <div className="imp-empty">
      <div className="imp-empty__glyph" aria-hidden><Users size={30} strokeWidth={1.75} /></div>
      <h2 className="imp-empty__title">{t("shell.importClinic.empty.title")}</h2>
      <p className="imp-empty__desc">{t("shell.importClinic.empty.desc")}</p>
      <div className="imp-empty__cta">
        <button type="button" className="btn-new btn-new--primary" style={{ height: 40, padding: "0 18px" }} onClick={onImport}>
          <Upload size={15} strokeWidth={1.75} aria-hidden /> {t("shell.importClinic.launch")}
        </button>
        <button type="button" className="btn-new btn-new--secondary" style={{ height: 40, padding: "0 18px" }} onClick={onAssisted}>
          {t("shell.importClinic.assistedCta")}
        </button>
      </div>
      <p className="imp-empty__hint">{t("shell.importClinic.empty.hint")}</p>
    </div>
  );
}

function HeroStats({
  stats, loading, onClick, activeFilter,
}: {
  stats?: Stats;
  loading: boolean;
  onClick: (kind: "total" | "newMonth" | "debt" | "nextAppt") => void;
  activeFilter: QuickFilter | null;
}) {
  const t = useT();
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className={styles.heroGrid}>
      <StatCard
        label={t("patients.hero.totalPatients")}
        icon={Users}
        value={stats ? fmt(stats.total) : loading ? "…" : "0"}
        deltaText={stats ? t("patients.hero.newThisMonthDelta", { count: stats.newThisMonth }) : ""}
        deltaTone="up"
        onClick={() => onClick("total")}
      />
      <StatCard
        label={t("patients.hero.newThisMonth")}
        icon={TrendingUp}
        value={stats ? fmt(stats.newThisMonth) : "0"}
        deltaText={
          stats && stats.newPctDelta !== 0
            ? t("patients.hero.pctVsPrevMonth", { pct: `${stats.newPctDelta > 0 ? "+" : ""}${stats.newPctDelta}` })
            : t("patients.hero.noChange")
        }
        deltaTone={stats && stats.newPctDelta < 0 ? "down" : "up"}
        variant="brand"
        onClick={() => onClick("newMonth")}
      />
      <StatCard
        label={t("patients.hero.withDebt")}
        icon={AlertCircle}
        value={stats ? formatMoney(stats.withDebtAmount) : "$0"}
        deltaText={stats ? t("patients.hero.patientsCount", { count: stats.withDebt }) : ""}
        deltaTone="down"
        variant="danger"
        active={activeFilter === "debt"}
        onClick={() => onClick("debt")}
      />
      <StatCard
        label={t("patients.hero.nextAppointments")}
        icon={Calendar}
        value={stats ? `${stats.nextAppointmentsToday} / ${stats.nextAppointmentsWeek}` : "0 / 0"}
        deltaText={t("patients.hero.todayThisWeek")}
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
        <Icon size={11} strokeWidth={1.75} aria-hidden /> {label}
      </span>
      <span className={`${styles.statCardValue} ${styles.mono}`}>{value}</span>
      <span
        className={[
          styles.statCardDelta,
          deltaTone === "up" ? styles.statCardDeltaUp : "",
          deltaTone === "down" ? styles.statCardDeltaDown : "",
        ].filter(Boolean).join(" ")}
      >
        <DeltaIcon size={11} strokeWidth={1.75} aria-hidden /> {deltaText}
      </span>
    </button>
  );
}

function PatientsTable({
  patients, loading, search, columnsVisible, selected, allSelected,
  focusedIdx, sortCol, sortDir, onSort, onToggleAll, onToggleOne, onToggleVip,
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
  onToggleVip: (id: string) => void;
}) {
  const t = useT();
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
          <Users size={28} strokeWidth={1.75} style={{ opacity: 0.3, marginBottom: 8 }} aria-hidden />
          <div>{t("patients.list.emptyFiltered")}</div>
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
              {/* Checkbox real (no <span role>): accesible por teclado
                  con Tab + Space, anuncia estado a lectores de pantalla. */}
              <input
                type="checkbox"
                className={styles.bulkCheckbox}
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={t("patients.list.selectAll")}
              />
            </th>
            {visibleCol("patient") && <SortHeader label={t("patients.list.colPatient")} col="name" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("contact") && <th>{t("patients.list.colContact")}</th>}
            {visibleCol("lastVisit") && <SortHeader label={t("patients.list.colLastVisit")} col="lastVisit" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("nextAppointment") && <SortHeader label={t("patients.list.colNextAppointment")} col="nextAppointment" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("balance") && <SortHeader label={t("patients.list.colBalance")} col="balance" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />}
            {visibleCol("doctor") && <th>{t("patients.list.colDoctor")}</th>}
            {visibleCol("tags") && <th>{t("patients.list.colTags")}</th>}
            {visibleCol("status") && <th>{t("patients.list.colStatus")}</th>}
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
              onToggleVip={onToggleVip}
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
      className={`${styles.thSortable} ${isActive ? styles.thSorted : ""} ${col === "balance" ? styles.thNum : ""}`}
      onClick={() => onSort(col)}
    >
      {label}
      <ChevronDown
        size={11}
        strokeWidth={1.75}
        aria-hidden
        className={`${styles.sortIcon} ${isActive ? styles.sortIconActive : ""} ${isActive && sortDir === "asc" ? styles.sortIconDesc : ""}`}
      />
    </th>
  );
}

function PatientRowComp({
  patient: p, idx, search, columnsVisible, isSelected, isFocused, onToggle, onToggleVip,
}: {
  patient: PatientRow;
  idx: number;
  search: string;
  columnsVisible: ColumnId[];
  isSelected: boolean;
  isFocused: boolean;
  onToggle: (id: string, idx: number, withShift: boolean) => void;
  onToggleVip: (id: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const visibleCol = (id: ColumnId) => columnsVisible.includes(id);
  const lastVisit = formatRelative(p.lastVisit, t);
  const nextApt = p.nextAppointment ? formatRelative(p.nextAppointment.startsAt, t) : null;

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
        {/* Checkbox real con name accesible. onClick captura shiftKey
            para multi-selección rango (mouse). Con teclado el toggle
            es individual via Space, que es comportamiento estándar. */}
        <input
          type="checkbox"
          className={styles.bulkCheckbox}
          checked={isSelected}
          onChange={() => { /* controlled — onClick maneja la lógica */ }}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(p.id, idx, e.shiftKey);
          }}
          aria-label={t("patients.row.selectPatient", { name: `${p.firstName} ${p.lastName}` })}
        />
      </td>
      {visibleCol("patient") && (
        <td>
          <div className={styles.patientCell}>
            <span className={`${styles.avatar} ${AVATAR_TINTS[idx % AVATAR_TINTS.length]}`}>
              {initials(p)}
              {p.isVip && <span className={styles.vipBadge}><Star size={8} strokeWidth={1.75} fill="currentColor" /></span>}
            </span>
            <span className={styles.patientInfo}>
              <span className={styles.patientName}>{highlightMatch(p.fullName, search)}</span>
              <span className={styles.patientMeta}>
                {p.patientNumber}
                {p.age != null && ` · ${t("patients.row.yearsOld", { age: p.age })}`}
                {p.gender !== "OTHER" && ` · ${p.gender === "MALE" ? "M" : "F"}`}
              </span>
              {/* FASE 2 — el paciente vive en otra sede vinculada. Va en su
                  propia línea (patientInfo apila) para no romper el ellipsis
                  del nombre en pantallas chicas. */}
              {p.originClinicName && <BranchOriginBadge name={p.originClinicName} />}
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
              <span className={styles.doctorName}>{t("patients.row.doctorPrefix")} {p.assignedDoctor.lastName}</span>
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
            {p.status === "ACTIVE" ? t("patients.status.active") : p.status === "INACTIVE" ? t("patients.status.inactive") : t("patients.status.archived")}
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
              title={t("patients.row.whatsapp")}
              onClick={(e) => e.stopPropagation()}
            >
              <MessageCircle size={13} strokeWidth={1.75} aria-hidden />
            </a>
          )}
          {p.phone && (
            <a
              href={`tel:${p.phone}`}
              className={`${styles.actionBtn} ${styles.actionCall}`}
              title={t("patients.row.call")}
              onClick={(e) => e.stopPropagation()}
            >
              <Phone size={13} strokeWidth={1.75} aria-hidden />
            </a>
          )}
          <Link
            href={`/dashboard/agenda?newAppointment=1&patientId=${p.id}`}
            className={`${styles.actionBtn} ${styles.actionCal}`}
            title={t("patients.row.schedule")}
            onClick={(e) => e.stopPropagation()}
          >
            <Calendar size={13} strokeWidth={1.75} aria-hidden />
          </Link>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionVip} ${p.isVip ? styles.actionVipActive : ""}`}
            title={p.isVip ? t("patients.row.removeVip") : t("patients.row.markVip")}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVip(p.id);
            }}
          >
            <Star size={13} strokeWidth={1.75} fill={p.isVip ? "currentColor" : "none"} aria-hidden />
          </button>
          <Link
            href={`/dashboard/patients/${p.id}`}
            className={styles.actionView}
            onClick={(e) => e.stopPropagation()}
          >
            {t("common.view")} <ArrowRight size={11} strokeWidth={1.75} aria-hidden />
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
  const t = useT();
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
        <Users size={28} strokeWidth={1.75} style={{ opacity: 0.3, marginBottom: 8 }} aria-hidden />
        <div>{t("patients.list.emptyFiltered")}</div>
      </div>
    );
  }
  return (
    <div className={styles.grid}>
      {patients.map((p, idx) => {
        const lastVisit = formatRelative(p.lastVisit, t);
        const nextApt = p.nextAppointment ? formatRelative(p.nextAppointment.startsAt, t) : null;
        const isSelected = selected.has(p.id);
        return (
          <Link
            key={p.id}
            href={`/dashboard/patients/${p.id}`}
            className={`${styles.gridCard} ${isSelected ? styles.gridCardSelected : ""}`}
          >
            <div className={styles.gridTop}>
              <span className={`${styles.avatar} ${styles.avatarLg} ${AVATAR_TINTS[idx % AVATAR_TINTS.length]}`}>
                {initials(p)}
                {p.isVip && <span className={styles.vipBadge}><Star size={9} strokeWidth={1.75} fill="currentColor" /></span>}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className={styles.gridName}>
                  {highlightMatch(p.fullName, search)}
                  {p.lifecycleStage === "prospect" && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--brand)", background: "var(--brand-softer)", border: "1px solid var(--brand-soft)", borderRadius: 6, padding: "1px 6px", verticalAlign: "middle" }}>
                      Prospecto
                    </span>
                  )}
                </h3>
                <span className={styles.gridMeta}>
                  {p.patientNumber}
                  {p.age != null && ` · ${t("patients.row.yearsOld", { age: p.age })}`}
                  {p.gender !== "OTHER" && ` · ${p.gender === "MALE" ? "M" : "F"}`}
                  {p.source && ` · ${p.source}`}
                </span>
                {/* FASE 2 — sede de origen del paciente prestado. */}
                {p.originClinicName && <BranchOriginBadge name={p.originClinicName} />}
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
                <span className={styles.gridInfoLabel}>{t("patients.list.colNextAppointment")}</span>
                <span className={styles.gridInfoValue} style={nextApt ? { color: "var(--brand)", fontWeight: 700 } : { color: "var(--text-3)" }}>
                  {nextApt ? nextApt.text : "—"}
                </span>
              </div>
              <div className={styles.gridInfoCell}>
                <span className={styles.gridInfoLabel}>{t("patients.list.colLastVisit")}</span>
                <span className={styles.gridInfoValue} style={{ color: lastVisit.tone === "recent" ? "var(--green)" : "var(--text-2)" }}>
                  {lastVisit.text}
                </span>
              </div>
              <div className={styles.gridInfoCell}>
                <span className={styles.gridInfoLabel}>{t("patients.list.colBalance")}</span>
                <span className={`${styles.gridInfoValue} ${styles.mono}`} style={p.balance > 0 ? { color: "var(--red)", fontWeight: 700 } : { color: "var(--text-4)" }}>
                  {p.balance > 0 ? formatMoney(p.balance) : "—"}
                </span>
              </div>
              <div className={styles.gridInfoCell}>
                <span className={styles.gridInfoLabel}>{t("patients.list.colDoctor")}</span>
                <span className={styles.gridInfoValue}>
                  {p.assignedDoctor ? `${t("patients.row.doctorPrefix")} ${p.assignedDoctor.lastName}` : "—"}
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
                  title={t("patients.row.whatsapp")}
                >
                  <MessageCircle size={13} strokeWidth={1.75} aria-hidden />
                </a>
              )}
              {p.phone && (
                <a
                  href={`tel:${p.phone}`}
                  className={`${styles.actionBtn} ${styles.actionCall}`}
                  onClick={(e) => e.stopPropagation()}
                  title={t("patients.row.call")}
                >
                  <Phone size={13} strokeWidth={1.75} aria-hidden />
                </a>
              )}
              <span style={{ flex: 1 }} />
              <span className={styles.actionView}>
                {t("common.view")} <ArrowRight size={11} strokeWidth={1.75} aria-hidden />
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
  source: string;
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
  const t = useT();
  const toggleArray = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  // Las etiquetas clínicas son VALORES funcionales (se envían a la API y se
  // comparan contra los tags almacenados en BD, en español): el value no cambia,
  // solo se localiza la ETIQUETA visible vía labelKey.
  const CLINICAL_TAGS: Array<{ value: string; labelKey: string }> = [
    { value: "VIP", labelKey: "patients.drawer.tagVip" },
    { value: "Alergia", labelKey: "patients.drawer.tagAllergy" },
    { value: "Crónico", labelKey: "patients.drawer.tagChronic" },
    { value: "Embarazo", labelKey: "patients.drawer.tagPregnancy" },
    { value: "Pediátrico", labelKey: "patients.drawer.tagPediatric" },
    { value: "Nuevo", labelKey: "patients.drawer.tagNew" },
  ];

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
          <h3 id="filter-drawer-title" className={styles.drawerTitle}>{t("patients.drawer.title")}</h3>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={onClose} aria-label={t("common.close")}>
            <X size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>{t("patients.drawer.age")}</span>
            <div className={styles.rangeRow}>
              <input
                type="number"
                className={styles.drawerInput}
                placeholder={t("patients.drawer.min")}
                value={drafts.ageMin}
                onChange={(e) => setDrafts({ ...drafts, ageMin: e.target.value })}
              />
              <span style={{ color: "var(--text-3)" }}>–</span>
              <input
                type="number"
                className={styles.drawerInput}
                placeholder={t("patients.drawer.max")}
                value={drafts.ageMax}
                onChange={(e) => setDrafts({ ...drafts, ageMax: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>{t("patients.drawer.gender")}</span>
            <div className={styles.checkRow}>
              {[
                { v: "MALE", l: t("patients.drawer.genderMale") },
                { v: "FEMALE", l: t("patients.drawer.genderFemale") },
                { v: "OTHER", l: t("patients.drawer.genderOther") },
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
            <span className={styles.drawerLabel}>{t("patients.drawer.assignedDoctor")}</span>
            <select
              className={styles.drawerInput}
              value={drafts.doctorId}
              onChange={(e) => setDrafts({ ...drafts, doctorId: e.target.value })}
            >
              <option value="">{t("patients.drawer.allDoctors")}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {t("patients.row.doctorPrefix")} {d.firstName} {d.lastName}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>Fuente</span>
            <select
              className={styles.drawerInput}
              value={drafts.source}
              onChange={(e) => setDrafts({ ...drafts, source: e.target.value })}
            >
              <option value="">Todas las fuentes</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>{t("patients.drawer.clinicalTags")}</span>
            <div className={styles.checkRow}>
              {CLINICAL_TAGS.map((tag) => (
                <button
                  key={tag.value}
                  type="button"
                  className={`${styles.checkPill} ${drafts.tags.includes(tag.value) ? styles.checkPillActive : ""}`}
                  onClick={() => setDrafts({ ...drafts, tags: toggleArray(drafts.tags, tag.value) })}
                >
                  {t(tag.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>{t("patients.drawer.lastVisitRange")}</span>
            <div className={styles.rangeRow}>
              <DateField
                className={styles.drawerInput}
                value={drafts.visitFrom}
                onChange={(e) => setDrafts({ ...drafts, visitFrom: e.target.value })}
              />
              <span style={{ color: "var(--text-3)" }}>–</span>
              <DateField
                className={styles.drawerInput}
                value={drafts.visitTo}
                onChange={(e) => setDrafts({ ...drafts, visitTo: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.drawerSection}>
            <span className={styles.drawerLabel}>{t("patients.list.colBalance")}</span>
            <select
              className={styles.drawerInput}
              value={drafts.hasDebt}
              onChange={(e) => setDrafts({ ...drafts, hasDebt: e.target.value as "any" | "yes" | "no" })}
            >
              <option value="any">{t("patients.drawer.debtAny")}</option>
              <option value="yes">{t("patients.drawer.debtYes")}</option>
              <option value="no">{t("patients.drawer.debtZero")}</option>
            </select>
          </div>
        </div>
        <div className={styles.drawerFooter}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClear} style={{ flex: 1 }}>
            {t("common.clear")}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onApply} style={{ flex: 2 }}>
            {t("patients.drawer.applyFilters")}
          </button>
        </div>
      </aside>
    </>
  );
}
