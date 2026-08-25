"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Plus } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { Dialog, Field } from "./lead-bits";
import { dateTime } from "./lead-ui";

export interface RealtyTaskRow {
  id: string;
  title: string;
  dueAt: string;
  done: boolean;
  userId: string;
  userName: string | null;
  leadId: string | null;
  leadName: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  overdue: boolean;
}

/**
 * "Mis pendientes de hoy" — lo vencido más lo que cae hoy.
 *
 * Consume /api/realty/leads/tasks, que es la MISMA ruta que después usará
 * el Inicio: el criterio de "hoy" (fin del día en la zona de la cuenta,
 * no del servidor) vive en el servidor y no se reimplementa aquí.
 */
export function TasksToday({
  t,
  canAssign,
  timeZone,
  locale,
}: {
  t: TFunction;
  canAssign: boolean;
  timeZone: string;
  locale: string;
}) {
  const [tasks, setTasks] = useState<RealtyTaskRow[]>([]);
  const [scope, setScope] = useState<"MIOS" | "EQUIPO">("MIOS");
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(
    async (all: boolean) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/realty/leads/tasks${all ? "?all=1" : ""}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { tasks: RealtyTaskRow[]; scope: "MIOS" | "EQUIPO" };
        setTasks(json.tasks);
        setScope(json.scope);
      } catch {
        /* el panel de pendientes no puede tumbar el embudo */
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  async function toggle(task: RealtyTaskRow) {
    // Optimismo: la palomita responde al instante y se quita la fila.
    setTasks((prev) => prev.filter((x) => x.id !== task.id));
    try {
      await fetch("/api/realty/leads/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, done: true }),
      });
    } catch {
      void load(scope === "EQUIPO");
    }
  }

  return (
    <>
      <section className="lead-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h2 className="lead-panel__title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <CalendarClock size={15} aria-hidden style={{ color: "var(--brand)" }} />
            {t("task.todayTitle")}
          </h2>
          <div style={{ display: "flex", gap: 6 }}>
            {canAssign ? (
              <div role="tablist" aria-label={t("task.todayTitle")} style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={scope === "MIOS"}
                  className="lead-btn lead-btn--sm"
                  onClick={() => void load(false)}
                  style={scope === "MIOS" ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)" } : undefined}
                >
                  {t("task.scope.mine")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={scope === "EQUIPO"}
                  className="lead-btn lead-btn--sm"
                  onClick={() => void load(true)}
                  style={scope === "EQUIPO" ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)" } : undefined}
                >
                  {t("task.scope.team")}
                </button>
              </div>
            ) : null}
            <button type="button" className="lead-btn lead-btn--sm" onClick={() => setShowNew(true)}>
              <Plus size={13} aria-hidden />
              {t("actions.newTask")}
            </button>
          </div>
        </div>

        {loading ? (
          <p style={{ margin: "9px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>{t("loading")}</p>
        ) : tasks.length === 0 ? (
          <p style={{ margin: "9px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>{t("task.todayEmpty")}</p>
        ) : (
          <ul style={{ listStyle: "none", margin: "9px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map((task) => (
              <li
                key={task.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 10px",
                  border: "1px solid var(--border-soft)",
                  borderLeft: `3px solid ${task.overdue ? "#C62828" : "var(--brand)"}`,
                  borderRadius: 10,
                  background: "var(--bg-elev-2)",
                }}
              >
                <button
                  type="button"
                  className="lead-btn lead-btn--sm"
                  onClick={() => void toggle(task)}
                  title={t("task.done")}
                  style={{ padding: 5, borderRadius: 999 }}
                >
                  <Check size={13} aria-hidden />
                  <span className="lead-sr">{t("task.done")}</span>
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lead-truncate" style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 600 }}>
                    {task.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: task.overdue ? "var(--danger)" : "var(--text-3)" }}>
                    {task.overdue ? `${t("task.overdue")} · ` : ""}
                    {dateTime(task.dueAt, locale)}
                    {task.leadName ? ` · ${task.leadName}` : ""}
                    {scope === "EQUIPO" && task.userName ? ` · ${task.userName}` : ""}
                  </div>
                </div>
                {task.leadId ? (
                  <Link href={`/inmobiliaria/prospectos/${task.leadId}`} className="lead-btn lead-btn--sm lead-btn--ghost">
                    {t("actions.open")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {showNew ? (
        <NewTaskDialog
          t={t}
          timeZone={timeZone}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void load(scope === "EQUIPO");
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Alta de pendiente. Se abre desde dentro de `.realty-page`, que declara
 * container-type y atraparía cualquier position:fixed — por eso `Dialog`
 * se pinta en un portal a `.realty-shell` (ver lead-bits.tsx). Aquí no hay
 * nada especial que hacer.
 */
function NewTaskDialog({
  t,
  timeZone,
  onClose,
  onCreated,
}: {
  t: TFunction;
  timeZone: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState(() => defaultDue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (title.trim().length < 2) {
      setError(t("task.what"));
      return;
    }
    const when = new Date(dueAt);
    if (Number.isNaN(when.getTime())) {
      setError(t("error"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/realty/leads/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueAt: when.toISOString() }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? t("error"));
        return;
      }
      onCreated();
    } catch {
      setError(t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={t("task.title")}
      closeLabel={t("actions.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="lead-btn" onClick={onClose} disabled={saving}>
            {t("actions.cancel")}
          </button>
          <button type="button" className="lead-btn realty-btn-primary" onClick={submit} disabled={saving}>
            {t("task.create")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      <Field label={t("task.what")} htmlFor="nt-title">
        <input
          id="nt-title"
          className="lead-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("task.whatPlaceholder")}
          autoComplete="off"
        />
      </Field>
      <Field label={t("task.due")} help={timeZone} htmlFor="nt-due">
        <input
          id="nt-due"
          className="lead-input"
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/** Mañana a las 10:00, en formato datetime-local (sin zona). */
export function defaultDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
