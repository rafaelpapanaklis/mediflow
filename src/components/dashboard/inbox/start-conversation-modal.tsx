"use client";

// "Iniciar conversación" — el único punto del producto desde el que la clínica
// puede ESCRIBIR PRIMERO por WhatsApp.
//
// Se monta desde dos sitios y es el MISMO componente a propósito: la ficha del
// paciente (con el paciente ya fijado) y el "+ Componer" del Inbox (que empieza
// pidiendo elegirlo). Dos modales distintos habrían acabado divergiendo justo en
// lo que no puede divergir: qué se le puede mandar a alguien y qué le cuesta.
//
// EL FLUJO NO ES UN CAPRICHO DE DISEÑO, ES LA REGLA DE META: a quien nunca ha
// escrito —o cuya ventana de 24 h ya cerró— WhatsApp solo le entrega una
// PLANTILLA APROBADA. Por eso aquí no hay recuadro de texto libre: se elige
// paciente → plantilla aprobada → se ve el texto EXACTO → se envía.
//
// Cada plantilla se la cobra Meta a la clínica, así que nada se dispara solo:
// pulsar un chip solo enseña el texto, y el envío es un segundo clic explícito.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Send, User } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { isAbortError } from "@/lib/fetch-safe";
import type { InboxTemplateOption } from "@/lib/inbox/composer-templates";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import styles from "./start-conversation.module.css";

/** Paciente elegido (o fijado por quien monta el modal). */
export interface ComposeTarget {
  id: string;
  name: string;
  phone?: string | null;
}

/** Respuesta de GET /api/inbox/compose. */
interface ComposePayload {
  patient: { id: string; name: string | null; firstName: string; phone: string | null } | null;
  /** Conversación que YA existe con este paciente, o null. */
  threadId: string | null;
  windowOpen: boolean;
  waConnected: boolean;
  billingOk: boolean;
  options: InboxTemplateOption[];
  /** Por qué HOY no se puede mandar ninguna, o null si alguna sirve. */
  unavailableReason: string | null;
  manageHref: string;
}

/** Un resultado de /api/patients/search. */
interface PatientHit {
  id: string;
  name: string;
  phone: string | null;
}

export interface StartConversationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Paciente de partida. Sin él, el modal empieza por el buscador (es el caso
   * del "+ Componer" del Inbox).
   */
  patient?: ComposeTarget | null;
  /**
   * `true` = el destinatario NO se puede cambiar. Es el caso de la ficha: ahí
   * el paciente es el de la ficha, y ofrecer "cambiar" invitaría a mandarle el
   * mensaje a otra persona desde el expediente de esta.
   */
  lockPatient?: boolean;
  /**
   * Se llama al enviar con éxito. `threadId` puede venir null si el mensaje
   * salió pero el registro en el Inbox falló: quien lo reciba debe tolerarlo y
   * no navegar a ninguna parte, nunca dar el envío por fallido.
   */
  onSent?: (threadId: string | null) => void;
  /** Abrir una conversación que ya existía, sin enviar nada. */
  onOpenThread?: (threadId: string) => void;
}

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

