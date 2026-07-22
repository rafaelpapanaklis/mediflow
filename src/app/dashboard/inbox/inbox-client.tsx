"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  Inbox as InboxIcon,
  Clock,
  Send,
  Archive,
  MessageCircle,
  Mail,
  MailOpen,
  FileText,
  ShieldCheck,
  Bell,
  MessageSquare,
  Plus,
  Search,
  Bot,
  Check,
  CheckCheck,
  Menu,
  ArrowLeft,
  User,
  UserX,
  UserPlus,
  Pause,
  Play,
  Lock,
  Zap,
  Paperclip,
  Smile,
  Mic,
  CalendarPlus,
  MoreHorizontal,
  Filter,
  ExternalLink,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import styles from "./inbox.module.css";

type Channel = "WHATSAPP" | "EMAIL" | "PORTAL_FORM" | "VALIDATION" | "REMINDER" | "PORTAL";
type Status = "UNREAD" | "READ" | "ARCHIVED" | "SNOOZED";
type Direction = "IN" | "OUT";

interface Viewer {
  id: string;
  firstName: string;
  lastName: string;
  clinicName: string;
}

interface Thread {
  id: string;
  channel: Channel;
  subject: string;
  status: Status;
  assignedToId: string | null;
  snoozedUntil: string | null;
  lastMessageAt: string;
  tags: string[];
  externalId: string | null;
  botActive: boolean;
  patient: { id: string; firstName: string; lastName: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  _count: { messages: number };
  // Contrato del rediseño (GET /api/inbox/threads). /api/inbox/since NO los
  // trae — el merge del polling los preserva y reconcilia (ver pollSince).
  lastMessage?: {
    direction: Direction;
    sentAt: string;
    excerpt: string;
    isInternal: boolean;
  } | null;
  lastInboundAt?: string | null;
}

interface Counts {
  total: number;
  byChannel: Record<string, number>;
}

interface Stats {
  waitingOver20m: number;
  resolvedToday: number;
  botAuto: number;
}

interface ThreadMessage {
  id: string;
  direction: Direction;
  body: string;
  attachments: unknown;
  sentAt: string;
  isInternal: boolean;
  externalId: string | null;
  sentBy: { id: string; firstName: string; lastName: string } | null;
}

interface ThreadDetail extends Thread {
  patient: { id: string; firstName: string; lastName: string; phone?: string | null; email?: string | null } | null;
  messages: ThreadMessage[];
}

interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  color: string | null;
}

interface LiveEvent {
  id: string;
  threadId: string;
  text: string;
  at: string;
}

const CHANNEL_META: Record<Channel, { labelKey: string; color: string; icon: typeof InboxIcon }> = {
  WHATSAPP:    { labelKey: "inbox.client.channelWhatsapp",   color: "#22c55e", icon: MessageCircle },
  EMAIL:       { labelKey: "inbox.client.channelEmail",      color: "#ef4444", icon: Mail },
  PORTAL_FORM: { labelKey: "inbox.client.channelForm",       color: "#3b82f6", icon: FileText },
  VALIDATION:  { labelKey: "inbox.client.channelValidation", color: "#f59e0b", icon: ShieldCheck },
  REMINDER:    { labelKey: "inbox.client.channelReminder",   color: "#8b5cf6", icon: Bell },
  PORTAL:      { labelKey: "inbox.client.channelPortal",     color: "#06b6d4", icon: MessageSquare },
};

const SYSTEM_FOLDERS: Array<{ id: string; labelKey: string; icon: typeof InboxIcon }> = [
  { id: "inbox",    labelKey: "inbox.client.folderInbox",    icon: InboxIcon },
  { id: "snoozed",  labelKey: "inbox.client.folderSnoozed",  icon: Clock },
  { id: "sent",     labelKey: "inbox.client.folderSent",     icon: Send },
  { id: "archived", labelKey: "inbox.client.folderArchived", icon: Archive },
];

/* Avatares = iniciales sobre gradientes (paleta del hifi), estables por nombre. */
const AVATAR_GRADIENTS = [
  ["#fb7185", "#e11d48"],
  ["#60a5fa", "#2563eb"],
  ["#8b5cf6", "#6d28d9"],
  ["#fbbf24", "#d97706"],
  ["#94a3b8", "#475569"],
  ["#2dd4bf", "#0d9488"],
  ["#a78bfa", "#7c3aed"],
  ["#f59e0b", "#b45309"],
];

function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const pair = AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

function getInitials(p: { firstName: string; lastName: string } | null, fallback?: string): string {
  if (p) return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
  const f = (fallback ?? "?").trim();
  return f.slice(0, 2).toUpperCase() || "?";
}

function threadName(th: { patient: { firstName: string; lastName: string } | null; subject: string }): string {
  return th.patient ? `${th.patient.firstName} ${th.patient.lastName}` : th.subject;
}

const WAIT_THRESHOLD_MS = 20 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function waitingMs(th: Thread, now: number): number | null {
  if (th.status !== "UNREAD" && th.status !== "READ") return null;
  const last = th.lastMessage;
  if (!last || last.direction !== "IN" || last.isInternal) return null;
  return now - new Date(last.sentAt).getTime();
}

