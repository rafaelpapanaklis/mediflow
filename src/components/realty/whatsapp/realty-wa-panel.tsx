"use client";
// ═══════════════════════════════════════════════════════════════════════
// Panel de WhatsApp del vertical INMUEBLES: Inbox + Configuración.
//
// i18n — CONVENCIÓN B, la misma que /inmobiliaria/registro: el SERVIDOR
// baja el sub-árbol ya recortado (realty.whatsapp) y aquí se usa
// makeRealtyT(dict) SIN segundo argumento. Anteponer un prefijo aquí lo
// aplicaría DOS VECES y la pantalla pintaría la llave cruda.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Check,
  CheckCheck,
  FileText,
  Loader2,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Send,
  Settings,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  REALTY_WA_PRICE_USD,
  REALTY_WA_TEMPLATES,
  REALTY_WA_STATUS_TONE,
  isRealtyWaMetaMedia,
  type RealtyWaConnectionDTO,
  type RealtyWaQuotaDTO,
  type RealtyWaThreadRowDTO,
} from "@/lib/realty/whatsapp-core";
import {
  REALTY_MESSAGE_STATUS_LABELS,
  type RealtyMessageDTO,
} from "@/lib/realty/types";

interface TemplateRow {
  kind: string;
  name: string;
  category: string;
  status: string;
  reason: string | null;
  optional: boolean;
}

/**
 * Los estados de plantilla que sabemos traducir. Meta tiene MÁS (PAUSED,
 * DISABLED, IN_APPEAL…) y añade nuevos cuando quiere: uno que no conozcamos
 * pintaría la llave cruda en pantalla, así que cae a "OTHER" con un texto
 * honesto en vez de a un `settings.tplStatus.LIMIT_EXCEEDED` a la vista.
 */
const KNOWN_TPL_STATUS = ["APPROVED", "PENDING", "REJECTED", "MISSING", "PAUSED", "DISABLED"];

function tplStatusKey(status: string): string {
  return KNOWN_TPL_STATUS.includes(status) ? status : "OTHER";
}

const TONE_COLOR: Record<string, string> = {
  neutral: "var(--text-3)",
  info: "var(--text-3)",
  success: "var(--brand)",
  danger: "var(--danger)",
};

