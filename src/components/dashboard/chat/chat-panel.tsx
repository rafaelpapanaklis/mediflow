"use client";

// ═══════════════════════════════════════════════════════════════════════
// Panel de chat de la clínica — bandeja → conversación en UNA columna
// (estilo Messenger), parametrizado por `domain` ("lab" | "supplier").
//
// Reusa la infraestructura REST existente (idéntica para ambos dominios):
//   • LISTA:        GET /api/{lab|supplier}-chat
//   • CONVERSACIÓN: GET /api/{lab|supplier}-chat/[threadId]/messages
//                     - SIN ?after=  → marca leído (clinicUnread=0) + últimos 100
//                     - CON ?after=<lastId> → solo mensajes nuevos (polling)
//                   POST /api/{lab|supplier}-chat/[threadId]/messages { body }
// La identidad/clinicId la resuelve el servidor desde la sesión; aquí el lado
// es SIEMPRE "CLINIC" (dashboard de la clínica). `mine = sender === "CLINIC"`.
//
// Reporta su total de no-leídos al launcher vía onUnreadCount (excluye el hilo
// abierto, igual que la bandeja) para que el mini-badge baje al abrir un hilo.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";

type Domain = "lab" | "supplier";

interface ChatMessage {
  id: string;
  threadId: string;
  sender: string; // "CLINIC" | "LAB" | "SUPPLIER"
  senderId: string;
  body: string;
  createdAt: string;
}

interface ChatThread {
  id: string;
  lastMessageAt: string;
  clinicUnread: number;
  lab?: { id: string; name: string; logoUrl: string | null };
  supplier?: { id: string; businessName: string; logoUrl: string | null };
  messages?: ChatMessage[];
}

const THREADS_POLL_MS = 5000;
const MESSAGES_POLL_MS = 4000;

// ── Config por dominio (endpoints + cómo leer la contraparte) ────────────
interface DomainConfig {
  listUrl: string;
  msgUrl: (threadId: string, after?: string | null) => string;
  nameOf: (t: ChatThread) => string;
  logoOf: (t: ChatThread) => string | null;
  counterpartLabel: string;
  emptyHint: string;
}

const CONFIG: Record<Domain, DomainConfig> = {
  lab: {
    listUrl: "/api/lab-chat",
    msgUrl: (id, after) =>
      `/api/lab-chat/${id}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    nameOf: (t) => t.lab?.name ?? "Laboratorio",
    logoOf: (t) => t.lab?.logoUrl ?? null,
    counterpartLabel: "Laboratorio",
    emptyHint: "Abre el chat desde la ficha de un laboratorio.",
  },
  supplier: {
    listUrl: "/api/supplier-chat",
    msgUrl: (id, after) =>
      `/api/supplier-chat/${id}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    nameOf: (t) => t.supplier?.businessName ?? "Proveedor",
    logoOf: (t) => t.supplier?.logoUrl ?? null,
    counterpartLabel: "Proveedor",
    emptyHint: "Abre el chat desde la ficha de un proveedor.",
  },
};

// ── Helpers de formato ───────────────────────────────────────────────────
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
function fmtThreadTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? fmtClock(iso)
    : d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" });
}
function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

function Avatar({ name, logoUrl, size = 38 }: { name: string; logoUrl: string | null; size?: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontSize: size <= 30 ? 11 : 13,
        fontWeight: 600,
        background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
      }}
    >
      {initials(name)}
    </div>
  );
}

export interface ChatPanelProps {
  domain: Domain;
  /** True si esta pestaña es la visible (gobierna auto-scroll). El polling
   *  corre mientras el panel esté montado y el documento visible. */
  active: boolean;
  /** Reporta el total de no-leídos del dominio (excluye el hilo abierto). */
  onUnreadCount?: (count: number) => void;
}

