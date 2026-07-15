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
  FileText,
  Calendar,
  Bell,
  Plus,
  Search,
  Bot,
  CheckCheck,
  ExternalLink,
  Menu,
  ArrowLeft,
  MessageSquare,
  User,
  UserX,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import styles from "./inbox.module.css";

type Channel = "WHATSAPP" | "EMAIL" | "PORTAL_FORM" | "VALIDATION" | "REMINDER" | "PORTAL";
type Status = "UNREAD" | "READ" | "ARCHIVED" | "SNOOZED";
type Direction = "IN" | "OUT";

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
}

interface Counts {
  total: number;
  byChannel: Record<string, number>;
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
  messages: ThreadMessage[];
}

const CHANNEL_META: Record<Channel, { labelKey: string; color: string; icon: typeof InboxIcon }> = {
  WHATSAPP:    { labelKey: "inbox.client.channelWhatsapp",  color: "#25d366", icon: MessageCircle },
  EMAIL:       { labelKey: "inbox.client.channelEmail",     color: "#ea580c", icon: Mail },
  PORTAL_FORM: { labelKey: "inbox.client.channelForm", color: "#06b6d4", icon: FileText },
  VALIDATION:  { labelKey: "inbox.client.channelValidation", color: "#d97706", icon: Calendar },
  REMINDER:    { labelKey: "inbox.client.channelReminder", color: "#7c3aed", icon: Bell },
  PORTAL:      { labelKey: "inbox.client.channelPortal", color: "#6366f1", icon: MessageSquare },
};

const SYSTEM_FOLDERS: Array<{ id: string; labelKey: string; icon: typeof InboxIcon }> = [
  { id: "inbox",    labelKey: "inbox.client.folderInbox", icon: InboxIcon },
  { id: "snoozed",  labelKey: "inbox.client.folderSnoozed",         icon: Clock },
  { id: "sent",     labelKey: "inbox.client.folderSent",           icon: Send },
  { id: "archived", labelKey: "inbox.client.folderArchived",        icon: Archive },
];

function getInitials(p: { firstName: string; lastName: string } | null): string {
  if (!p) return "?";
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(date);
}

function formatDayDivider(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long", day: "numeric", month: "long",
  }).format(date);
}

