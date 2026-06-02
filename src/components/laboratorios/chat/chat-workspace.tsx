"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DentalLabChatSender } from "@/lib/laboratorios/types";

// ── Endpoints (contrato de types.ts) ─────────────────────────────────────
const API_THREADS = "/api/lab-chat";
const API_START = "/api/lab-chat/start";
const messagesUrl = (threadId: string, after?: string | null) =>
  `/api/lab-chat/${threadId}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`;

const THREADS_POLL_MS = 5000;
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

interface ChatThread {
  id: string;
  clinicId: string;
  labId: string;
  lastMessageAt: string;
  clinicUnread: number;
  labUnread: number;
  createdAt: string;
  lab?: { id: string; name: string; logoUrl: string | null };
  clinic?: { id: string; name: string; logoUrl: string | null };
  messages?: ChatMessage[];
}

// ── Derivaciones según el lado: la contraparte y el no-leído propio salen
//    de los campos crudos del hilo (clinic/lab, clinicUnread/labUnread). ──
function counterpartName(t: ChatThread, side: Side): string {
  return side === "CLINIC" ? t.lab?.name ?? "Laboratorio" : t.clinic?.name ?? "Clínica";
}
function counterpartLogo(t: ChatThread, side: Side): string | null {
  return (side === "CLINIC" ? t.lab?.logoUrl : t.clinic?.logoUrl) ?? null;
}
function unreadFor(t: ChatThread, side: Side): number {
  return side === "CLINIC" ? t.clinicUnread : t.labUnread;
}

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

