"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Bath,
  BedDouble,
  Building2,
  ChevronDown,
  Copy,
  ExternalLink,
  FileDown,
  Filter,
  ImageOff,
  LayoutGrid,
  Link2,
  Loader2,
  MapPin,
  Maximize,
  Plus,
  Rows3,
  Search,
  View,
  X,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { RealtyMode, RealtyPropertyStatus } from "@/lib/realty/types";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  REALTY_PROPERTY_STATUS_UI,
} from "@/lib/realty/types";
import type {
  RealtyPropertyFacets,
  RealtyPropertyListItem,
  RealtyPropertyPage,
  RealtyPropertySort,
} from "@/lib/realty/properties-shared";
import {
  REALTY_EXCLUSIVE_WARN_DAYS,
  REALTY_PROPERTY_SORTS,
} from "@/lib/realty/properties-shared";
import {
  apiCall,
  Badge,
  Field,
  formatNumber,
  formatPrice,
  Modal,
  styles as s,
  useRealtyT,
} from "./ui";

/**
 * /inmobiliaria/inmuebles — la cartera.
 *
 * El servidor pinta la PRIMERA página (para que la pantalla abra con datos
 * y no con un esqueleto) y a partir de ahí el cliente pide por API. El
 * paginado, el orden y los filtros se resuelven SIEMPRE en el servidor:
 * una inmobiliaria con 3 000 inmuebles no puede traérselos al navegador
 * para filtrarlos en memoria.
 *
 * 🔴 MODO OWNER: un rentista administra lo SUYO — no hay asesor a quien
 * asignarle el inmueble ni comisión que repartir. Las dos columnas
 * desaparecen; no se pintan vacías.
 */

const KINDS = Object.keys(REALTY_PROPERTY_KIND_LABELS) as Array<
  keyof typeof REALTY_PROPERTY_KIND_LABELS
>;
const STATUSES = Object.keys(REALTY_PROPERTY_STATUS_UI) as RealtyPropertyStatus[];

type ViewMode = "table" | "cards";

interface FilterState {
  q: string;
  kind: string;
  operation: string;
  status: string;
  priceMin: string;
  priceMax: string;
  currency: string;
  bedroomsMin: string;
  bathroomsMin: string;
  city: string;
  colonia: string;
  assignedUserId: string;
  hasTour: string;
  hasExclusive: string;
  isPublished: string;
  sort: RealtyPropertySort;
}

const EMPTY: FilterState = {
  q: "",
  kind: "",
  operation: "",
  status: "",
  priceMin: "",
  priceMax: "",
  currency: "",
  bedroomsMin: "",
  bathroomsMin: "",
  city: "",
  colonia: "",
  assignedUserId: "",
  hasTour: "",
  hasExclusive: "",
  isPublished: "",
  sort: "recientes",
};

/** Cuántos filtros (sin contar la búsqueda ni el orden) están puestos. */
function countActive(f: FilterState): number {
  const keys: (keyof FilterState)[] = [
    "kind",
    "operation",
    "status",
    "priceMin",
    "priceMax",
    "currency",
    "bedroomsMin",
    "bathroomsMin",
    "city",
    "colonia",
    "assignedUserId",
    "hasTour",
    "hasExclusive",
    "isPublished",
  ];
  return keys.filter((k) => String(f[k] ?? "").trim() !== "").length;
}

function toQuery(f: FilterState, page: number, pageSize: number): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.kind) p.set("kind", f.kind);
  if (f.operation) p.set("operation", f.operation);
  if (f.status) p.set("status", f.status);
  if (f.priceMin) p.set("priceMin", f.priceMin);
  if (f.priceMax) p.set("priceMax", f.priceMax);
  if (f.currency) p.set("currency", f.currency);
  if (f.bedroomsMin) p.set("bedroomsMin", f.bedroomsMin);
  if (f.bathroomsMin) p.set("bathroomsMin", f.bathroomsMin);
  if (f.city) p.set("city", f.city);
  if (f.colonia) p.set("colonia", f.colonia);
  if (f.assignedUserId) p.set("assignedUserId", f.assignedUserId);
  if (f.hasTour) p.set("hasTour", f.hasTour);
  if (f.hasExclusive) p.set("hasExclusive", f.hasExclusive);
  if (f.isPublished) p.set("isPublished", f.isPublished);
  p.set("sort", f.sort);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p.toString();
}

