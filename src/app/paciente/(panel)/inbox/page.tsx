"use client";

// Mensajes del portal del paciente (WS2-T2). Implementa el chat in-app contra
// el Inbox de la clínica (canal PORTAL):
//   · Lista de conversaciones: UNA por clínica vinculada (con vista previa +
//     punto "nuevo" cuando la clínica respondió y no lo has visto).
//   · Vista de hilo con burbujas: IN (tú) a la derecha, OUT (clínica) a la
//     izquierda. Caja para escribir.
//   · Polling cada 5s del hilo abierto (pausa con la pestaña oculta), cursor
//     serverTime para evitar clock skew. SWR refresca la lista cada 20s.
// Master/detail responsive por CSS: en móvil se ve lista O hilo; en ≥768px ambos.
// Estilo dark del portal, español neutro con tú.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Send, MessageSquare } from "lucide-react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import { PacienteCard } from "@/components/paciente/ui";
import type {
  PortalThreadsResponse,
  PortalThreadDTO,
  PortalMessageDTO,
  PortalMessagesResponse,
  PortalSinceResponse,
  PortalSendResponse,
  PortalStartResponse,
} from "@/lib/patient-portal/inbox";

const BORDER = "1px solid rgba(255,255,255,0.08)";
const SEEN_KEY = "pi_seen_v1";

const PAGE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "clamp(14px, 2.5vw, 22px)",
};

