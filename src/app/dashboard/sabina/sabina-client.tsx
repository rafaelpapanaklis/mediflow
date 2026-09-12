"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Plus,
  History,
  X,
  Loader2,
  CloudOff,
  RotateCcw,
} from "lucide-react";
import {
  sanitizeQuestion,
  titleFromQuestion,
  classifySabinaError,
  SABINA_SUGGESTIONS,
  SABINA_THINKING_HINTS,
  SABINA_SLOW_HINT_MS,
  SABINA_QUESTION_MAX_CHARS,
  type SabinaErrorKind,
} from "@/components/sabina/sabina-core";
import { SabinaMessageContent } from "@/components/sabina/message-content";
import { ToolTrace } from "@/components/sabina/tool-trace";
import { SabinaErrorNotice } from "@/components/sabina/error-notice";
import styles from "./sabina.module.css";

interface SabinaMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  pending?: boolean;
  herramientasUsadas?: string[];
  modelo?: string;
  /** Solo cuando role === "system": por qué falló ESTA pantalla al preguntar. */
  errorKind?: SabinaErrorKind;
}

interface HistoryRow {
  id: string;
  title: string;
  updatedAt: number;
}

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(ts));
}

/** Fila cruda de /api/sabina/conversations → fila de la barra de historial. */
function toHistoryRow(raw: unknown): HistoryRow | null {
  const row = raw as { id?: unknown; title?: unknown; updatedAt?: unknown };
  if (typeof row?.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    title: typeof row.title === "string" && row.title ? row.title : "Consulta a Sabina",
    updatedAt: typeof row.updatedAt === "number" && isFinite(row.updatedAt) ? row.updatedAt : Date.now(),
  };
}

/** Turno crudo de /api/sabina/conversations/:id → mensaje pintable. */
function toSabinaMessage(raw: unknown): SabinaMessage | null {
  const row = raw as {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    timestamp?: unknown;
    herramientasUsadas?: unknown;
    modelo?: unknown;
  };
  if (typeof row?.content !== "string") return null;
  return {
    id: typeof row.id === "string" && row.id ? row.id : makeId(),
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    timestamp: typeof row.timestamp === "number" && isFinite(row.timestamp) ? row.timestamp : Date.now(),
    herramientasUsadas: Array.isArray(row.herramientasUsadas)
      ? row.herramientasUsadas.filter((t): t is string => typeof t === "string")
      : undefined,
    modelo: typeof row.modelo === "string" ? row.modelo : undefined,
  };
}

/**
 * "Sabina está pensando…" con pistas que rotan y, pasado un rato, el aviso
 * de que las preguntas abiertas tardan más. NO afirma qué herramienta está
 * llamando de verdad — el contrato no manda ese dato hasta que la respuesta
 * llega entera (ver sabina-core.ts, comentario de SABINA_THINKING_HINTS).
 */
function ThinkingIndicator({ startedAt }: { startedAt: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 900);
    return () => clearInterval(id);
  }, []);
  const hint = SABINA_THINKING_HINTS[Math.floor(tick / 2) % SABINA_THINKING_HINTS.length];
  const slow = Date.now() - startedAt > SABINA_SLOW_HINT_MS;
  return (
    <div className={styles.thinking}>
      <span className={styles.thinkingDots} aria-hidden>
        <i /><i /><i />
      </span>
      <span>{hint}</span>
      {slow && <span className={styles.thinkingSlow}>Las preguntas abiertas tardan un poco más.</span>}
    </div>
  );
}