export function RealtyWaPanel({
  dict,
  canSend,
  accountName,
}: {
  dict: Dictionary;
  canSend: boolean;
  accountName: string;
}) {
  // 🔴 useMemo NO es un adorno. makeRealtyT devuelve una función NUEVA en cada
  // llamada, y `t` está en las dependencias de los useCallback de abajo, que a
  // su vez son las dependencias de sus useEffect. Sin memoizar: render → `t`
  // nuevo → callback nuevo → el efecto vuelve a disparar → setState → render…
  // Un bucle infinito que además pega a `/templates`, y ESE endpoint consulta
  // a Meta en cada llamada. Sería auto-infligirnos un bloqueo de la WABA.
  const t = useMemo(() => makeRealtyT(dict), [dict]);

  const [tab, setTab] = useState<"inbox" | "settings">("inbox");
  const [showArchived, setShowArchived] = useState(false);
  const [threads, setThreads] = useState<RealtyWaThreadRowDTO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RealtyMessageDTO[]>([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [contactName, setContactName] = useState<string | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [connection, setConnection] = useState<RealtyWaConnectionDTO | null>(null);
  const [quota, setQuota] = useState<RealtyWaQuotaDTO | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesNote, setTemplatesNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ── Carga ────────────────────────────────────────────────────────────
  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const res = await fetch(`/api/realty/whatsapp/threads?archived=${showArchived ? "1" : "0"}`);
      const data = await res.json().catch(() => ({}));
      setThreads(Array.isArray(data?.threads) ? data.threads : []);
    } catch {
      setNotice({ kind: "err", text: t("errors.load") });
    } finally {
      setLoadingThreads(false);
    }
  }, [showArchived, t]);

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/realty/whatsapp/threads/${threadId}`);
      const data = await res.json().catch(() => ({}));
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setWindowOpen(data?.windowOpen === true);
      setContactName(data?.contactName ?? data?.phone ?? null);
      // Marcar leído no es crítico: si falla, el hilo sigue abierto.
      fetch(`/api/realty/whatsapp/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      }).catch(() => {});
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const [statusRes, tplRes] = await Promise.all([
        fetch("/api/realty/whatsapp/status"),
        fetch("/api/realty/whatsapp/templates"),
      ]);
      const status = await statusRes.json().catch(() => ({}));
      const tpl = await tplRes.json().catch(() => ({}));
      setConnection(status?.connection ?? null);
      setQuota(status?.quota ?? null);
      setTemplates(Array.isArray(tpl?.templates) ? tpl.templates : []);
      setTemplatesNote(typeof tpl?.reason === "string" ? tpl.reason : null);
    } catch {
      setNotice({ kind: "err", text: t("errors.load") });
    }
  }, [t]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // ── Acciones ─────────────────────────────────────────────────────────
  async function send() {
    if (!activeId || !draft.trim() || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/realty/whatsapp/threads/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El texto viene del servidor YA en español y explica el porqué
        // real (ventana cerrada, cupo, sin conexión). No se sustituye por
        // un "algo salió mal" genérico.
        setNotice({ kind: "err", text: data?.error ?? t("errors.generic") });
        return;
      }
      setDraft("");
      await loadMessages(activeId);
      await loadThreads();
    } catch {
      setNotice({ kind: "err", text: t("errors.generic") });
    } finally {
      setSending(false);
    }
  }

  async function toggleArchive(threadId: string, archived: boolean) {
    await fetch(`/api/realty/whatsapp/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    }).catch(() => {});
    if (activeId === threadId) setActiveId(null);
    await loadThreads();
  }

  async function createTemplates(includeMarketing: boolean) {
    setBusy("templates");
    setNotice(null);
    try {
      const res = await fetch("/api/realty/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeMarketing }),
      });
      const data = await res.json().catch(() => ({}));
      setNotice(
        data?.ok
          ? { kind: "ok", text: t("settings.templatesDone") }
          : { kind: "err", text: data?.reason ?? t("settings.templatesPartial") },
      );
      await loadSettings();
    } finally {
      setBusy(null);
    }
  }

  async function runDispatch() {
    setBusy("dispatch");
    setNotice(null);
    try {
      const res = await fetch("/api/realty/whatsapp/dispatch", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data?.error ?? t("errors.generic") });
        return;
      }
      const sent = (data?.visits?.sent ?? 0) + (data?.rent?.sent ?? 0);
      setNotice({ kind: "ok", text: t("settings.dispatchDone", { n: String(sent) }) });
      await loadThreads();
      await loadSettings();
    } finally {
      setBusy(null);
    }
  }

  const activeThread = useMemo(
    () => threads.find((th) => th.id === activeId) ?? null,
    [threads, activeId],
  );

  // ── Pintado ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>{t("subtitle")}</p>
      </header>

      <nav style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--border-soft)" }}>
        {(["inbox", "settings"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              color: tab === key ? "var(--brand)" : "var(--text-3)",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${tab === key ? "var(--brand)" : "transparent"}`,
              cursor: "pointer",
            }}
          >
            {key === "inbox" ? <MessageCircle size={15} /> : <Settings size={15} />}
            {t(`tabs.${key}`)}
          </button>
        ))}
      </nav>

      {notice && (
        <div
          role="status"
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 13,
            border: `1px solid ${notice.kind === "ok" ? "var(--border-brand)" : "var(--danger)"}`,
            background: notice.kind === "ok" ? "var(--brand-softer)" : "transparent",
            color: notice.kind === "ok" ? "var(--text-1)" : "var(--danger)",
          }}
        >
          {notice.text}
        </div>
      )}

      {tab === "inbox" ? (
        <InboxView
          t={t}
          threads={threads}
          loadingThreads={loadingThreads}
          loadingMessages={loadingMessages}
          activeId={activeId}
          activeThread={activeThread}
          setActiveId={setActiveId}
          messages={messages}
          windowOpen={windowOpen}
          contactName={contactName}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          draft={draft}
          setDraft={setDraft}
          send={send}
          sending={sending}
          canSend={canSend}
          toggleArchive={toggleArchive}
          bottomRef={bottomRef}
          onRefresh={loadThreads}
        />
      ) : (
        <SettingsView
          t={t}
          connection={connection}
          quota={quota}
          templates={templates}
          templatesNote={templatesNote}
          busy={busy}
          canSend={canSend}
          accountName={accountName}
          createTemplates={createTemplates}
          runDispatch={runDispatch}
        />
      )}
    </div>
  );
}

// ── Inbox ──────────────────────────────────────────────────────────────