function isWaitingOver20m(th: Thread, now: number): boolean {
  const ms = waitingMs(th, now);
  return ms !== null && ms > WAIT_THRESHOLD_MS;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatClock(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

function formatBubbleTime(iso: string): string {
  return formatClock(new Date(iso));
}

/* Clave de día en hora LOCAL (agrupar por fecha UTC partía la noche en dos). */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function InboxClient({ viewer }: { viewer: Viewer }) {
  const t = useT();
  const sp = useSearchParams();
  const patientIdFilter = sp.get("patientId");

  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, byChannel: {} });
  const [stats, setStats] = useState<Stats | null>(null);
  const [folder, setFolder] = useState<string>("inbox");
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  // Segmented Todos / Míos / Sin asignar — filtro CLIENT-side (cambio instantáneo
  // y contadores de los tres segmentos a la vez).
  const [segment, setSegment] = useState<"all" | "mine" | "unassigned">("all");
  // Filtro rápido accionable: banner SLA ("sla") o CTA Supervisar ("bot").
  const [quickFilter, setQuickFilter] = useState<null | "sla" | "bot">(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadDetail | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [composerMode, setComposerMode] = useState<"reply" | "internal">("reply");
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Menús flotantes del header de conversación (uno abierto a la vez).
  const [openMenu, setOpenMenu] = useState<null | "snooze" | "assign" | "more">(null);
  // Equipo para asignar (lazy vía /api/team/light). "error" = sin acceso →
  // fallback: solo "Asignarme a mí" / "Quitar asignación".
  const [team, setTeam] = useState<TeamMember[] | "error" | null>(null);
  // Eventos de sistema SOLO en vivo (v1 no los persiste): "X tomó la conversación".
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  // Pospuestos que vuelven hoy (footer de la lista). Se calcula una vez al montar.
  const [snoozedToday, setSnoozedToday] = useState(0);
  // Tick de 30s para refrescar tiempos relativos / SLA / ventana 24h sin re-fetch.
  const [nowTick, setNowTick] = useState(0);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Cursor del polling en tiempo real (lo siembra el listado con serverTime y lo
  // avanza cada poll de /api/inbox/since). Ref para no re-disparar efectos.
  const lastSyncRef = useRef<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  // Contador de polls para reconciliar en duro (silencioso) 1 de cada 6 (~30s).
  const pollTickRef = useRef(0);
  // Debounce de la reconciliación extra que dispara el merge del polling (los
  // threads de /since no traen lastMessage; el fetch completo los repone).
  const reconcilePendingRef = useRef(false);
  const teamLoadingRef = useRef(false);

  const now = Date.now() + nowTick * 0; // nowTick fuerza el re-render periódico

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Debounce del buscador (250ms) — el fetch autoritativo depende de `search`.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput), 250);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Esc cierra menús, drawer o el detalle (solo móvil).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openMenu) setOpenMenu(null);
      else if (mobileSidebarOpen) setMobileSidebarOpen(false);
      else if (activeThreadId && window.matchMedia("(max-width: 767px)").matches) {
        setActiveThreadId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openMenu, mobileSidebarOpen, activeThreadId]);

  // Carga autoritativa de la lista. `silent: true` la usa la reconciliación del
  // polling: recarga la lista completa SIN spinner ni tocar el cursor, para
  // reflejar bajas/cambios que el incremental no puede ver.
  const fetchThreads = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoadingList(true);
      setError(null);
      // Pausa el polling mientras recargamos en duro: cualquier poll que entre
      // en esta ventana corta (since=null) en vez de avanzar un cursor obsoleto.
      lastSyncRef.current = null;
    }
    try {
      const params = new URLSearchParams();
      if (folder === "snoozed") params.set("status", "SNOOZED");
      if (folder === "archived") params.set("status", "ARCHIVED");
      if (activeChannel) params.set("channel", activeChannel);
      if (search.trim()) params.set("search", search.trim());
      if (patientIdFilter) params.set("patientId", patientIdFilter);
      // Stats globales solo en cargas visibles (no en cada reconciliación).
      if (!silent) params.set("include", "stats");

      const res = await fetch(`/api/inbox/threads?${params.toString()}`);
      if (!res.ok) {
        if (silent) return; // reconciliación silenciosa: no toca la UI en fallo
        const data = await res.json().catch(() => ({}));
        if (res.status === 503) {
          setError(data.hint ?? t("inbox.client.errorSchemaNotMigrated"));
          setThreads([]);
          return;
        }
        throw new Error(data.error ?? t("inbox.client.errorLoadInbox"));
      }
      const data = await res.json();
      setThreads(data.threads ?? []);
      setCounts(data.counts ?? { total: 0, byChannel: {} });
      if (data.stats) setStats(data.stats);
      // Sólo la carga NO silenciosa siembra/avanza el cursor. La reconciliación
      // deja el cursor intacto a propósito: así el siguiente poll incremental
      // sigue trayendo los mensajes nuevos del hilo abierto sin huecos.
      if (!silent && data.serverTime) lastSyncRef.current = data.serverTime;
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : t("inbox.client.errorLoadInbox"));
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [folder, activeChannel, search, patientIdFilter, t]);

  // Polling en tiempo real: cada 5s pide a /api/inbox/since SÓLO lo que cambió
  // desde el último cursor y lo mergea sin recargar la vista. Se pausa cuando la
  // pestaña está oculta. El aislamiento por clínica lo garantiza el servidor.
  const pollSince = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const since = lastSyncRef.current;
    if (!since) return;

    // 1 de cada 6 polls (~30s) reconciliamos la lista completa en silencio.
    pollTickRef.current += 1;
    if (pollTickRef.current % 6 === 0) {
      await fetchThreads({ silent: true });
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("ts", since);
      if (folder === "snoozed") params.set("status", "SNOOZED");
      if (folder === "archived") params.set("status", "ARCHIVED");
      if (activeChannel) params.set("channel", activeChannel);
      if (search.trim()) params.set("search", search.trim());
      if (patientIdFilter) params.set("patientId", patientIdFilter);
      if (activeThreadIdRef.current) params.set("threadId", activeThreadIdRef.current);

      const res = await fetch(`/api/inbox/since?${params.toString()}`);
      if (!res.ok) return; // polling silencioso: nunca rompe la UI
      const data = await res.json();
      if (data.serverTime) lastSyncRef.current = data.serverTime;

      // Threads cambiados: /since NO trae lastMessage/lastInboundAt → se
      // preservan los del estado previo y se agenda una reconciliación corta
      // que repone el shape completo (preview, SLA, ventana).
      const incoming: Thread[] = data.threads ?? [];
      if (incoming.length > 0) {
        setThreads((prev) => {
          const byId: Record<string, Thread> = {};
          for (const th of prev) byId[th.id] = th;
          for (const th of incoming) {
            const old = byId[th.id];
            byId[th.id] = old
              ? { ...th, lastMessage: th.lastMessage ?? old.lastMessage, lastInboundAt: th.lastInboundAt ?? old.lastInboundAt }
              : th;
          }
          return Object.keys(byId)
            .map((k) => byId[k])
            .sort(
              (a, b) =>
                new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
            );
        });
        if (!reconcilePendingRef.current) {
          reconcilePendingRef.current = true;
          window.setTimeout(() => {
            reconcilePendingRef.current = false;
            void fetchThreads({ silent: true });
          }, 500);
        }
      }

      if (data.counts?.byChannel) {
        setCounts((prev) => ({ ...prev, byChannel: data.counts.byChannel }));
      }

      // Mensajes nuevos del hilo abierto: se anexan deduplicando por id.
      const newMsgs: ThreadMessage[] = data.messages ?? [];
      if (newMsgs.length > 0) {
        setActiveThread((prev) => {
          if (!prev) return prev;
          const haveIds: Record<string, true> = {};
          for (const m of prev.messages) haveIds[m.id] = true;
          const extra = newMsgs.filter((m) => !haveIds[m.id]);
          if (extra.length === 0) return prev;
          const merged = prev.messages
            .concat(extra)
            .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
          return { ...prev, messages: merged };
        });
      }
    } catch {
      // silencioso: un poll fallido se reintenta en el siguiente tick
    }
  }, [folder, activeChannel, search, patientIdFilter, fetchThreads]);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // Arranca/limpia el intervalo de polling + poll inmediato al volver a la pestaña.
  useEffect(() => {
    const id = window.setInterval(() => {
      void pollSince();
    }, 5000);
    const onVisible = () => {
      if (!document.hidden) void pollSince();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollSince]);

  // Pospuestos que vuelven hoy — una consulta al montar (footer de la lista).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/inbox/threads?status=SNOOZED");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        const list: Thread[] = data.threads ?? [];
        setSnoozedToday(
          list.filter((th) => th.snoozedUntil && new Date(th.snoozedUntil) <= end).length,
        );
      } catch {
        // opcional: sin footer si falla
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cuando se selecciona un thread, fetch detalle + marcar leído.
  useEffect(() => {
    if (!activeThreadId) {
      setActiveThread(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setComposerMode("reply");
    setOpenMenu(null);
    (async () => {
      try {
        const res = await fetch(`/api/inbox/threads/${activeThreadId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        setActiveThread(data.thread);
        if (data.thread.status === "UNREAD") {
          await fetch(`/api/inbox/threads/${activeThreadId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "READ" }),
          });
          setThreads((prev) =>
            prev.map((th) => (th.id === activeThreadId ? { ...th, status: "READ" } : th)),
          );
        }
      } catch {
        if (!cancelled) toast.error(t("inbox.client.toastLoadConversationError"));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeThreadId, t]);

  // Auto-scroll al fondo cuando cambian mensajes.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages.length, liveEvents.length]);

  /* ── Derivados ── */

  const waitingThreads = useMemo(
    () =>
      threads
        .filter((th) => isWaitingOver20m(th, now))
        .sort(
          (a, b) =>
            new Date(a.lastMessage?.sentAt ?? a.lastMessageAt).getTime() -
            new Date(b.lastMessage?.sentAt ?? b.lastMessageAt).getTime(),
        ),
    [threads, now],
  );

  const mineCount = useMemo(
    () => threads.filter((th) => th.assignedToId === viewer.id).length,
    [threads, viewer.id],
  );
  const unassignedCount = useMemo(
    () => threads.filter((th) => th.assignedToId === null).length,
    [threads],
  );

  const visibleThreads = useMemo(() => {
    let list = threads;
    if (segment === "mine") list = list.filter((th) => th.assignedToId === viewer.id);
    else if (segment === "unassigned") list = list.filter((th) => th.assignedToId === null);
    if (quickFilter === "sla") list = list.filter((th) => isWaitingOver20m(th, now));
    else if (quickFilter === "bot") {
      list = list.filter((th) => th.channel === "WHATSAPP" && th.botActive && th.status !== "ARCHIVED");
    }
    return list;
  }, [threads, segment, quickFilter, viewer.id, now]);

  const unreadVisible = useMemo(
    () => visibleThreads.filter((th) => th.status === "UNREAD").length,
    [visibleThreads],
  );
  const unreadAll = useMemo(
    () => threads.filter((th) => th.status === "UNREAD").length,
    [threads],
  );

  const hasFilters = activeChannel !== null || segment !== "all" || quickFilter !== null || searchInput.trim() !== "";

  /* ── Acciones ── */

  const pushLiveEvent = useCallback((threadId: string, text: string) => {
    setLiveEvents((prev) => [
      ...prev,
      { id: `live-${Date.now()}-${prev.length}`, threadId, text, at: new Date().toISOString() },
    ]);
  }, []);

  const sendReply = useCallback(async () => {
    if (!activeThread || !composerText.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/inbox/threads/${activeThread.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: composerText.trim(),
          isInternal: composerMode === "internal",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("inbox.client.errorSend"));
      }
      const data = await res.json();
      // Si un humano respondió un hilo de WhatsApp, el server pausó el bot:
      // reflejarlo en el detalle y en la lista + evento de sistema en vivo.
      const pausedBot =
        composerMode !== "internal" && activeThread.channel === "WHATSAPP" && activeThread.botActive;
      setActiveThread((prev) =>
        prev
          ? { ...prev, messages: [...prev.messages, data.message], ...(pausedBot ? { botActive: false } : {}) }
          : prev,
      );
      if (pausedBot) {
        setThreads((prev) =>
          prev.map((th) => (th.id === activeThread.id ? { ...th, botActive: false } : th)),
        );
        pushLiveEvent(
          activeThread.id,
          t("inbox.client.eventTookOver", { name: `${viewer.firstName} ${viewer.lastName}`.trim() }),
        );
      }
      setComposerText("");
      if (data.sendError) {
        toast(t("inbox.client.toastSavedButError", { error: data.sendError }), { icon: "⚠️" });
      } else {
        toast.success(composerMode === "internal" ? t("inbox.client.toastInternalNoteSaved") : t("inbox.client.toastMessageSent"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("inbox.client.errorSend"));
    } finally {
      setSending(false);
    }
  }, [activeThread, composerText, composerMode, sending, t, viewer.firstName, viewer.lastName, pushLiveEvent]);

  // Pausa/reactiva el bot de WhatsApp en el hilo activo (PATCH botActive).
  const toggleBot = useCallback(async () => {
    if (!activeThread) return;
    const next = !activeThread.botActive;
    try {
      const res = await fetch(`/api/inbox/threads/${activeThread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botActive: next }),
      });
      if (!res.ok) throw new Error();
      setActiveThread((prev) => (prev ? { ...prev, botActive: next } : prev));
      setThreads((prev) =>
        prev.map((th) => (th.id === activeThread.id ? { ...th, botActive: next } : th)),
      );
      if (!next) {
        pushLiveEvent(
          activeThread.id,
          t("inbox.client.eventTookOver", { name: `${viewer.firstName} ${viewer.lastName}`.trim() }),
        );
      }
      toast.success(next ? t("inbox.client.toastBotResumed") : t("inbox.client.toastBotPaused"));
    } catch {
      toast.error(t("inbox.client.errorSend"));
    }
  }, [activeThread, t, viewer.firstName, viewer.lastName, pushLiveEvent]);

  // Resolver = ARCHIVED, con toast para deshacer.
  const resolveThread = useCallback(async () => {
    if (!activeThread) return;
    const snapshot = threads.find((th) => th.id === activeThread.id) ?? null;
    const threadId = activeThread.id;
    try {
      const res = await fetch(`/api/inbox/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      if (!res.ok) throw new Error();
      setThreads((prev) => prev.filter((th) => th.id !== threadId));
      setActiveThreadId(null);
      setActiveThread(null);
      setStats((prev) => (prev ? { ...prev, resolvedToday: prev.resolvedToday + 1 } : prev));
      toast(
        (tk) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {t("inbox.client.toastResolved")}
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(tk.id);
                try {
                  const undo = await fetch(`/api/inbox/threads/${threadId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "READ" }),
                  });
                  if (!undo.ok) throw new Error();
                  if (snapshot) {
                    setThreads((prev) =>
                      [...prev.filter((th) => th.id !== threadId), { ...snapshot, status: "READ" as Status }].sort(
                        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
                      ),
                    );
                  } else {
                    void fetchThreads({ silent: true });
                  }
                  setStats((prev) => (prev ? { ...prev, resolvedToday: Math.max(0, prev.resolvedToday - 1) } : prev));
                } catch {
                  toast.error(t("inbox.client.toastArchiveError"));
                }
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "#7c3aed",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                padding: 0,
              }}
            >
              {t("inbox.client.undo")}
            </button>
          </span>
        ),
        { duration: 5000 },
      );
    } catch {
      toast.error(t("inbox.client.toastArchiveError"));
    }
  }, [activeThread, threads, t, fetchThreads]);

  // Posponer → SNOOZED + snoozedUntil.
  const snoozeUntil = useCallback(async (when: Date) => {
    if (!activeThread) return;
    const threadId = activeThread.id;
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/inbox/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SNOOZED", snoozedUntil: when.toISOString() }),
      });
      if (!res.ok) throw new Error();
      if (folder !== "snoozed") {
        setThreads((prev) => prev.filter((th) => th.id !== threadId));
        setActiveThreadId(null);
        setActiveThread(null);
      }
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      if (when <= todayEnd) setSnoozedToday((n) => n + 1);
      toast.success(
        t("inbox.client.toastSnoozed", {
          when: sameDay(when, new Date())
            ? formatClock(when)
            : new Intl.DateTimeFormat("es-MX", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(when),
        }),
      );
    } catch {
      toast.error(t("inbox.client.errorSend"));
    }
  }, [activeThread, folder, t]);

  const snoozeIn3h = useCallback(() => {
    void snoozeUntil(new Date(Date.now() + 3 * 60 * 60 * 1000));
  }, [snoozeUntil]);
  const snoozeTomorrow9 = useCallback(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    void snoozeUntil(d);
  }, [snoozeUntil]);
  const snoozeMonday9 = useCallback(() => {
    const d = new Date();
    const add = (8 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + add);
    d.setHours(9, 0, 0, 0);
    void snoozeUntil(d);
  }, [snoozeUntil]);

  // Asignar / desasignar (PATCH assignedToId).
  const assignTo = useCallback(async (member: { id: string; firstName: string; lastName: string } | null) => {
    if (!activeThread) return;
    const threadId = activeThread.id;
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/inbox/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: member ? member.id : null }),
      });
      if (!res.ok) throw new Error();
      const assigned = member ? { id: member.id, firstName: member.firstName, lastName: member.lastName } : null;
      setActiveThread((prev) => (prev ? { ...prev, assignedToId: member?.id ?? null, assignedTo: assigned } : prev));
      setThreads((prev) =>
        prev.map((th) => (th.id === threadId ? { ...th, assignedToId: member?.id ?? null, assignedTo: assigned } : th)),
      );
      toast.success(
        member
          ? t("inbox.client.toastAssigned", { name: `${member.firstName} ${member.lastName}`.trim() })
          : t("inbox.client.toastUnassigned"),
      );
    } catch {
      toast.error(t("inbox.client.errorSend"));
    }
  }, [activeThread, t]);

  const loadTeam = useCallback(async () => {
    if (team !== null || teamLoadingRef.current) return;
    teamLoadingRef.current = true;
    try {
      const res = await fetch("/api/team/light");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTeam(Array.isArray(data) ? data : "error");
    } catch {
      setTeam("error");
    } finally {
      teamLoadingRef.current = false;
    }
  }, [team]);

  const markUnread = useCallback(async () => {
    if (!activeThread) return;
    const threadId = activeThread.id;
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/inbox/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "UNREAD" }),
      });
      if (!res.ok) throw new Error();
      setThreads((prev) => prev.map((th) => (th.id === threadId ? { ...th, status: "UNREAD" } : th)));
      setActiveThreadId(null);
      setActiveThread(null);
    } catch {
      toast.error(t("inbox.client.errorSend"));
    }
  }, [activeThread, t]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void sendReply();
    }
  }, [sendReply]);

  const handleFolderClick = useCallback((id: string) => {
    setFolder(id);
    setActiveChannel(null);
    setSegment("all");
    setQuickFilter(null);
    setActiveThreadId(null);
    setMobileSidebarOpen(false);
  }, []);

  const handleChannelClick = useCallback((ch: Channel) => {
    setFolder("inbox");
    setActiveChannel((prev) => (prev === ch ? null : ch));
    setActiveThreadId(null);
    setMobileSidebarOpen(false);
  }, []);

  const handleSegmentClick = useCallback((seg: "all" | "mine" | "unassigned") => {
    setFolder((prev) => (prev === "snoozed" || prev === "archived" ? "inbox" : prev));
    setSegment(seg);
    setMobileSidebarOpen(false);
  }, []);

  const clearFilters = useCallback(() => {
    setActiveChannel(null);
    setSegment("all");
    setQuickFilter(null);
    setSearchInput("");
  }, []);

  const composeSoon = useCallback(() => {
    toast(t("inbox.client.composeSoon"), { icon: "🛠️" });
  }, [t]);

  const openOldestWaiting = useCallback(() => {
    if (waitingThreads.length > 0) {
      setActiveThreadId(waitingThreads[0].id);
    } else {
      setQuickFilter("sla");
    }
  }, [waitingThreads]);

  const insertTemplate = useCallback((text: string) => {
    setComposerText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text));
    composerRef.current?.focus();
  }, []);

  /* ── Grupos de mensajes por día ── */
  const messagesByDay = useMemo(() => {
    if (!activeThread) return [] as Array<{ day: string; items: ThreadMessage[] }>;
    const groups = new Map<string, ThreadMessage[]>();
    for (const m of activeThread.messages) {
      const k = dayKey(m.sentAt);
      const arr = groups.get(k) ?? [];
      arr.push(m);
      groups.set(k, arr);
    }
    return Array.from(groups.entries()).map(([day, items]) => ({ day, items }));
  }, [activeThread]);

  const activeLiveEvents = useMemo(
    () => liveEvents.filter((ev) => ev.threadId === activeThreadId),
    [liveEvents, activeThreadId],
  );

  /* ── Ventana 24h del hilo activo (client-side; el server la respeta igual) ── */
  const windowInfo = useMemo(() => {
    if (!activeThread || activeThread.channel !== "WHATSAPP") return null;
    let lastIn: string | null = null;
    for (const m of activeThread.messages) {
      if (m.direction === "IN" && !m.isInternal) lastIn = m.sentAt;
    }
    if (!lastIn) {
      const fromList = threads.find((th) => th.id === activeThread.id)?.lastInboundAt ?? null;
      lastIn = fromList;
    }
    if (!lastIn) return { open: false, closesAt: null as Date | null };
    const closesAt = new Date(new Date(lastIn).getTime() + WINDOW_MS);
    return { open: closesAt.getTime() > now, closesAt };
  }, [activeThread, threads, now]);

  const windowClosed = windowInfo !== null && !windowInfo.open;
  const replyDisabled = sending || (composerMode === "reply" && windowClosed);

  /* ── Formatos de texto ── */

  const formatListTime = useCallback((iso: string): string => {
    const d = new Date(iso);
    const today = new Date();
    if (sameDay(d, today)) return formatClock(d);
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (sameDay(d, yesterday)) return t("inbox.client.yesterday");
    const diffD = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
    if (diffD < 7) return new Intl.DateTimeFormat("es-MX", { weekday: "short" }).format(d);
    return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(d);
  }, [t]);

  const formatWaiting = useCallback((ms: number): string => {
    const min = Math.floor(ms / 60_000);
    if (min < 60) return t("inbox.client.waitMinutes", { count: min });
    return t("inbox.client.waitHours", { count: Math.floor(min / 60) });
  }, [t]);

  const formatDayDivider = useCallback((iso: string): string => {
    const d = new Date(`${iso}T12:00:00`);
    const today = new Date();
    if (sameDay(d, today)) return t("inbox.client.today");
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (sameDay(d, yesterday)) return t("inbox.client.yesterday");
    return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" }).format(d);
  }, [t]);

  const formatCloses = useCallback((closesAt: Date): string => {
    const time = formatClock(closesAt);
    return sameDay(closesAt, new Date())
      ? t("inbox.client.windowClosesToday", { time })
      : t("inbox.client.windowClosesTomorrow", { time });
  }, [t]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const key = h < 12 ? "inbox.client.goodMorning" : h < 19 ? "inbox.client.goodAfternoon" : "inbox.client.goodEvening";
    return t(key, { name: viewer.firstName });
  }, [t, viewer.firstName]);

  const emptyDateLine = useMemo(() => {
    const d = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    return `${d} · ${viewer.clinicName} · ${t("inbox.client.inboxToday")}`;
  }, [t, viewer.clinicName]);

  const folderTitle = folder === "snoozed"
    ? t("inbox.client.folderSnoozed")
    : folder === "sent"
    ? t("inbox.client.folderSent")
    : folder === "archived"
    ? t("inbox.client.folderArchived")
    : activeChannel
    ? t(CHANNEL_META[activeChannel].labelKey)
    : segment === "mine"
    ? t("inbox.client.assigneeMe")
    : segment === "unassigned"
    ? t("inbox.client.assigneeUnassigned")
    : t("inbox.client.folderInbox");

  const activePatient = activeThread?.patient ?? null;
  const channelMeta = activeThread ? CHANNEL_META[activeThread.channel] : null;
  const activeContact = activeThread
    ? activePatient?.phone ?? activePatient?.email ?? activeThread.externalId ?? null
    : null;

  const teamList = Array.isArray(team) ? team : [];

  /* ═══════════════════ Render ═══════════════════ */

  return (
    <div
      className={styles.page}
      data-mobile-sidebar-open={mobileSidebarOpen || undefined}
      data-mobile-detail-open={activeThreadId ? "true" : undefined}
    >
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label={t("inbox.client.closePanel")}
          className={styles.mobileBackdrop}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* ─── Col 1: Sidebar (drawer en <1200px) ─── */}
      <aside
        className={styles.sidebar}
        role={mobileSidebarOpen ? "dialog" : undefined}
        aria-modal={mobileSidebarOpen ? "true" : undefined}
        aria-label={t("inbox.client.channelsAndFolders")}
      >
        <div className={styles.sidebarTop}>
          <div className={styles.brandRow}>
            <span className={styles.brandIcon}><InboxIcon size={16} strokeWidth={2} aria-hidden /></span>
            Inbox
          </div>
          <button type="button" className={styles.composeBtn} onClick={composeSoon}>
            <Plus size={15} strokeWidth={2.2} aria-hidden /> {t("inbox.client.compose")}
            <kbd>C</kbd>
          </button>
        </div>

        <div className={styles.sidebarScroll}>
          <div className={styles.groupLabel}>{t("inbox.client.groupFolders")}</div>
          <div className={styles.navGroup}>
            {SYSTEM_FOLDERS.map((f) => {
              const isActive = folder === f.id && !activeChannel && segment === "all";
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                  onClick={() => handleFolderClick(f.id)}
                >
                  <span className={styles.navIcon}><f.icon size={16} strokeWidth={2} aria-hidden /></span>
                  <span className={styles.navLabel}>{t(f.labelKey)}</span>
                  {f.id === "inbox" && unreadAll > 0 && (
                    <span className={styles.navBadge}>{unreadAll}</span>
                  )}
                  {f.id === "snoozed" && snoozedToday > 0 && (
                    <span className={styles.navCount}>{t("inbox.client.snoozedTodayShort", { count: snoozedToday })}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className={styles.groupLabel}>{t("inbox.client.groupChannels")}</div>
          <div className={styles.navGroup}>
            {(Object.keys(CHANNEL_META) as Channel[]).map((ch) => {
              const meta = CHANNEL_META[ch];
              const c = counts.byChannel[ch] ?? 0;
              const isActive = activeChannel === ch;
              return (
                <button
                  key={ch}
                  type="button"
                  className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                  style={{ ["--mf-ch-color" as never]: meta.color }}
                  onClick={() => handleChannelClick(ch)}
                >
                  <span className={styles.navDot} aria-hidden />
                  <span className={styles.navLabel}>{t(meta.labelKey)}</span>
                  {c > 0 && <span className={styles.navCount}>{c}</span>}
                </button>
              );
            })}
          </div>

          <div className={styles.groupLabel}>{t("inbox.client.groupAssignedTo")}</div>
          <div className={styles.navGroup}>
            <button
              type="button"
              className={`${styles.navItem} ${segment === "mine" ? styles.navItemActive : ""}`}
              onClick={() => handleSegmentClick(segment === "mine" ? "all" : "mine")}
            >
              <span className={styles.navIcon}><User size={16} strokeWidth={2} aria-hidden /></span>
              <span className={styles.navLabel}>{t("inbox.client.assigneeMe")}</span>
              {mineCount > 0 && <span className={styles.navCount}>{mineCount}</span>}
            </button>
            <button
              type="button"
              className={`${styles.navItem} ${segment === "unassigned" ? styles.navItemActive : ""}`}
              onClick={() => handleSegmentClick(segment === "unassigned" ? "all" : "unassigned")}
            >
              <span className={styles.navIcon}><UserX size={16} strokeWidth={2} aria-hidden /></span>
              <span className={styles.navLabel}>{t("inbox.client.assigneeUnassigned")}</span>
              {unassignedCount > 0 && <span className={styles.navBadgeAmber}>{unassignedCount}</span>}
            </button>
          </div>
        </div>

        <div className={styles.userBlock}>
          <div className={styles.userAvatar}>{getInitials({ firstName: viewer.firstName, lastName: viewer.lastName })}</div>
          <div className={styles.userMeta}>
            <span className={styles.userName}>{`${viewer.firstName} ${viewer.lastName}`.trim()}</span>
            <span className={styles.userRole}>{viewer.clinicName}</span>
          </div>
        </div>
      </aside>

      {/* ─── Col 2: Lista ─── */}
      <section className={styles.listCol}>
        <div className={styles.listHeader}>
          <div className={styles.listTitleRow}>
            <button
              type="button"
              className={styles.mobileMenuBtn}
              onClick={() => setMobileSidebarOpen(true)}
              aria-label={t("inbox.client.openChannelsAndFolders")}
            >
              <Menu size={18} strokeWidth={2} aria-hidden />
            </button>
            <div className={styles.listTitleBox}>
              <span className={styles.listTitle}>{folderTitle}</span>
              <span className={styles.listSub}>
                {t("inbox.client.conversationsCount", { count: visibleThreads.length })}
                {" · "}
                {t("inbox.client.unreadCount", { count: unreadVisible })}
              </span>
            </div>
            <button
              type="button"
              className={`${styles.filterBtn} ${hasFilters ? styles.filterBtnActive : ""}`}
              onClick={clearFilters}
              title={hasFilters ? t("inbox.client.clearFilters") : t("inbox.client.filters")}
              aria-label={hasFilters ? t("inbox.client.clearFilters") : t("inbox.client.filters")}
            >
              <Filter size={15} strokeWidth={2} aria-hidden />
            </button>
          </div>

          {(waitingThreads.length > 0 || quickFilter === "sla") && folder === "inbox" && (
            <button
              type="button"
              className={styles.slaBanner}
              onClick={() => setQuickFilter((prev) => (prev === "sla" ? null : "sla"))}
              aria-pressed={quickFilter === "sla"}
            >
              <span className={styles.slaIcon}><Clock size={16} strokeWidth={2} aria-hidden /></span>
              <span className={styles.slaTexts}>
                <span className={styles.slaTitle}>
                  {t("inbox.client.slaWaiting", { count: waitingThreads.length })}
                </span>
                <span className={styles.slaSub}>
                  {quickFilter === "sla" ? t("inbox.client.slaShowingOnly") : t("inbox.client.slaOver20")}
                </span>
              </span>
              <span className={styles.slaAction}>
                {quickFilter === "sla" ? t("inbox.client.slaClear") : t("inbox.client.slaFilter")}
              </span>
            </button>
          )}

          {quickFilter === "bot" && (
            <button
              type="button"
              className={styles.slaBanner}
              style={{ background: "var(--ib-teal-bg)", borderColor: "var(--ib-teal-border)" }}
              onClick={() => setQuickFilter(null)}
            >
              <span className={styles.slaIcon} style={{ color: "var(--ib-teal)" }}>
                <Bot size={16} strokeWidth={2} aria-hidden />
              </span>
              <span className={styles.slaTexts}>
                <span className={styles.slaTitle} style={{ color: "var(--ib-teal-deep)" }}>
                  {t("inbox.client.botFilterTitle")}
                </span>
              </span>
              <span className={styles.slaAction} style={{ color: "var(--ib-teal-deep)", borderColor: "var(--ib-teal-border)" }}>
                {t("inbox.client.slaClear")}
              </span>
            </button>
          )}

          <div className={styles.searchWrap}>
            <Search size={15} strokeWidth={2} aria-hidden className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder={t("inbox.client.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <div className={styles.segmented} role="group" aria-label={t("inbox.client.groupAssignedTo")}>
            <button
              type="button"
              className={`${styles.segment} ${segment === "all" ? styles.segmentActive : ""}`}
              onClick={() => handleSegmentClick("all")}
            >
              {t("inbox.client.segmentAll")} · {threads.length}
            </button>
            <button
              type="button"
              className={`${styles.segment} ${segment === "mine" ? styles.segmentActive : ""}`}
              onClick={() => handleSegmentClick("mine")}
            >
              {t("inbox.client.segmentMine")} · {mineCount}
            </button>
            <button
              type="button"
              className={`${styles.segment} ${segment === "unassigned" ? styles.segmentActive : ""}`}
              onClick={() => handleSegmentClick("unassigned")}
            >
              {t("inbox.client.segmentUnassigned")} · {unassignedCount}
            </button>
          </div>

          <div className={styles.chipsRow}>
            {(Object.keys(CHANNEL_META) as Channel[]).map((ch) => (
              <button
                key={ch}
                type="button"
                className={`${styles.chip} ${activeChannel === ch ? styles.chipActive : ""}`}
                onClick={() => handleChannelClick(ch)}
              >
                <span className={styles.chipDot} style={{ background: CHANNEL_META[ch].color }} aria-hidden />
                {t(CHANNEL_META[ch].labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.threadList}>
          {loadingList ? (
            <div className={styles.emptyList}>{t("common.loading")}</div>
          ) : error ? (
            <div className={styles.emptyList} style={{ color: "var(--ib-red)" }}>{error}</div>
          ) : visibleThreads.length === 0 ? (
            <div className={styles.emptyList}>
              <InboxIcon size={36} strokeWidth={1.75} aria-hidden style={{ opacity: 0.3, marginBottom: 8 }} />
              <div>{t("inbox.client.emptyThreadsIn", { folder: folderTitle.toLowerCase() })}</div>
            </div>
          ) : (
            visibleThreads.map((th) => {
              const meta = CHANNEL_META[th.channel];
              const Icon = meta.icon;
              const isActive = th.id === activeThreadId;
              const isUnread = th.status === "UNREAD";
              const isSnoozed = th.status === "SNOOZED";
              const name = threadName(th);
              const wait = waitingMs(th, now);
              const waiting = wait !== null && wait > WAIT_THRESHOLD_MS;
              const preview = th.lastMessage
                ? (th.lastMessage.direction === "OUT" && th.botActive ? `${t("inbox.client.previewBotPrefix")} ` : "") + th.lastMessage.excerpt
                : th.subject;
              const showHumanChip = th.assignedTo !== null;
              const showBotChip = !showHumanChip && th.channel === "WHATSAPP" && th.botActive;
              const showUnattended = !showHumanChip && !showBotChip && isUnread;
              return (
                <button
                  key={th.id}
                  type="button"
                  className={[
                    styles.row,
                    isActive ? styles.rowSelected : "",
                    isUnread ? styles.rowUnread : "",
                    isSnoozed ? styles.rowSnoozed : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setActiveThreadId(th.id)}
                >
                  <span className={styles.avatarWrap}>
                    <span className={styles.avatar} style={{ background: gradientFor(name) }}>
                      {getInitials(th.patient, th.subject)}
                    </span>
                    <span
                      className={styles.channelBadge}
                      style={{ ["--mf-ch-color" as never]: meta.color }}
                      title={t(meta.labelKey)}
                    >
                      <Icon size={10} strokeWidth={2.4} aria-hidden />
                    </span>
                  </span>
                  <span className={styles.rowBody}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowName}>{name}</span>
                      {waiting ? (
                        <span className={styles.rowWait}>
                          <Clock size={11} strokeWidth={2.4} aria-hidden />
                          {formatWaiting(wait)}
                        </span>
                      ) : (
                        <span className={styles.rowTime}>
                          {isSnoozed && <Clock size={11} strokeWidth={2} aria-hidden />}
                          {formatListTime(th.lastMessageAt)}
                        </span>
                      )}
                    </span>
                    <span className={styles.rowBottom}>
                      {th.lastMessage?.direction === "OUT" && !waiting && (
                        <span className={styles.rowCheck}>
                          <CheckCheck size={13} strokeWidth={2.4} aria-hidden />
                        </span>
                      )}
                      <span className={styles.rowPreview}>{preview}</span>
                      {th.tags.length > 0 && <span className={styles.tagPill}>{th.tags[0]}</span>}
                      {showUnattended && (
                        <span className={`${styles.stateChip} ${styles.stateChipAmber}`}>
                          <Pause size={10} strokeWidth={2.4} aria-hidden />
                          {t("inbox.client.chipUnattended")}
                        </span>
                      )}
                      {showBotChip && (
                        <span className={`${styles.stateChip} ${styles.stateChipTeal}`}>
                          <Bot size={11} strokeWidth={2.2} aria-hidden />
                          {t("inbox.client.chipBotActive")}
                        </span>
                      )}
                      {showHumanChip && th.assignedTo && (
                        <span className={`${styles.stateChip} ${styles.stateChipViolet}`}>
                          <User size={10} strokeWidth={2.4} aria-hidden />
                          {th.assignedTo.firstName}
                        </span>
                      )}
                      {isUnread && <span className={styles.unreadPill} aria-label={t("inbox.client.unreadAria")} />}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {snoozedToday > 0 && folder === "inbox" && (
          <div className={styles.listFooter}>
            <Clock size={14} strokeWidth={2} aria-hidden />
            <span className={styles.listFooterText}>
              {t("inbox.client.snoozedReturnToday", { count: snoozedToday })}
            </span>
            <button type="button" className={styles.listFooterLink} onClick={() => handleFolderClick("snoozed")}>
              {t("inbox.client.view")}
            </button>
          </div>
        )}

        <button type="button" className={styles.fab} onClick={composeSoon} aria-label={t("inbox.client.compose")}>
          <Plus size={22} strokeWidth={2.2} aria-hidden />
        </button>
      </section>

      {/* ─── Col 3: Conversación / panel vacío ─── */}
      <section className={styles.detailCol}>
        {!activeThread ? (
          loadingDetail ? (
            <div className={styles.emptyLoading}>{t("common.loading")}</div>
          ) : (
            <div className={styles.emptyPanel}>
              <div className={styles.emptyInner}>
                <div>
                  <div className={styles.greetTitle}>{greeting}</div>
                  <div className={styles.greetSub}>{emptyDateLine}</div>
                </div>
                {stats && (
                  <div className={styles.statGrid}>
                    <div className={styles.statCard}>
                      <span className={`${styles.statIcon} ${styles.statIconRed}`}>
                        <Clock size={16} strokeWidth={2} aria-hidden />
                      </span>
                      <span className={styles.statNumber}>{stats.waitingOver20m}</span>
                      <span className={styles.statLabel}>{t("inbox.client.statWaitingLabel")}</span>
                      {stats.waitingOver20m > 0 && (
                        <button type="button" className={styles.statCta} onClick={openOldestWaiting}>
                          {t("inbox.client.statWaitingCta")}
                        </button>
                      )}
                    </div>
                    <div className={styles.statCard}>
                      <span className={`${styles.statIcon} ${styles.statIconGreen}`}>
                        <CheckCheck size={16} strokeWidth={2} aria-hidden />
                      </span>
                      <span className={styles.statNumber}>{stats.resolvedToday}</span>
                      <span className={styles.statLabel}>{t("inbox.client.statResolvedLabel")}</span>
                    </div>
                    <div className={styles.statCard}>
                      <span className={`${styles.statIcon} ${styles.statIconTeal}`}>
                        <Bot size={17} strokeWidth={2} aria-hidden />
                      </span>
                      <span className={styles.statNumber}>{stats.botAuto}</span>
                      <span className={styles.statLabel}>{t("inbox.client.statBotLabel")}</span>
                      {stats.botAuto > 0 && (
                        <button
                          type="button"
                          className={`${styles.statCta} ${styles.statCtaTeal}`}
                          onClick={() => setQuickFilter("bot")}
                        >
                          {t("inbox.client.statBotCta")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {waitingThreads.length > 0 && (
                  <div className={styles.needCard}>
                    <div className={styles.needHead}>
                      <span className={styles.needDot} aria-hidden />
                      <span className={styles.needTitle}>{t("inbox.client.needAttentionNow")}</span>
                    </div>
                    {waitingThreads.slice(0, 3).map((th) => {
                      const name = threadName(th);
                      const wait = waitingMs(th, now) ?? 0;
                      return (
                        <div key={th.id} className={styles.needRow}>
                          <span className={styles.needAvatar} style={{ background: gradientFor(name) }}>
                            {getInitials(th.patient, th.subject)}
                          </span>
                          <span className={styles.needInfo}>
                            <span className={styles.needName}>{name}</span>
                            <span className={styles.needMeta}>
                              {t(CHANNEL_META[th.channel].labelKey)} · {t("inbox.client.waitingFor", { time: formatWaiting(wait) })}
                            </span>
                          </span>
                          <button type="button" className={styles.needOpen} onClick={() => setActiveThreadId(th.id)}>
                            {t("inbox.client.open")}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className={styles.emptyFootnote}>{t("inbox.client.emptyFootnote")}</div>
              </div>
            </div>
          )
        ) : (
          <>
            <header className={styles.convHeader}>
              <button
                type="button"
                className={styles.mobileBackBtn}
                onClick={() => setActiveThreadId(null)}
                aria-label={t("inbox.client.backToList")}
              >
                <ArrowLeft size={20} strokeWidth={2} aria-hidden />
              </button>
              <span className={styles.convAvatar} style={{ background: gradientFor(threadName(activeThread)) }}>
                {getInitials(activePatient, activeThread.subject)}
              </span>
              <div className={styles.convHeadInfo}>
                <div className={styles.convNameRow}>
                  <h2 className={styles.convName}>{threadName(activeThread)}</h2>
                  {activeThread.tags.length > 0 && (
                    <span className={styles.convTag}>{activeThread.tags[0]}</span>
                  )}
                </div>
                <div className={styles.convSub}>
                  {channelMeta && (
                    <channelMeta.icon size={12} strokeWidth={2.2} aria-hidden style={{ color: channelMeta.color }} />
                  )}
                  <span>
                    {channelMeta ? t(channelMeta.labelKey) : ""}
                    {activeContact ? ` · ${activeContact}` : ""}
                    {` · ${t("inbox.client.messageCount", { count: activeThread.messages.length })}`}
                  </span>
                </div>
              </div>
              <div className={styles.convActions}>
                <div className={styles.menuWrap}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={t("inbox.client.snooze")}
                    aria-label={t("inbox.client.snooze")}
                    aria-expanded={openMenu === "snooze"}
                    onClick={() => setOpenMenu((m) => (m === "snooze" ? null : "snooze"))}
                  >
                    <Clock size={16} strokeWidth={2} aria-hidden />
                  </button>
                  {openMenu === "snooze" && (
                    <div className={styles.menu} role="menu">
                      <div className={styles.menuLabel}>{t("inbox.client.snoozeUntil")}</div>
                      <button type="button" className={styles.menuItem} onClick={snoozeIn3h} role="menuitem">
                        <Clock size={14} strokeWidth={2} aria-hidden />
                        {t("inbox.client.snooze3h")}
                      </button>
                      <button type="button" className={styles.menuItem} onClick={snoozeTomorrow9} role="menuitem">
                        <Clock size={14} strokeWidth={2} aria-hidden />
                        {t("inbox.client.snoozeTomorrow")}
                      </button>
                      <button type="button" className={styles.menuItem} onClick={snoozeMonday9} role="menuitem">
                        <Clock size={14} strokeWidth={2} aria-hidden />
                        {t("inbox.client.snoozeMonday")}
                      </button>
                    </div>
                  )}
                </div>
                <div className={styles.menuWrap}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={t("inbox.client.assign")}
                    aria-label={t("inbox.client.assign")}
                    aria-expanded={openMenu === "assign"}
                    onClick={() => {
                      setOpenMenu((m) => (m === "assign" ? null : "assign"));
                      void loadTeam();
                    }}
                  >
                    <UserPlus size={16} strokeWidth={2} aria-hidden />
                  </button>
                  {openMenu === "assign" && (
                    <div className={styles.menu} role="menu">
                      <div className={styles.menuLabel}>{t("inbox.client.assignTo")}</div>
                      <button
                        type="button"
                        className={`${styles.menuItem} ${activeThread.assignedToId === viewer.id ? styles.menuItemActive : ""}`}
                        onClick={() => assignTo({ id: viewer.id, firstName: viewer.firstName, lastName: viewer.lastName })}
                        role="menuitem"
                      >
                        <span className={styles.menuAvatar} style={{ background: gradientFor(`${viewer.firstName} ${viewer.lastName}`) }}>
                          {getInitials({ firstName: viewer.firstName, lastName: viewer.lastName })}
                        </span>
                        {t("inbox.client.assignMe")}
                      </button>
                      {activeThread.assignedToId && (
                        <button type="button" className={styles.menuItem} onClick={() => assignTo(null)} role="menuitem">
                          <UserX size={14} strokeWidth={2} aria-hidden />
                          {t("inbox.client.unassign")}
                        </button>
                      )}
                      {teamList
                        .filter((m) => m.id !== viewer.id)
                        .map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`${styles.menuItem} ${activeThread.assignedToId === m.id ? styles.menuItemActive : ""}`}
                            onClick={() => assignTo(m)}
                            role="menuitem"
                          >
                            <span
                              className={styles.menuAvatar}
                              style={{ background: m.color || gradientFor(`${m.firstName} ${m.lastName}`) }}
                            >
                              {getInitials(m)}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {m.firstName} {m.lastName}
                            </span>
                          </button>
                        ))}
                      {team === "error" && (
                        <div className={styles.menuEmpty}>{t("inbox.client.teamUnavailable")}</div>
                      )}
                      {team === null && <div className={styles.menuEmpty}>{t("common.loading")}</div>}
                    </div>
                  )}
                </div>
                <button type="button" className={styles.resolveBtn} onClick={resolveThread}>
                  <Check size={14} strokeWidth={2.4} aria-hidden />
                  <span className={styles.resolveLabel}>{t("inbox.client.resolve")}</span>
                </button>
                <div className={styles.menuWrap}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={t("inbox.client.moreOptions")}
                    aria-label={t("inbox.client.moreOptions")}
                    aria-expanded={openMenu === "more"}
                    onClick={() => setOpenMenu((m) => (m === "more" ? null : "more"))}
                  >
                    <MoreHorizontal size={16} strokeWidth={2.4} aria-hidden />
                  </button>
                  {openMenu === "more" && (
                    <div className={styles.menu} role="menu">
                      {activePatient && (
                        <a className={styles.menuItem} href={`/dashboard/patients/${activePatient.id}`} role="menuitem">
                          <ExternalLink size={14} strokeWidth={2} aria-hidden />
                          {t("inbox.client.viewRecord")}
                        </a>
                      )}
                      <button type="button" className={styles.menuItem} onClick={markUnread} role="menuitem">
                        <MailOpen size={14} strokeWidth={2} aria-hidden />
                        {t("inbox.client.markUnread")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </header>
            {openMenu && (
              <button
                type="button"
                className={styles.menuBackdrop}
                aria-label={t("inbox.client.closePanel")}
                onClick={() => setOpenMenu(null)}
              />
            )}

            {/* Strip de estado: bot (WhatsApp) + asignado + ventana 24h */}
            <div className={styles.stateStrip}>
              {activeThread.channel === "WHATSAPP" ? (
                activeThread.botActive ? (
                  <>
                    <span className={`${styles.pill} ${styles.pillTeal}`}>
                      <Bot size={13} strokeWidth={2.2} aria-hidden />
                      {t("inbox.client.botAutoPill")}
                    </span>
                    <button type="button" className={`${styles.pillBtn} ${styles.pillBtnNeutral}`} onClick={toggleBot}>
                      <Pause size={11} strokeWidth={2.2} aria-hidden />
                      {t("inbox.client.botPause")}
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`${styles.pill} ${styles.pillAmber}`}>
                      <Pause size={12} strokeWidth={2.2} aria-hidden />
                      {activeThread.assignedTo
                        ? t("inbox.client.botPausedByPill", { name: `${activeThread.assignedTo.firstName} ${activeThread.assignedTo.lastName}`.trim() })
                        : t("inbox.client.botPausedPill")}
                    </span>
                    <button type="button" className={styles.pillBtn} onClick={toggleBot}>
                      <Play size={11} strokeWidth={2.2} aria-hidden />
                      {t("inbox.client.botResume")}
                    </button>
                  </>
                )
              ) : (
                <span className={`${styles.pill} ${activeThread.assignedTo ? styles.pillViolet : styles.pillAmber}`}>
                  <User size={11} strokeWidth={2.4} aria-hidden />
                  {activeThread.assignedTo
                    ? t("inbox.client.attendedByPill", { name: `${activeThread.assignedTo.firstName} ${activeThread.assignedTo.lastName}`.trim() })
                    : t("inbox.client.assigneeUnassigned")}
                </span>
              )}
              <span className={styles.stripSpacer} />
              {windowInfo && (
                windowInfo.open ? (
                  <span className={`${styles.pill} ${styles.pillGreen}`}>
                    <span className={styles.pulseDot} aria-hidden />
                    {t("inbox.client.windowOpenPill")}
                  </span>
                ) : (
                  <span className={`${styles.pill} ${styles.pillRed}`}>
                    <span className={styles.redDot} aria-hidden />
                    {t("inbox.client.windowClosedPill")}
                  </span>
                )
              )}
            </div>

            {/* Mensajes */}
            <div className={styles.messages}>
              {loadingDetail ? (
                <div className={styles.msgLoading}>{t("inbox.client.loadingMessages")}</div>
              ) : activeThread.messages.length === 0 && activeLiveEvents.length === 0 ? (
                <div className={styles.msgLoading}>{t("inbox.client.noMessagesYet")}</div>
              ) : (
                messagesByDay.map((g) => (
                  <div key={g.day} style={{ display: "contents" }}>
                    <div className={styles.dayWrap}>
                      <span className={styles.dayChip}>{formatDayDivider(g.day)}</span>
                    </div>
                    {g.items.map((m) => {
                      if (m.isInternal) {
                        return (
                          <div key={m.id} className={styles.noteCard}>
                            <div className={styles.noteHead}>
                              <Lock size={12} strokeWidth={2.2} aria-hidden />
                              <span className={styles.noteTitle}>{t("inbox.client.internalNote")}</span>
                              <span className={styles.noteMeta}>
                                {m.sentBy ? `${m.sentBy.firstName} ${m.sentBy.lastName}` : t("inbox.client.staff")}
                                {" · "}
                                {formatBubbleTime(m.sentAt)}
                              </span>
                            </div>
                            <div className={styles.noteBody}>{m.body}</div>
                            <div className={styles.noteFoot}>{t("inbox.client.internalNoteFoot")}</div>
                          </div>
                        );
                      }
                      if (m.direction === "IN") {
                        return (
                          <div key={m.id} className={`${styles.msgGroup} ${styles.msgGroupIn}`}>
                            <div className={`${styles.bubble} ${styles.bubbleIn}`}>
                              {m.body}
                              <span className={styles.bubbleTime}>{formatBubbleTime(m.sentAt)}</span>
                            </div>
                          </div>
                        );
                      }
                      // OUT: staff desde el panel (sentBy) vs bot/celular (sin sentBy —
                      // v1 no los distingue: label genérico "DaleControl").
                      const fromStaff = m.sentBy !== null;
                      return (
                        <div key={m.id} className={`${styles.msgGroup} ${styles.msgGroupOut}`}>
                          <span className={styles.msgLabel}>
                            {fromStaff ? (
                              <>
                                <span className={styles.msgLabelIconStaff}>
                                  <User size={11} strokeWidth={2.2} aria-hidden />
                                </span>
                                {t("inbox.client.staffFromPanel", { name: `${m.sentBy!.firstName} ${m.sentBy!.lastName}`.trim() })}
                              </>
                            ) : activeThread.channel === "WHATSAPP" ? (
                              <>
                                <span className={styles.msgLabelIconBot}>
                                  <Bot size={12} strokeWidth={2.2} aria-hidden />
                                </span>
                                {t("inbox.client.genericOutLabel")}
                              </>
                            ) : (
                              t("inbox.client.genericOutLabel")
                            )}
                          </span>
                          <div className={`${styles.bubble} ${fromStaff ? styles.bubbleStaff : styles.bubbleBot}`}>
                            {m.body}
                            <span className={styles.bubbleTime}>
                              {formatBubbleTime(m.sentAt)}
                              <span className={fromStaff ? styles.checkSolid : styles.checkSoft}>
                                <CheckCheck size={13} strokeWidth={2.2} aria-hidden />
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              {activeLiveEvents.map((ev) => (
                <div key={ev.id} className={styles.sysEvent}>
                  <span className={styles.sysEventPill}>
                    <Pause size={11} strokeWidth={2.2} aria-hidden />
                    {ev.text} · {formatBubbleTime(ev.at)}
                  </span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className={`${styles.composer} ${composerMode === "internal" ? styles.composerNote : ""}`}>
              {windowInfo && composerMode === "reply" && (
                windowInfo.open ? (
                  <div className={styles.winStrip}>
                    <span className={styles.pulseDot} aria-hidden />
                    <span className={styles.winText}>{t("inbox.client.windowStripOpen")}</span>
                    {windowInfo.closesAt && (
                      <span className={styles.winCountdown}>{formatCloses(windowInfo.closesAt)}</span>
                    )}
                  </div>
                ) : (
                  <div className={`${styles.winStrip} ${styles.winStripClosed}`}>
                    <span className={styles.redDot} aria-hidden />
                    <span className={styles.winText}>{t("inbox.client.windowStripClosed")}</span>
                  </div>
                )
              )}

              <div className={styles.composerTabs}>
                <button
                  type="button"
                  className={`${styles.composerTab} ${composerMode === "reply" ? styles.composerTabActive : ""}`}
                  onClick={() => setComposerMode("reply")}
                >
                  <MessageCircle size={13} strokeWidth={2.2} aria-hidden />
                  {t("inbox.client.tabReply")}
                </button>
                <button
                  type="button"
                  className={`${styles.composerTab} ${composerMode === "internal" ? styles.composerTabNoteActive : ""}`}
                  onClick={() => setComposerMode("internal")}
                >
                  <Lock size={12} strokeWidth={2.2} aria-hidden />
                  {t("inbox.client.tabInternalNote")}
                </button>
                {composerMode === "internal" && (
                  <span className={styles.noteHint}>{t("inbox.client.noteHint")}</span>
                )}
              </div>

              {composerMode === "reply" && (
                <div className={styles.tplRow}>
                  <span className={styles.tplLabel}>
                    <Zap size={12} strokeWidth={2.2} aria-hidden />
                    <span>{t("inbox.client.templates")}</span>
                  </span>
                  {(["tplConfirm", "tplLocation", "tplPostCare"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={styles.tplChip}
                      disabled={windowClosed}
                      onClick={() => insertTemplate(t(`inbox.client.${k}Text`))}
                    >
                      {t(`inbox.client.${k}Label`)}
                    </button>
                  ))}
                </div>
              )}

              {composerMode === "reply" && windowClosed && (
                <div className={styles.oowNotice}>{t("inbox.client.outOfWindowNotice")}</div>
              )}

              <div className={styles.composerMain}>
                <div className={styles.textareaWrap}>
                  <textarea
                    ref={composerRef}
                    className={styles.textarea}
                    rows={2}
                    placeholder={
                      composerMode === "internal"
                        ? t("inbox.client.placeholderInternalNote")
                        : activePatient
                        ? t("inbox.client.placeholderReplyFor", { name: activePatient.firstName })
                        : t("inbox.client.placeholderReply")
                    }
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    onKeyDown={handleKey}
                    disabled={sending || (composerMode === "reply" && windowClosed)}
                  />
                </div>
                <div className={styles.composerIcons}>
                  <button type="button" className={styles.composerIconBtn} disabled title={t("inbox.client.comingSoon")} aria-label={t("inbox.client.attachFile")}>
                    <Paperclip size={16} strokeWidth={2} aria-hidden />
                  </button>
                  {composerMode === "reply" ? (
                    <>
                      <button type="button" className={styles.composerIconBtn} disabled title={t("inbox.client.comingSoon")} aria-label={t("inbox.client.insertEmoji")}>
                        <Smile size={16} strokeWidth={2} aria-hidden />
                      </button>
                      <button type="button" className={styles.composerIconBtn} disabled title={t("inbox.client.comingSoon")} aria-label={t("inbox.client.recordAudio")}>
                        <Mic size={16} strokeWidth={2} aria-hidden />
                      </button>
                      <button type="button" className={styles.composerIconBtn} disabled title={t("inbox.client.comingSoon")} aria-label={t("inbox.client.scheduleAppointment")}>
                        <CalendarPlus size={16} strokeWidth={2} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <button type="button" className={styles.mentionBtn} disabled title={t("inbox.client.comingSoon")}>
                      @ {t("inbox.client.mentionTeam")}
                    </button>
                  )}
                </div>
                <div className={styles.sendZone}>
                  <span className={styles.sendHint}>{t("inbox.client.enterToSend")}</span>
                  <button
                    type="button"
                    className={`${styles.sendBtn} ${composerMode === "internal" ? styles.sendBtnNote : ""}`}
                    onClick={sendReply}
                    disabled={!composerText.trim() || replyDisabled}
                  >
                    {composerMode === "internal" ? (
                      <Lock size={13} strokeWidth={2.2} aria-hidden />
                    ) : (
                      <Send size={14} strokeWidth={2} aria-hidden />
                    )}
                    <span className={styles.sendLabel}>
                      {sending
                        ? t("inbox.client.sending")
                        : composerMode === "internal"
                        ? t("inbox.client.saveNote")
                        : t("common.send")}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
