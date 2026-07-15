"use client";

import { useState } from "react";
import { Plus, X, ChevronRight, Footprints } from "lucide-react";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import styles from "./orthotics.module.css";

interface PipelineItem {
  id: string;
  name: string;        // patient name
  description: string | null; // type of orthotic
  category: string;    // "orthotics_<stage>"
  emoji: string;
  quantity: number;
  minQuantity: number;
  unit: string;        // days tracking info
  createdAt: string;
}

const STAGES = [
  { key: "evaluacion",    labelKey: "pages.orthotics.stageEvaluation" },
  { key: "molde",         labelKey: "pages.orthotics.stageMold" },
  { key: "laboratorio",   labelKey: "pages.orthotics.stageInLab" },
  { key: "listo",         labelKey: "pages.orthotics.stageReady" },
  { key: "entregado",     labelKey: "pages.orthotics.stageDelivered" },
  { key: "ajuste",        labelKey: "pages.orthotics.stageAdjustment" },
];

// Cada etapa mapea a su clase de columna (fija --stage/--stage-soft/--stage-strong)
const STAGE_COLORS: Record<string, string> = {
  evaluacion:  styles.stageEvaluacion,
  molde:       styles.stageMolde,
  laboratorio: styles.stageLaboratorio,
  listo:       styles.stageListo,
  entregado:   styles.stageEntregado,
  ajuste:      styles.stageAjuste,
};

function getStage(category: string): string {
  return category.replace("orthotics_", "");
}

function getDaysInStage(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

export function OrthoticsClient({ initialItems }: { initialItems: PipelineItem[] }) {
  const t = useT();
  const askConfirm = useConfirm();
  const [items, setItems] = useState<PipelineItem[]>(initialItems);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ patientName: "", type: "", notes: "" });

  async function handleAdd() {
    if (!form.patientName.trim() || !form.type.trim()) {
      toast.error(t("pages.orthotics.patientNameAndTypeRequired"));
      return;
    }
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.patientName,
          description: form.type,
          category: "orthotics_evaluacion",
          emoji: "🦶",
          quantity: 0,
          minQuantity: 0,
          unit: form.notes || "Sin notas",
        }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setItems(prev => [...prev, created]);
      setShowAdd(false);
      setForm({ patientName: "", type: "", notes: "" });
      toast.success(t("pages.orthotics.orderCreated"));
    } catch {
      toast.error(t("pages.orthotics.orderCreateError"));
    }
  }

  async function advanceStage(item: PipelineItem) {
    const currentStage = getStage(item.category);
    const currentIdx = STAGES.findIndex(s => s.key === currentStage);
    if (currentIdx === -1 || currentIdx >= STAGES.length - 1) {
      toast.error(t("pages.orthotics.alreadyLastStage"));
      return;
    }
    const nextStage = STAGES[currentIdx + 1].key;
    try {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: `orthotics_${nextStage}` }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, category: updated.category } : i));
      toast.success(t("pages.orthotics.advancedTo", { stage: t(STAGES[currentIdx + 1].labelKey) }));
    } catch {
      toast.error(t("pages.orthotics.advanceError"));
    }
  }

  async function handleDelete(id: string) {
    if (!(await askConfirm({
      title: t("pages.orthotics.deleteOrderTitle"),
      description: t("pages.orthotics.deleteOrderDescription"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    try {
      await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      setItems(prev => prev.filter(i => i.id !== id));
      toast.success(t("pages.orthotics.orderDeleted"));
    } catch {
      toast.error(t("common.genericError"));
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("pages.orthotics.title")}</h1>
          <p className={styles.subtitle}>{t("pages.orthotics.ordersInProgress", { count: items.length })}</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className={styles.btnPrimary}>
          <Plus size={16} strokeWidth={1.75} /> {t("pages.orthotics.newOrder")}
        </button>
      </div>

      {/* Kanban columns */}
      <div className={styles.board}>
        {STAGES.map(stage => {
          const stageItems = items.filter(i => getStage(i.category) === stage.key);
          return (
            <div key={stage.key} className={`${styles.col} ${STAGE_COLORS[stage.key] || ""}`}>
              <div className={styles.colHead}>
                <h3 className={styles.colTitle}>{t(stage.labelKey)}</h3>
                <span className={styles.colCount}>{stageItems.length}</span>
              </div>
              <div className={styles.colStack}>
                {stageItems.map(item => {
                  const days = getDaysInStage(item.createdAt);
                  const currentIdx = STAGES.findIndex(s => s.key === stage.key);
                  const isLast = currentIdx >= STAGES.length - 1;

                  return (
                    <div key={item.id} className={styles.card}>
                      <div className={styles.cardHead}>
                        <p className={styles.cardName}>{item.name}</p>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className={styles.cardDelete}
                          aria-label={t("common.delete")}
                        >
                          <X size={16} strokeWidth={1.75} />
                        </button>
                      </div>
                      {item.description && <p className={styles.cardType}>{item.description}</p>}
                      <p className={styles.cardDays}>
                        {days === 0 ? t("pages.orthotics.todayInStage") : t("pages.orthotics.daysInStage", { count: days })}
                      </p>
                      {!isLast && (
                        <button
                          type="button"
                          onClick={() => advanceStage(item)}
                          className={styles.advanceBtn}
                        >
                          {t("pages.orthotics.advance")} <ChevronRight size={16} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {stageItems.length === 0 && (
                  <div className={styles.colEmpty}>{t("pages.orthotics.empty")}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className={styles.emptyCard}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <Footprints size={22} strokeWidth={1.75} />
          </span>
          <p className={styles.emptyTitle}>{t("pages.orthotics.noOrders")}</p>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>{t("pages.orthotics.newOrderModalTitle")}</h2>
              <button type="button" onClick={() => setShowAdd(false)} className={styles.modalClose} aria-label={t("common.close")}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("pages.orthotics.patientNameLabel")}</Label>
                <input className={styles.input}
                  placeholder={t("pages.orthotics.fullNamePlaceholder")}
                  value={form.patientName} onChange={e => setForm(f => ({ ...f, patientName: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("pages.orthotics.orthoticTypeLabel")}</Label>
                <input className={styles.input}
                  placeholder={t("pages.orthotics.orthoticTypePlaceholder")}
                  value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("common.notes")}</Label>
                <textarea className={styles.textarea}
                  placeholder={t("pages.orthotics.notesPlaceholder")}
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button type="button" onClick={() => setShowAdd(false)} className={styles.btnGhost}>{t("common.cancel")}</button>
              <button type="button" onClick={handleAdd} className={styles.btnPrimary}>{t("pages.orthotics.createOrder")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