function InboxView(props: any) {
  const {
    t,
    threads,
    loadingThreads,
    loadingMessages,
    activeId,
    activeThread,
    setActiveId,
    messages,
    windowOpen,
    contactName,
    showArchived,
    setShowArchived,
    draft,
    setDraft,
    send,
    sending,
    canSend,
    toggleArchive,
    bottomRef,
    onRefresh,
  } = props;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(240px, 320px) 1fr",
        gap: 16,
        alignItems: "start",
      }}
      className="realty-wa-grid"
    >
      {/* Lista de hilos */}
      <aside
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 12px",
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            style={ghostBtn}
          >
            {showArchived ? t("inbox.showActive") : t("inbox.showArchived")}
          </button>
          <button type="button" onClick={onRefresh} style={ghostBtn} aria-label={t("inbox.refresh")}>
            <RefreshCw size={14} />
          </button>
        </div>

        <div style={{ maxHeight: "62vh", overflowY: "auto" }}>
          {loadingThreads ? (
            <Empty icon={<Loader2 size={18} />} text={t("inbox.loading")} />
          ) : threads.length === 0 ? (
            <Empty
              icon={<MessageCircle size={18} />}
              text={showArchived ? t("inbox.emptyArchived") : t("inbox.empty")}
              hint={showArchived ? null : t("inbox.emptyHint")}
            />
          ) : (
            threads.map((th: RealtyWaThreadRowDTO) => (
              <button
                key={th.id}
                type="button"
                onClick={() => setActiveId(th.id)}
                style={{
                  display: "grid",
                  gap: 3,
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border-soft)",
                  background: activeId === th.id ? "var(--brand-softer)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                    {th.contactName ?? th.phone}
                  </span>
                  {th.unread > 0 && (
                    <span
                      style={{
                        minWidth: 18,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: "var(--brand)",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        textAlign: "center",
                      }}
                    >
                      {th.unread}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {th.lastBody ?? "—"}
                </span>
                {/* 🔴 El estado del ÚLTIMO mensaje se pinta AQUÍ. Sin esto,
                    un mensaje rechazado por Meta se vería como cualquier
                    otro — el bug que arrastraba el Inbox del dental. */}
                {th.lastDirection === "OUTBOUND" && th.lastStatus === "FAILED" && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "var(--danger)",
                    }}
                  >
                    <AlertCircle size={11} />
                    {th.lastError ?? t("inbox.failed")}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Conversación */}
      <section
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          minHeight: "62vh",
        }}
      >
        {!activeId ? (
          <div style={{ gridRow: "1 / -1", display: "grid", placeItems: "center", padding: 32 }}>
            <Empty icon={<MessageCircle size={22} />} text={t("inbox.pickThread")} />
          </div>
        ) : (
          <>
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <strong style={{ fontSize: 14, color: "var(--text-1)" }}>
                  {contactName ?? activeThread?.phone}
                </strong>
                <span
                  style={{
                    fontSize: 11,
                    color: windowOpen ? "var(--brand)" : "var(--text-3)",
                  }}
                >
                  {windowOpen ? t("inbox.windowOpen") : t("inbox.windowClosed")}
                </span>
              </div>
              {activeThread && (
                <button
                  type="button"
                  onClick={() => toggleArchive(activeThread.id, !activeThread.archived)}
                  style={ghostBtn}
                >
                  {activeThread.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  {activeThread.archived ? t("inbox.unarchive") : t("inbox.archive")}
                </button>
              )}
            </header>

            <div style={{ padding: 14, overflowY: "auto", maxHeight: "50vh", display: "grid", gap: 10 }}>
              {loadingMessages ? (
                <Empty icon={<Loader2 size={18} />} text={t("inbox.loading")} />
              ) : (
                messages.map((m: RealtyMessageDTO) => <Bubble key={m.id} m={m} t={t} />)
              )}
              <div ref={bottomRef} />
            </div>

            <footer style={{ padding: 12, borderTop: "1px solid var(--border-soft)" }}>
              {!windowOpen && (
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 8px" }}>
                  {t("inbox.windowHint")}
                </p>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("inbox.composer")}
                  rows={2}
                  disabled={!canSend || !windowOpen || sending}
                  style={{
                    flex: 1,
                    resize: "vertical",
                    padding: "8px 10px",
                    fontSize: 13,
                    borderRadius: 10,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg)",
                    color: "var(--text-1)",
                  }}
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend || !windowOpen || sending || !draft.trim()}
                  style={{
                    ...primaryBtn,
                    opacity: !canSend || !windowOpen || sending || !draft.trim() ? 0.5 : 1,
                  }}
                >
                  {sending ? <Loader2 size={14} /> : <Send size={14} />}
                  {t("inbox.send")}
                </button>
              </div>
              {!canSend && (
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: "8px 0 0" }}>
                  {t("inbox.noPermission")}
                </p>
              )}
            </footer>
          </>
        )}
      </section>

      <style>{`
        @media (max-width: 860px) {
          .realty-wa-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Bubble({ m, t }: { m: RealtyMessageDTO; t: (k: string, v?: any) => string }) {
  const out = m.direction === "OUTBOUND";
  const failed = m.status === "FAILED";
  const media = isRealtyWaMetaMedia(m.mediaUrl);

  return (
    <div style={{ display: "grid", justifyItems: out ? "end" : "start", gap: 3 }}>
      <div
        style={{
          maxWidth: "78%",
          padding: "8px 11px",
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: out ? "var(--brand-soft)" : "var(--bg-elev-2)",
          border: `1px solid ${failed ? "var(--danger)" : "var(--border-soft)"}`,
          color: "var(--text-1)",
        }}
      >
        {m.body ?? "—"}
        {media && (
          <a
            href={`/api/realty/whatsapp/media/${encodeURIComponent(m.id)}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 6,
              fontSize: 12,
              color: "var(--brand)",
            }}
          >
            <Paperclip size={12} />
            {t("inbox.openMedia")}
          </a>
        )}
      </div>

      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11,
          color: failed ? "var(--danger)" : "var(--text-4)",
        }}
      >
        {m.templateName && (
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <FileText size={10} />
            {t("inbox.viaTemplate")}
          </span>
        )}
        <span>{new Date(m.createdAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</span>
        {out && <DeliveryTick m={m} />}
      </span>

      {/* El motivo REAL, fuera de la burbuja para que no compita con el
          texto. Nunca se pinta "entregado" a un rechazo. */}
      {out && failed && (
        <span style={{ fontSize: 11, color: "var(--danger)", maxWidth: "78%", textAlign: out ? "right" : "left" }}>
          {m.errorCode ? `(#${m.errorCode}) ` : ""}
          {m.errorTitle ?? t("inbox.failed")}
        </span>
      )}
    </div>
  );
}

