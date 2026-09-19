"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import styles from "./procedures.module.css";
import { margenDe } from "./margen";
// Mismos tokens `--pr-*` e Instrument Sans del rediseño de Pacientes: es el
// idioma visual ya aprobado por Rafael, no uno nuevo. Se heredan por CSS
// (custom properties), así que reutilizarlos aquí no acopla este módulo al
// de Pacientes más allá de leer las mismas variables.
import { CLASES_REDISENO } from "@/components/dashboard/pacientes-rediseno/raiz";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Clock,
  Tag,
  Info,
  Power,
} from "lucide-react";

interface Procedure {
  id: string;
  name: string;
  category: string;
  basePrice: number;
  /** Gasto de la clínica. null = no medido (≠ 0). */
  cost: number | null;
  duration: number | null;
  description: string | null;
  isActive: boolean;
}

interface Props {
  initialProcedures: Procedure[];
  /**
   * Interruptor `menu-dos-niveles` de la clínica activa. Aditivo: en `false`
   * (o sin pasar) la pantalla se pinta exactamente igual que hoy — ni una
   * clase nueva se aplica.
   */
  rediseno?: boolean;
}

const CATEGORY_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "general", labelKey: "pages.procedures.catGeneral" },
  { value: "dental", labelKey: "pages.procedures.catDental" },
  { value: "aesthetic", labelKey: "pages.procedures.catAesthetic" },
  { value: "laboratory", labelKey: "pages.procedures.catLaboratory" },
  { value: "consultation", labelKey: "pages.procedures.catConsultation" },
];

const CATEGORY_LABEL_KEY: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.value, c.labelKey])
);

interface FormState {
  name: string;
  category: string;
  basePrice: string;
  cost: string;
  duration: string;
  description: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "general",
  basePrice: "",
  cost: "",
  duration: "",
  description: "",
  isActive: true,
};

