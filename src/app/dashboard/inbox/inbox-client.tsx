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
  Paperclip,
  Smile,
  Sparkles,
  Check,
  CheckCheck,
  MoreHorizontal,
  ExternalLink,
  Phone,
  Video,
  X,
  Menu,
  ArrowLeft,
} from "lucide-react";
import toast from "react-hot-toast";
import styles from "./inbox.module.css";

type Channel = "WHATSAPP" | "EMAIL" | "PORTAL_FORM" | "VALIDATION" | "REMINDER";
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

const CHANNEL_META: Record<Channel, { label: string; color: string; icon: typeof InboxIcon }> = {
  WHATSAPP:    { label: "WhatsApp",  color: "#25d366", icon: MessageCircle },
  EMAIL:       { label: "Email",     color: "#ea580c", icon: Mail },
  PORTAL_FORM: { label: "Formulario", color: "#06b6d4", icon: FileText },
  VALIDATION:  { label: "Validación", color: "#d97706", icon: Calendar },
  REMINDER:    { label: "Recordatorio", color: "#7c3aed", icon: Bell },
};

const SYSTEM_FOLDERS: Array<{ id: string; label: string; icon: typeof InboxIcon }> = [
  { id: "inbox",    label: "Bandeja de entrada", icon: InboxIcon },
  { id: "snoozed",  label: "Pospuestos",         icon: Clock },
  { id: "sent",     label: "Enviados",           icon: Send },
  { id: "archived", label: "Archivados",         icon: Archive },
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

  const fetchThreads = useCallback(async () => {
    setLoadingList(true);
    setError(null);
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
        const data = await res.json().catch(() => ({}));
        if (res.status === 503) {
          setError(data.hint ?? "Schema no migrado. Aplica la migración inbox.");
          setThreads([]);
          return;
        }
        throw new Error(data.error ?? "Error al cargar bandeja");
      }
      const data = await res.json();
      setThreads(data.threads ?? []);
      setCounts(data.counts ?? { total: 0, byChannel: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar bandeja");
    } finally {
      setLoadingList(false);
    }
  }, [folder, activeChannel, activeAssignee, search, patientIdFilter]);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

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
            prev.map((t) => (t.id === activeThreadId ? { ...t, status: "READ" } : t)),
          );
        }
      } catch {
        if (!cancelled) toast.error("No se pudo cargar la conversación");
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeThreadId]);

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
        throw new Error(data.error ?? "Error al enviar");
      }
      const data = await res.json();
      setActiveThread((prev) =>
        prev ? { ...prev, messages: [...prev.messages, data.message] } : prev,
      );
      setComposerText("");
      if (data.sendError) {
        toast(`Mensaje guardado pero ${data.sendError}`, { icon: "⚠️" });
      } else {
        toast.success(composerMode === "internal" ? "Nota interna guardada" : "Mensaje enviado");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }, [activeThread, composerText, composerMode]);

  const archiveThread = useCallback(async () => {
    if (!activeThread) return;
    try {
      await fetch(`/api/inbox/threads/${activeThread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      setThreads((prev) => prev.filter((t) => t.id !== activeThread.id));
      setActiveThreadId(null);
      setActiveThread(null);
      toast.success("Conversación archivada");
    } catch {
      toast.error("Error al archivar");
    }
  }, [activeThread]);

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
    ? "Pospuestos"
    : folder === "sent"
    ? "Enviados"
    : folder === "archived"
    ? "Archivados"
    : activeChannel
    ? CHANNEL_META[activeChannel].label
    : activeAssignee === "me"
    ? "Mis mensajes"
    : activeAssignee === "unassigned"
    ? "Sin asignar"
    : "Bandeja de entrada";

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
          aria-label="Cerrar panel"
          className={styles.mobileBackdrop}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      {/* ─── Col 1: Sidebar (drawer en mobile) ─── */}
      <aside
        className={styles.sidebar}
        role={mobileSidebarOpen ? "dialog" : undefined}
        aria-modal={mobileSidebarOpen ? "true" : undefined}
        aria-label="Canales y carpetas"
      >
        <div className={styles.brandHeader}>
          <div className={styles.brandRow}>
            <span className={styles.brandIcon}><InboxIcon size={14} aria-hidden /></span>
            Inbox
          </div>
          <button type="button" className={styles.composeBtn}>
            <Plus size={13} aria-hidden /> Componer
            <kbd>C</kbd>
          </button>
        </div>

        <div className={styles.folderList}>
          <div className={styles.folderGroupLabel}>Carpetas</div>
          {SYSTEM_FOLDERS.map((f) => {
            const isActive = folder === f.id && !activeChannel && !activeAssignee;
            return (
              <button
                key={f.id}
                type="button"
                className={`${styles.folder} ${isActive ? styles.folderActive : ""}`}
                onClick={() => handleFolderClick(f.id)}
              >
                <span className={styles.folderIcon}><f.icon size={14} aria-hidden /></span>
                <span className={styles.folderLabel}>{f.label}</span>
                {f.id === "inbox" && counts.total > 0 && (
                  <span className={styles.folderCount}>{counts.total}</span>
                )}
              </button>
            );
          })}

          <div className={styles.folderGroupLabel}>Canales</div>
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
                <span className={styles.folderLabel}>{meta.label}</span>
                {c > 0 && <span className={styles.folderCount}>{c}</span>}
              </button>
            );
          })}

          <div className={styles.folderGroupLabel}>Asignado a</div>
          <button
            type="button"
            className={`${styles.folder} ${activeAssignee === "me" ? styles.folderActive : ""}`}
            onClick={() => handleAssigneeClick("me")}
          >
            <span className={styles.folderIcon}>👤</span>
            <span className={styles.folderLabel}>Mis mensajes</span>
          </button>
          <button
            type="button"
            className={`${styles.folder} ${activeAssignee === "unassigned" ? styles.folderActive : ""}`}
            onClick={() => handleAssigneeClick("unassigned")}
          >
            <span className={styles.folderIcon}>?</span>
            <span className={styles.folderLabel}>Sin asignar</span>
          </button>
        </div>

        <div className={styles.userBlock}>
          <div className={styles.userAvatar}>DR</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.userName}>Doctor</div>
            <div className={styles.userRole}>Inbox unificado</div>
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
              aria-label="Abrir canales y carpetas"
            >
              <Menu size={16} aria-hidden />
            </button>
            <h2>{folderTitle}</h2>
            <span className={styles.threadCount}>
              {filteredThreads.length} {filteredThreads.length === 1 ? "thread" : "threads"}
            </span>
          </div>
          <div className={styles.threadSearch}>
            <Search size={13} aria-hidden className={styles.threadSearchIcon} />
            <input
              type="text"
              className={styles.threadSearchInput}
              placeholder="Buscar pacientes, asuntos…"
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
                {CHANNEL_META[ch].label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.threadList}>
          {loadingList ? (
            <div className={styles.emptyState}>Cargando…</div>
          ) : error ? (
            <div className={styles.emptyState} style={{ color: "var(--st-warning)" }}>{error}</div>
          ) : filteredThreads.length === 0 ? (
            <div className={styles.emptyState}>
              <InboxIcon size={36} aria-hidden style={{ opacity: 0.3, marginBottom: 8 }} />
              <div>Sin conversaciones en {folderTitle.toLowerCase()}.</div>
            </div>
          ) : (
            filteredThreads.map((t) => {
              const meta = CHANNEL_META[t.channel];
              const Icon = meta.icon;
              const isActive = t.id === activeThreadId;
              const isUnread = t.status === "UNREAD";
              const isSnoozed = t.status === "SNOOZED";
              return (
                <button
                  key={t.id}
                  type="button"
                  className={[
                    styles.thread,
                    isActive ? styles.threadActive : "",
                    isUnread ? styles.threadUnread : "",
                    isSnoozed ? styles.threadSnoozed : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setActiveThreadId(t.id)}
                >
                  <span className={styles.threadCheckbox}>
                    {isUnread && <span className={styles.unreadDot} aria-hidden />}
                  </span>
                  <span className={styles.threadAvatar}>
                    {getInitials(t.patient)}
                    <span
                      className={styles.threadChannelBadge}
                      style={{ ["--mf-ch-color" as never]: meta.color }}
                      title={meta.label}
                    >
                      <Icon size={9} aria-hidden />
                    </span>
                  </span>
                  <span className={styles.threadBody}>
                    <span className={styles.threadRow1}>
                      <span className={styles.threadName}>
                        {t.patient ? `${t.patient.firstName} ${t.patient.lastName}` : t.subject}
                      </span>
                      <span className={styles.threadTime}>
                        {isSnoozed && "⏰ "}{formatTime(t.lastMessageAt)}
                      </span>
                    </span>
                    <span className={styles.threadSubject}>{t.subject}</span>
                    {t.tags.length > 0 && (
                      <span className={styles.threadTags}>
                        {t.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className={styles.threadTag} style={{ ["--mf-tag-color" as never]: "#7c3aed" }}>
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
            <InboxIcon size={48} aria-hidden style={{ opacity: 0.25, marginBottom: 12 }} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>
              Selecciona una conversación
            </h2>
            <p>Elige un thread del panel izquierdo para verlo aquí.</p>
          </div>
        ) : (
          <>
            <header className={styles.detailHeader}>
              {/* Back button sólo visible en mobile. Vuelve al thread list. */}
              <button
                type="button"
                className={styles.mobileBackBtn}
                onClick={() => setActiveThreadId(null)}
                aria-label="Volver a la lista de conversaciones"
              >
                <ArrowLeft size={16} aria-hidden />
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
                      <channelMeta.icon size={11} aria-hidden /> {channelMeta.label}
                    </span>
                  )}
                  <span>·</span>
                  <span>{activeThread.subject}</span>
                  <span>·</span>
                  <span>{activeThread.messages.length} mensaje{activeThread.messages.length === 1 ? "" : "s"}</span>
                </div>
              </div>
              <div className={styles.detailHeaderActions}>
                <button type="button" className={styles.iconBtn} title="Llamar" aria-label="Llamar">
                  <Phone size={14} aria-hidden />
                </button>
                <button type="button" className={styles.iconBtn} title="Videollamada" aria-label="Iniciar videollamada">
                  <Video size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="Archivar"
                  aria-label="Archivar conversación"
                  onClick={archiveThread}
                >
                  <Archive size={14} aria-hidden />
                </button>
                <button type="button" className={styles.iconBtn} title="Más" aria-label="Más opciones">
                  <MoreHorizontal size={14} aria-hidden />
                </button>
              </div>
            </header>

            <div className={styles.assigneeStrip}>
              <span className={styles.assigneeStripLabel}>Asignado a</span>
              <span style={{ fontWeight: 700 }}>
                {activeThread.assignedTo
                  ? `${activeThread.assignedTo.firstName} ${activeThread.assignedTo.lastName}`
                  : "Sin asignar"}
              </span>
              <span className={styles.assigneeStripSpacer} />
              {activePatient && (
                <a
                  className={styles.assigneeStripLink}
                  href={`/dashboard/patients/${activePatient.id}`}
                >
                  <ExternalLink size={11} aria-hidden style={{ display: "inline", marginRight: 3 }} />
                  Ver expediente
                </a>
              )}
            </div>

            <div className={styles.messages}>
              {loadingDetail ? (
                <div style={{ padding: 30, color: "var(--text-3)", textAlign: "center" }}>Cargando mensajes…</div>
              ) : activeThread.messages.length === 0 ? (
                <div style={{ padding: 30, color: "var(--text-3)", textAlign: "center" }}>
                  Sin mensajes en este thread todavía.
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
                                  : "Staff"}
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
                              {isOut && <CheckCheck size={11} aria-hidden style={{ color: "var(--st-success)" }} />}
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
                  Responder
                </button>
                <button
                  type="button"
                  className={`${styles.composerTab} ${composerMode === "internal" ? styles.composerTabActiveInternal : ""}`}
                  onClick={() => setComposerMode("internal")}
                >
                  Nota interna
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
                      ? "Escribe una nota interna (no la verá el paciente)…"
                      : channelMeta
                      ? `Responder por ${channelMeta.label.toLowerCase()}…`
                      : "Escribe tu respuesta…"
                  }
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={handleKey}
                  disabled={sending}
                />
                <div className={styles.composerBar}>
                  <button type="button" className={styles.composerActionBtn} title="Adjuntar" aria-label="Adjuntar archivo">
                    <Paperclip size={14} aria-hidden />
                  </button>
                  <button type="button" className={styles.composerActionBtn} title="Emoji" aria-label="Insertar emoji">
                    <Smile size={14} aria-hidden />
                  </button>
                  <button type="button" className={styles.composerActionBtn} title="Sugerir con IA" aria-label="Sugerir respuesta con IA">
                    <Sparkles size={14} aria-hidden />
                  </button>
                  <span className={styles.composerBarSpacer} />
                  <button
                    type="button"
                    className={styles.sendBtn}
                    onClick={sendReply}
                    disabled={!composerText.trim() || sending}
                  >
                    <Send size={12} aria-hidden />
                    {sending ? "Enviando…" : composerMode === "internal" ? "Guardar nota" : "Enviar"}
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