export function ChatPanel({ domain, active, onUnreadCount }: ChatPanelProps) {
  const cfg = CONFIG[domain];

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs leídos por los intervals de polling (evitan closures obsoletas y que
  // una respuesta tardía pinte mensajes del hilo equivocado).
  const selectedIdRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const onUnreadRef = useRef(onUnreadCount);
  const activeRef = useRef(active);

  useEffect(() => {
    onUnreadRef.current = onUnreadCount;
  }, [onUnreadCount]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    lastMessageIdRef.current = messages.length ? messages[messages.length - 1].id : null;
  }, [messages]);
  useEffect(() => {
    if (active) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, active]);

  // Reporta no-leídos hacia arriba (excluye el hilo abierto, igual que la UI).
  useEffect(() => {
    const sum = threads.reduce(
      (acc, t) => acc + (t.id === selectedId ? 0 : t.clinicUnread || 0),
      0,
    );
    onUnreadRef.current?.(sum);
  }, [threads, selectedId]);

  // ── Fetchers (estables) ──────────────────────────────────────────────
  const fetchThreads = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(cfg.listUrl, { signal });
        if (!res.ok) return;
        const data: ChatThread[] = await res.json();
        if (!signal?.aborted && Array.isArray(data)) setThreads(data);
      } catch {
        /* ignore — el polling reintenta */
      } finally {
        if (!signal?.aborted) setLoadingThreads(false);
      }
    },
    [cfg.listUrl],
  );

  const fetchMessagesFull = useCallback(
    async (threadId: string, signal?: AbortSignal) => {
      setLoadingMessages(true);
      try {
        // SIN ?after= → el servidor marca leído (clinicUnread=0) y devuelve los últimos 100.
        const res = await fetch(cfg.msgUrl(threadId), { signal });
        if (!res.ok) return;
        const data: ChatMessage[] = await res.json();
        if (!signal?.aborted && selectedIdRef.current === threadId && Array.isArray(data)) {
          setMessages(data);
        }
      } catch {
        /* ignore */
      } finally {
        if (!signal?.aborted) setLoadingMessages(false);
      }
    },
    [cfg],
  );

  const pollMessages = useCallback(
    async (threadId: string, signal?: AbortSignal) => {
      const after = lastMessageIdRef.current;
      try {
        const res = await fetch(cfg.msgUrl(threadId, after), { signal });
        if (!res.ok) return;
        const incoming: ChatMessage[] = await res.json();
        if (signal?.aborted || selectedIdRef.current !== threadId) return;
        if (Array.isArray(incoming) && incoming.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = incoming.filter((m) => !seen.has(m.id));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
        }
      } catch {
        /* ignore */
      }
    },
    [cfg],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      setSelectedId(threadId);
      selectedIdRef.current = threadId;
      setMessages([]);
      lastMessageIdRef.current = null;
      setError(null);
      // Optimista: limpiar el badge del hilo abierto (baja el no-leído al abrir).
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, clinicUnread: 0 } : t)));
      fetchMessagesFull(threadId);
    },
    [fetchMessagesFull],
  );

  const backToList = useCallback(() => {
    setSelectedId(null);
    selectedIdRef.current = null;
  }, []);

  // ── Carga inicial de la bandeja ──────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    fetchThreads(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchThreads]);

  // ── Polling de la bandeja (pausa con documento oculto) ───────────────
  useEffect(() => {
    const ctrl = new AbortController();
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => fetchThreads(ctrl.signal);
    const start = () => {
      if (id === null) id = setInterval(tick, THREADS_POLL_MS);
    };
    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchThreads]);

  // ── Polling de mensajes del hilo activo ──────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const ctrl = new AbortController();
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => pollMessages(selectedId, ctrl.signal);
    const start = () => {
      if (id === null) id = setInterval(tick, MESSAGES_POLL_MS);
    };
    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [selectedId, pollMessages]);

  // ── Composer auto-grow ───────────────────────────────────────────────
  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }
  useEffect(() => {
    autoGrow();
  }, [draft]);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    const id = selectedIdRef.current;
    if (!text || !id || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(cfg.msgUrl(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "No se pudo enviar el mensaje.");
        return;
      }
      const msg: ChatMessage = await res.json();
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setDraft("");
      // Mover el hilo al tope con el nuevo preview.
      setThreads((prev) => {
        const target = prev.find((t) => t.id === id);
        if (!target) return prev;
        const updated: ChatThread = {
          ...target,
          lastMessageAt: msg.createdAt,
          messages: [msg],
          clinicUnread: 0,
        };
        return [updated, ...prev.filter((t) => t.id !== id)];
      });
    } catch {
      setError("No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }, [draft, sending, cfg]);

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  // ════════════════════════════════════════════════════════════════════
  // Render — UNA columna: bandeja O conversación.
  // ════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {!selected ? (
        // ── Bandeja ──────────────────────────────────────────────────
        <div className="scrollbar-thin" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loadingThreads && threads.length === 0 ? (
            <p style={{ padding: 16, fontSize: 13, color: "var(--text-3)" }}>Cargando…</p>
          ) : threads.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "40px 24px",
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              <MessageCircle size={28} style={{ opacity: 0.4 }} />
              <span>Aún no tienes conversaciones.</span>
              <span style={{ fontSize: 12 }}>{cfg.emptyHint}</span>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {threads.map((t) => {
                const unread = t.clinicUnread || 0;
                const last = t.messages?.[0];
                const name = cfg.nameOf(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectThread(t.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        width: "100%",
                        padding: "11px 14px",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid var(--border-soft)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Avatar name={name} logoUrl={cfg.logoOf(t)} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text-1)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {name}
                          </span>
                          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-3)" }}>
                            {fmtThreadTime(t.lastMessageAt)}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--text-3)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {last ? `${last.sender === "CLINIC" ? "Tú: " : ""}${last.body}` : "Sin mensajes aún"}
                          </span>
                          {unread > 0 && (
                            <span
                              style={{
                                marginLeft: "auto",
                                flexShrink: 0,
                                minWidth: 20,
                                height: 20,
                                padding: "0 6px",
                                borderRadius: 999,
                                background: "var(--brand)",
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 700,
                                display: "grid",
                                placeItems: "center",
                              }}
                            >
                              {unread > 99 ? "99+" : unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        // ── Conversación ─────────────────────────────────────────────
        <>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderBottom: "1px solid var(--border-soft)",
              background: "var(--bg-elev)",
            }}
          >
            <button
              type="button"
              onClick={backToList}
              aria-label="Volver a la bandeja"
              style={{
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "var(--text-2)",
                cursor: "pointer",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <ArrowLeft size={17} />
            </button>
            <Avatar name={cfg.nameOf(selected)} logoUrl={cfg.logoOf(selected)} size={34} />
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {cfg.nameOf(selected)}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-3)" }}>{cfg.counterpartLabel}</p>
            </div>
          </header>

          <div
            className="scrollbar-thin"
            style={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: "var(--bg)",
            }}
          >
            {loadingMessages && messages.length === 0 ? (
              <p style={{ margin: "auto", fontSize: 13, color: "var(--text-3)" }}>Cargando mensajes…</p>
            ) : messages.length === 0 ? (
              <div
                style={{
                  margin: "auto",
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  padding: "24px 12px",
                }}
              >
                <MessageCircle size={26} style={{ opacity: 0.4 }} />
                No hay mensajes. Escribe el primero.
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.sender === "CLINIC";
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                    <div
                      style={{
                        maxWidth: "82%",
                        padding: "8px 11px",
                        borderRadius: 14,
                        borderBottomRightRadius: mine ? 4 : 14,
                        borderBottomLeftRadius: mine ? 14 : 4,
                        fontSize: 13,
                        lineHeight: 1.45,
                        background: mine ? "var(--brand)" : "var(--bg-elev-2)",
                        color: mine ? "#fff" : "var(--text-1)",
                        border: mine ? "none" : "1px solid var(--border-soft)",
                        boxShadow: "0 2px 8px -4px rgba(0,0,0,0.3)",
                      }}
                    >
                      <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</p>
                      <span
                        style={{
                          display: "block",
                          textAlign: "right",
                          fontSize: 10,
                          marginTop: 3,
                          color: mine ? "rgba(255,255,255,0.7)" : "var(--text-3)",
                        }}
                      >
                        {fmtClock(m.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          <footer style={{ borderTop: "1px solid var(--border-soft)", padding: 10, background: "var(--bg-elev)" }}>
            {error && <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--danger)" }}>{error}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              style={{ display: "flex", alignItems: "flex-end", gap: 8 }}
            >
              <textarea
                ref={taRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                placeholder="Escribe un mensaje…"
                style={{
                  flex: 1,
                  resize: "none",
                  maxHeight: 110,
                  minHeight: 36,
                  padding: "8px 11px",
                  borderRadius: 10,
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg-elev)",
                  color: "var(--text-1)",
                  fontSize: 13,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label="Enviar mensaje"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  borderRadius: 10,
                  border: "none",
                  background: !draft.trim() || sending ? "var(--bg-elev-2)" : "var(--brand)",
                  color: !draft.trim() || sending ? "var(--text-3)" : "#fff",
                  cursor: !draft.trim() || sending ? "default" : "pointer",
                  transition: "background 0.12s",
                }}
              >
                <Send size={15} />
              </button>
            </form>
          </footer>
        </>
      )}
    </div>
  );
}
