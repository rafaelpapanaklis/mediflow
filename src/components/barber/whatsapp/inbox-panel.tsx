"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, MessageCircle, Paperclip, Send } from "lucide-react";
import { apiCall, Btn, Chip, EmptyState, ErrorText, useSaving } from "../team/admin-ui";
import {
  isBarberWaUnlimited,
  type BarberWaMessageDTO,
  type BarberWaQuotaDTO,
  type BarberWaThreadDTO,
} from "@/lib/barber/whatsapp-core";
import { formatWhen, prettyPhone, useWaT } from "./ui";
import s from "./whatsapp.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Bandeja de entrada.
//
// TRES DECISIONES QUE VIENEN DE LO QUE FALLÓ EN EL DENTAL:
//  1. El estado que se pinta es el REAL. Un mensaje que Meta rechazó se ve
//     "No se entregó" y CON EL MOTIVO. En el dental un recordatorio
//     rechazado se veía como entregado y la clínica creía que había llegado.
//  2. Archivar NUNCA borra. Es una marca con fecha; si el cliente vuelve a
//     escribir, la conversación reaparece sola.
//  3. La multimedia se sirve por proxy con el token del servidor, indexada
//     por el id del MENSAJE (no por el del archivo) y acotada por barbería:
//     una barbería no puede ver el archivo de otra ni con el id en la mano.
// ═══════════════════════════════════════════════════════════════════════

interface ThreadDetail {
  messages: BarberWaMessageDTO[];
  windowOpen: boolean;
  clientId: string | null;
  clientName: string | null;
}

