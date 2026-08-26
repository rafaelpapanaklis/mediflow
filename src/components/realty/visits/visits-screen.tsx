"use client";

// ═══════════════════════════════════════════════════════════════════════
// LA PANTALLA de Visitas y Llaves. Cuatro pestañas sobre la misma área:
// agenda, ruta de hoy, llaves y recordatorios.
//
// 🔴 LO QUE ESTA PANTALLA NO NEGOCIA — el bug M-22:
// Al soltar una tarjeta en otra hora, el PATCH contesta cuántos
// recordatorios sin salir se cancelaron, y el aviso flotante LO DICE. No es
// adorno: es la prueba visible de que el recordatorio con la hora vieja ya
// no va a salir. En el dental se reagendaba y el aviso viejo salía igual; el
// prospecto recibía dos horas distintas y no sabía a cuál hacerle caso.
//
// i18n — CONVENCIÓN B: el servidor manda el sub-árbol YA recortado
// (visits.json → el idioma que toque) y aquí se llama a makeRealtyT SIN
// prefijo. Cruzar las dos convenciones es lo que pinta llaves crudas.
//
// FECHAS: cada conversión entre "lo que se ve" y "lo que se guarda" pasa por
// realtyLocalToUtc/realtyDateISO CON LA ZONA DE LA CUENTA. No hay un solo
// getHours() en todo el área.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Plus,
  RefreshCw,
  Route,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import css from "./visits.module.css";
import { VisitBoard, type BoardColumn, type DropTarget } from "./visit-board";
import { Banner, Empty, Toast, useNow, type ToastState } from "./visits-ui";
import { FeedbackDialog, NewVisitDialog, VisitDetailDialog, defaultSlot } from "./visit-dialogs";
import { KeysPanel, RemindersPanel, RoutePanel, type RouteOrigin } from "./visits-panels";
import {
  addDaysISO,
  realtyDateISO,
  realtyLocalToUtc,
  startOfWeekISO,
  weekDaysISO,
  weekdayOfISO,
  type RealtyVisitAgentDTO,
  type RealtyVisitCardDTO,
  type RealtyVisitOutcome,
  type RealtyVisitStatusKey,
} from "./visit-core";

/** Columna de las visitas que no tienen asesor. No es un id real de nadie. */
const UNASSIGNED = "__sin_asesor__";

/**
 * Hasta cuántos asesores se pintan SIEMPRE en la vista de día. Por encima,
 * solo salen los que traen visitas ese día (más uno mismo): veinte columnas
 * de 40 px no son una agenda, son una tabla ilegible.
 */
const DAY_COLUMN_LIMIT = 6;

export interface VisitsWindowPayload {
  visits: RealtyVisitCardDTO[];
  agents: RealtyVisitAgentDTO[];
  timeZone: string;
  fromISO: string;
  days: number;
  me: { realtyUserId: string; role: string };
}