// ── helpers de red (mismas reglas que pacienteFetcher: 401 → login) ──────────
function redirectLogin() {
  if (typeof window !== "undefined") {
    window.location.assign(`/paciente/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
}
async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    redirectLogin();
    throw new Error("401");
  }
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json() as Promise<T>;
}
async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    redirectLogin();
    throw new Error("401");
  }
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json() as Promise<T>;
}

// ── helpers de mensajes ──────────────────────────────────────────────────────
function bySentAt(a: PortalMessageDTO, b: PortalMessageDTO): number {
  return a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0;
}
function mergeMessages(prev: PortalMessageDTO[], incoming: PortalMessageDTO[]): PortalMessageDTO[] {
  if (!incoming.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    if (!byId.has(m.id)) {
      byId.set(m.id, m);
      changed = true;
    }
  }
  if (!changed) return prev;
  return Array.from(byId.values()).sort(bySentAt);
}
function replaceTemp(prev: PortalMessageDTO[], tempId: string, real: PortalMessageDTO): PortalMessageDTO[] {
  const without = prev.filter((m) => m.id !== tempId);
  if (without.some((m) => m.id === real.id)) return without;
  return [...without, real].sort(bySentAt);
}
function hhmm(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ── persistencia "visto" (punto nuevo) en localStorage ───────────────────────
function loadSeen(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

const CSS = `
.pi-grid{display:grid;grid-template-columns:1fr;gap:14px;}
.pi-list,.pi-convo{display:flex;flex-direction:column;min-width:0;}
.pi-back{display:inline-flex;}
@media(min-width:768px){
  .pi-grid{grid-template-columns:minmax(230px,300px) 1fr;align-items:stretch;}
  .pi-list,.pi-convo{display:flex !important;}
  .pi-back{display:none !important;}
}
@media(max-width:767px){
  .pi-grid[data-sel="0"] .pi-convo{display:none;}
  .pi-grid[data-sel="1"] .pi-list{display:none;}
}
@keyframes piPulse{0%,100%{opacity:.4}50%{opacity:.9}}
`;

export default function PacienteInboxPage() {
  const { data, error, isLoading, mutate } =
    usePacienteData<PortalThreadsResponse>("/api/paciente/inbox/threads");

  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PortalMessageDTO[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>({});

  const cursorRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const clinics = useMemo(() => data?.clinics ?? [], [data]);
  const threadByClinic = useMemo(() => {
    const m = new Map<string, PortalThreadDTO>();
    for (const t of data?.threads ?? []) m.set(t.clinicId, t);
    return m;
  }, [data]);

  const selectedThread = selectedClinicId ? threadByClinic.get(selectedClinicId) ?? null : null;
  const selectedThreadId = selectedThread?.threadId ?? null;
  const selectedClinicName =
    clinics.find((c) => c.clinicId === selectedClinicId)?.clinicName ?? "Tu clínica";

  // Carga "visto" tras montar (evita mismatch de hidratación).
  useEffect(() => {
    setSeen(loadSeen());
  }, []);

  const markSeen = useCallback((threadId: string, ts: string) => {
    setSeen((prev) => {
      if (prev[threadId] === ts) return prev;
      const next = { ...prev, [threadId]: ts };
      try {
        window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        /* sin almacenamiento: el punto se recalcula en memoria */
      }
      return next;
    });
  }, []);

  const isThreadNew = useCallback(
    (t: PortalThreadDTO | null | undefined): boolean => {
      if (!t || t.lastDirection !== "OUT") return false;
      const s = seen[t.threadId];
      return !s || t.lastMessageAt > s;
    },
    [seen],
  );

  // Auto-selección en escritorio: si hay una sola clínica, ábrela.
  useEffect(() => {
    if (selectedClinicId || clinics.length === 0) return;
    if (typeof window !== "undefined" && window.matchMedia("(min-width:768px)").matches) {
      setSelectedClinicId(clinics[0].clinicId);
    }
  }, [clinics, selectedClinicId]);

  // Marca el hilo abierto como visto (limpia su punto).
  useEffect(() => {
    if (selectedThread) markSeen(selectedThread.threadId, selectedThread.lastMessageAt);
  }, [selectedThread, markSeen]);

  // Carga el historial al abrir un hilo existente; resetea para "conversación nueva".
  useEffect(() => {
    setSendErr(null);
    if (!selectedThreadId) {
      setMessages([]);
      cursorRef.current = null;
      return;
    }
    let cancelled = false;
    setLoadingMsgs(true);
    apiGet<PortalMessagesResponse>(`/api/paciente/inbox/threads/${selectedThreadId}/messages`)
      .then((resp) => {
        if (cancelled) return;
        setMessages(resp.messages);
        cursorRef.current = resp.serverTime;
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMsgs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedThreadId]);

  // Polling del hilo abierto (pausa con pestaña oculta).
  useEffect(() => {
    if (!selectedThreadId) return;
    let stopped = false;

    async function poll() {
      if (stopped || typeof document === "undefined" || document.hidden) return;
      const ts = cursorRef.current;
      if (!ts) return;
      try {
        const resp = await apiGet<PortalSinceResponse>(
          `/api/paciente/inbox/since?ts=${encodeURIComponent(ts)}&threadId=${encodeURIComponent(selectedThreadId!)}`,
        );
        if (stopped) return;
        cursorRef.current = resp.serverTime;
        if (resp.messages.length) {
          setMessages((prev) => mergeMessages(prev, resp.messages));
        }
        if (resp.threads.length) {
          // Hay novedades en algún hilo → refresca previews/puntos de la lista.
          mutate();
        }
      } catch {
        /* error transitorio de red: el próximo tick reintenta */
      }
    }

    const id = window.setInterval(poll, 5000);
    const onVis = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [selectedThreadId, mutate]);

  // Auto-scroll al final cuando cambian los mensajes o el hilo.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, selectedThreadId, loadingMsgs]);

  const send = useCallback(async () => {
    const value = text.trim();
    if (!value || sending || !selectedClinicId) return;
    setSending(true);
    setSendErr(null);

    const tempId = `temp-${Date.now()}`;
    const optimistic: PortalMessageDTO = {
      id: tempId,
      direction: "IN",
      body: value,
      attachments: [],
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setText("");

    try {
      if (selectedThreadId) {
        const r = await apiPost<PortalSendResponse>(
          `/api/paciente/inbox/threads/${selectedThreadId}/messages`,
          { body: value },
        );
        setMessages((prev) => replaceTemp(prev, tempId, r.message));
      } else {
        // Primera vez con esta clínica: crea/reutiliza el hilo PORTAL.
        const r = await apiPost<PortalStartResponse>(`/api/paciente/inbox/start`, {
          clinicId: selectedClinicId,
          body: value,
        });
        await mutate(); // la lista ya tiene el hilo nuevo
        const m = await apiGet<PortalMessagesResponse>(
          `/api/paciente/inbox/threads/${r.threadId}/messages`,
        );
        setMessages(m.messages);
        cursorRef.current = m.serverTime;
      }
      mutate(); // refresca previews de la lista
    } catch (e) {
      // Revierte el optimista y devuelve el texto para reintentar.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(value);
      setSendErr(
        e instanceof Error && e.message === "401"
          ? "Tu sesión expiró."
          : "No se pudo enviar. Intenta de nuevo.",
      );
    } finally {
      setSending(false);
    }
  }, [text, sending, selectedClinicId, selectedThreadId, mutate]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={PAGE_STYLE}>
        <style>{CSS}</style>
        <Header />
        <PacienteCard>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 54,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.06)",
                  animation: "piPulse 1.4s ease-in-out infinite",
                }}
              />
            ))}
          </div>
        </PacienteCard>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={PAGE_STYLE}>
        <style>{CSS}</style>
        <Header />
        <PacienteCard>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "clamp(20px,4vw,36px) 12px", textAlign: "center" }}>
            <p style={{ margin: 0, opacity: 0.8 }}>No pudimos cargar tus mensajes. Inténtalo de nuevo.</p>
            <button onClick={() => mutate()} style={primaryBtnStyle}>
              Reintentar
            </button>
          </div>
        </PacienteCard>
      </div>
    );
  }

  if (clinics.length === 0) {
    return (
      <div style={PAGE_STYLE}>
        <style>{CSS}</style>
        <Header />
        <PacienteCard>
          <div style={{ padding: 28, textAlign: "center", color: "rgba(245,245,247,0.55)", lineHeight: 1.5 }}>
            Aún no tienes una clínica vinculada a tu cuenta. Cuando reserves o te
            registres con una clínica, aquí podrás escribirle.
          </div>
        </PacienteCard>
      </div>
    );
  }

  return (
    <div style={PAGE_STYLE}>
      <style>{CSS}</style>
      <Header />

      <div className="pi-grid" data-sel={selectedClinicId ? "1" : "0"}>
        {/* ── Lista de conversaciones ─────────────────────────────────────── */}
        <div className="pi-list">
          <PacienteCard title="Conversaciones" style={{ padding: "clamp(12px,2vw,16px)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {clinics.map((c) => {
                const t = threadByClinic.get(c.clinicId);
                const active = c.clinicId === selectedClinicId;
                const dot = isThreadNew(t);
                const previewText = t
                  ? `${t.lastDirection === "IN" ? "Tú: " : ""}${t.preview ?? ""}`.trim() ||
                    "Sin mensajes todavía"
                  : "Inicia una conversación";
                return (
                  <button
                    key={c.clinicId}
                    type="button"
                    onClick={() => setSelectedClinicId(c.clinicId)}
                    aria-current={active ? "true" : undefined}
                    style={{
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "11px 12px",
                      borderRadius: 12,
                      border: active ? "1px solid #8b5cf6" : BORDER,
                      background: active ? "rgba(124,58,237,0.16)" : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      color: "inherit",
                      fontFamily: "inherit",
                      width: "100%",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        {c.clinicName}
                      </span>
                      {dot && (
                        <span
                          aria-label="Mensajes nuevos"
                          style={{ width: 9, height: 9, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }}
                        />
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: "rgba(245,245,247,0.6)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: dot ? 600 : 400,
                      }}
                    >
                      {previewText}
                    </span>
                  </button>
                );
              })}
            </div>
          </PacienteCard>
        </div>

        {/* ── Hilo ────────────────────────────────────────────────────────── */}
        <div className="pi-convo">
          {!selectedClinicId ? (
            <PacienteCard>
              <div style={{ padding: 28, textAlign: "center", color: "rgba(245,245,247,0.55)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <MessageSquare size={28} style={{ opacity: 0.5 }} />
                Selecciona una conversación para empezar.
              </div>
            </PacienteCard>
          ) : (
            <section
              style={{
                background: "#121020",
                border: BORDER,
                borderRadius: 14,
                display: "flex",
                flexDirection: "column",
                height: "clamp(400px, 64vh, 660px)",
                overflow: "hidden",
              }}
            >
              {/* Header del hilo */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: BORDER }}>
                <button
                  type="button"
                  className="pi-back"
                  onClick={() => setSelectedClinicId(null)}
                  aria-label="Volver a conversaciones"
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: BORDER,
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <ArrowLeft size={16} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedClinicName}
                  </div>
                  <div style={{ fontSize: 11.5, color: "rgba(245,245,247,0.5)" }}>Mensajes con tu clínica</div>
                </div>
              </div>

              {/* Mensajes */}
              <div style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
                {loadingMsgs ? (
                  <div style={{ margin: "auto", color: "rgba(245,245,247,0.5)", fontSize: 13 }}>Cargando…</div>
                ) : messages.length === 0 ? (
                  <div style={{ margin: "auto", textAlign: "center", color: "rgba(245,245,247,0.5)", fontSize: 13, lineHeight: 1.5, maxWidth: 280 }}>
                    No hay mensajes aún. Escribe el primero y tu clínica lo verá en su bandeja.
                  </div>
                ) : (
                  messages.map((m) => <Bubble key={m.id} m={m} />)
                )}
                <div ref={endRef} />
              </div>

              {/* Composer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderTop: BORDER }}
              >
                {sendErr && (
                  <div style={{ fontSize: 12, color: "#f87171" }} role="alert">
                    {sendErr}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Escribe un mensaje…"
                    aria-label="Escribe un mensaje"
                    style={{
                      flex: 1,
                      resize: "none",
                      minHeight: 42,
                      maxHeight: 120,
                      overflowY: "auto",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: BORDER,
                      background: "rgba(255,255,255,0.04)",
                      color: "#f5f5f7",
                      fontFamily: "inherit",
                      fontSize: "clamp(13px,1.5vw,14px)",
                      lineHeight: 1.45,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={sending || !text.trim()}
                    aria-label="Enviar mensaje"
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      border: "none",
                      flexShrink: 0,
                      cursor: sending || !text.trim() ? "default" : "pointer",
                      background: sending || !text.trim() ? "rgba(124,58,237,0.4)" : "#7c3aed",
                      color: "#fff",
                      opacity: sending || !text.trim() ? 0.6 : 1,
                    }}
                  >
                    <Send size={17} />
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 style={{ margin: 0, fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 700 }}>Mensajes</h1>
      <p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: "clamp(13px, 1.5vw, 15px)" }}>
        Escríbele directo a tu clínica
      </p>
    </header>
  );
}

function Bubble({ m }: { m: PortalMessageDTO }) {
  const mine = m.direction === "IN"; // IN = paciente
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 3 }}>
        <div
          style={{
            padding: "9px 12px",
            borderRadius: 14,
            borderBottomRightRadius: mine ? 4 : 14,
            borderBottomLeftRadius: mine ? 14 : 4,
            background: mine ? "rgba(124,58,237,0.22)" : "rgba(255,255,255,0.06)",
            border: mine ? "1px solid rgba(139,92,246,0.35)" : BORDER,
            color: "#f5f5f7",
            fontSize: "clamp(13px,1.5vw,14px)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {m.body}
          {m.attachments.map((a, i) => (
            <a
              key={i}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "block", marginTop: 6, fontSize: 12.5, color: "#c4b5fd", textDecoration: "underline", overflowWrap: "anywhere" }}
            >
              {a.name}
            </a>
          ))}
        </div>
        <span style={{ fontSize: 10.5, color: "rgba(245,245,247,0.45)" }}>{hhmm(m.sentAt)}</span>
      </div>
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  background: "#7c3aed",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontWeight: 600,
  fontSize: "clamp(13px,1.5vw,14px)",
  cursor: "pointer",
  fontFamily: "inherit",
};