export function InboxPanel({
  locale,
  canSend,
  quota,
}: {
  locale: string;
  canSend: boolean;
  quota: BarberWaQuotaDTO;
}) {
  const t = useWaT();
  const [archived, setArchived] = useState(false);
  const [threads, setThreads] = useState<BarberWaThreadDTO[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const { saving, error, setError, run } = useSaving();
  const listEnd = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async () => {
    setListError(null);
    try {
      const data = await apiCall<{ threads: BarberWaThreadDTO[] }>(
        `/api/barber/whatsapp/threads?archived=${archived ? "1" : "0"}`,
      );
      setThreads(data.threads);
      // Si el hilo abierto ya no está en la lista (se archivó), se cierra.
      setActive((current) =>
        current && data.threads.some((th) => th.phone === current) ? current : null,
      );
    } catch (e) {
      setListError(e instanceof Error ? e.message : t("errors.generic"));
    }
  }, [archived, t]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const loadDetail = useCallback(
    async (phone: string) => {
      setDetail(null);
      try {
        const data = await apiCall<ThreadDetail>(
          `/api/barber/whatsapp/messages?phone=${encodeURIComponent(phone)}`,
        );
        setDetail(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("errors.generic"));
      }
    },
    [setError, t],
  );

  useEffect(() => {
    if (active) void loadDetail(active);
  }, [active, loadDetail]);

  // El hilo se abre por abajo, como cualquier chat.
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [detail]);

  function send() {
    const body = draft.trim();
    if (!body || !active) return;
    void run(async () => {
      await apiCall("/api/barber/whatsapp/messages", {
        method: "POST",
        json: { phone: active, body },
      });
      setDraft("");
      await loadDetail(active);
      await loadThreads();
    });
  }

  function toggleArchive(phone: string, next: boolean) {
    void run(async () => {
      await apiCall("/api/barber/whatsapp/archive", {
        method: "POST",
        json: { phone, archived: next },
      });
      await loadThreads();
    });
  }

  const activeThread = threads.find((th) => th.phone === active) ?? null;
  const quotaOut = !isBarberWaUnlimited(quota.limit) && quota.exhausted;

  return (
    <div className={s.page}>
      <div className={s.rowActions}>
        <Btn variant={archived ? "primary" : "default"} size="sm" onClick={() => setArchived((v) => !v)}>
          {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {archived ? t("inbox.showActive") : t("inbox.showArchived")}
        </Btn>
        <span className={s.tplMeta}>{t("inbox.archiveNote")}</span>
      </div>

      <ErrorText>{listError}</ErrorText>

      <div className={s.inbox}>
        {/* ── Lista de hilos ────────────────────────────────────────── */}
        <div className={s.threadList}>
          {threads.length === 0 ? (
            <div className={s.empty}>{archived ? t("inbox.emptyArchived") : t("inbox.empty")}</div>
          ) : (
            threads.map((th) => (
              <button
                key={th.phone}
                type="button"
                className={[s.threadItem, th.phone === active ? s.threadActive : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setActive(th.phone)}
              >
                <span className={s.threadTop}>
                  <span className={s.threadName}>
                    {th.clientName ?? prettyPhone(th.phone)}
                  </span>
                  <span className={s.threadWhen}>{formatWhen(th.lastAt, locale)}</span>
                </span>
                <span className={s.threadPreview}>
                  {th.lastDirection === "OUTBOUND" ? `${t("inbox.you")}: ` : ""}
                  {th.lastBody ?? "—"}
                </span>
                {th.unread > 0 ? (
                  <span className={s.threadTop}>
                    <span className={s.tabBadge}>{th.unread}</span>
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>

        {/* ── Hilo abierto ──────────────────────────────────────────── */}
        <div className={s.thread}>
          {!active ? (
            <EmptyState icon={<MessageCircle size={22} />} title={t("inbox.pickThread")} />
          ) : (
            <>
              <div className={s.threadHead}>
                <div style={{ minWidth: 0 }}>
                  <div className={s.threadName}>
                    {detail?.clientName ?? activeThread?.clientName ?? prettyPhone(active)}
                  </div>
                  <div className={s.tplMeta}>
                    {detail?.clientName || activeThread?.clientName
                      ? prettyPhone(active)
                      : t("inbox.unknownClient")}
                  </div>
                </div>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => toggleArchive(active, !archived)}
                >
                  {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  {archived ? t("inbox.unarchive") : t("inbox.archive")}
                </Btn>
              </div>

              <div className={s.msgList}>
                {(detail?.messages ?? []).map((m) => (
                  <MessageBubble key={m.id} message={m} locale={locale} />
                ))}
                <div ref={listEnd} />
              </div>

              {detail && !detail.windowOpen ? (
                <div className={s.closedNote}>{t("inbox.windowClosed")}</div>
              ) : canSend && !quotaOut ? (
                <div className={s.composer}>
                  <textarea
                    className={s.composerInput}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("inbox.placeholder")}
                    rows={2}
                    onKeyDown={(e) => {
                      // Enter manda, Shift+Enter hace salto de línea — como
                      // en WhatsApp, que es donde tiene la mano el mostrador.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <Btn variant="primary" onClick={send} disabled={saving || !draft.trim()}>
                    <Send size={15} />
                    {saving ? t("inbox.sending") : t("inbox.send")}
                  </Btn>
                </div>
              ) : quotaOut ? (
                <div className={s.closedNote}>{t("quota.exhausted")}</div>
              ) : null}

              <ErrorText>{error}</ErrorText>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Una burbuja. El estado y el motivo del fallo van SIEMPRE con la verdad. */
function MessageBubble({ message, locale }: { message: BarberWaMessageDTO; locale: string }) {
  const t = useWaT();
  const out = message.direction === "OUTBOUND";
  const failed = message.status === "FAILED";
  const att = message.attachment;
  const src = `/api/barber/whatsapp/media/${encodeURIComponent(message.id)}`;

  return (
    <div className={[s.msg, out ? s.msgOut : s.msgIn].join(" ")}>
      <div
        className={[s.bubble, out ? s.bubbleOut : "", failed ? s.bubbleFailed : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {message.body}
        {att ? (
          att.kind === "image" ? (
            // <img> normal y no next/image: la fuente es nuestro proxy, no un
            // dominio que haya que meter en una allowlist.
            <a href={src} target="_blank" rel="noreferrer">
              <img className={s.thumb} src={src} alt={att.filename ?? ""} loading="lazy" />
            </a>
          ) : (
            <a className={s.attachment} href={src} target="_blank" rel="noreferrer">
              <Paperclip size={14} />
              {att.filename ?? t("inbox.openAttachment")}
            </a>
          )
        ) : null}
      </div>
      <div className={s.msgMeta}>
        <span>{formatWhen(message.createdAt, locale)}</span>
        {out ? <span>· {t(`status.${message.status}`)}</span> : null}
        {message.templateName ? (
          <Chip tone="muted">{t("inbox.template")}</Chip>
        ) : null}
      </div>
      {message.error ? <span className={s.msgError}>{message.error}</span> : null}
    </div>
  );
}
