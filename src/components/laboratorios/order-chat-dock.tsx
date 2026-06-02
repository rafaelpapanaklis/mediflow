"use client";

// ═══════════════════════════════════════════════════════════════════════
// Chat clínica↔laboratorio EMBEBIDO en el detalle de una orden.
//
// Conversación ÚNICA (sin bandeja) reusando los endpoints existentes del
// módulo de chat de labs — mismo polling/POST que <ChatWorkspace>:
//   • CLÍNICA: POST /api/lab-chat/start { labId }      (counterpartId = labId)
//   • LAB:     POST /api/lab-chat/start { clinicId }   (counterpartId = clinicId)
//   • GET/POST /api/lab-chat/[threadId]/messages       (polling + enviar)
// El rol SIEMPRE se resuelve en el servidor desde la sesión; aquí solo se
// pasa el id de la contraparte (que sale de la orden).
//
// Botón MINIMIZAR: colapsa a una burbuja flotante (FAB) abajo-derecha con
// contador de no-leídos; reabrir restaura. Estado recordado por orden.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, Minus } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system";
import type { DentalLabChatSender } from "@/lib/laboratorios/types";

const API_START = "/api/lab-chat/start";
const messagesUrl = (threadId: string, after?: string | null) =>
  `/api/lab-chat/${threadId}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`;

const MESSAGES_POLL_MS = 4000;

type Side = "CLINIC" | "LAB";

interface ChatMessage {
  id: string;
  threadId: string;
  sender: DentalLabChatSender;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface OrderChatDockProps {
  /** Lado que ve el dock (define quién es "yo" en las burbujas). */
  side: Side;
  /** Id de la contraparte: labId (clínica) o clinicId (laboratorio). */
  counterpartId: string;
  /** Nombre de la contraparte (header). */
  counterpartName: string;
  /** Logo de la contraparte (header). */
  counterpartLogoUrl?: string | null;
  /** Número de orden, mostrado como contexto en el header. */
  orderNumber?: string;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
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

function Avatar({ name, logoUrl, size = 36 }: { name: string; logoUrl?: string | null; size?: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
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
        fontSize: size <= 28 ? 11 : 13,
        fontWeight: 600,
        background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
      }}
    >
      {initials(name)}
    </div>
  );
}

export function OrderChatDock({
  side,
  counterpartId,
  counterpartName,
  counterpartLogoUrl,
  orderNumber,
}: OrderChatDockProps) {
  const storageKey = `lab-chat-dock:${side}:${counterpartId}`;

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const threadIdRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const openRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ── Montaje + estado recordado (minimizado por orden) ──────────────────
  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "min") {
        setOpen(false);
        openRef.current = false;
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    openRef.current = open;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "min");
    } catch {
      /* ignore */
    }
    if (open) setUnread(0);
  }, [open, storageKey]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);
  useEffect(() => {
    lastMessageIdRef.current = messages.length ? messages[messages.length - 1].id : null;
  }, [messages]);
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, open]);

  // ── Resolver el hilo + carga inicial de mensajes ───────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const body = side === "CLINIC" ? { labId: counterpartId } : { clinicId: counterpartId };
        const res = await fetch(API_START, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const thread = await res.json();
        if (ctrl.signal.aborted || !thread?.id) return;
        setThreadId(thread.id);
        threadIdRef.current = thread.id;
        // Historial completo del hilo.
        const mRes = await fetch(messagesUrl(thread.id), { signal: ctrl.signal });
        if (!mRes.ok) return;
        const data: ChatMessage[] = await mRes.json();
        if (!ctrl.signal.aborted && Array.isArray(data)) {
          setMessages(data);
          lastMessageIdRef.current = data.length ? data[data.length - 1].id : null;
        }
      } catch {
        /* ignore — el polling reintenta */
      }
    })();
    return () => ctrl.abort();
  }, [side, counterpartId]);

  // ── Polling de mensajes nuevos (pausa con pestaña oculta) ──────────────
  const poll = useCallback(async (signal?: AbortSignal) => {
    const id = threadIdRef.current;
    if (!id) return;
    try {
      const res = await fetch(messagesUrl(id, lastMessageIdRef.current), { signal });
      if (!res.ok) return;
      const incoming: ChatMessage[] = await res.json();
      if (signal?.aborted || !Array.isArray(incoming) || incoming.length === 0) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = incoming.filter((m) => !seen.has(m.id));
        if (!fresh.length) return prev;
        // No-leídos: mensajes de la contraparte mientras está minimizado.
        if (!openRef.current) {
          const theirs = fresh.filter((m) => m.sender !== side).length;
          if (theirs) setUnread((u) => u + theirs);
        }
        return [...prev, ...fresh];
      });
    } catch {
      /* ignore */
    }
  }, [side]);

  useEffect(() => {
    if (!threadId) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => poll(ctrl.signal);
    const start = () => {
      if (timer === null) timer = setInterval(tick, MESSAGES_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
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
  }, [threadId, poll]);

  // ── Composer ────────────────────────────────────────────────────────────
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
    const id = threadIdRef.current;
    if (!text || !id || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(messagesUrl(id), {
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
    } catch {
      setError("No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }, [draft, sending]);

  if (!mounted) return null;

  // ── FAB minimizado ───────────────────────────────────────────────────────
  if (!open) {
    return createPortal(
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir chat con la contraparte"
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: 60,
          width: 58,
          height: 58,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          color: "#fff",
          background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
          boxShadow: "0 12px 30px -8px rgba(124,58,237,0.7)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <MessageCircle size={24} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              minWidth: 22,
              height: 22,
              padding: "0 6px",
              borderRadius: 999,
              background: "var(--danger)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
              border: "2px solid var(--bg)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>,
      document.body,
    );
  }

  // ── Panel abierto (dock derecho flotante) ─────────────────────────────────
  return createPortal(
    <div
      role="dialog"
      aria-label={`Chat con ${counterpartName}`}
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 60,
        width: "min(384px, calc(100vw - 32px))",
        height: "min(560px, calc(100dvh - 120px))",
        display: "flex",
        flexDirection: "column",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        boxShadow: "0 24px 60px -16px rgba(0,0,0,0.5), 0 0 0 1px var(--border-soft)",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          background: "linear-gradient(135deg, var(--lab-eta-from), var(--lab-eta-to))",
          borderBottom: "1px solid var(--border-soft)",
        }}
      >
        <Avatar name={counterpartName} logoUrl={counterpartLogoUrl} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {counterpartName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "rgba(232,232,236,0.65)" }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--success)",
                boxShadow: "0 0 6px var(--success)",
              }}
            />
            En línea{orderNumber ? ` · ${orderNumber}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimizar chat"
          style={{
            display: "grid",
            placeItems: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.08)",
            color: "#fff",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Minus size={15} />
        </button>
      </header>

      {/* Mensajes */}
      <div
        className="scrollbar-thin"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "var(--bg)",
        }}
      >
        {messages.length === 0 ? (
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
            Escribe el primer mensaje para coordinar esta orden.
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender === side;
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

      {/* Composer */}
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
          <ButtonNew
            type="submit"
            variant="primary"
            icon={<Send size={15} />}
            disabled={!draft.trim() || sending}
            aria-label="Enviar mensaje"
            style={{ height: 36 }}
          />
        </form>
      </footer>
    </div>,
    document.body,
  );
}