export function StartConversationModal({
  open,
  onOpenChange,
  patient = null,
  lockPatient = false,
  onSent,
  onOpenThread,
}: StartConversationModalProps) {
  const t = useT();

  // Paciente destino. Mientras haya uno, el buscador ni se monta.
  const [target, setTarget] = useState<ComposeTarget | null>(patient);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [data, setData] = useState<ComposePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<InboxTemplateOption | null>(null);
  const [sending, setSending] = useState(false);

  // Candado del doble clic en el propio navegador. El estado `sending` ya
  // deshabilita el botón, pero un segundo clic disparado ANTES del re-render
  // pasaría igual — y Meta cobraría las dos plantillas. El servidor tiene su
  // propio candado; este evita hasta la petición.
  const sendingRef = useRef(false);

  /* El paciente de partida viaja por un ref, y el efecto de abajo depende de su
     ID, no del objeto.
     POR QUÉ: quien monta el modal pasa `patient={{ id, name, phone }}` en el
     propio JSX, así que es un objeto NUEVO en cada render del padre. Con el
     objeto en las dependencias, cualquier re-render de la ficha (o del Inbox)
     volvería a correr el reinicio y borraría la plantilla ya elegida debajo de
     los dedos de quien estaba a punto de enviarla. */
  const initialPatientRef = useRef<ComposeTarget | null>(patient);
  initialPatientRef.current = patient;
  const initialPatientId = patient?.id ?? null;

  /* Cada apertura empieza limpia. Sin esto, al reabrir se vería la plantilla
     elegida —y su vista previa con los datos— de la sesión anterior, que puede
     ser de OTRO paciente. */
  useEffect(() => {
    if (!open) return;
    setTarget(initialPatientRef.current);
    setQuery("");
    setHits(null);
    setSearching(false);
    setData(null);
    setLoadError(null);
    setChosen(null);
    setSending(false);
    sendingRef.current = false;
  }, [open, initialPatientId]);

  /* ── Buscador de paciente (solo mientras no hay destinatario) ── */
  useEffect(() => {
    if (!open || target) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setHits(null);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/patients/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((json) => {
          if (cancelled) return;
          setHits(Array.isArray(json?.hits) ? (json.hits as PatientHit[]) : []);
        })
        .catch((err: unknown) => {
          // Cancelar no es fallar. Un error de red deja la lista vacía: el
          // buscador es un atajo, no la vía crítica.
          if (cancelled || isAbortError(err)) return;
          setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [open, target, query]);

  /* ── Qué se le puede mandar a este paciente ── */
  const targetId = target?.id ?? null;
  useEffect(() => {
    if (!open || !targetId) {
      setData(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setData(null);
    setChosen(null);

    fetch(`/api/inbox/compose?patientId=${encodeURIComponent(targetId)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || t("inbox.compose.loadFailed"));
        if (cancelled) return;
        // Se normaliza en la puerta: un 200 con el cuerpo a medias reventaría el
        // render al hacer options.map, y tumbar la ficha entera por esto sería
        // un precio absurdo.
        setData({
          patient: json?.patient ?? null,
          threadId: json?.threadId ?? null,
          windowOpen: !!json?.windowOpen,
          waConnected: !!json?.waConnected,
          billingOk: !!json?.billingOk,
          options: Array.isArray(json?.options) ? (json.options as InboxTemplateOption[]) : [],
          unavailableReason: json?.unavailableReason ?? null,
          manageHref: typeof json?.manageHref === "string" ? json.manageHref : "",
        });
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return;
        setLoadError(err instanceof Error ? err.message : t("inbox.compose.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [open, targetId, t]);

  const displayName = data?.patient?.name?.trim() || target?.name || "";
  const displayPhone = data?.patient?.phone ?? target?.phone ?? null;

  const send = useCallback(async () => {
    if (!targetId || !chosen || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch("/api/inbox/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: targetId, kind: chosen.kind }),
      });
      const json = await res.json().catch(() => ({}));
      // El servidor ya devuelve el motivo en español: se muestra tal cual, nunca
      // el error crudo de Meta ni un genérico que no dice qué arreglar.
      if (!res.ok) throw new Error(json?.error || t("inbox.compose.failed"));
      toast.success(t("inbox.compose.sent", { name: displayName }));
      onOpenChange(false);
      onSent?.(typeof json?.threadId === "string" ? json.threadId : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("inbox.compose.failed"));
      // Solo se libera al FALLAR: tras un envío correcto el modal se cierra, y
      // reabrirlo reinicia el candado.
      sendingRef.current = false;
      setSending(false);
    }
  }, [targetId, chosen, t, displayName, onOpenChange, onSent]);

  const openExisting = useCallback(() => {
    const id = data?.threadId;
    if (!id) return;
    onOpenChange(false);
    onOpenThread?.(id);
  }, [data, onOpenChange, onOpenThread]);

  /** Sufijo corto del chip apagado: un chip muerto sin motivo no se entiende. */
  const stateSuffix = (state: InboxTemplateOption["state"]): string | null => {
    if (state === "pending") return t("inbox.client.tplStatePending");
    if (state === "rejected") return t("inbox.client.tplStateRejected");
    if (state === "missing") return t("inbox.client.tplStateMissing");
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="mb-1">{t("inbox.compose.title")}</DialogTitle>
          <p className="text-xs text-muted-foreground mb-4">{t("inbox.compose.rule")}</p>
        </DialogHeader>

        <div className={`${styles.body} flex-1 overflow-y-auto min-h-0`}>
          {/* ── Destinatario ── */}
          {target ? (
            <div className={styles.target}>
              <span className={styles.targetIcon}>
                <User size={15} strokeWidth={2} aria-hidden />
              </span>
              <span className={styles.targetText}>
                <span className={styles.targetName}>{displayName}</span>
                <span className={styles.targetPhone}>
                  {displayPhone || t("inbox.compose.noPhoneShort")}
                </span>
              </span>
              {/* Desde la ficha el destinatario ES el paciente de la ficha, así
                  que no se ofrece cambiarlo; desde el Inbox sí. */}
              {!lockPatient && (
                <button
                  type="button"
                  className={styles.targetChange}
                  onClick={() => {
                    setTarget(null);
                    setChosen(null);
                  }}
                  disabled={sending}
                >
                  {t("inbox.compose.change")}
                </button>
              )}
            </div>
          ) : (
            <div>
              <label className={styles.fieldLabel} htmlFor="dc-compose-search">
                {t("inbox.compose.pickPatient")}
              </label>
              <div className="relative">
                <Search
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="dc-compose-search"
                  className="pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("inbox.compose.searchPlaceholder")}
                  autoComplete="off"
                />
              </div>
              {query.trim().length < MIN_QUERY ? (
                <div className={styles.searchNote}>{t("inbox.compose.searchHint")}</div>
              ) : searching ? (
                <div className={styles.searchNote}>{t("inbox.compose.searching")}</div>
              ) : hits && hits.length === 0 ? (
                <div className={styles.searchNote}>{t("inbox.compose.noResults")}</div>
              ) : hits ? (
                <ul className={styles.hits}>
                  {hits.map((h) => {
                    const noPhone = !h.phone || !h.phone.trim();
                    return (
                      <li key={h.id}>
                        {/* Sin teléfono no hay WhatsApp posible: el renglón se
                            queda apagado y lo dice, en vez de desaparecer y
                            hacer creer que el paciente no existe. */}
                        <button
                          type="button"
                          className={styles.hit}
                          disabled={noPhone}
                          title={noPhone ? t("inbox.compose.noPhoneOption", { name: h.name }) : undefined}
                          onClick={() => setTarget({ id: h.id, name: h.name, phone: h.phone })}
                        >
                          <span className={styles.hitName}>{h.name}</span>
                          {noPhone ? (
                            <span className={styles.hitNoPhone}>{t("inbox.compose.noPhoneBadge")}</span>
                          ) : (
                            <span className={styles.hitPhone}>{h.phone}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          )}

          {/* ── Plantillas del paciente elegido ── */}
          {target && loading && (
            <div className={`${styles.note} ${styles.noteInfo}`}>{t("inbox.compose.loading")}</div>
          )}

          {target && !loading && loadError && (
            <div className={`${styles.note} ${styles.noteWarn}`}>{loadError}</div>
          )}

          {target && !loading && !loadError && data && (
            <>
              {/* Ya hay conversación: mejor abrirla que abrir otra puerta. Se
                  sigue pudiendo mandar la plantilla desde aquí. */}
              {data.threadId && onOpenThread && (
                <div className={`${styles.note} ${styles.noteInfo} ${styles.existingRow}`}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {t("inbox.compose.existingThread", { name: displayName })}
                  </span>
                  <button type="button" className={styles.existingBtn} onClick={openExisting}>
                    {t("inbox.compose.openExisting")}
                  </button>
                </div>
              )}

              {/* Dentro de la ventana de 24 h el mensaje sale como texto normal
                  y NO cuesta. Decirlo cambia la decisión de quien lo manda.

                  Se muestra TAMBIÉN cuando no hay ninguna plantilla enviable:
                  ese aviso habla de Meta y de la ventana cerrada, y dejarlo solo
                  mandaría a la clínica a arreglar plantillas cuando ahora mismo
                  puede escribirle a este paciente sin ninguna. */}
              {data.windowOpen && (
                <div className={`${styles.note} ${styles.noteOk}`}>
                  {t("inbox.compose.windowOpenNote", { name: displayName })}
                </div>
              )}

              {data.unavailableReason ? (
                <div className={`${styles.note} ${styles.noteWarn}`}>
                  {data.unavailableReason}{" "}
                  {data.manageHref && (
                    <Link href={data.manageHref} className={styles.noteLink}>
                      {t("inbox.client.tplManage")}
                    </Link>
                  )}
                </div>
              ) : (
                <div>
                  <span className={styles.fieldLabel}>{t("inbox.compose.chooseTemplate")}</span>
                  <div className={styles.chips}>
                    {data.options.map((opt) => {
                      const blocked = opt.blockedReason !== null;
                      const suffix = blocked ? stateSuffix(opt.state) : null;
                      const isChosen = chosen !== null && chosen.kind === opt.kind;
                      return (
                        <button
                          key={opt.kind}
                          type="button"
                          className={`${styles.chip} ${isChosen ? styles.chipChosen : ""}`}
                          disabled={blocked || sending}
                          title={opt.blockedReason ?? undefined}
                          onClick={() => setChosen(opt)}
                        >
                          {t(opt.labelKey)}
                          {suffix && <span className={styles.chipState}> · {suffix}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {!data.windowOpen && (
                    <div className={styles.searchNote}>{t("inbox.compose.costNote")}</div>
                  )}
                </div>
              )}

              {chosen?.preview && (
                <div className={styles.preview}>
                  <div className={styles.previewTitle}>{t("inbox.compose.previewTitle")}</div>
                  <div className={styles.previewBody}>{chosen.preview}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* El pie queda FUERA del área que scrollea (contrato de DialogContent):
            en laptops de poca altura el botón de enviar no puede quedarse debajo
            del borde de la pantalla. */}
        <DialogFooter className={styles.footerHost}>
          <div className={styles.footer}>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
              {t("inbox.compose.cancel")}
            </Button>
            <Button onClick={send} disabled={!chosen || sending || loading}>
              {sending ? (
                t("inbox.compose.sending")
              ) : (
                <>
                  <Send size={14} strokeWidth={2} aria-hidden />
                  {t("inbox.compose.send")}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