export interface PropertiesScreenProps {
  dict: Dictionary;
  locale: string;
  initial: RealtyPropertyPage;
  facets: RealtyPropertyFacets;
  mode: RealtyMode;
  canEdit: boolean;
  /** slug de la cuenta, para armar la liga pública /i/<slug>/<inmueble>. */
  accountSlug: string;
  /** Origen absoluto, para que "copiar liga" copie algo que se pueda pegar. */
  origin: string;
}

export function PropertiesScreen({
  dict,
  locale,
  initial,
  facets,
  mode,
  canEdit,
  accountSlug,
  origin,
}: PropertiesScreenProps) {
  const t = useRealtyT(dict);

  const [view, setView] = useState<ViewMode>("table");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RealtyPropertyPage>(initial);
  const [loading, setLoading] = useState(false);
  const [statusFor, setStatusFor] = useState<RealtyPropertyListItem | null>(null);

  const isOwnerMode = mode === "OWNER";
  const seq = useRef(0);
  const firstRun = useRef(true);

  // La preferencia de vista es del usuario y de su navegador: no vale la
  // pena una columna en la base para esto.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("realty:propsView");
      if (saved === "cards" || saved === "table") setView(saved);
    } catch {
      /* modo privado o cookies bloqueadas: se queda con la tabla */
    }
  }, []);

  const changeView = useCallback((next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem("realty:propsView", next);
    } catch {
      /* no pasa nada: es solo una comodidad */
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(filters.q.trim()), 320);
    return () => clearTimeout(id);
  }, [filters.q]);

  const queryKey = useMemo(
    () => toQuery({ ...filters, q: debouncedQ }, page, data.pageSize),
    [filters, debouncedQ, page, data.pageSize],
  );

  const load = useCallback(async () => {
    // Si el asesor escribe rápido, la respuesta que llega tarde NO puede
    // pisar a la que llegó después.
    const mine = ++seq.current;
    setLoading(true);
    try {
      const json = await apiCall<RealtyPropertyPage>(`/api/realty/properties?${queryKey}`);
      if (mine !== seq.current) return;
      setData(json);
    } catch (e) {
      if (mine === seq.current) {
        toast.error(e instanceof Error ? e.message : t("errors.load"));
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // `t` NO va en las dependencias: makeRealtyT devuelve una funcion
    // NUEVA cada vez que cambia el diccionario, y una t inestable aqui
    // reengancha `load` en cada render -> bucle infinito de peticiones.
    // El diccionario no cambia mientras la pantalla vive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return; // la primera pintura ya viene del servidor
    }
    void load();
  }, [load]);

  // Cambiar un filtro devuelve a la página 1: quedarse en la 7 de un
  // resultado que ahora tiene 2 páginas enseña una tabla vacía sin motivo.
  useEffect(() => {
    setPage(1);
  }, [
    debouncedQ,
    filters.kind,
    filters.operation,
    filters.status,
    filters.priceMin,
    filters.priceMax,
    filters.currency,
    filters.bedroomsMin,
    filters.bathroomsMin,
    filters.city,
    filters.colonia,
    filters.assignedUserId,
    filters.hasTour,
    filters.hasExclusive,
    filters.isPublished,
    filters.sort,
  ]);

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const activeCount = countActive(filters);
  const hasQuery = debouncedQ !== "" || activeCount > 0;

  function publicUrl(row: RealtyPropertyListItem): string | null {
    if (!row.isPublished || !row.publicUrlSlug) return null;
    return `${origin}/i/${accountSlug}/${row.publicUrlSlug}`;
  }

  async function copyLink(row: RealtyPropertyListItem) {
    const url = publicUrl(row);
    if (!url) {
      toast.error(t("actions.noPublicLink"));
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("actions.linkCopied"));
    } catch {
      toast.error(t("actions.linkFailed"));
    }
  }

  async function changeStatus(row: RealtyPropertyListItem, status: RealtyPropertyStatus) {
    try {
      await apiCall(`/api/realty/properties/${row.id}/status`, {
        method: "PATCH",
        json: { status },
      });
      toast.success(t("actions.statusChanged"));
      setStatusFor(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.generic"));
    }
  }

  return (
    <>
      {/* .realty-page declara el contenedor del vertical (container-type). */}
      <div className={`realty-page ${s.page}`}>
        <header className={s.header}>
          <div className={s.headerInner}>
            <div className={s.headerText}>
              <h1 className={s.title}>{t("title")}</h1>
              <p className={s.subtitle}>{t("subtitle")}</p>
            </div>
            {canEdit ? (
              <div className={s.headerActions}>
                <Link
                  href="/inmobiliaria/inmuebles/nuevo"
                  className={`${s.btn} realty-btn-primary`}
                >
                  <Plus size={15} />
                  {t("actions.new")}
                </Link>
              </div>
            ) : null}
          </div>
        </header>

        <section className={s.card}>
          <div className={`${s.cardPad} ${s.toolbar}`}>
            <div className={s.toolbarInner}>
              <div className={s.searchBox}>
                <span className={s.searchIcon}>
                  <Search size={15} />
                </span>
                <input
                  className={s.searchInput}
                  type="search"
                  value={filters.q}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.label")}
                  onChange={(e) => set("q", e.target.value)}
                />
                {filters.q ? (
                  <button
                    type="button"
                    className={s.searchClear}
                    onClick={() => set("q", "")}
                    aria-label={t("search.clear")}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>

              <div className={s.toolbarRight}>
                <button
                  type="button"
                  className={s.btn}
                  onClick={() => setShowFilters((v) => !v)}
                  aria-expanded={showFilters}
                >
                  <Filter size={14} />
                  {showFilters ? t("filters.hide") : t("filters.show")}
                  {activeCount > 0 ? <span className={s.filterCount}>{activeCount}</span> : null}
                </button>

                <select
                  className={s.select}
                  style={{ width: "auto" }}
                  value={filters.sort}
                  aria-label={t("sort.label")}
                  onChange={(e) => set("sort", e.target.value as RealtyPropertySort)}
                >
                  {REALTY_PROPERTY_SORTS.map((key) => (
                    <option key={key} value={key}>
                      {t(`sort.${key}`)}
                    </option>
                  ))}
                </select>

                <div className={s.viewToggle} role="group" aria-label={t("views.label")}>
                  <button
                    type="button"
                    className={`${s.viewBtn} ${view === "table" ? s.viewBtnActive : ""}`}
                    onClick={() => changeView("table")}
                    aria-pressed={view === "table"}
                  >
                    <Rows3 size={13} />
                    {t("views.table")}
                  </button>
                  <button
                    type="button"
                    className={`${s.viewBtn} ${view === "cards" ? s.viewBtnActive : ""}`}
                    onClick={() => changeView("cards")}
                    aria-pressed={view === "cards"}
                  >
                    <LayoutGrid size={13} />
                    {t("views.cards")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {showFilters ? (
            <div className={s.filterPanel}>
              <div className={s.filterGrid}>
                <Field label={t("filters.kind")} htmlFor="f-kind">
                  <select
                    id="f-kind"
                    className={s.select}
                    value={filters.kind}
                    onChange={(e) => set("kind", e.target.value)}
                  >
                    <option value="">{t("filters.all")}</option>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {REALTY_PROPERTY_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("filters.operation")} htmlFor="f-op">
                  <select
                    id="f-op"
                    className={s.select}
                    value={filters.operation}
                    onChange={(e) => set("operation", e.target.value)}
                  >
                    <option value="">{t("filters.all")}</option>
                    {(["VENTA", "RENTA", "AMBAS"] as const).map((o) => (
                      <option key={o} value={o}>
                        {REALTY_OPERATION_LABELS[o]}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("filters.status")} htmlFor="f-status">
                  <select
                    id="f-status"
                    className={s.select}
                    value={filters.status}
                    onChange={(e) => set("status", e.target.value)}
                  >
                    <option value="">{t("filters.all")}</option>
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {REALTY_PROPERTY_STATUS_UI[st].label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("filters.currency")} htmlFor="f-cur">
                  <select
                    id="f-cur"
                    className={s.select}
                    value={filters.currency}
                    onChange={(e) => set("currency", e.target.value)}
                  >
                    <option value="">{t("filters.any")}</option>
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </Field>

                <Field label={t("filters.price")} htmlFor="f-pmin">
                  <div className={s.filterRange}>
                    <input
                      id="f-pmin"
                      className={s.input}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder={t("filters.priceMin")}
                      value={filters.priceMin}
                      onChange={(e) => set("priceMin", e.target.value)}
                    />
                    <span className={s.muted}>—</span>
                    <input
                      className={s.input}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder={t("filters.priceMax")}
                      aria-label={t("filters.priceMax")}
                      value={filters.priceMax}
                      onChange={(e) => set("priceMax", e.target.value)}
                    />
                  </div>
                </Field>

                <Field label={t("filters.bedrooms")} htmlFor="f-bed">
                  <select
                    id="f-bed"
                    className={s.select}
                    value={filters.bedroomsMin}
                    onChange={(e) => set("bedroomsMin", e.target.value)}
                  >
                    <option value="">{t("filters.any")}</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}+
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("filters.bathrooms")} htmlFor="f-bath">
                  <select
                    id="f-bath"
                    className={s.select}
                    value={filters.bathroomsMin}
                    onChange={(e) => set("bathroomsMin", e.target.value)}
                  >
                    <option value="">{t("filters.any")}</option>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}+
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("filters.city")} htmlFor="f-city">
                  <select
                    id="f-city"
                    className={s.select}
                    value={filters.city}
                    onChange={(e) => set("city", e.target.value)}
                  >
                    <option value="">{t("filters.all")}</option>
                    {facets.cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("filters.colonia")} htmlFor="f-col">
                  <select
                    id="f-col"
                    className={s.select}
                    value={filters.colonia}
                    onChange={(e) => set("colonia", e.target.value)}
                  >
                    <option value="">{t("filters.all")}</option>
                    {facets.colonias.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* En modo OWNER no hay asesores a quien filtrar. */}
                {!isOwnerMode ? (
                  <Field label={t("filters.agent")} htmlFor="f-agent">
                    <select
                      id="f-agent"
                      className={s.select}
                      value={filters.assignedUserId}
                      onChange={(e) => set("assignedUserId", e.target.value)}
                    >
                      <option value="">{t("filters.all")}</option>
                      {facets.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                <Field label={t("filters.tour")} htmlFor="f-tour">
                  <select
                    id="f-tour"
                    className={s.select}
                    value={filters.hasTour}
                    onChange={(e) => set("hasTour", e.target.value)}
                  >
                    <option value="">{t("filters.any")}</option>
                    <option value="1">{t("filters.withTour")}</option>
                    <option value="0">{t("filters.withoutTour")}</option>
                  </select>
                </Field>

                {!isOwnerMode ? (
                  <Field label={t("filters.exclusive")} htmlFor="f-exc">
                    <select
                      id="f-exc"
                      className={s.select}
                      value={filters.hasExclusive}
                      onChange={(e) => set("hasExclusive", e.target.value)}
                    >
                      <option value="">{t("filters.any")}</option>
                      <option value="1">{t("filters.withExclusive")}</option>
                      <option value="0">{t("filters.withoutExclusive")}</option>
                    </select>
                  </Field>
                ) : null}

                <Field label={t("filters.published")} htmlFor="f-pub">
                  <select
                    id="f-pub"
                    className={s.select}
                    value={filters.isPublished}
                    onChange={(e) => set("isPublished", e.target.value)}
                  >
                    <option value="">{t("filters.any")}</option>
                    <option value="1">{t("filters.isPublished")}</option>
                    <option value="0">{t("filters.notPublished")}</option>
                  </select>
                </Field>
              </div>

              <div className={s.filterFoot}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSm} ${s.btnGhost}`}
                  onClick={() => setFilters({ ...EMPTY, sort: filters.sort })}
                  disabled={activeCount === 0}
                >
                  <X size={13} />
                  {t("filters.clear")}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className={s.card}>
          {loading ? (
            <div className={s.cardBody} aria-busy="true">
              <div style={{ display: "grid", gap: 10 }}>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className={s.skeleton} />
                ))}
              </div>
            </div>
          ) : data.rows.length === 0 ? (
            <div className={s.empty}>
              <span className={s.emptyIcon}>
                <Building2 size={22} />
              </span>
              <span className={s.emptyTitle}>
                {hasQuery ? t("empty.searchTitle") : t("empty.title")}
              </span>
              <span className={s.emptyBody}>
                {hasQuery ? t("empty.searchBody") : t("empty.body")}
              </span>
              {!hasQuery && canEdit ? (
                <Link
                  href="/inmobiliaria/inmuebles/nuevo"
                  className={`${s.btn} realty-btn-primary`}
                >
                  <Plus size={15} />
                  {t("empty.cta")}
                </Link>
              ) : null}
            </div>
          ) : view === "table" ? (
            <TableView
              rows={data.rows}
              t={t}
              locale={locale}
              isOwnerMode={isOwnerMode}
              canEdit={canEdit}
              onCopy={copyLink}
              onStatus={setStatusFor}
              publicUrl={publicUrl}
            />
          ) : (
            <div className={`${s.cardBody} ${s.cardsWrap}`}>
              <div className={s.cardsGrid}>
                {data.rows.map((row) => (
                  <PropertyCard
                    key={row.id}
                    row={row}
                    t={t}
                    locale={locale}
                    isOwnerMode={isOwnerMode}
                    canEdit={canEdit}
                    onCopy={copyLink}
                    onStatus={setStatusFor}
                    publicUrl={publicUrl}
                  />
                ))}
              </div>
            </div>
          )}

          {data.rows.length > 0 ? (
            <div className={s.pager}>
              <span className={s.resultCount}>
                {t("pager.showing", { count: data.total })}
              </span>
              {data.pageCount > 1 ? (
                <>
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSm}`}
                    disabled={data.page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("pager.prev")}
                  </button>
                  <span className={s.pagerText}>
                    {t("pager.page", { page: data.page, pages: data.pageCount })}
                  </span>
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSm}`}
                    disabled={data.page >= data.pageCount || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("pager.next")}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {/* El modal vive FUERA de .realty-page: container-type atraparía su
          position:fixed y saldría encajado en una esquina. */}
      {statusFor ? (
        <Modal
          title={t("actions.changeStatus")}
          subtitle={statusFor.title}
          onClose={() => setStatusFor(null)}
          closeLabel={t("actions.cancel")}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {STATUSES.map((st) => {
              const ui = REALTY_PROPERTY_STATUS_UI[st];
              const current = statusFor.status === st;
              return (
                <button
                  key={st}
                  type="button"
                  className={s.btn}
                  style={{ justifyContent: "flex-start", height: 40 }}
                  disabled={current}
                  onClick={() => void changeStatus(statusFor, st)}
                >
                  <Badge tone={ui.tone}>{ui.label}</Badge>
                  {current ? <span className={s.muted}>·</span> : null}
                </button>
              );
            })}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ── Tabla ──────────────────────────────────────────────────────────────
interface RowProps {
  row: RealtyPropertyListItem;
  t: ReturnType<typeof useRealtyT>;
  locale: string;
  isOwnerMode: boolean;
  canEdit: boolean;
  onCopy: (row: RealtyPropertyListItem) => void;
  onStatus: (row: RealtyPropertyListItem) => void;
  publicUrl: (row: RealtyPropertyListItem) => string | null;
}

function TableView({
  rows,
  ...rest
}: Omit<RowProps, "row"> & { rows: RealtyPropertyListItem[] }) {
  const { t, isOwnerMode } = rest;
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.thumbCell}>
              <span className={s.srOnly}>{t("table.photo")}</span>
            </th>
            <th>{t("table.property")}</th>
            <th>{t("table.kind")}</th>
            <th>{t("table.operation")}</th>
            <th className={s.num}>{t("table.price")}</th>
            <th>{t("table.location")}</th>
            <th>{t("table.status")}</th>
            {!isOwnerMode ? <th>{t("table.agent")}</th> : null}
            <th className={s.num}>{t("table.days")}</th>
            <th>
              <span className={s.srOnly}>{t("table.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow key={row.id} row={row} {...rest} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ row, t, locale, isOwnerMode, canEdit, onCopy, onStatus, publicUrl }: RowProps) {
  const ui = REALTY_PROPERTY_STATUS_UI[row.status];
  const url = publicUrl(row);
  const warn =
    row.exclusiveDaysLeft !== null && row.exclusiveDaysLeft <= REALTY_EXCLUSIVE_WARN_DAYS;

  return (
    <tr>
      <td className={s.thumbCell}>
        {row.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.thumb} src={row.coverUrl} alt="" loading="lazy" />
        ) : (
          <span className={`${s.thumb} ${s.thumbEmpty}`} title={t("table.noPhoto")}>
            <ImageOff size={14} />
          </span>
        )}
      </td>
      <td>
        <div className={s.cellTitle}>
          <Link
            href={`/inmobiliaria/inmuebles/${row.id}`}
            className={s.cellTitleLink}
            title={row.title}
          >
            {row.title}
          </Link>
          <span className={s.cellMeta}>
            {row.shortTermFolio ? <span>{row.shortTermFolio}</span> : null}
            {row.hasTour ? (
              <Badge tone="brand" title={t("badges.tour")}>
                <View size={10} />
                {t("badges.tour")}
              </Badge>
            ) : null}
            {!isOwnerMode && warn ? (
              <Badge tone="warning">
                {row.exclusiveDaysLeft === 0
                  ? t("badges.exclusiveToday")
                  : t("badges.exclusiveEnds", { count: row.exclusiveDaysLeft ?? 0 })}
              </Badge>
            ) : null}
            {!row.isPublished ? (
              <Badge tone="neutral">{t("badges.notPublished")}</Badge>
            ) : null}
          </span>
        </div>
      </td>
      <td>{REALTY_PROPERTY_KIND_LABELS[row.kind]}</td>
      <td>{REALTY_OPERATION_LABELS[row.operation]}</td>
      <td className={s.num}>
        <PriceCell row={row} t={t} locale={locale} />
      </td>
      <td>
        {row.colonia || row.city ? (
          <span title={[row.colonia, row.city].filter(Boolean).join(", ")}>
            {row.colonia ?? row.city}
            {row.colonia && row.city ? <span className={s.muted}> · {row.city}</span> : null}
          </span>
        ) : (
          <span className={s.muted}>{t("table.noLocation")}</span>
        )}
      </td>
      <td>
        <Badge tone={ui.tone}>{ui.label}</Badge>
      </td>
      {!isOwnerMode ? (
        <td>
          {row.assignedUserName ?? <span className={s.muted}>{t("table.noAgent")}</span>}
        </td>
      ) : null}
      <td className={s.num}>{formatNumber(row.daysListed, locale)}</td>
      <td>
        <span className={s.rowActions}>
          {url ? (
            <a
              className={s.iconBtn}
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("actions.publicPage")}
              title={t("actions.publicPage")}
            >
              <ExternalLink size={13} />
            </a>
          ) : null}
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => onCopy(row)}
            aria-label={t("actions.copyLink")}
            title={url ? t("actions.copyLink") : t("actions.noPublicLink")}
          >
            <Link2 size={13} />
          </button>
          <a
            className={s.iconBtn}
            href={`/api/realty/properties/${row.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            aria-label={t("actions.pdf")}
            title={t("actions.pdf")}
          >
            <FileDown size={13} />
          </a>
          {canEdit ? (
            <button
              type="button"
              className={s.iconBtn}
              onClick={() => onStatus(row)}
              aria-label={t("actions.changeStatus")}
              title={t("actions.changeStatus")}
            >
              <ChevronDown size={13} />
            </button>
          ) : null}
        </span>
      </td>
    </tr>
  );
}

/**
 * El precio que se enseña depende de la operación: en RENTA el `price`
 * está en cero (no es "gratis", es que no está en venta) y enseñarlo sería
 * mentir. En AMBAS se enseñan los dos.
 */
function PriceCell({
  row,
  t,
  locale,
}: {
  row: RealtyPropertyListItem;
  t: ReturnType<typeof useRealtyT>;
  locale: string;
}) {
  const sale = formatPrice(row.price, row.currency, locale);
  const rent =
    row.rentPrice !== null ? `${formatPrice(row.rentPrice, row.currency, locale)}` : null;

  if (row.operation === "RENTA") {
    return rent ? (
      <span className={s.priceMain}>
        {rent}
        <span className={s.priceAlt}>{t("table.rentSuffix")}</span>
      </span>
    ) : (
      <span className={s.muted}>—</span>
    );
  }
  if (row.operation === "AMBAS" && rent) {
    return (
      <span className={s.priceMain}>
        {sale}
        <span className={s.priceAlt}>
          {rent} {t("table.rentSuffix")}
        </span>
      </span>
    );
  }
  return <span className={s.priceMain}>{row.price > 0 ? sale : "—"}</span>;
}

// ── Tarjeta ────────────────────────────────────────────────────────────
function PropertyCard({
  row,
  t,
  locale,
  isOwnerMode,
  canEdit,
  onCopy,
  onStatus,
  publicUrl,
}: RowProps) {
  const ui = REALTY_PROPERTY_STATUS_UI[row.status];
  const url = publicUrl(row);
  const warn =
    row.exclusiveDaysLeft !== null && row.exclusiveDaysLeft <= REALTY_EXCLUSIVE_WARN_DAYS;

  return (
    <article className={s.propCard}>
      <div className={s.propCardMedia}>
        {row.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.propCardImg} src={row.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className={s.propCardNoImg}>
            <ImageOff size={22} />
            <span>{t("table.noPhoto")}</span>
          </div>
        )}
        <div className={s.propCardTop}>
          <div className={s.propCardBadges}>
            <Badge tone={ui.tone}>{ui.label}</Badge>
            {row.hasTour ? (
              <Badge tone="brand">
                <View size={10} />
                {t("badges.tour")}
              </Badge>
            ) : null}
            {!isOwnerMode && warn ? (
              <Badge tone="warning">
                {row.exclusiveDaysLeft === 0
                  ? t("badges.exclusiveToday")
                  : t("badges.exclusiveEnds", { count: row.exclusiveDaysLeft ?? 0 })}
              </Badge>
            ) : null}
          </div>
          {!row.isPublished ? <Badge tone="neutral">{t("badges.notPublished")}</Badge> : null}
        </div>
      </div>

      <div className={s.propCardBody}>
        <Link href={`/inmobiliaria/inmuebles/${row.id}`} className={s.propCardTitle}>
          {row.title}
        </Link>
        <span className={s.propCardPrice}>
          <PriceCell row={row} t={t} locale={locale} />
        </span>
        <span className={s.propCardWhere}>
          <MapPin size={12} />
          {row.colonia || row.city ? (
            [row.colonia, row.city].filter(Boolean).join(", ")
          ) : (
            <span className={s.muted}>{t("table.noLocation")}</span>
          )}
        </span>
        <div className={s.propCardSpecs}>
          {row.bedrooms !== null ? (
            <span className={s.spec}>
              <BedDouble size={12} /> {row.bedrooms}
            </span>
          ) : null}
          {row.bathrooms !== null ? (
            <span className={s.spec}>
              <Bath size={12} /> {row.bathrooms}
            </span>
          ) : null}
          {row.builtM2 !== null ? (
            <span className={s.spec}>
              <Maximize size={12} /> {formatNumber(row.builtM2, locale)} m²
            </span>
          ) : null}
          {row.photoCount > 0 ? (
            <span className={s.spec}>{t("badges.photos", { count: row.photoCount })}</span>
          ) : null}
        </div>
      </div>

      <div className={s.propCardFoot}>
        <span className={s.propCardAgent}>
          {isOwnerMode
            ? t("badges.days", { count: row.daysListed })
            : (row.assignedUserName ?? t("table.noAgent"))}
        </span>
        <span className={s.rowActions}>
          {url ? (
            <a
              className={s.iconBtn}
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("actions.publicPage")}
              title={t("actions.publicPage")}
            >
              <ExternalLink size={13} />
            </a>
          ) : null}
          <button
            type="button"
            className={s.iconBtn}
            onClick={() => onCopy(row)}
            aria-label={t("actions.copyLink")}
            title={url ? t("actions.copyLink") : t("actions.noPublicLink")}
          >
            <Copy size={13} />
          </button>
          <a
            className={s.iconBtn}
            href={`/api/realty/properties/${row.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            aria-label={t("actions.pdf")}
            title={t("actions.pdf")}
          >
            <FileDown size={13} />
          </a>
          {canEdit ? (
            <button
              type="button"
              className={s.iconBtn}
              onClick={() => onStatus(row)}
              aria-label={t("actions.changeStatus")}
              title={t("actions.changeStatus")}
            >
              <ChevronDown size={13} />
            </button>
          ) : null}
        </span>
      </div>
    </article>
  );
}

/** Spinner reutilizable de las pantallas del módulo. */
export function Spinner({ label }: { label?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Loader2 size={14} className={s.spin} />
      {label}
    </span>
  );
}