function Avatar({ name, logoUrl, size = 40 }: { name: string; logoUrl: string | null; size?: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

export function ChatWorkspace({
  side,
  initialLabId,
}: {
  side: Side;
  /** Solo lado clínica: laboratorio con el que abrir/crear el hilo al entrar. */
  initialLabId?: string;
}) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs leídos por los intervals de polling para evitar closures obsoletas
  // y evitar que una respuesta tardía pinte mensajes del hilo equivocado.
  const selectedIdRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    lastMessageIdRef.current = messages.length ? messages[messages.length - 1].id : null;
  }, [messages]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Fetchers (estables) ────────────────────────────────────────────────
  const fetchThreads = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(API_THREADS, { signal });
      if (!res.ok) return;
      const data: ChatThread[] = await res.json();
      if (!signal?.aborted && Array.isArray(data)) setThreads(data);
    } catch {
      /* ignore — el polling reintenta */
    } finally {
      if (!signal?.aborted) setLoadingThreads(false);
    }
  }, []);

  const fetchMessagesFull = useCallback(async (threadId: string, signal?: AbortSignal) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(messagesUrl(threadId), { signal });
      if (!res.ok) return;
      const data: ChatMessage[] = await res.json();
      // Solo aplicar si el hilo sigue seleccionado (evita bleed entre hilos).
      if (!signal?.aborted && selectedIdRef.current === threadId && Array.isArray(data)) {
        setMessages(data);
      }
    } catch {
      /* ignore */
    } finally {
      if (!signal?.aborted) setLoadingMessages(false);
    }
  }, []);

  const pollMessages = useCallback(async (threadId: string, signal?: AbortSignal) => {
    const after = lastMessageIdRef.current;
    try {
      const res = await fetch(messagesUrl(threadId, after), { signal });
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
  }, []);

  const selectThread = useCallback(
    (threadId: string) => {
      setSelectedId(threadId);
      selectedIdRef.current = threadId;
      setMessages([]);
      lastMessageIdRef.current = null;
      setError(null);
      // Optimista: limpiar el badge de no-leídos del hilo abierto.
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? side === "CLINIC"
              ? { ...t, clinicUnread: 0 }
              : { ...t, labUnread: 0 }
            : t
        )
      );
      fetchMessagesFull(threadId);
    },
    [side, fetchMessagesFull]
  );

  const startThread = useCallback(
    async (labId: string, signal?: AbortSignal) => {
      try {
        const res = await fetch(API_START, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labId }),
          signal,
        });
        if (!res.ok) return;
        const thread: ChatThread = await res.json();
        if (signal?.aborted) return;
        setThreads((prev) =>
          prev.some((t) => t.id === thread.id)
            ? prev.map((t) => (t.id === thread.id ? thread : t))
            : [thread, ...prev]
        );
        selectThread(thread.id);
      } catch {
        /* ignore */
      }
    },
    [selectThread]
  );

  // ── Carga inicial + deep-link de clínica (al montar) ───────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      await fetchThreads(ctrl.signal);
      if (side === "CLINIC" && initialLabId) {
        await startThread(initialLabId, ctrl.signal);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling de la bandeja (pausa con pestaña oculta) ───────────────────
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

  // ── Polling de mensajes del hilo activo ────────────────────────────────
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

  // ── Composer ───────────────────────────────────────────────────────────
  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }
  useEffect(() => {
    autoGrow();
  }, [draft]);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(messagesUrl(selectedId), {
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
        const target = prev.find((t) => t.id === selectedId);
        if (!target) return prev;
        const updated: ChatThread = {
          ...target,
          lastMessageAt: msg.createdAt,
          messages: [msg],
          // Optimista: solo el contador del propio lado se pone a 0 (acabo de
          // leer el hilo). El del receptor lo reconcilia el siguiente poll —
          // el servidor lo incrementa (ver POST .../messages).
          ...(side === "CLINIC" ? { clinicUnread: 0 } : { labUnread: 0 }),
        };
        return [updated, ...prev.filter((t) => t.id !== selectedId)];
      });
    } catch {
      setError("No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }, [draft, selectedId, sending]);

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[460px] w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* ── Bandeja de hilos ── */}
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r border-border md:flex md:w-80 lg:w-96",
          selectedId ? "hidden md:flex" : "flex"
        )}
      >
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-base font-semibold text-foreground">Mensajes</h1>
          <p className="text-xs text-muted-foreground">
            {side === "CLINIC" ? "Conversaciones con laboratorios" : "Conversaciones con clínicas"}
          </p>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {loadingThreads && threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
          ) : threads.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              <MessageCircle className="mx-auto mb-2 opacity-40" size={28} />
              {side === "CLINIC"
                ? "Aún no tienes conversaciones. Abre el chat desde el perfil de un laboratorio."
                : "Aún no tienes conversaciones. Las clínicas iniciarán el contacto."}
            </div>
          ) : (
            <ul>
              {threads.map((t) => {
                const unread = t.id === selectedId ? 0 : unreadFor(t, side);
                const last = t.messages?.[0];
                const active = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectThread(t.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted",
                        active && "bg-brand-50"
                      )}
                    >
                      <Avatar name={counterpartName(t, side)} logoUrl={counterpartLogo(t, side)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {counterpartName(t, side)}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {fmtThreadTime(t.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {last
                              ? `${last.sender === side ? "Tú: " : ""}${last.body}`
                              : "Sin mensajes aún"}
                          </span>
                          {unread > 0 && (
                            <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">
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
      </aside>

      {/* ── Conversación ── */}
      <section className={cn("w-full flex-1 flex-col", selectedId ? "flex" : "hidden md:flex")}>
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  selectedIdRef.current = null;
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden"
                aria-label="Volver a la bandeja"
              >
                <ArrowLeft size={18} />
              </button>
              <Avatar
                name={counterpartName(selected, side)}
                logoUrl={counterpartLogo(selected, side)}
                size={36}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {counterpartName(selected, side)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {side === "CLINIC" ? "Laboratorio" : "Clínica"}
                </p>
              </div>
            </header>

            <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto bg-muted/30 px-4 py-4">
              {loadingMessages && messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">Cargando mensajes…</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay mensajes. Escribe el primero.
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender === side;
                  return (
                    <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                          mine
                            ? "rounded-br-sm bg-brand-600 text-white"
                            : "rounded-bl-sm bg-white text-foreground"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <span
                          className={cn(
                            "mt-1 block text-right text-[10px]",
                            mine ? "text-white/70" : "text-muted-foreground"
                          )}
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

            <footer className="border-t border-border p-3">
              {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendMessage();
                }}
                className="flex items-end gap-2"
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
                  className="max-h-[120px] flex-1 resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
                <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label="Enviar">
                  <Send size={16} />
                </Button>
              </form>
            </footer>
          </>
        ) : (
          <div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">
            Selecciona una conversación
          </div>
        )}
      </section>
    </div>
  );
}
