"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Banknote, UserPlus, CheckCircle2, CalendarClock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { isAbortError } from "@/lib/fetch-safe";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { vestidor, type AparienciaTopbar } from "@/components/dashboard/topbar-rediseno/apariencia";
import c from "@/components/dashboard/topbar-rediseno/piezas-topbar.module.css";

interface ActivityEvent {
  id: string;
  type: "payment" | "patient_new" | "appointment_completed" | "booking_request";
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
  booking_request: { Icon: CalendarClock, color: "#fbbf24" },
};
/** Un tipo desconocido (feed más nuevo que este bundle) no debe tumbar la campana. */
const FALLBACK_ICON = { Icon: Bell, color: "#94a3b8" };

/** El tono de cada tipo con la ropa nueva: semáforo de globals + marca del menú. */
const TONO_NUEVO: Record<ActivityEvent["type"], string> = {
  payment: c.tonoExito,
  patient_new: c.tonoMarca,
  appointment_completed: c.tonoInfo,
  booking_request: c.tonoAlerta,
};

/**
 * `apariencia`: la ropa (topbar-rediseno/apariencia.ts). Sin ella —la barra
 * de siempre— cada elemento recibe EXACTAMENTE los `style` de antes; con
 * "nueva" —la barra del menú de dos niveles— se pinta con las clases del
 * rediseño. La lógica (sondeo, marcar leído, cerrar al clic fuera) es una.
 */
export function NotificationsPopover({ apariencia }: { apariencia?: AparienciaTopbar }) {
  const t = useT();
  const nueva = apariencia === "nueva";
  const vestir = vestidor(apariencia);
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
      if (!isAbortError(err)) { /* silent */ }
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
    <div ref={wrapperRef} {...vestir({ position: "relative" }, c.ancla)}>
      <button
        type="button"
        onClick={handleToggle}
        className={nueva ? c.botonIcono : "icon-btn-new"}
        title={t("shell.notif.title")}
        aria-label={unreadCount > 0 ? t("shell.notif.ariaUnread", { count: unreadCount }) : t("shell.notif.title")}
      >
        <Bell size={nueva ? 17 : 14} />
        {unreadCount > 0 && <span className={nueva ? c.punto : "icon-btn-new__dot"} />}
      </button>

      {open && (
        <div
          {...vestir({
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 360, maxHeight: 480,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12, overflow: "hidden",
            boxShadow: "0 16px 40px -8px rgba(0,0,0,0.55)",
            zIndex: 100, display: "flex", flexDirection: "column",
          }, `${CLASES_MENU} ${c.piel} ${c.panel}`)}
        >
          <div {...vestir({ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }, c.cabecera)}>
            {t("shell.notif.recentActivity")}
          </div>
          <div {...vestir({ overflowY: "auto", flex: 1 }, c.lista)}>
            {loading ? (
              <div {...vestir({ padding: 24, textAlign: "center", fontSize: 12, color: "var(--text-3)" }, c.vacio)}>{t("common.loading")}</div>
            ) : events.length === 0 ? (
              <div {...vestir({ padding: 24, textAlign: "center", fontSize: 12, color: "var(--text-3)" }, c.vacio)}>{t("shell.notif.empty")}</div>
            ) : (
              events.map(ev => {
                const conf = TYPE_ICON[ev.type] ?? FALLBACK_ICON;
                // El feed sólo trae actividad OCURRIDA (el API descarta fechas
                // futuras), pero addSuffix rendería "en X" si el reloj DEL
                // NAVEGADOR va adelantado del servidor. Clampamos a ahora para
                // que un evento pasado nunca se lea como futuro.
                const at = new Date(ev.at);
                const now = new Date();
                const when = formatDistanceToNow(at > now ? now : at, { addSuffix: true, locale: es });
                return (
                  <Link
                    key={ev.id}
                    href={ev.href}
                    onClick={() => setOpen(false)}
                    style={nueva ? undefined : {
                      display: "flex", gap: 10, padding: "10px 14px",
                      textDecoration: "none", color: "var(--text-1)",
                      borderBottom: "1px solid var(--border-soft)",
                    }}
                    className={nueva ? c.fila : "notif-item"}
                  >
                    <div {...vestir({
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: `${conf.color}1f`,
                      display: "grid", placeItems: "center",
                    }, `${c.icono} ${TONO_NUEVO[ev.type] ?? c.tonoNeutro}`)}>
                      <conf.Icon size={14} style={nueva ? undefined : { color: conf.color }} />
                    </div>
                    <div {...vestir({ flex: 1, minWidth: 0 }, c.filaTextos)}>
                      <div {...vestir({ fontSize: 12.5, color: "var(--text-1)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, c.filaTitulo)}>{ev.title}</div>
                      {ev.subtitle && (
                        <div className={nueva ? c.filaSub : "mono"} style={nueva ? undefined : { fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{ev.subtitle}</div>
                      )}
                      <div {...vestir({ fontSize: 10, color: "var(--text-3)", marginTop: 3 }, c.filaCuando)}>{when}</div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
          {!nueva && <style>{`
            .notif-item:hover { background: var(--bg-elev-2); }
          `}</style>}
        </div>
      )}
    </div>
  );
}
