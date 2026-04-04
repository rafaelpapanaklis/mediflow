"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, CheckCircle, Clock } from "lucide-react";
import toast from "react-hot-toast";

interface Appt {
  id: string; type: string; startTime: string; endTime: string; durationMins: number;
  status: string; notes?: string | null;
  patient: { id: string; firstName: string; lastName: string; phone?: string | null };
  doctor:  { id: string; firstName: string; lastName: string; color: string };
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  PENDING:     { label:"Pendiente",  dot:"bg-amber-400",   bg:"bg-amber-50 dark:bg-amber-900/20",   text:"text-amber-700 dark:text-amber-300"   },
  CONFIRMED:   { label:"Confirmada", dot:"bg-emerald-400", bg:"bg-emerald-50 dark:bg-emerald-900/20",text:"text-emerald-700 dark:text-emerald-300"},
  IN_PROGRESS: { label:"En curso",   dot:"bg-blue-400",    bg:"bg-blue-50 dark:bg-blue-900/20",     text:"text-blue-700 dark:text-blue-300"     },
  COMPLETED:   { label:"Completada", dot:"bg-slate-400",   bg:"bg-slate-100 dark:bg-slate-800",     text:"text-slate-500 dark:text-slate-400"   },
  CANCELLED:   { label:"Cancelada",  dot:"bg-rose-400",    bg:"bg-rose-50 dark:bg-rose-900/20",     text:"text-rose-700 dark:text-rose-300"     },
  NO_SHOW:     { label:"No asistió", dot:"bg-orange-400",  bg:"bg-orange-50 dark:bg-orange-900/20", text:"text-orange-700 dark:text-orange-300" },
};

export function TodayStrip({ initialAppts }: { initialAppts: Appt[] }) {
  const [appts, setAppts] = useState<Appt[]>(initialAppts);

  async function changeStatus(id: string, status: string) {
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Error");
      setAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a));
      const labels: Record<string, string> = { IN_PROGRESS:"En curso", COMPLETED:"Completada", CONFIRMED:"Confirmada" };
      toast.success(`${labels[status] ?? status}`);
    } catch { toast.error("Error al actualizar"); }
  }

  if (appts.length === 0) return null;

  const active   = appts.filter(a => a.status === "IN_PROGRESS");
  const pending  = appts.filter(a => ["PENDING","CONFIRMED"].includes(a.status));
  const done     = appts.filter(a => ["COMPLETED","CANCELLED","NO_SHOW"].includes(a.status));

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  return (
    <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl shadow-card overflow-hidden mb-5">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-base font-bold">Citas de hoy</span>
          <span className="text-sm font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full">{appts.length}</span>
          {active.length > 0 && (
            <span className="flex items-center gap-1.5 text-sm font-bold text-blue-600">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              {active.length} en curso
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground font-mono">{timeStr}</span>
          <Link href="/dashboard/appointments"
            className="text-sm text-brand-600 font-semibold hover:underline">
            Ver agenda completa →
          </Link>
        </div>
      </div>

      {/* Appointments - horizontal scroll on mobile */}
      <div className="divide-y divide-border/50">
        {[...active, ...pending, ...done].map(appt => {
          const cfg   = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.PENDING;
          const isDone = ["COMPLETED","CANCELLED","NO_SHOW"].includes(appt.status);
          const isActive = appt.status === "IN_PROGRESS";

          return (
            <div key={appt.id}
              className={`flex items-center gap-4 px-5 py-3.5 transition-colors group
                ${isActive ? "bg-blue-50/50 dark:bg-blue-950/10" : "hover:bg-muted/10"}
                ${isDone ? "opacity-60" : ""}`}>

              {/* Time */}
              <div className="text-center flex-shrink-0 w-12">
                <div className="text-base font-extrabold text-foreground leading-none">{appt.startTime}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{appt.durationMins}m</div>
              </div>

              {/* Color bar */}
              <div className="w-1 h-10 rounded-full flex-shrink-0"
                style={{ background: appt.doctor.color }} />

              {/* Patient info */}
              <div className="flex-1 min-w-0">
                <Link href={`/dashboard/patients/${appt.patient.id}`}
                  className="text-base font-bold hover:text-brand-600 transition-colors">
                  {appt.patient.firstName} {appt.patient.lastName}
                </Link>
                <div className="text-sm text-muted-foreground">
                  {appt.type} · Dr/a. {appt.doctor.firstName} {appt.doctor.lastName}
                </div>
              </div>

              {/* Status badge */}
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${cfg.dot}`} />
                {cfg.label}
              </span>

              {/* 1-click action buttons */}
              {!isDone && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {appt.status !== "IN_PROGRESS" && (
                    <button onClick={() => changeStatus(appt.id, "IN_PROGRESS")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-all hover:scale-105 active:scale-95 shadow-sm">
                      <Play className="w-3.5 h-3.5" /> Iniciar
                    </button>
                  )}
                  {appt.status === "IN_PROGRESS" && (
                    <button onClick={() => changeStatus(appt.id, "COMPLETED")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-all hover:scale-105 active:scale-95 shadow-sm">
                      <CheckCircle className="w-3.5 h-3.5" /> Completar
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
