"use client";

import { useState, useEffect } from "react";
import { Plus, X, Clock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

interface QueueItem {
  id: string;
  patientName: string;
  service: string;
  priority: number;
  status: string;
  assignedTo: string | null;
  joinedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  WAITING: "pages.walkIn.statusWaiting",
  ASSIGNED: "pages.walkIn.statusAssigned",
  IN_PROGRESS: "pages.walkIn.statusInProgress",
  COMPLETED: "pages.walkIn.statusCompleted",
  CANCELLED: "pages.walkIn.statusCancelled",
};

const STATUS_COLORS: Record<string, string> = {
  WAITING: "bg-amber-100 text-amber-700 border-amber-300",
  ASSIGNED: "bg-blue-100 text-blue-700 border-blue-300",
  IN_PROGRESS: "bg-brand-500/15 text-brand-700 border-brand-300",
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-300",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    function update() {
      const diff = Date.now() - new Date(since).getTime();
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      setElapsed(hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`);
    }
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [since]);

  return <span className="text-xs font-medium">{elapsed}</span>;
}

export function WalkInClient({ initialQueue }: { initialQueue: QueueItem[] }) {
  const t = useT();
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ patientName: "", service: "" });

  const statusLabel = (status: string) =>
    STATUS_LABEL_KEYS[status] ? t(STATUS_LABEL_KEYS[status]) : status;

  // Auto-refresh cada 30s con pausa cuando la pestaña no está visible.
  useEffect(() => {
    const ctrl = new AbortController();
    const fetchQueue = async () => {
      try {
        const res = await fetch("/api/walk-in", { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && !ctrl.signal.aborted) setQueue(data);
        }
      } catch { /* ignore */ }
    };
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (intervalId === null) intervalId = setInterval(fetchQueue, 30_000); };
    const stop = () => { if (intervalId !== null) { clearInterval(intervalId); intervalId = null; } };
    const onVis = () => {
      if (document.visibilityState === "visible") { fetchQueue(); start(); }
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  async function handleAdd() {
    if (!form.patientName.trim() || !form.service.trim()) {
      toast.error(t("pages.walkIn.nameServiceRequired"));
      return;
    }
    try {
      const res = await fetch("/api/walk-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setQueue(prev => [...prev, created]);
      setShowAdd(false);
      setForm({ patientName: "", service: "" });
      toast.success(t("pages.walkIn.patientAdded"));
    } catch {
      toast.error(t("pages.walkIn.addError"));
    }
  }

  async function handleAction(id: string, action: string) {
    try {
      const res = await fetch(`/api/walk-in/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setQueue(prev => prev.map(q => q.id === id ? updated : q));
      toast.success(t("pages.walkIn.statusUpdatedToast", { status: statusLabel(updated.status) }));
    } catch {
      toast.error(t("pages.walkIn.updateError"));
    }
  }

  const activeQueue = queue.filter(q => q.status !== "COMPLETED" && q.status !== "CANCELLED");
  const doneQueue = queue.filter(q => q.status === "COMPLETED" || q.status === "CANCELLED");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">{t("pages.walkIn.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("pages.walkIn.waitingCount", { count: activeQueue.length })}</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <UserPlus className="w-5 h-5 mr-2" /> {t("pages.walkIn.addPatient")}
        </Button>
      </div>

      {/* Active queue */}
      <div className="space-y-3 mb-8">
        {activeQueue.map(item => (
          <div key={item.id} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-base font-bold">{item.patientName}</p>
                <p className="text-sm text-muted-foreground">{item.service}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${STATUS_COLORS[item.status] || ""}`}>
                {statusLabel(item.status)}
              </span>
            </div>
            <div className="flex items-center gap-4 text-muted-foreground mb-3">
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">{t("pages.walkIn.arrived")} {new Date(item.joinedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">{t("pages.walkIn.waitingLabel")} </span>
                <ElapsedTimer since={item.joinedAt} />
              </div>
            </div>
            <div className="flex gap-2">
              {item.status === "WAITING" && (
                <Button size="sm" variant="outline" onClick={() => handleAction(item.id, "assign")}>{t("pages.walkIn.assign")}</Button>
              )}
              {(item.status === "WAITING" || item.status === "ASSIGNED") && (
                <Button size="sm" onClick={() => handleAction(item.id, "start")}>{t("pages.walkIn.start")}</Button>
              )}
              {item.status === "IN_PROGRESS" && (
                <Button size="sm" onClick={() => handleAction(item.id, "complete")}>{t("pages.walkIn.complete")}</Button>
              )}
              {item.status !== "COMPLETED" && item.status !== "CANCELLED" && (
                <Button size="sm" variant="outline" className="text-rose-500 border-rose-300 hover:bg-rose-50" onClick={() => handleAction(item.id, "cancel")}>{t("common.cancel")}</Button>
              )}
            </div>
          </div>
        ))}
        {activeQueue.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <UserPlus className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-base font-semibold">{t("pages.walkIn.emptyActive")}</p>
          </div>
        )}
      </div>

      {/* Done queue */}
      {doneQueue.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3 text-muted-foreground">{t("pages.walkIn.attendedToday")}</h2>
          <div className="space-y-2">
            {doneQueue.map(item => (
              <div key={item.id} className="bg-muted/50 border border-border/50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.patientName}</p>
                  <p className="text-xs text-muted-foreground">{item.service}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${STATUS_COLORS[item.status] || ""}`}>
                  {statusLabel(item.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-bold">{t("pages.walkIn.addToQueue")}</h2>
              <button onClick={() => setShowAdd(false)} aria-label={t("common.close")} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto min-h-0">
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.walkIn.patientNameLabel")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.walkIn.fullNamePlaceholder")}
                  value={form.patientName} onChange={e => setForm(f => ({ ...f, patientName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.walkIn.serviceLabel")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.walkIn.servicePlaceholder")}
                  value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
              </div>
            </div>
            <div className="px-6 py-4 flex gap-3 shrink-0 border-t border-border">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">{t("common.cancel")}</Button>
              <Button onClick={handleAdd} className="flex-1 h-11 text-base">{t("common.add")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
