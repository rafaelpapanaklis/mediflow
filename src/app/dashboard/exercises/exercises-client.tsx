"use client";

import { useState } from "react";
import { Plus, X, Search, Dumbbell } from "lucide-react";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";
import styles from "./exercises.module.css";

interface Exercise {
  id: string;
  name: string;
  description: string | null;
  category: string;
  emoji: string;
  quantity: number;     // used as sets
  minQuantity: number;  // used as reps
  unit: string;         // used as muscle group
}

export function ExercisesClient({ initialExercises }: { initialExercises: Exercise[] }) {
  const t = useT();
  const askConfirm = useConfirm();
  const [exercises, setExercises] = useState<Exercise[]>(initialExercises);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", muscleGroup: "", sets: 3, reps: 12 });

  const filtered = exercises.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.unit.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd() {
    if (!form.name.trim()) { toast.error(t("pages.exercises.nameRequired")); return; }
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: "exercise_library",
          emoji: "🏋️",
          quantity: form.sets,
          minQuantity: form.reps,
          unit: form.muscleGroup || "General",
        }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setExercises(prev => [...prev, created]);
      setShowAdd(false);
      setForm({ name: "", description: "", muscleGroup: "", sets: 3, reps: 12 });
      toast.success(t("pages.exercises.added"));
    } catch {
      toast.error(t("pages.exercises.addError"));
    }
  }

  async function handleDelete(id: string) {
    if (!(await askConfirm({
      title: t("pages.exercises.deleteTitle"),
      description: t("pages.exercises.deleteDescription"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    try {
      const res = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      setExercises(prev => prev.filter(e => e.id !== id));
      toast.success(t("pages.exercises.deleted"));
    } catch {
      toast.error(t("pages.exercises.deleteError"));
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("pages.exercises.title")}</h1>
          <p className={styles.subtitle}>{t("pages.exercises.registeredCount", { count: exercises.length })}</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className={styles.btnPrimary}>
          <Plus size={16} strokeWidth={1.75} /> {t("pages.exercises.addExercise")}
        </button>
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <Search size={16} strokeWidth={1.75} className={styles.searchIcon} aria-hidden="true" />
        <input
          className={styles.searchInput}
          placeholder={t("pages.exercises.searchPlaceholder")}
          value={search} onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className={styles.grid}>
          {filtered.map(exercise => (
            <div key={exercise.id} className={styles.card}>
              <div className={styles.cardHead}>
                <h3 className={styles.cardName}>{exercise.name}</h3>
                <button
                  type="button"
                  onClick={() => handleDelete(exercise.id)}
                  className={styles.cardDelete}
                  aria-label={t("common.delete")}
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
              {exercise.description && <p className={styles.cardDesc}>{exercise.description}</p>}
              <div className={styles.cardMeta}>
                <span className={styles.muscleTag}>{exercise.unit}</span>
                <span className={styles.cardStat}>
                  {t("pages.exercises.setsReps", { sets: exercise.quantity, reps: exercise.minQuantity })}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyCard}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <Dumbbell size={22} strokeWidth={1.75} />
          </span>
          <p className={styles.emptyTitle}>
            {search ? t("common.noResults") : t("pages.exercises.emptyState")}
          </p>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>{t("pages.exercises.addExercise")}</h2>
              <button type="button" onClick={() => setShowAdd(false)} className={styles.modalClose} aria-label={t("common.close")}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("pages.exercises.nameLabel")}</Label>
                <input className={styles.input}
                  placeholder={t("pages.exercises.namePlaceholder")}
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("common.description")}</Label>
                <textarea className={styles.textarea}
                  placeholder={t("pages.exercises.descriptionPlaceholder")}
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("pages.exercises.muscleGroupLabel")}</Label>
                <input className={styles.input}
                  placeholder={t("pages.exercises.muscleGroupPlaceholder")}
                  value={form.muscleGroup} onChange={e => setForm(f => ({ ...f, muscleGroup: e.target.value }))} />
              </div>
              <div className={styles.formRow}>
                <div className={styles.field}>
                  <Label className={styles.fieldLabel}>{t("pages.exercises.setsLabel")}</Label>
                  <input type="number" min="1" className={styles.input}
                    value={form.sets} onChange={e => setForm(f => ({ ...f, sets: parseInt(e.target.value) || 1 }))} />
                </div>
                <div className={styles.field}>
                  <Label className={styles.fieldLabel}>{t("pages.exercises.repsLabel")}</Label>
                  <input type="number" min="1" className={styles.input}
                    value={form.reps} onChange={e => setForm(f => ({ ...f, reps: parseInt(e.target.value) || 1 }))} />
                </div>
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button type="button" onClick={() => setShowAdd(false)} className={styles.btnGhost}>{t("common.cancel")}</button>
              <button type="button" onClick={handleAdd} className={styles.btnPrimary}>{t("common.add")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