export function VisitsScreen({
  dict,
  locale,
  initial,
  origin,
  canKeys,
  keysOverdue,
  canAssign,
}: {
  dict: Dictionary;
  locale: string;
  initial: VisitsWindowPayload;
  origin: RouteOrigin | null;
  canKeys: boolean;
  keysOverdue: number;
  /** Un AGENT no reasigna: el servidor lo fuerza y aquí se esconde el gesto. */
  canAssign: boolean;
}) {
  // 🔴 useMemo NO es cosmético: makeRealtyT devuelve una FUNCIÓN NUEVA en
  // cada render. Con `t` suelto en las dependencias de `load`, el efecto que
  // depende de `load` se volvería a disparar en cada render y la agenda
  // entraría en un bucle infinito de peticiones.
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const now = useNow();
  const timeZone = initial.timeZone;

  const [tab, setTab] = useState<"agenda" | "ruta" | "llaves" | "recordatorios">("agenda");
  const [view, setView] = useState<"day" | "week">("day");
  const [anchor, setAnchor] = useState(initial.fromISO);
  const [agentFilter, setAgentFilter] = useState("");

  const [data, setData] = useState<VisitsWindowPayload>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [overdue, setOverdue] = useState(keysOverdue);

  const [showNew, setShowNew] = useState(false);
  // 🔴 El diálogo guarda la VISITA, no su id. Guardando el id había que
  // tenerla dentro de `data.visits` para poder pintarla, y la ruta de hoy
  // (que abre visitas de HOY estando la agenda en otro día) la metía ahí a
  // la fuerza: el tablero la dibujaba en el día equivocado, porque la
  // rejilla confía en que la ventana ya viene recortada por el servidor.
  const [detail, setDetail] = useState<RealtyVisitCardDTO | null>(null);
  const [feedbackVisit, setFeedbackVisit] = useState<RealtyVisitCardDTO | null>(null);

  const fromISO = view === "week" ? startOfWeekISO(anchor) : anchor;
  const days = view === "week" ? 7 : 1;
  const todayISO = realtyDateISO(new Date(now), timeZone);

  // ── Carga ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const sp = new URLSearchParams();
      sp.set("date", fromISO);
      sp.set("days", String(days));
      if (agentFilter) sp.set("userId", agentFilter);
      const res = await fetch(`/api/realty/visits?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      setData((await res.json()) as VisitsWindowPayload);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fromISO, days, agentFilter]);

  // La primera ventana ya vino del servidor: solo se recarga cuando cambia
  // el rango o el filtro. Sin esta guarda se pediría dos veces al abrir.
  const firstKey = useRef(`${fromISO}|${days}|`);
  const mounted = useRef(false);
  useEffect(() => {
    const key = `${fromISO}|${days}|${agentFilter}`;
    if (!mounted.current) {
      mounted.current = true;
      if (key === firstKey.current) return;
    }
    void load();
  }, [load, fromISO, days, agentFilter]);

  /**
   * Sustituye UNA visita en el estado, sin volver a pedir la ventana entera.
   * Los diálogos abiertos se sincronizan aquí mismo: si no, el detalle
   * seguiría enseñando el estado viejo de la visita que se acaba de cambiar.
   */
  const patchVisit = useCallback((visit: RealtyVisitCardDTO) => {
    setData((prev) => ({
      ...prev,
      visits: prev.visits.map((v) => (v.id === visit.id ? visit : v)),
    }));
    setDetail((prev) => (prev && prev.id === visit.id ? visit : prev));
    setFeedbackVisit((prev) => (prev && prev.id === visit.id ? visit : prev));
  }, []);

  /** Estable: sin esto el temporizador del aviso se reiniciaba en cada render. */
  const clearToast = useCallback(() => setToast(null), []);

  // ── Columnas ──────────────────────────────────────────────────────────

  const dayColumns = useMemo((): BoardColumn[] => {
    if (agentFilter) {
      const one = data.agents.find((a) => a.id === agentFilter);
      return [{ id: agentFilter, label: one ? one.name : t("toolbar.agent"), isToday: anchor === todayISO }];
    }

    const withVisits = new Set<string>();
    let hasUnassigned = false;
    for (let i = 0; i < data.visits.length; i++) {
      const uid = data.visits[i].userId;
      if (uid) withVisits.add(uid);
      else hasUnassigned = true;
    }

    const showAll = data.agents.length <= DAY_COLUMN_LIMIT;
    const out: BoardColumn[] = [];
    for (let i = 0; i < data.agents.length; i++) {
      const a = data.agents[i];
      // Un asesor sin visitas ese día solo ocupa columna si el equipo es
      // chico: si no, se llenaría la pantalla de carriles vacíos.
      if (showAll || withVisits.has(a.id) || a.id === data.me.realtyUserId) {
        out.push({ id: a.id, label: a.name, isToday: anchor === todayISO });
      }
    }
    // 🔴 La columna "sin asesor" NO es opcional cuando hay visitas sin dueño:
    // sin ella `columnOf` devolvería una columna inexistente y esas visitas
    // DESAPARECERÍAN de la pantalla sin que nadie las borrara.
    if (hasUnassigned) {
      out.push({ id: UNASSIGNED, label: t("grid.unassigned"), isToday: anchor === todayISO });
    }
    if (out.length === 0) {
      out.push({ id: data.me.realtyUserId, label: t("toolbar.agent"), isToday: anchor === todayISO });
    }
    return out;
  }, [agentFilter, data.agents, data.visits, data.me.realtyUserId, anchor, todayISO, t]);

  const weekColumns = useMemo((): BoardColumn[] => {
    const shortDay = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      timeZone: timeZone || "America/Mexico_City",
      day: "numeric",
      month: "short",
    });
    return weekDaysISO(fromISO).map((iso) => ({
      id: iso,
      label: t(`weekdaysShort.${weekdayOfISO(iso)}`),
      meta: shortDay.format(realtyLocalToUtc(iso, 12 * 60, timeZone)),
      isToday: iso === todayISO,
    }));
  }, [fromISO, timeZone, locale, todayISO, t]);

  const columns = view === "week" ? weekColumns : dayColumns;

  const columnOf = useCallback(
    (visit: RealtyVisitCardDTO): string | null => {
      if (view === "week") return realtyDateISO(new Date(visit.scheduledAt), timeZone);
      return visit.userId ?? UNASSIGNED;
    },
    [view, timeZone],
  );

  // ── Mover ⭐ ──────────────────────────────────────────────────────────

  const applyMove = useCallback(
    async (
      visitId: string,
      body: { scheduledAt: string; userId?: string | null },
      opts: { undo?: () => void; silent?: boolean } = {},
    ) => {
      try {
        const res = await fetch(`/api/realty/visits/${visitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
          setToast({
            message: (json && json.error) || t("move.failed"),
            tone: "bad",
          });
          void load();
          return false;
        }
        patchVisit(json.visit as RealtyVisitCardDTO);
        if (!opts.silent) {
          const hora = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
            timeZone: timeZone || "America/Mexico_City",
            timeStyle: "short",
          }).format(new Date(body.scheduledAt));
          setToast({
            message: t("move.moved", { time: hora }),
            // 🔴 El recordatorio viejo se canceló y la pantalla LO DICE.
            note: json.remindersCancelled > 0 ? t("move.remindersCancelled") : null,
            tone: "ok",
            actionLabel: opts.undo ? t("move.undo") : null,
            onAction: opts.undo ?? null,
          });
        }
        return true;
      } catch {
        setToast({ message: t("move.failed"), tone: "bad" });
        void load();
        return false;
      }
    },
    [t, locale, timeZone, patchVisit, load],
  );

  const onDrop = useCallback(
    (target: DropTarget) => {
      const visit = target.visit;
      const dateISO = view === "week" ? target.columnId : fromISO;
      const scheduledAt = realtyLocalToUtc(dateISO, target.minute, timeZone).toISOString();

      // En la vista de día la columna ES el asesor; en la de semana es el
      // día y el asesor no se toca (por eso `userId` va ausente, que para el
      // servidor significa "déjalo como estaba" — un null lo BORRARÍA).
      const body: { scheduledAt: string; userId?: string | null } = { scheduledAt };
      let movedAgent = false;
      if (view === "day" && canAssign) {
        const nextUser = target.columnId === UNASSIGNED ? null : target.columnId;
        if (nextUser !== visit.userId) {
          body.userId = nextUser;
          movedAgent = true;
        }
      }

      const undoBody: { scheduledAt: string; userId?: string | null } = {
        scheduledAt: visit.scheduledAt,
      };
      if (movedAgent) undoBody.userId = visit.userId;

      const undo = () => {
        void applyMove(visit.id, undoBody, { silent: true }).then((ok) => {
          setToast({ message: ok ? t("move.undone") : t("move.undoFailed"), tone: ok ? "ok" : "bad" });
        });
      };

      void applyMove(visit.id, body, { undo });
    },
    [view, fromISO, timeZone, canAssign, applyMove, t],
  );

  // ── Estado y retroalimentación ───────────────────────────────────────

  const setStatus = useCallback(
    async (
      visitId: string,
      status: RealtyVisitStatusKey,
      feedback?: { outcome: RealtyVisitOutcome | null; note: string | null },
    ) => {
      const body: Record<string, unknown> = { status };
      if (feedback) {
        body.outcome = feedback.outcome;
        body.note = feedback.note;
      }
      const res = await fetch(`/api/realty/visits/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setToast({ message: (json && json.error) || t("error"), tone: "bad" });
        throw new Error("status");
      }
      patchVisit(json.visit as RealtyVisitCardDTO);
    },
    [patchVisit, t],
  );

  // ── Etiqueta del rango ───────────────────────────────────────────────

  const rangeLabel = useMemo(() => {
    const loc = locale === "en" ? "en-US" : "es-MX";
    const tz = timeZone || "America/Mexico_City";
    if (view === "day") {
      return new Intl.DateTimeFormat(loc, {
        timeZone: tz,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(realtyLocalToUtc(anchor, 12 * 60, timeZone));
    }
    const fmt = new Intl.DateTimeFormat(loc, { timeZone: tz, day: "numeric", month: "short" });
    const a = fmt.format(realtyLocalToUtc(fromISO, 12 * 60, timeZone));
    const b = fmt.format(realtyLocalToUtc(addDaysISO(fromISO, 6), 12 * 60, timeZone));
    return `${a} – ${b}`;
  }, [view, anchor, fromISO, timeZone, locale]);

  const step = view === "week" ? 7 : 1;
  const slot = defaultSlot(view === "week" ? todayISO : anchor, timeZone, now);

  const tabs: { key: typeof tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "agenda", label: t("tabs.agenda"), icon: <CalendarDays size={14} aria-hidden="true" /> },
    { key: "ruta", label: t("tabs.ruta"), icon: <Route size={14} aria-hidden="true" /> },
    ...(canKeys
      ? [
          {
            key: "llaves" as const,
            label: t("tabs.llaves"),
            icon: <KeyRound size={14} aria-hidden="true" />,
            badge: overdue,
          },
        ]
      : []),
    { key: "recordatorios", label: t("tabs.recordatorios"), icon: <Bell size={14} aria-hidden="true" /> },
  ];

  return (
    <>
      <div className="realty-page">
        <header className={css.head}>
          <h1 className={css.title}>{t("title")}</h1>
          <p className={css.subtitle}>{t("subtitle")}</p>
        </header>

        <nav className={css.tabs} aria-label={t("title")}>
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? `${css.tab} ${css.tabActive}` : css.tab}
              aria-current={tab === item.key ? "page" : undefined}
              onClick={() => setTab(item.key)}
            >
              {item.icon}
              {item.label}
              {item.badge ? <span className={css.tabBadge}>{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        {tab === "agenda" ? (
          <>
            <div className={css.toolbar}>
              <div className={css.segment} role="group" aria-label={t("toolbar.view")}>
                <button
                  type="button"
                  className={view === "day" ? `${css.segmentBtn} ${css.segmentActive}` : css.segmentBtn}
                  aria-pressed={view === "day"}
                  onClick={() => setView("day")}
                >
                  {t("toolbar.day")}
                </button>
                <button
                  type="button"
                  className={view === "week" ? `${css.segmentBtn} ${css.segmentActive}` : css.segmentBtn}
                  aria-pressed={view === "week"}
                  onClick={() => setView("week")}
                >
                  {t("toolbar.week")}
                </button>
              </div>

              <button
                type="button"
                className={`${css.btn} ${css.btnSm}`}
                aria-label={t("toolbar.prev")}
                onClick={() => setAnchor((a) => addDaysISO(a, -step))}
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              <button type="button" className={css.btn} onClick={() => setAnchor(todayISO)}>
                {t("toolbar.today")}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnSm}`}
                aria-label={t("toolbar.next")}
                onClick={() => setAnchor((a) => addDaysISO(a, step))}
              >
                <ChevronRight size={14} aria-hidden="true" />
              </button>

              <span className={css.rangeLabel}>{rangeLabel}</span>
              <span className={css.toolbarSpacer} />

              {data.agents.length > 1 ? (
                <select
                  className={css.select}
                  style={{ width: "auto", minWidth: 150 }}
                  aria-label={t("toolbar.agent")}
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                >
                  <option value="">{t("toolbar.allAgents")}</option>
                  {data.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : null}

              <button
                type="button"
                className={css.btn}
                onClick={() => void load()}
                disabled={loading}
                aria-label={t("toolbar.refresh")}
              >
                <RefreshCw size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnPrimary}`}
                onClick={() => setShowNew(true)}
              >
                <Plus size={14} aria-hidden="true" />
                {t("toolbar.new")}
              </button>
            </div>

            {error ? (
              <Banner tone="warn">
                <span>{t("error")}</span>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnSm}`}
                  onClick={() => void load()}
                  style={{ marginLeft: "auto" }}
                >
                  {t("retry")}
                </button>
              </Banner>
            ) : null}

            <VisitBoard
              visits={data.visits}
              columns={columns}
              columnOf={columnOf}
              columnKind={view === "week" ? "day" : "agent"}
              timeZone={timeZone}
              t={t}
              now={now}
              canDrag
              onOpen={setDetail}
              onDrop={onDrop}
            />

            {data.visits.length === 0 && !loading ? (
              <Empty>{view === "week" ? t("grid.empty") : t("grid.emptyDay")}</Empty>
            ) : (
              <p className={css.hint}>{t("grid.hint")}</p>
            )}
          </>
        ) : null}

        {tab === "ruta" ? (
          <RoutePanel
            t={t}
            timeZone={timeZone}
            locale={locale}
            origin={origin}
            agents={data.agents}
            meId={data.me.realtyUserId}
            onOpenVisit={setDetail}
          />
        ) : null}

        {tab === "llaves" && canKeys ? (
          <KeysPanel
            t={t}
            timeZone={timeZone}
            locale={locale}
            onToast={setToast}
            onCountChange={setOverdue}
          />
        ) : null}

        {tab === "recordatorios" ? (
          <RemindersPanel t={t} timeZone={timeZone} locale={locale} onToast={setToast} />
        ) : null}
      </div>

      {/* Los diálogos se montan FUERA de .realty-page: ese contenedor declara
          container-type y atraparía su position:fixed. Además se pintan en un
          portal a .realty-shell (ver visits-ui.tsx). */}
      {showNew ? (
        <NewVisitDialog
          t={t}
          timeZone={timeZone}
          agents={data.agents}
          canAssign={canAssign}
          defaultDateISO={slot.dateISO}
          defaultMinute={slot.minute}
          defaultAgentId={agentFilter || (canAssign ? "" : data.me.realtyUserId)}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void load();
          }}
        />
      ) : null}

      {detail && !feedbackVisit ? (
        <VisitDetailDialog
          t={t}
          visit={detail}
          timeZone={timeZone}
          locale={locale}
          onClose={() => setDetail(null)}
          onStatus={async (status) => {
            await setStatus(detail.id, status);
            setDetail(null);
          }}
          onAskFeedback={() => setFeedbackVisit(detail)}
        />
      ) : null}

      {feedbackVisit ? (
        <FeedbackDialog
          t={t}
          visit={feedbackVisit}
          onClose={() => setFeedbackVisit(null)}
          onSave={async (feedback) => {
            await setStatus(feedbackVisit.id, "REALIZADA", feedback);
            setFeedbackVisit(null);
            setDetail(null);
          }}
        />
      ) : null}

      <Toast state={toast} onDone={clearToast} />
    </>
  );
}
