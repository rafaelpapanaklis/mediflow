"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Banknote, UserPlus, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface ActivityEvent {
  id: string;
  type: "payment" | "patient_new" | "appointment_completed";
  title: string;
  subtitle?: string;
  amount?: number;
  href: string;
  at: string;
}

const TYPE_ICON = {
  payment: { Icon: Banknote, color: "#34d399" },
  patient_new: { Icon: UserPlus, color: "#a78bfa" },
  appointment_completed: { Icon: CheckCircle2, color: "#38bdf8" },
};

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

  async function fetchActivity(signal?: AbortSignal) {
    try {
      const res = await fetch("/api/dashboard/activity", { signal });
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch (err: any) {
      if (err.name !== "AbortError") { /* silent */ }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    fetchActivity(ctrl.signal);
    // Pausa polling cuando la pestaña no está visible — el bell no
    // necesita actualizarse si el usuario no está mirando.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (intervalId === null) intervalId = setInterval(() => fetchActivity(), 60_000); };
    const stop = () => { if (intervalId !== null) { clearInterval(intervalId); intervalId = null; } };
    const onVis = () => {
      if (document.visibilityState === "visible") { fetchActivity(); start(); }
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

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && unreadCount > 0) {
      setUnreadCount(0);
      try {
        await fetch("/api/dashboard/activity/mark-read", { method: "POST" });
      } catch { /* silent */ }
    }
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={handleToggle}
        className="icon-btn-new"
        title="Notificaciones"
        aria-label={`Notificaciones${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ""}`}
      >
        <Bell size={14} />
        {unreadCount > 0 && <span className="icon-btn-new__dot" />}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 360, maxHeight: 480,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12, overflow: "hidden",
            boxShadow: "0 16px 40px -8px rgba(0,0,0,0.55)",
            zIndex: 100, display: "flex", flexDirection: "column",
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
            Actividad reciente
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>Cargando…</div>
            ) : events.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>Sin actividad reciente</div>
            ) : (
              events.map(ev => {
                const conf = TYPE_ICON[ev.type];
                const when = formatDistanceToNow(new Date(ev.at), { addSuffix: true, locale: es });
                return (
                  <Link
                    key={ev.id}
                    href={ev.href}
                    onClick={() => setOpen(false)}
                    style={{
                      display: "flex", gap: 10, padding: "10px 14px",
                      textDecoration: "none", color: "var(--text-1)",
                      borderBottom: "1px solid var(--border-soft)",
                    }}
                    className="notif-item"
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: `${conf.color}1f`,
                      display: "grid", placeItems: "center",
                    }}>
                      <conf.Icon size={14} style={{ color: conf.color }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: "var(--text-1)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                      {ev.subtitle && (
                        <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{ev.subtitle}</div>
                      )}
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{when}</div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
          <style>{`
            .notif-item:hover { background: var(--bg-elev-2); }
          `}</style>
        </div>
      )}
    </div>
  );
}