export function ProceduresClient({ initialProcedures, rediseno = false }: Props) {
  const t = useT();
  const router = useRouter();
  const askConfirm = useConfirm();
  const [procedures, setProcedures] = useState<Procedure[]>(initialProcedures);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Procedure | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return procedures;
    return procedures.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [procedures, search]);

  const grouped = useMemo(() => {
    const map: Record<string, Procedure[]> = {};
    for (const p of filtered) {
      (map[p.category] ??= []).push(p);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(p: Procedure) {
    setEditing(p);
    setForm({
      name: p.name,
      category: p.category,
      basePrice: String(p.basePrice),
      cost: p.cost != null ? String(p.cost) : "",
      duration: p.duration != null ? String(p.duration) : "",
      description: p.description ?? "",
      isActive: p.isActive,
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error(t("pages.procedures.nameRequired"));
      return;
    }
    const price = Number(form.basePrice);
    if (Number.isNaN(price) || price < 0) {
      toast.error(t("pages.procedures.invalidPrice"));
      return;
    }
    // Vacío = null («no lo hemos medido»), que no es lo mismo que 0.
    const cost = form.cost.trim() === "" ? null : Number(form.cost);
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) {
      toast.error(t("pages.procedures.invalidCost"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        basePrice: price,
        cost,
        duration: form.duration ? Number(form.duration) : null,
        description: form.description.trim() || null,
        isActive: form.isActive,
      };

      if (editing) {
        const res = await fetch(`/api/procedures/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? t("pages.procedures.updateError"));
        }
        const updated: Procedure = await res.json();
        setProcedures((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        );
        toast.success(t("pages.procedures.updated"));
        router.refresh();
      } else {
        const res = await fetch("/api/procedures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? t("pages.procedures.createError"));
        }
        const created: Procedure = await res.json();
        setProcedures((prev) => [created, ...prev]);
        toast.success(t("pages.procedures.created"));
        router.refresh();
      }
      setModalOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Procedure) {
    const next = !p.isActive;
    // optimistic
    setProcedures((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, isActive: next } : x))
    );
    try {
      const res = await fetch(`/api/procedures/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? t("pages.procedures.activated") : t("pages.procedures.deactivated"));
      router.refresh();
    } catch {
      // revert
      setProcedures((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, isActive: p.isActive } : x))
      );
      toast.error(t("pages.procedures.statusUpdateError"));
    }
  }

  async function handleDelete(p: Procedure) {
    if (!(await askConfirm({
      title: t("pages.procedures.deleteTitle", { name: p.name }),
      description: t("pages.procedures.deleteDescription"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    try {
      const res = await fetch(`/api/procedures/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setProcedures((prev) => prev.filter((x) => x.id !== p.id));
      toast.success(t("pages.procedures.deleted"));
      router.refresh();
    } catch {
      toast.error(t("pages.procedures.deleteError"));
    }
  }

  const activeCount = procedures.filter((p) => p.isActive).length;

  return (
    <div
      className={[styles.page, rediseno ? `${CLASES_REDISENO} ${styles.pageRediseno}` : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Header */}
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>
            {t("pages.procedures.title")}
          </h1>
          <p className={styles.subtitle}>
            {t("pages.procedures.countProcedures", { count: procedures.length })}{" "}
            · {t("pages.procedures.countActive", { count: activeCount })}
          </p>
        </div>
        <button
          onClick={openCreate}
          className={styles.btnPrimary}
        >
          <Plus size={16} strokeWidth={1.75} />
          {t("pages.procedures.newProcedure")}
        </button>
      </div>

      {/* Info banner */}
      <div className={styles.banner}>
        <Info size={18} strokeWidth={1.75} className={styles.bannerIcon} aria-hidden="true" />
        <p className={styles.bannerText}>
          {t("pages.procedures.infoBanner")}
        </p>
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <Search size={16} strokeWidth={1.75} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("pages.procedures.searchPlaceholder")}
          aria-label={t("pages.procedures.searchPlaceholder")}
          className={styles.searchInput}
        />
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className={styles.emptyCard}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <Tag size={22} strokeWidth={1.75} />
          </span>
          <p>
            {procedures.length === 0
              ? t("pages.procedures.emptyNoProcedures")
              : t("pages.procedures.emptyNoMatch")}
          </p>
        </div>
      ) : (
        <div className={rediseno ? styles.groups : "space-y-6"}>
          {grouped.map(([category, items]) => (
            <div
              key={category}
              className={
                rediseno
                  ? styles.groupCard
                  : "bg-card border border-border rounded-2xl shadow-card overflow-hidden"
              }
            >
              <div className={rediseno ? styles.groupHead : "px-5 py-3 border-b border-border bg-muted/50"}>
                <h2 className={rediseno ? styles.groupTitle : "text-xs font-bold uppercase tracking-wider text-muted-foreground"}>
                  {CATEGORY_LABEL_KEY[category] ? t(CATEGORY_LABEL_KEY[category]) : category}
                  {rediseno ? (
                    <span className={styles.groupCount} style={{ marginLeft: 8 }}>{items.length}</span>
                  ) : (
                    <span className="ml-2 text-muted-foreground font-semibold">
                      ({items.length})
                    </span>
                  )}
                </h2>
              </div>
              <div className={rediseno ? styles.tableScroll : "overflow-x-auto"}>
                <table className={rediseno ? styles.table : "w-full text-sm"}>
                  <thead>
                    <tr className={rediseno ? undefined : "text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border"}>
                      <th className={rediseno ? undefined : "px-5 py-3"}>{t("common.name")}</th>
                      <th className={rediseno ? styles.thNum : "px-3 py-3 text-right"}>{t("pages.procedures.colPrice")}</th>
                      <th className={rediseno ? styles.thNum : "px-3 py-3 text-right"}>{t("pages.procedures.colCost")}</th>
                      <th className={rediseno ? styles.thNum : "px-3 py-3 text-right"}>{t("pages.procedures.colMargin")}</th>
                      <th className={rediseno ? undefined : "px-3 py-3"}>{t("pages.procedures.colDuration")}</th>
                      <th className={rediseno ? undefined : "px-3 py-3"}>{t("common.status")}</th>
                      <th className={rediseno ? styles.thNum : "px-5 py-3 text-right"}>{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => {
                      const margen = margenDe(p.basePrice, p.cost);
                      return (
                      <tr
                        key={p.id}
                        className={
                          rediseno
                            ? !p.isActive
                              ? styles.rowInactive
                              : undefined
                            : `border-b border-border last:border-0 hover:bg-muted transition-colors ${
                                !p.isActive ? "opacity-60" : ""
                              }`
                        }
                      >
                        <td className={rediseno ? undefined : "px-5 py-3"}>
                          <div className={rediseno ? styles.procName : "font-semibold text-foreground"}>
                            {p.name}
                          </div>
                          {p.description && (
                            <div className={rediseno ? styles.procDesc : "text-xs text-muted-foreground mt-0.5 line-clamp-1"}>
                              {p.description}
                            </div>
                          )}
                        </td>
                        <td className={rediseno ? styles.priceCell : "px-3 py-3 text-right font-bold text-foreground whitespace-nowrap tabular-nums"}>
                          {formatCurrency(p.basePrice)}
                        </td>
                        <td className={rediseno ? styles.costCell : "px-3 py-3 text-right text-muted-foreground whitespace-nowrap tabular-nums"}>
                          {p.cost != null ? formatCurrency(p.cost) : "—"}
                        </td>
                        {/* Sin gasto no hay margen: ni 0 ni el precio (ver ./margen). */}
                        <td className={rediseno ? styles.marginCell : "px-3 py-3 text-right font-semibold text-foreground whitespace-nowrap tabular-nums"}>
                          {margen != null ? formatCurrency(margen) : "—"}
                        </td>
                        <td className={rediseno ? styles.durationCell : "px-3 py-3 text-muted-foreground whitespace-nowrap"}>
                          {p.duration ? (
                            <span className={rediseno ? styles.durationVal : "inline-flex items-center gap-1 tabular-nums"}>
                              <Clock className="w-3.5 h-3.5" />
                              {t("pages.procedures.minutes", { count: p.duration })}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={rediseno ? undefined : "px-3 py-3"}>
                          <span
                            className={
                              rediseno
                                ? `${styles.statusPill} ${p.isActive ? styles.statusActive : styles.statusInactive}`
                                : `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    p.isActive
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                      : "bg-muted text-muted-foreground"
                                  }`
                            }
                          >
                            {p.isActive ? t("pages.procedures.active") : t("pages.procedures.inactive")}
                          </span>
                        </td>
                        <td className={rediseno ? undefined : "px-5 py-3"}>
                          <div className={rediseno ? styles.actions : "flex items-center justify-end gap-1"}>
                            <button
                              onClick={() => openEdit(p)}
                              title={t("common.edit")}
                              className={
                                rediseno
                                  ? styles.actionBtn
                                  : "p-1.5 rounded-lg text-muted-foreground hover:text-brand-600 hover:bg-brand-600/15 dark:hover:bg-brand-900/20 transition-colors"
                              }
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => toggleActive(p)}
                              title={p.isActive ? t("pages.procedures.deactivate") : t("pages.procedures.activate")}
                              className={
                                rediseno
                                  ? `${styles.actionBtn} ${p.isActive ? styles.actionWarn : styles.actionOk}`
                                  : `p-1.5 rounded-lg transition-colors ${
                                      p.isActive
                                        ? "text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                        : "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                    }`
                              }
                            >
                              <Power className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
                              title={t("common.delete")}
                              className={
                                rediseno
                                  ? `${styles.actionBtn} ${styles.actionDanger}`
                                  : "p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              }
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className={rediseno ? styles.modalOverlay : "fixed inset-0 z-50 flex items-center justify-center p-4"}>
          <div
            className={rediseno ? styles.modalBackdrop : "absolute inset-0 bg-black/60 backdrop-blur-sm"}
            onClick={closeModal}
          />
          <div className={rediseno ? styles.modal : "relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"}>
            <div className={rediseno ? styles.modalHead : "flex items-center justify-between px-6 py-4 border-b border-border shrink-0"}>
              <h2 className={rediseno ? styles.modalTitle : "text-lg font-bold text-foreground"}>
                {editing ? t("pages.procedures.editProcedure") : t("pages.procedures.newProcedure")}
              </h2>
              <button
                onClick={closeModal}
                className={rediseno ? styles.modalClose : "p-1.5 rounded-lg text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors"}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className={rediseno ? styles.modalForm : "flex-1 min-h-0 flex flex-col overflow-hidden"}>
              <div className={rediseno ? styles.modalBody : "flex-1 overflow-y-auto min-h-0 p-6 space-y-4"}>
              <div className={rediseno ? styles.field : undefined}>
                <label className={rediseno ? styles.fieldLabel : "block text-xs font-semibold text-muted-foreground mb-1.5"}>
                  {t("common.name")} <span className={rediseno ? styles.required : "text-red-500"}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("pages.procedures.namePlaceholder")}
                  className={rediseno ? styles.input : "w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"}
                />
              </div>

              <div className={rediseno ? styles.formRow : "grid grid-cols-2 gap-4"}>
                <div className={rediseno ? styles.field : undefined}>
                  <label className={rediseno ? styles.fieldLabel : "block text-xs font-semibold text-muted-foreground mb-1.5"}>
                    {t("pages.procedures.basePriceMxn")} <span className={rediseno ? styles.required : "text-red-500"}>*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.basePrice}
                    onChange={(e) =>
                      setForm({ ...form, basePrice: e.target.value })
                    }
                    placeholder="0.00"
                    className={rediseno ? styles.input : "w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"}
                  />
                </div>
                <div className={rediseno ? styles.field : undefined}>
                  <label className={rediseno ? styles.fieldLabel : "block text-xs font-semibold text-muted-foreground mb-1.5"}>
                    {t("pages.procedures.costMxn")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    placeholder={t("pages.procedures.optional")}
                    aria-describedby="procedure-cost-hint"
                    className={rediseno ? styles.input : "w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"}
                  />
                  <p id="procedure-cost-hint" className={rediseno ? styles.fieldHint : "text-xs text-muted-foreground mt-1"}>
                    {t("pages.procedures.costHint")}
                  </p>
                </div>
              </div>

              <div className={rediseno ? styles.formRow : "grid grid-cols-2 gap-4"}>
                <div className={rediseno ? styles.field : undefined}>
                  <label className={rediseno ? styles.fieldLabel : "block text-xs font-semibold text-muted-foreground mb-1.5"}>
                    {t("pages.procedures.category")}
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    className={rediseno ? styles.input : "w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {t(c.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={rediseno ? styles.field : undefined}>
                  <label className={rediseno ? styles.fieldLabel : "block text-xs font-semibold text-muted-foreground mb-1.5"}>
                    {t("pages.procedures.durationMin")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.duration}
                    onChange={(e) =>
                      setForm({ ...form, duration: e.target.value })
                    }
                    placeholder={t("pages.procedures.optional")}
                    className={rediseno ? styles.input : "w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"}
                  />
                </div>
              </div>

              <div className={rediseno ? styles.field : undefined}>
                <label className={rediseno ? styles.fieldLabel : "block text-xs font-semibold text-muted-foreground mb-1.5"}>
                  {t("common.description")}
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={3}
                  placeholder={t("pages.procedures.optional")}
                  className={rediseno ? styles.textarea : "w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 resize-none"}
                />
              </div>

              <label className={rediseno ? styles.checkboxRow : "flex items-center gap-2 cursor-pointer select-none"}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                  className={rediseno ? styles.checkbox : "w-4 h-4 rounded border-border text-brand-600 focus:ring-brand-500/40"}
                />
                <span className={rediseno ? undefined : "text-sm font-semibold text-muted-foreground"}>
                  {t("pages.procedures.active")}
                </span>
              </label>
              </div>

              <div className={rediseno ? styles.modalFoot : "flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0"}>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className={rediseno ? styles.btnGhost : "px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={rediseno ? styles.btnPrimary : "px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"}
                >
                  {saving ? t("common.saving") : editing ? t("pages.procedures.saveChanges") : t("common.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
