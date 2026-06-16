"use client";

// Calendario del módulo Marketing (WS-MKT-T3). Vista mensual/semanal con posts
// coloreados por estado; clic en un post → editar en Composer; clic en un día
// vacío → crear en esa fecha; lista lateral de próximos. date-fns + tokens var(--).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  startOfMonth,
  startOfWeek,
  endOfDay,
  addDays,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  format,
  isSameMonth,
  isToday,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Facebook,
  Instagram,
  Megaphone,
  AlertTriangle,
  CalendarDays,
} from "lucide-react";

interface Post {
  id: string;
  channel: string;
  caption: string;
  mediaUrls: string[];
  status: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
}

type View = "month" | "week";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const STATUS_META: Record<string, { label: string; color: string; soft: string }> = {
  DRAFT: { label: "Borrador", color: "var(--text-3)", soft: "var(--bg-elev-2)" },
  SCHEDULED: { label: "Programado", color: "var(--info)", soft: "var(--info-soft)" },
  PUBLISHING: { label: "Publicando", color: "var(--warning)", soft: "var(--warning-soft)" },
  PUBLISHED: { label: "Publicado", color: "var(--success)", soft: "var(--success-soft)" },
  FAILED: { label: "Falló", color: "var(--danger)", soft: "var(--danger-soft)" },
};
function statusOf(s: string) {
  return STATUS_META[s] ?? STATUS_META.DRAFT;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function postDate(p: Post): string {
  return p.scheduledFor || p.publishedAt || p.createdAt;
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  borderRadius: 9,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)",
  color: "var(--text-2)",
  cursor: "pointer",
};