/**
 * La palomita dice la entrega REAL de Meta, no "el envío no lanzó".
 * PENDING/SENT = una palomita; DELIVERED = dos; READ = dos en verde;
 * FAILED = un aviso rojo. Las etiquetas salen del contrato
 * (REALTY_MESSAGE_STATUS_LABELS), no de un literal escrito aquí.
 */
function DeliveryTick({ m }: { m: RealtyMessageDTO }) {
  const label = REALTY_MESSAGE_STATUS_LABELS[m.status];
  const color = TONE_COLOR[REALTY_WA_STATUS_TONE[m.status]] ?? "var(--text-4)";

  if (m.status === "FAILED") {
    return (
      <span title={label} aria-label={label} style={{ color }}>
        <AlertCircle size={12} />
      </span>
    );
  }
  const Icon = m.status === "DELIVERED" || m.status === "READ" ? CheckCheck : Check;
  return (
    <span title={label} aria-label={label} style={{ color }}>
      <Icon size={12} />
    </span>
  );
}

// ── Configuración ──────────────────────────────────────────────────────

function SettingsView(props: any) {
  const {
    t,
    connection,
    quota,
    templates,
    templatesNote,
    busy,
    canSend,
    createTemplates,
    runDispatch,
  } = props;

  const utility = REALTY_WA_TEMPLATES.filter((x) => !x.optional).length;
  const marketing = REALTY_WA_TEMPLATES.length - utility;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title={t("settings.connectionTitle")} body={t("settings.connectionBody")}>
        {connection ? (
          <dl style={dlStyle}>
            <Row label={t("settings.state")} value={t(`settings.states.${connection.state}`)} />
            <Row label={t("settings.senderMode")} value={t(`settings.senders.${connection.senderMode}`)} />
            {connection.displayPhone && (
              <Row label={t("settings.number")} value={connection.displayPhone} />
            )}
            {connection.problem && (
              <Row label={t("settings.problem")} value={connection.problem} danger />
            )}
          </dl>
        ) : (
          <Empty icon={<Loader2 size={16} />} text={t("inbox.loading")} />
        )}
      </Card>

      <Card title={t("settings.quotaTitle")} body={t("settings.quotaBody")}>
        {quota ? (
          <>
            <dl style={dlStyle}>
              <Row
                label={t("settings.quotaLimit")}
                value={quota.limit < 0 ? t("settings.quotaUnlimited") : String(quota.limit)}
              />
              <Row label={t("settings.quotaUsed")} value={String(quota.used)} />
              <Row
                label={t("settings.quotaRemaining")}
                value={quota.limit < 0 ? t("settings.quotaUnlimited") : String(quota.remaining)}
              />
            </dl>
            {quota.exhausted && (
              <p style={{ fontSize: 12, color: "var(--danger)", margin: "8px 0 0" }}>
                {t("settings.quotaExhausted")}
              </p>
            )}
            {!quota.exhausted && quota.nearLimit && (
              <p style={{ fontSize: 12, color: "var(--text-2)", margin: "8px 0 0" }}>
                {t("settings.quotaNear")}
              </p>
            )}
          </>
        ) : (
          <Empty icon={<Loader2 size={16} />} text={t("inbox.loading")} />
        )}
      </Card>

      <Card
        title={t("settings.templatesTitle")}
        body={t("settings.templatesBody", { utility: String(utility), marketing: String(marketing) })}
      >
        {templatesNote && (
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 10px" }}>{templatesNote}</p>
        )}
        <ul style={{ display: "grid", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
          {templates.map((tpl: TemplateRow) => (
            <li
              key={tpl.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "7px 10px",
                borderRadius: 9,
                border: "1px solid var(--border-soft)",
                fontSize: 12,
              }}
            >
              <span style={{ display: "grid", gap: 1 }}>
                <strong style={{ color: "var(--text-1)" }}>{t(`kinds.${tpl.kind}`)}</strong>
                <code style={{ color: "var(--text-4)", fontSize: 11 }}>{tpl.name}</code>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--text-3)" }}>
                  {t(`settings.categories.${tpl.category}`)}
                </span>
                <span
                  style={{
                    color: tpl.status === "APPROVED" ? "var(--brand)" : "var(--text-3)",
                    fontWeight: 600,
                  }}
                >
                  {t(`settings.tplStatus.${tplStatusKey(tpl.status)}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        {canSend && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => createTemplates(false)}
              disabled={busy === "templates"}
              style={primaryBtn}
            >
              {busy === "templates" ? <Loader2 size={14} /> : <FileText size={14} />}
              {t("settings.createTemplates")}
            </button>
            <button
              type="button"
              onClick={() => createTemplates(true)}
              disabled={busy === "templates"}
              style={ghostBtn}
            >
              {t("settings.createTemplatesMarketing")}
            </button>
          </div>
        )}

        {/* El costo se ENSEÑA antes, no después. Y se dice que es una
            estimación de Meta, porque Meta cambia sus tarifas. */}
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: "12px 0 0" }}>
          {t("settings.costHint", {
            utility: REALTY_WA_PRICE_USD.UTILITY.toFixed(4),
            marketing: REALTY_WA_PRICE_USD.MARKETING.toFixed(4),
          })}
        </p>
      </Card>

      <Card title={t("settings.dispatchTitle")} body={t("settings.dispatchBody")}>
        {canSend && (
          <button type="button" onClick={runDispatch} disabled={busy === "dispatch"} style={primaryBtn}>
            {busy === "dispatch" ? <Loader2 size={14} /> : <Send size={14} />}
            {t("settings.dispatchRun")}
          </button>
        )}
      </Card>
    </div>
  );
}

// ── Piezas ─────────────────────────────────────────────────────────────

const dlStyle: React.CSSProperties = { display: "grid", gap: 6, margin: 0 };

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background: "var(--brand)",
  border: "1px solid var(--brand)",
  borderRadius: 10,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-2)",
  background: "transparent",
  border: "1px solid var(--border-soft)",
  borderRadius: 9,
  cursor: "pointer",
};

function Card({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        padding: 16,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "grid", gap: 3 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>{body}</p>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
      <dt style={{ color: "var(--text-3)" }}>{label}</dt>
      <dd style={{ margin: 0, color: danger ? "var(--danger)" : "var(--text-1)", fontWeight: 600 }}>
        {value}
      </dd>
    </div>
  );
}

function Empty({
  icon,
  text,
  hint,
}: {
  icon: React.ReactNode;
  text: string;
  hint?: string | null;
}) {
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 6, padding: 24, textAlign: "center" }}>
      <span style={{ color: "var(--text-4)" }}>{icon}</span>
      <span style={{ fontSize: 13, color: "var(--text-2)" }}>{text}</span>
      {hint && <span style={{ fontSize: 12, color: "var(--text-4)", maxWidth: 260 }}>{hint}</span>}
    </div>
  );
}