function formatBubbleTime(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function InboxClient() {
  const t = useT();
  const sp = useSearchParams();
  const patientIdFilter = sp.get("patientId");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, byChannel: {} });
  const [folder, setFolder] = useState<string>("inbox");
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [activeAssignee, setActiveAssignee] = useState<"me" | "unassigned" | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadDetail | null>(null);
  const [search, setSearch] = useState("");
  const [composerMode, setComposerMode] = useState<"reply" | "internal">("reply");
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mobile drawer state — solo se usa <1024px. El sidebar de canales
  // pasa a drawer izquierdo (off-canvas) y el detail panel a overlay
  // full-screen cuando hay activeThread. Esc cierra cualquier overlay.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mobileSidebarOpen) setMobileSidebarOpen(false);
      else if (activeThreadId && window.matchMedia("(max-width: 1023px)").matches) {
        setActiveThreadId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileSidebarOpen, activeThreadId]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Cursor del polling en tiempo real (lo siembra el listado con serverTime y lo
  // avanza cada poll de /api/inbox/since). Ref para no re-disparar efectos.
  const lastSyncRef = useRef<string | null>(null);
  // El hilo abierto, en ref, para leerlo dentro del intervalo de polling sin
  // recrearlo en cada cambio de selección.
  const activeThreadIdRef = useRef<string | null>(null);
  // Contador de polls para reconciliar en duro (silencioso) 1 de cada 6 (~30s).
  const pollTickRef = useRef(0);

  // Carga autoritativa de la lista. `silent: true` la usa la reconciliación del
  // polling: recarga la lista completa SIN spinner ni tocar el cursor, para
  // reflejar bajas/cambios que el incremental no puede ver (hilos que salen del
  // filtro, reasignados, archivados por otro usuario).
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
      if (activeAssignee) params.set("assignedTo", activeAssignee);
      if (search.trim()) params.set("search", search.trim());
      if (patientIdFilter) params.set("patientId", patientIdFilter);

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
      // Sólo la carga NO silenciosa siembra/avanza el cursor. La reconciliación
      // deja el cursor intacto a propósito: así el siguiente poll incremental
      // sigue trayendo los mensajes nuevos del hilo abierto sin huecos.
      if (!silent && data.serverTime) lastSyncRef.current = data.serverTime;
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : t("inbox.client.errorLoadInbox"));
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [folder, activeChannel, activeAssignee, search, patientIdFilter, t]);

  // Polling en tiempo real: cada 5s pide a /api/inbox/since SÓLO lo que cambió
  // desde el último cursor y lo mergea sin recargar la vista. Se pausa cuando la
  // pestaña está oculta. El aislamiento por clínica lo garantiza el servidor.
  const pollSince = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    // Un único gate por cursor: si es null hay una recarga en duro en curso (o
    // aún no cargó la lista), así que no hacemos NADA hasta que se siembre.
    const since = lastSyncRef.current;
    if (!since) return;

    // 1 de cada 6 polls (~30s) reconciliamos la lista completa en silencio. Es
    // la red de seguridad para lo que el incremental no ve: hilos que salen del
    // filtro, reasignados o archivados por otro usuario, y la rara truncación
    // por tope. No avanza el cursor (lo hace solo el incremental).
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
      if (activeAssignee) params.set("assignedTo", activeAssignee);
      if (search.trim()) params.set("search", search.trim());
      if (patientIdFilter) params.set("patientId", patientIdFilter);
      if (activeThreadIdRef.current) params.set("threadId", activeThreadIdRef.current);

      const res = await fetch(`/api/inbox/since?${params.toString()}`);
      if (!res.ok) return; // polling silencioso: nunca rompe la UI
      const data = await res.json();
      if (data.serverTime) lastSyncRef.current = data.serverTime;

      // Threads cambiados: el `since` devuelve el Thread completo (mismo select
      // que el listado), así que se reemplaza por id y se reordena por fecha.
      const incoming: Thread[] = data.threads ?? [];
      if (incoming.length > 0) {
        setThreads((prev) => {
          const byId: Record<string, Thread> = {};
          for (const th of prev) byId[th.id] = th;
          for (const th of incoming) byId[th.id] = th;
          return Object.keys(byId)
            .map((k) => byId[k])
            .sort(
              (a, b) =>
                new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
            );
        });
      }

      // Badges de no-leídos por canal (el total del folder Inbox se deriva de
      // threads.length en otro efecto).
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
  }, [folder, activeChannel, activeAssignee, search, patientIdFilter, fetchThreads]);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  // Mantiene el ref del hilo abierto al día para el polling.
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // El badge del folder "Inbox" refleja en vivo el número de hilos de la vista.
  useEffect(() => {
    setCounts((c) => (c.total === threads.length ? c : { ...c, total: threads.length }));
  }, [threads.length]);

  // Arranca/limpia el intervalo de polling. Se re-crea si cambian los filtros
  // (pollSince depende de ellos) y dispara un poll inmediato al volver a la
  // pestaña (visibilitychange). Limpia interval y listener al desmontar.
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

  // Cuando se selecciona un thread, fetch detalle
  useEffect(() => {
    if (!activeThreadId) {
      setActiveThread(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    (async () => {
      try {
        const res = await fetch(`/api/inbox/threads/${activeThreadId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        setActiveThread(data.thread);
        // Marca como leído si estaba unread
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

  // Auto-scroll al fondo cuando cambian mensajes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages.length]);

  const filteredThreads = useMemo(() => {
    if (folder === "sent") {
      // No tenemos status SENT — mostramos los que tienen mensajes OUT
      return threads;
    }
    return threads;
  }, [threads, folder]);

  const sendReply = useCallback(async () => {
    if (!activeThread || !composerText.trim()) return;
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
      // reflejarlo en el detalle y en la lista sin re-fetch.
      const pausedBot = composerMode !== "internal" && activeThread.channel === "WHATSAPP";
      setActiveThread((prev) =>
        prev
          ? { ...prev, messages: [...prev.messages, data.message], ...(pausedBot ? { botActive: false } : {}) }
          : prev,
      );
      if (pausedBot) {
        setThreads((prev) =>
          prev.map((th) => (th.id === activeThread.id ? { ...th, botActive: false } : th)),
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
  }, [activeThread, composerText, composerMode, t]);

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
      toast.success(next ? t("inbox.client.botActive") : t("inbox.client.botPaused"));
    } catch {
      toast.error(t("inbox.client.errorSend"));
    }
  }, [activeThread, t]);

  const archiveThread = useCallback(async () => {
    if (!activeThread) return;
    try {
      await fetch(`/api/inbox/threads/${activeThread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      setThreads((prev) => prev.filter((th) => th.id !== activeThread.id));
      setActiveThreadId(null);
      setActiveThread(null);
      toast.success(t("inbox.client.toastArchived"));
    } catch {
      toast.error(t("inbox.client.toastArchiveError"));
    }
  }, [activeThread, t]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void sendReply();
    }
  }, [sendReply]);

  const handleFolderClick = useCallback((id: string) => {
    setFolder(id);
    setActiveChannel(null);
    setActiveAssignee(null);
    setActiveThreadId(null);
    setMobileSidebarOpen(false);
  }, []);

  const handleChannelClick = useCallback((ch: Channel) => {
    setFolder("inbox");
    setActiveChannel((prev) => (prev === ch ? null : ch));
    setActiveAssignee(null);
    setActiveThreadId(null);
    setMobileSidebarOpen(false);
  }, []);

  const handleAssigneeClick = useCallback((a: "me" | "unassigned") => {
    setFolder("inbox");
    setActiveChannel(null);
    setActiveAssignee((prev) => (prev === a ? null : a));
    setActiveThreadId(null);
    setMobileSidebarOpen(false);
  }, []);

  // Group messages por día para los dividers
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

  const folderTitle = folder === "snoozed"
    ? t("inbox.client.folderSnoozed")
    : folder === "sent"
    ? t("inbox.client.folderSent")
    : folder === "archived"
    ? t("inbox.client.folderArchived")
    : activeChannel
    ? t(CHANNEL_META[activeChannel].labelKey)
    : activeAssignee === "me"
    ? t("inbox.client.assigneeMe")
    : activeAssignee === "unassigned"
    ? t("inbox.client.assigneeUnassigned")
    : t("inbox.client.folderInbox");

  const activePatient = activeThread?.patient ?? null;
  const channelMeta = activeThread ? CHANNEL_META[activeThread.channel] : null;

  return (
    <div
      className={styles.page}
      data-mobile-sidebar-open={mobileSidebarOpen || undefined}
      data-mobile-detail-open={activeThreadId ? "true" : undefined}
    >
      {/* Backdrop sólo aparece en mobile cuando el sidebar drawer está abierto. */}
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label={t("inbox.client.closePanel")}
          className={styles.mobileBackdrop}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      {/* ─── Col 1: Sidebar (drawer en mobile) ─── */}
      <aside
        className={styles.sidebar}
        role={mobileSidebarOpen ? "dialog" : undefined}
        aria-modal={mobileSidebarOpen ? "true" : undefined}
        aria-label={t("inbox.client.channelsAndFolders")}
      >
        <div className={styles.brandHeader}>
          <div className={styles.brandRow}>
            <span className={styles.brandIcon}><InboxIcon size={14} strokeWidth={1.75} aria-hidden /></span>
            Inbox
          </div>
          <button type="button" className={styles.composeBtn}>
            <Plus size={13} strokeWidth={1.75} aria-hidden /> {t("inbox.client.compose")}
            <kbd>C</kbd>
          </button>
        </div>

        <div className={styles.folderList}>
          <div className={styles.folderGroupLabel}>{t("inbox.client.groupFolders")}</div>
          {SYSTEM_FOLDERS.map((f) => {
            const isActive = folder === f.id && !activeChannel && !activeAssignee;
            return (
              <button
                key={f.id}
                type="button"
                className={`${styles.folder} ${isActive ? styles.folderActive : ""}`}
                onClick={() => handleFolderClick(f.id)}
              >
                <span className={styles.folderIcon}><f.icon size={14} strokeWidth={1.75} aria-hidden /></span>
                <span className={styles.folderLabel}>{t(f.labelKey)}</span>
                {f.id === "inbox" && counts.total > 0 && (
                  <span className={styles.folderCount}>{counts.total}</span>
                )}
              </button>
            );
          })}

          <div className={styles.folderGroupLabel}>{t("inbox.client.groupChannels")}</div>
          {(Object.keys(CHANNEL_META) as Channel[]).map((ch) => {
            const meta = CHANNEL_META[ch];
            const c = counts.byChannel[ch] ?? 0;
            const isActive = activeChannel === ch;
            return (
              <button
                key={ch}
                type="button"
                className={`${styles.folder} ${isActive ? styles.folderActive : ""} ${c > 0 ? styles.folderUnread : ""}`}
                style={{ ["--mf-ch-color" as never]: meta.color }}
                onClick={() => handleChannelClick(ch)}
              >
                <span className={styles.folderDot} aria-hidden />
                <span className={styles.folderLabel}>{t(meta.labelKey)}</span>
                {c > 0 && <span className={styles.folderCount}>{c}</span>}
              </button>
            );
          })}

          <div className={styles.folderGroupLabel}>{t("inbox.client.groupAssignedTo")}</div>
          <button
            type="button"
            className={`${styles.folder} ${activeAssignee === "me" ? styles.folderActive : ""}`}
            onClick={() => handleAssigneeClick("me")}
          >
            <span className={styles.folderIcon}><User size={14} strokeWidth={1.75} aria-hidden /></span>
            <span className={styles.folderLabel}>{t("inbox.client.assigneeMe")}</span>
          </button>
          <button
            type="button"
            className={`${styles.folder} ${activeAssignee === "unassigned" ? styles.folderActive : ""}`}
            onClick={() => handleAssigneeClick("unassigned")}
          >
            <span className={styles.folderIcon}><UserX size={14} strokeWidth={1.75} aria-hidden /></span>
            <span className={styles.folderLabel}>{t("inbox.client.assigneeUnassigned")}</span>
          </button>
        </div>

        <div className={styles.userBlock}>
          <div className={styles.userAvatar}>DR</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.userName}>{t("inbox.client.userDoctor")}</div>
            <div className={styles.userRole}>{t("inbox.client.userUnifiedInbox")}</div>
          </div>
        </div>
      </aside>

      {/* ─── Col 2: Threads list ─── */}
      <section className={styles.threadCol}>
        <div className={styles.threadHeader}>
          <div className={styles.threadHeaderTitle}>
            {/* Hamburger sólo en mobile (lo oculta el CSS con media query). */}
            <button
              type="button"
              className={styles.mobileMenuBtn}
              onClick={() => setMobileSidebarOpen(true)}
              aria-label={t("inbox.client.openChannelsAndFolders")}
            >
              <Menu size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <h2>{folderTitle}</h2>
            <span className={styles.threadCount}>
              {t("inbox.client.threadCount", { count: filteredThreads.length })}
            </span>
          </div>
          <div className={styles.threadSearch}>
            <Search size={13} strokeWidth={1.75} aria-hidden className={styles.threadSearchIcon} />
            <input
              type="text"
              className={styles.threadSearchInput}
              placeholder={t("inbox.client.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={styles.threadFilters}>
            {(Object.keys(CHANNEL_META) as Channel[]).map((ch) => (
              <button
                key={ch}
                type="button"
                className={`${styles.threadFilter} ${activeChannel === ch ? styles.threadFilterActive : ""}`}
                style={{ ["--mf-ch-color" as never]: CHANNEL_META[ch].color }}
                onClick={() => handleChannelClick(ch)}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: CHANNEL_META[ch].color }} aria-hidden />
                {t(CHANNEL_META[ch].labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.threadList}>
          {loadingList ? (
            <div className={styles.emptyState}>{t("common.loading")}</div>
          ) : error ? (
            <div className={styles.emptyState} style={{ color: "var(--warning)" }}>{error}</div>
          ) : filteredThreads.length === 0 ? (
            <div className={styles.emptyState}>
              <InboxIcon size={36} strokeWidth={1.75} aria-hidden style={{ opacity: 0.3, marginBottom: 8 }} />
              <div>{t("inbox.client.emptyThreadsIn", { folder: folderTitle.toLowerCase() })}</div>
            </div>
          ) : (
            filteredThreads.map((th) => {
              const meta = CHANNEL_META[th.channel];
              const Icon = meta.icon;
              const isActive = th.id === activeThreadId;
              const isUnread = th.status === "UNREAD";
              const isSnoozed = th.status === "SNOOZED";
              return (
                <button
                  key={th.id}
                  type="button"
                  className={[
                    styles.thread,
                    isActive ? styles.threadActive : "",
                    isUnread ? styles.threadUnread : "",
                    isSnoozed ? styles.threadSnoozed : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setActiveThreadId(th.id)}
                >
                  <span className={styles.threadCheckbox}>
                    {isUnread && <span className={styles.unreadDot} aria-hidden />}
                  </span>
                  <span className={styles.threadAvatar}>
                    {getInitials(th.patient)}
                    <span
                      className={styles.threadChannelBadge}
                      style={{ ["--mf-ch-color" as never]: meta.color }}
                      title={t(meta.labelKey)}
                    >
                      <Icon size={9} strokeWidth={1.75} aria-hidden />
                    </span>
                  </span>
                  <span className={styles.threadBody}>
                    <span className={styles.threadRow1}>
                      <span className={styles.threadName}>
                        {th.patient ? `${th.patient.firstName} ${th.patient.lastName}` : th.subject}
                      </span>
                      <span className={styles.threadTime}>
                        {isSnoozed && <Clock size={11} strokeWidth={1.75} aria-hidden />}{formatTime(th.lastMessageAt)}
                      </span>
                    </span>
                    <span className={styles.threadSubject}>{th.subject}</span>
                    {th.tags.length > 0 && (
                      <span className={styles.threadTags}>
                        {th.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className={styles.threadTag} style={{ ["--mf-tag-color" as never]: "var(--brand)" }}>
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* ─── Col 3: Detail panel ─── */}
      <section className={styles.detailCol}>
        {!activeThread ? (
          <div className={styles.emptyState} style={{ flex: 1 }}>
            <InboxIcon size={48} strokeWidth={1.75} aria-hidden style={{ opacity: 0.25, marginBottom: 12 }} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>
              {t("inbox.client.selectConversation")}
            </h2>
            <p>{t("inbox.client.selectConversationHint")}</p>
          </div>
        ) : (
          <>
            <header className={styles.detailHeader}>
              {/* Back button sólo visible en mobile. Vuelve al thread list. */}
              <button
                type="button"
                className={styles.mobileBackBtn}
                onClick={() => setActiveThreadId(null)}
                aria-label={t("inbox.client.backToList")}
              >
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
              </button>
              <span className={styles.detailAvatar}>{getInitials(activePatient)}</span>
              <div className={styles.detailHeaderInfo}>
                <h2 className={styles.detailName}>
                  {activePatient
                    ? `${activePatient.firstName} ${activePatient.lastName}`
                    : activeThread.subject}
                </h2>
                <div className={styles.detailMeta}>
                  {channelMeta && (
                    <span className={styles.channelTag} style={{ ["--mf-ch-color" as never]: channelMeta.color }}>
                      <channelMeta.icon size={11} strokeWidth={1.75} aria-hidden /> {t(channelMeta.labelKey)}
                    </span>
                  )}
                  <span>·</span>
                  <span>{activeThread.subject}</span>
                  <span>·</span>
                  <span>{t("inbox.client.messageCount", { count: activeThread.messages.length })}</span>
                </div>
              </div>
              <div className={styles.detailHeaderActions}>
                {activeThread.channel === "WHATSAPP" && (
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={activeThread.botActive ? t("inbox.client.botActive") : t("inbox.client.botPaused")}
                    aria-label={activeThread.botActive ? t("inbox.client.botPause") : t("inbox.client.botResume")}
                    onClick={toggleBot}
                  >
                    <Bot size={14} strokeWidth={1.75} aria-hidden style={{ color: activeThread.botActive ? "var(--success)" : "var(--text-3)" }} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.iconBtn}
                  title={t("inbox.client.archive")}
                  aria-label={t("inbox.client.archiveConversation")}
                  onClick={archiveThread}
                >
                  <Archive size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </header>

            <div className={styles.assigneeStrip}>
              <span className={styles.assigneeStripLabel}>{t("inbox.client.assignedTo")}</span>
              <span style={{ fontWeight: 700 }}>
                {activeThread.assignedTo
                  ? `${activeThread.assignedTo.firstName} ${activeThread.assignedTo.lastName}`
                  : t("inbox.client.assigneeUnassigned")}
              </span>
              <span className={styles.assigneeStripSpacer} />
              {activePatient && (
                <a
                  className={styles.assigneeStripLink}
                  href={`/dashboard/patients/${activePatient.id}`}
                >
                  <ExternalLink size={11} strokeWidth={1.75} aria-hidden style={{ display: "inline", marginRight: 3 }} />
                  {t("inbox.client.viewRecord")}
                </a>
              )}
            </div>

            <div className={styles.messages}>
              {loadingDetail ? (
                <div style={{ padding: 30, color: "var(--text-3)", textAlign: "center" }}>{t("inbox.client.loadingMessages")}</div>
              ) : activeThread.messages.length === 0 ? (
                <div style={{ padding: 30, color: "var(--text-3)", textAlign: "center" }}>
                  {t("inbox.client.noMessagesYet")}
                </div>
              ) : (
                messagesByDay.map((g) => (
                  <div key={g.day}>
                    <div className={styles.dayDivider}>{formatDayDivider(g.day)}</div>
                    {g.items.map((m) => {
                      if (m.isInternal) {
                        return (
                          <div key={m.id} className={`${styles.message} ${styles.messageInternal}`}>
                            <div className={`${styles.messageBubble} ${styles.messageBubbleInternal}`}>
                              <div>{m.body}</div>
                              <span className={styles.messageMeta}>
                                {m.sentBy
                                  ? `${m.sentBy.firstName} ${m.sentBy.lastName}`
                                  : t("inbox.client.staff")}
                                {" · "}{formatBubbleTime(m.sentAt)}
                              </span>
                            </div>
                          </div>
                        );
                      }
                      const isOut = m.direction === "OUT";
                      return (
                        <div
                          key={m.id}
                          className={`${styles.message} ${isOut ? styles.messageOut : styles.messageIn}`}
                        >
                          <span className={`${styles.messageAvatar} ${isOut ? styles.messageAvatarOut : styles.messageAvatarIn}`}>
                            {isOut ? "DR" : getInitials(activePatient)}
                          </span>
                          <div className={`${styles.messageBubble} ${isOut ? styles.messageBubbleOut : styles.messageBubbleIn}`}>
                            <div>{m.body}</div>
                            <span className={styles.messageMeta}>
                              {formatBubbleTime(m.sentAt)}
                              {isOut && <CheckCheck size={11} strokeWidth={1.75} aria-hidden style={{ color: "var(--success)" }} />}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className={styles.composer}>
              <div className={styles.composerTabs}>
                <button
                  type="button"
                  className={`${styles.composerTab} ${composerMode === "reply" ? styles.composerTabActive : ""}`}
                  onClick={() => setComposerMode("reply")}
                >
                  {t("inbox.client.tabReply")}
                </button>
                <button
                  type="button"
                  className={`${styles.composerTab} ${composerMode === "internal" ? styles.composerTabActiveInternal : ""}`}
                  onClick={() => setComposerMode("internal")}
                >
                  {t("inbox.client.tabInternalNote")}
                </button>
              </div>
              <div
                className={`${styles.composerArea} ${composerMode === "internal" ? styles.composerAreaInternal : ""}`}
              >
                <textarea
                  ref={composerRef}
                  className={styles.composerTextarea}
                  placeholder={
                    composerMode === "internal"
                      ? t("inbox.client.placeholderInternalNote")
                      : channelMeta
                      ? t("inbox.client.placeholderReplyVia", { channel: t(channelMeta.labelKey).toLowerCase() })
                      : t("inbox.client.placeholderReply")
                  }
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={handleKey}
                  disabled={sending}
                />
                <div className={styles.composerBar}>
                  <span className={styles.composerBarSpacer} />
                  <button
                    type="button"
                    className={styles.sendBtn}
                    onClick={sendReply}
                    disabled={!composerText.trim() || sending}
                  >
                    <Send size={12} strokeWidth={1.75} aria-hidden />
                    {sending ? t("inbox.client.sending") : composerMode === "internal" ? t("inbox.client.saveNote") : t("common.send")}
                    <kbd>⌘↵</kbd>
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