export default function CalendarClient() {
  const router = useRouter();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [posts, setPosts] = useState<Post[]>([]);
  const [upcoming, setUpcoming] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  // Rango visible + celdas + título (memoizado; depende solo de cursor+view).
  const { fromISO, toISO, cells, title } = useMemo(() => {
    if (view === "month") {
      const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
      const list: Date[] = [];
      for (let i = 0; i < 42; i++) list.push(addDays(gridStart, i));
      return {
        fromISO: gridStart.toISOString(),
        toISO: endOfDay(list[41]).toISOString(),
        cells: list,
        title: cap(format(cursor, "LLLL yyyy", { locale: es })),
      };
    }
    const wkStart = startOfWeek(cursor, { weekStartsOn: 1 });
    const list: Date[] = [];
    for (let i = 0; i < 7; i++) list.push(addDays(wkStart, i));
    return {
      fromISO: wkStart.toISOString(),
      toISO: endOfDay(list[6]).toISOString(),
      cells: list,
      title: `${format(wkStart, "d MMM", { locale: es })} – ${format(list[6], "d MMM yyyy", { locale: es })}`,
    };
  }, [cursor, view]);

  // Agrupa los posts por día local (clave yyyy-MM-dd) — memoizado.
  const byDay = useMemo(() => {
    const map: Record<string, Post[]> = {};
    posts.forEach((p) => {
      const ref = postDate(p);
      if (!ref) return;
      const d = new Date(ref);
      if (isNaN(d.getTime())) return;
      const key = format(d, "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [posts]);

  const loadGrid = useCallback(async (from: string, to: string) => {
    const myId = reqRef.current + 1;
    reqRef.current = myId;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/marketing/posts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (myId !== reqRef.current) return; // respuesta obsoleta → ignorar
      if (!res.ok) {
        setError(res.status === 503 ? data.hint ?? "Marketing aún no está activo." : data.error ?? "No se pudieron cargar las publicaciones");
        setPosts([]);
        return;
      }
      setError(null);
      setPosts(Array.isArray(data.posts) ? data.posts : []);
    } catch {
      if (myId === reqRef.current) setError("Error de red al cargar el calendario");
    } finally {
      if (myId === reqRef.current) setLoading(false);
    }
  }, []);

  const loadUpcoming = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/marketing/posts?status=SCHEDULED&from=${encodeURIComponent(new Date().toISOString())}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const list: Post[] = Array.isArray(data.posts) ? data.posts : [];
      list.sort((a, b) => new Date(postDate(a)).getTime() - new Date(postDate(b)).getTime());
      setUpcoming(list.slice(0, 8));
    } catch {
      /* silencioso: la lista lateral es secundaria */
    }
  }, []);

  useEffect(() => {
    void loadGrid(fromISO, toISO);
  }, [fromISO, toISO, loadGrid]);

  useEffect(() => {
    void loadUpcoming();
  }, [loadUpcoming]);

  const go = useCallback(
    (dir: -1 | 1) => {
      setCursor((c) => {
        if (view === "month") return dir < 0 ? subMonths(c, 1) : addMonths(c, 1);
        return dir < 0 ? subWeeks(c, 1) : addWeeks(c, 1);
      });
    },
    [view],
  );

  const openCreate = useCallback(
    (day?: Date) => {
      router.push(day ? `/dashboard/marketing/composer?date=${format(day, "yyyy-MM-dd")}` : "/dashboard/marketing/composer");
    },
    [router],
  );
  const openEdit = useCallback(
    (id: string) => {
      router.push(`/dashboard/marketing/composer?id=${id}`);
    },
    [router],
  );

  const monthCellMinH = view === "month" ? 96 : 280;
  const maxChips = view === "month" ? 3 : 12;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
      {/* Calendario */}
      <div style={{ flex: "1 1 600px", minWidth: 0 }}>
        {/* Barra superior */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" aria-label="Anterior" onClick={() => go(-1)} style={iconBtn}>
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button type="button" aria-label="Siguiente" onClick={() => go(1)} style={iconBtn}>
              <ChevronRight size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setCursor(new Date())}
              style={{ ...iconBtn, width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600 }}
            >
              Hoy
            </button>
            <h2 style={{ margin: "0 0 0 6px", fontSize: 17, fontWeight: 600, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
              {title}
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden style={{ color: "var(--text-3)" }} /> : null}
            </h2>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {/* Toggle de vista */}
            <div style={{ display: "inline-flex", background: "var(--bg-elev-2)", borderRadius: 9, padding: 3 }}>
              {(["month", "week"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    padding: "7px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 7,
                    color: view === v ? "var(--brand)" : "var(--text-3)",
                    background: view === v ? "var(--bg-elev)" : "transparent",
                  }}
                >
                  {v === "month" ? "Mes" : "Semana"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openCreate()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                minHeight: 38,
                padding: "0 14px",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background: "var(--brand)",
                border: "none",
                borderRadius: 9,
                cursor: "pointer",
                boxShadow: "0 4px 16px -6px rgba(124,58,237,0.6)",
              }}
            >
              <Plus size={16} aria-hidden />
              Crear
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--warning)",
              background: "var(--warning-soft)",
              border: "1px solid var(--warning)",
              borderRadius: 10,
              padding: "10px 12px",
              marginBottom: 12,
            }}
          >
            <AlertTriangle size={16} aria-hidden /> {error}
          </div>
        ) : null}

        {/* Encabezados de día */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", marginBottom: 6 }}>
          {WEEKDAYS.map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text-3)", padding: "4px 0" }}>
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 5 }}>
          {cells.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayPosts = byDay[key] ?? [];
            const outside = view === "month" && !isSameMonth(day, cursor);
            const today = isToday(day);
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                aria-label={`Crear publicación el ${format(day, "d 'de' MMMM", { locale: es })}`}
                onClick={() => openCreate(day)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openCreate(day);
                  }
                }}
                style={{
                  minHeight: monthCellMinH,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: 6,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: outside ? "var(--bg)" : "var(--bg-elev)",
                  border: today ? "1px solid var(--brand)" : "1px solid var(--border-soft)",
                  boxShadow: today ? "inset 0 0 0 1px var(--brand)" : "none",
                  opacity: outside ? 0.5 : 1,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: today ? "var(--brand)" : "var(--text-2)",
                    alignSelf: "flex-start",
                  }}
                >
                  {format(day, "d")}
                </span>

                {dayPosts.slice(0, maxChips).map((p) => {
                  const st = statusOf(p.status);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={`${st.label} · ${p.caption}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(p.id);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        width: "100%",
                        textAlign: "left",
                        padding: "3px 6px",
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        background: st.soft,
                        color: "var(--text-1)",
                        fontSize: 11,
                        lineHeight: 1.3,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.color, flexShrink: 0 }} aria-hidden />
                      {p.channel === "FACEBOOK" ? <Facebook size={11} aria-hidden style={{ flexShrink: 0, color: "var(--text-3)" }} /> : null}
                      {p.channel === "INSTAGRAM" ? <Instagram size={11} aria-hidden style={{ flexShrink: 0, color: "var(--text-3)" }} /> : null}
                      {p.channel === "BOTH" ? <Megaphone size={11} aria-hidden style={{ flexShrink: 0, color: "var(--text-3)" }} /> : null}
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.caption || "(sin texto)"}
                      </span>
                    </button>
                  );
                })}
                {dayPosts.length > maxChips ? (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)", paddingLeft: 4 }}>
                    +{dayPosts.length - maxChips} más
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Leyenda de estados (color no es el único indicador) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
          {Object.keys(STATUS_META).map((k) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS_META[k].color }} aria-hidden />
              {STATUS_META[k].label}
            </span>
          ))}
        </div>
      </div>

      {/* Próximas publicaciones */}
      <aside style={{ flex: "0 1 290px", minWidth: 260 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <CalendarDays size={16} aria-hidden style={{ color: "var(--brand)" }} />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>Próximas</h3>
        </div>
        {upcoming.length === 0 ? (
          <div
            style={{
              fontSize: 13,
              color: "var(--text-3)",
              background: "var(--bg-elev)",
              border: "1px dashed var(--border-soft)",
              borderRadius: 12,
              padding: 18,
              textAlign: "center",
            }}
          >
            No tienes publicaciones programadas.
            <br />
            <button
              type="button"
              onClick={() => openCreate()}
              style={{ marginTop: 10, color: "var(--brand)", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
            >
              Crear la primera →
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcoming.map((p) => {
              const st = statusOf(p.status);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openEdit(p.id)}
                  style={{
                    display: "flex",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    padding: 10,
                    borderRadius: 11,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: st.color, flexShrink: 0 }} aria-hidden />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                      {cap(format(new Date(postDate(p)), "EEE d MMM, HH:mm", { locale: es }))}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--text-3)",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.caption || "(sin texto)"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}