export function SabinaClient({ firstName }: { firstName: string }) {
  const [messages, setMessages] = useState<SabinaMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  // Conversación abierta desde el historial que no se pudo cargar: se
  // bloquea el composer (igual que en /dashboard/ai-assistant) para no
  // mandar una pregunta sin contexto a un hilo que en pantalla parece vacío.
  const [activeFailed, setActiveFailed] = useState(false);
  const [openingConv, setOpeningConv] = useState(false);

  // ── Historial (drawer) ──────────────────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const historyLoadedRef = useRef(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [input]);

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  /**
   * GET /api/sabina/conversations — NO está en "El contrato del endpoint"
   * de CONTRATO.md (ese solo cubre el POST). Se asume por analogía con
   * /api/ai-assistant/conversations porque el trabajo pide que el historial
   * "se guarde y se recupere por usuario, como el Asistente IA" — está
   * anotado en el reporte para que ws1-t2 lo confirme o lo ajuste. Si el
   * endpoint no existe todavía, esto falla en silencio (fail-open, igual
   * que el aviso de persistencia del Asistente IA): el chat sigue
   * funcionando, lo que no hay es historial que mostrar.
   */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/sabina/conversations");
      if (!res.ok) {
        setHistoryNotice("No se pudo cargar tu historial.");
        return;
      }
      const data = await res.json().catch(() => null);
      const rows = (Array.isArray(data?.conversations) ? data.conversations : [])
        .map(toHistoryRow)
        .filter((r: HistoryRow | null): r is HistoryRow => r !== null);
      setHistoryList(rows);
      setHistoryNotice(null);
    } catch {
      setHistoryNotice("No se pudo cargar tu historial.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    if (!historyLoadedRef.current) {
      historyLoadedRef.current = true;
      void loadHistory();
    }
  }, [loadHistory]);

  const startNew = useCallback(() => {
    setConversationId(null);
    setConversationTitle(null);
    setMessages([]);
    setActiveFailed(false);
    setLastQuestion(null);
    setHistoryOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  /**
   * GET /api/sabina/conversations/:id — mismo supuesto que `loadHistory`,
   * documentado ahí.
   */
  const openConversation = useCallback(async (row: HistoryRow) => {
    setHistoryOpen(false);
    setConversationId(row.id);
    setConversationTitle(row.title);
    setActiveFailed(false);
    setOpeningConv(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/sabina/conversations/${encodeURIComponent(row.id)}`);
      if (!res.ok) {
        setActiveFailed(true);
        return;
      }
      const data = await res.json().catch(() => null);
      const msgs = (Array.isArray(data?.messages) ? data.messages : [])
        .map(toSabinaMessage)
        .filter((m: SabinaMessage | null): m is SabinaMessage => m !== null);
      setMessages(msgs);
      const meta = toHistoryRow(data?.conversation);
      if (meta) setConversationTitle(meta.title);
    } catch {
      setActiveFailed(true);
    } finally {
      setOpeningConv(false);
    }
  }, []);

  /** Manda la pregunta y actualiza EL MISMO mensaje (placeholder o reintento). */
  const runRequest = useCallback(
    async (question: string, targetId: string, isNewTurn: boolean) => {
      setSending(true);
      try {
        const res = await fetch("/api/sabina", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pregunta: question, conversacionId: conversationId ?? undefined }),
        });
        let data: {
          respuesta?: unknown;
          herramientasUsadas?: unknown;
          conversacionId?: unknown;
          modelo?: unknown;
        } | null = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }

        if (!res.ok) {
          const kind = classifySabinaError(res.status);
          setMessages((prev) =>
            prev.map((m) => (m.id === targetId ? { ...m, role: "system", content: "", pending: false, errorKind: kind } : m)),
          );
          return;
        }

        const respuesta = typeof data?.respuesta === "string" ? data.respuesta : "";
        const herramientasUsadas = Array.isArray(data?.herramientasUsadas)
          ? data.herramientasUsadas.filter((t): t is string => typeof t === "string")
          : [];
        const modelo = typeof data?.modelo === "string" ? data.modelo : undefined;
        const convId = typeof data?.conversacionId === "string" ? data.conversacionId : null;

        if (convId && convId !== conversationId) {
          setConversationId(convId);
          const title = titleFromQuestion(question);
          setConversationTitle((cur) => cur ?? title);
          setHistoryList((prev) => {
            const already = prev.find((r) => r.id === convId);
            const entry: HistoryRow = { id: convId, title: already?.title ?? title, updatedAt: Date.now() };
            return [entry, ...prev.filter((r) => r.id !== convId)];
          });
        } else if (convId) {
          setHistoryList((prev) => {
            const idx = prev.findIndex((r) => r.id === convId);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], updatedAt: Date.now() };
            return next;
          });
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === targetId
              ? { ...m, role: "assistant", content: respuesta, pending: false, herramientasUsadas, modelo, errorKind: undefined }
              : m,
          ),
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) => (m.id === targetId ? { ...m, role: "system", content: "", pending: false, errorKind: "network" } : m)),
        );
      } finally {
        setSending(false);
        setRetryingId(null);
      }
      void isNewTurn; // solo documenta la intención en el sitio de llamada
    },
    [conversationId],
  );

  const ask = useCallback(
    (raw: string) => {
      const clean = sanitizeQuestion(raw);
      if (!clean || sending || activeFailed) return;

      setInput("");
      setLastQuestion(clean);

      const now = Date.now();
      const userMsg: SabinaMessage = { id: makeId(), role: "user", content: clean, timestamp: now };
      const placeholderId = makeId();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: placeholderId, role: "assistant", content: "", timestamp: now, pending: true },
      ]);

      void runRequest(clean, placeholderId, true);
    },
    [sending, activeFailed, runRequest],
  );

  const retry = useCallback(
    (failedId: string) => {
      if (!lastQuestion || sending) return;
      setRetryingId(failedId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedId ? { ...m, role: "assistant", content: "", pending: true, timestamp: Date.now(), errorKind: undefined } : m,
        ),
      );
      void runRequest(lastQuestion, failedId, false);
    },
    [lastQuestion, sending, runRequest],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        ask(input);
      }
    },
    [ask, input],
  );

  const empty = messages.length === 0 && !openingConv && !activeFailed;

  return (
    <div className={styles.page} data-history-open={historyOpen || undefined}>
      {historyOpen && (
        <button type="button" className={styles.backdrop} aria-label="Cerrar historial" onClick={() => setHistoryOpen(false)} />
      )}

      {/* ── Historial (drawer, off-canvas siempre) ── */}
      <aside className={styles.drawer} role={historyOpen ? "dialog" : undefined} aria-modal={historyOpen || undefined} aria-label="Historial de Sabina">
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>Historial</span>
          <button type="button" className={styles.iconBtn} onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial">
            <X size={15} aria-hidden />
          </button>
        </div>
        <button type="button" className={styles.newConvBtn} onClick={startNew}>
          <Plus size={13} aria-hidden /> Nueva conversación
        </button>
        <div className={styles.drawerList}>
          {historyLoading ? (
            <div className={styles.drawerLoading}>
              <Loader2 size={14} aria-hidden className={styles.spin} /> Cargando…
            </div>
          ) : historyNotice ? (
            <div className={styles.drawerNotice}>
              <CloudOff size={13} aria-hidden /> {historyNotice}
            </div>
          ) : historyList.length === 0 ? (
            <div className={styles.drawerEmpty}>Aquí van a aparecer tus conversaciones con Sabina.</div>
          ) : (
            historyList.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`${styles.drawerItem} ${row.id === conversationId ? styles.drawerItemActive : ""}`}
                onClick={() => void openConversation(row)}
              >
                <span className={styles.drawerItemTitle}>{row.title}</span>
                <span className={styles.drawerItemTime}>{formatRelative(row.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Chat ── */}
      <div className={styles.main}>
        <header className={styles.header}>
          <button type="button" className={styles.iconBtn} onClick={openHistory} aria-label="Ver historial">
            <History size={17} aria-hidden />
          </button>
          <div className={styles.headerInfo}>
            <div className={styles.headerTitle}>
              <span className={styles.brandDot}><Sparkles size={12} aria-hidden /></span>
              Sabina
            </div>
            <div className={styles.headerSubtitle}>{conversationTitle ?? `Hola, ${firstName || "doctor"}`}</div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={startNew} aria-label="Nueva conversación" title="Nueva conversación">
            <Plus size={17} aria-hidden />
          </button>
        </header>

        <div className={styles.scroll}>
          <div className={styles.scrollInner}>
            {openingConv ? (
              <div className={styles.centerNotice}>
                <Loader2 size={16} aria-hidden className={styles.spin} /> Abriendo conversación…
              </div>
            ) : activeFailed ? (
              <div className={styles.centerNotice}>
                <CloudOff size={20} strokeWidth={1.75} aria-hidden />
                <span>No se pudo abrir esta conversación.</span>
                <button type="button" className={styles.retryLink} onClick={startNew}>
                  <RotateCcw size={12} aria-hidden /> Empezar una nueva
                </button>
              </div>
            ) : empty ? (
              <div className={styles.welcome}>
                <div className={styles.welcomeIcon}><Sparkles size={24} aria-hidden /></div>
                <h1 className={styles.welcomeTitle}>Pregúntale a Sabina</h1>
                <p className={styles.welcomeText}>
                  Sabina lee los datos de tu clínica y contesta con lo que encuentra — nunca inventa un número.
                  Pregunta en lenguaje normal, como si le hablaras a tu recepcionista.
                </p>
                <div className={styles.suggestions}>
                  {SABINA_SUGGESTIONS.map((s) => (
                    <button
                      key={s.text}
                      type="button"
                      className={styles.suggestion}
                      onClick={() => {
                        setInput(s.text);
                        setTimeout(() => textareaRef.current?.focus(), 30);
                      }}
                    >
                      <span className={styles.suggestionText}>{s.text}</span>
                      <span className={styles.suggestionHint}>{s.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.role === "system" ? (
                  <div key={m.id} className={styles.systemRow}>
                    <SabinaErrorNotice kind={m.errorKind ?? "unknown"} retrying={retryingId === m.id} onRetry={() => retry(m.id)} />
                  </div>
                ) : (
                  <div key={m.id} className={`${styles.message} ${m.role === "user" ? styles.messageUser : ""}`}>
                    <div className={m.role === "user" ? styles.avatarUser : styles.avatarSabina}>
                      {m.role === "user" ? (firstName ? firstName[0]?.toUpperCase() : "D") : <Sparkles size={13} aria-hidden />}
                    </div>
                    <div className={styles.bubbleCol}>
                      <div className={styles.bubble}>
                        {m.pending ? (
                          <ThinkingIndicator startedAt={m.timestamp} />
                        ) : m.role === "assistant" ? (
                          <SabinaMessageContent content={m.content || "—"} />
                        ) : (
                          <p className={styles.userText}>{m.content}</p>
                        )}
                      </div>
                      {!m.pending && m.role === "assistant" && <ToolTrace tools={m.herramientasUsadas} />}
                      <span className={styles.timestamp}>{formatTime(m.timestamp)}</span>
                    </div>
                  </div>
                ),
              )
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className={styles.composerWrap}>
          <div className={styles.composerInner}>
            <div className={styles.composerBox}>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                placeholder="Pregúntale algo a Sabina…"
                value={input}
                maxLength={SABINA_QUESTION_MAX_CHARS}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={activeFailed}
                rows={1}
              />
              <button
                type="button"
                className={styles.sendBtn}
                onClick={() => ask(input)}
                disabled={!input.trim() || sending || activeFailed}
                aria-label="Preguntar"
              >
                <Send size={15} aria-hidden />
              </button>
            </div>
            <div className={styles.composerHint}>Sabina solo lee datos — no agenda, no cobra, no edita nada.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
