"use client";

/**
 * EL HILO Y LA CAJA DE TEXTO — la única copia.
 *
 * Esto es lo que se ve de Sabina: los mensajes, las tarjetas de confirmación y
 * el composer. Lo pintan sus DOS puertas —la pantalla `/dashboard/sabina` y el
 * cajón lateral de cualquier pantalla del panel— y por eso vive aquí y no en
 * ninguna de las dos. El encargo de ws1-t1 lo dice con todas las letras: «si te
 * ves copiando el componente del chat, párate».
 *
 * El estado no está aquí: está en `./almacen`, fuera de React, para que las dos
 * puertas enseñen LA MISMA conversación (regla 3 del encargo). Este componente
 * solo pinta lo que lee y llama a las acciones del almacén.
 *
 * Los estilos se toman del módulo CSS de la pantalla de Sabina, sin moverlo:
 * hay otras terminales trabajando sobre esos archivos a la vez, y mover uno es
 * un choque garantizado para ellas.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, CloudOff, RotateCcw } from "lucide-react";
import {
  SABINA_SUGGESTIONS,
  SABINA_THINKING_HINTS,
  SABINA_SLOW_HINT_MS,
  SABINA_QUESTION_MAX_CHARS,
} from "@/components/sabina/sabina-core";
import { SabinaMessageContent } from "@/components/sabina/message-content";
import { ToolTrace } from "@/components/sabina/tool-trace";
import { SabinaErrorNotice } from "@/components/sabina/error-notice";
import { PropuestaCard } from "@/app/dashboard/sabina/propuesta-card";
import styles from "@/app/dashboard/sabina/sabina.module.css";
import {
  actuar,
  consultarPropuesta,
  escribir,
  nuevaConversacion,
  preguntar,
  reintentar,
  type SabinaMessage,
} from "./almacen";
import { useContextoSabina, useSabinaEstado } from "./use-sabina-chat";

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
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
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, []);
  const hint = SABINA_THINKING_HINTS[tick % SABINA_THINKING_HINTS.length];
  const lento = Date.now() - startedAt > SABINA_SLOW_HINT_MS;
  return (
    <div className={styles.thinking} aria-live="polite">
      <span className={styles.thinkingDots} aria-hidden>
        <i /><i /><i />
      </span>
      <span>{hint}</span>
      {lento && <span className={styles.thinkingSlow}>Las preguntas abiertas tardan un poco más.</span>}
    </div>
  );
}

export interface SabinaConversacionProps {
  firstName: string;
  /**
   * Lo que el SERVIDOR ya sabía al pintar la página: Sabina está apagada para
   * este usuario. Se suma a lo que diga el almacén (que se entera con el primer
   * 403) para que no haya un primer fotograma con la bienvenida y el composer
   * habilitados antes de que llegue el aviso.
   */
  apagada?: boolean;
  /** ¿El catálogo trae acciones? Cambia solo la línea de ayuda del composer. */
  puedeProponer?: boolean;
  /**
   * El cajón lateral: menos sugerencias y una bienvenida más corta. La
   * conversación es la misma; lo que cambia es cuánto sitio hay.
   */
  compacto?: boolean;
  /** Se llama al enfocar la caja de texto (el cajón la enfoca al abrirse). */
  autoFocus?: boolean;
}

export function SabinaConversacion({
  firstName,
  apagada: apagadaAlEntrar = false,
  puedeProponer = false,
  compacto = false,
  autoFocus = false,
}: SabinaConversacionProps) {
  const estado = useSabinaEstado();
  const contextoDe = useContextoSabina();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, sending, activeFailed, openingConv, retryingId, desfase, trabajando, dudosas } =
    estado;
  const apagada = apagadaAlEntrar || estado.apagada;
  // Mientras se recupera un hilo guardado, la caja de texto se bloquea: si no,
  // la pregunta escrita en esos milisegundos se pierde cuando vuelve el GET
  // (y ya se habría cobrado al monedero). Ver `preguntar` en ./almacen.
  const bloqueado = activeFailed || apagada || openingConv;

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
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // «Nueva conversación» se pulsa en el marco (la cabecera del cajón o la de la
  // pantalla), que no tiene el `ref` de la caja de texto. El almacén sube un
  // contador y el foco lo pone quien sí lo tiene: aquí.
  useEffect(() => {
    if (estado.foco > 0) textareaRef.current?.focus();
  }, [estado.foco]);

  const ask = useCallback(
    (raw: string) => {
      // El contexto se calcula AQUÍ, en el clic: es la pantalla en la que está
      // el dedo, no la que hubiera cuando se montó el componente.
      preguntar(raw, contextoDe());
    },
    [contextoDe],
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
  const sugerencias = compacto ? SABINA_SUGGESTIONS.slice(0, 2) : SABINA_SUGGESTIONS;

  return (
    <>
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
              <button type="button" className={styles.retryLink} onClick={nuevaConversacion}>
                <RotateCcw size={12} aria-hidden /> Empezar una nueva
              </button>
            </div>
          ) : empty && apagada ? (
            <div className={styles.systemRow}>
              <SabinaErrorNotice kind="apagada" />
            </div>
          ) : empty ? (
            <div className={styles.welcome}>
              <div className={styles.welcomeIcon}><Sparkles size={compacto ? 20 : 24} aria-hidden /></div>
              <h1 className={styles.welcomeTitle}>Pregúntale a Sabina</h1>
              <p className={styles.welcomeText}>
                {compacto
                  ? "Sabe en qué pantalla estás. Si tienes abierta la ficha de un paciente, no hace falta que le digas su nombre."
                  : "Sabina lee los datos de tu clínica y contesta con lo que encuentra — nunca inventa un número. Pregunta en lenguaje normal, como si le hablaras a tu recepcionista."}
              </p>
              <div className={styles.suggestions}>
                {sugerencias.map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    className={styles.suggestion}
                    onClick={() => {
                      escribir(s.text);
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
            messages.map((m: SabinaMessage) =>
              m.role === "system" ? (
                <div key={m.id} className={styles.systemRow}>
                  <SabinaErrorNotice
                    kind={m.errorKind ?? "unknown"}
                    retrying={retryingId === m.id}
                    onRetry={() => reintentar(m.id, contextoDe())}
                  />
                </div>
              ) : (
                <div key={m.id} className={`${styles.message} ${m.role === "user" ? styles.messageUser : ""}`}>
                  <div className={m.role === "user" ? styles.avatarUser : styles.avatarSabina}>
                    {m.role === "user" ? (firstName ? firstName[0]?.toUpperCase() : "D") : <Sparkles size={13} aria-hidden />}
                  </div>
                  <div className={`${styles.bubbleCol} ${m.propuestas?.length ? styles.bubbleColWide : ""}`}>
                    <div className={styles.bubble}>
                      {m.pending ? (
                        <ThinkingIndicator startedAt={m.timestamp} />
                      ) : m.role === "assistant" ? (
                        <SabinaMessageContent content={m.content || "—"} />
                      ) : (
                        <p className={styles.userText}>{m.content}</p>
                      )}
                    </div>
                    {!m.pending &&
                      m.role === "assistant" &&
                      m.propuestas?.map((p) => (
                        <PropuestaCard
                          key={p.id}
                          propuesta={p}
                          desfase={desfase}
                          ocupado={sending || (trabajando !== null && trabajando.id !== p.id)}
                          trabajando={trabajando?.id === p.id ? trabajando.tipo : null}
                          dudoso={dudosas.includes(p.id)}
                          onConfirmar={() => void actuar(p.id, "confirmar")}
                          onDescartar={() => void actuar(p.id, "descartar")}
                          onConsultar={() => void consultarPropuesta(p.id)}
                          onCaducar={() => void consultarPropuesta(p.id, true)}
                        />
                      ))}
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
              onChange={(e) => escribir(e.target.value)}
              onKeyDown={handleKey}
              disabled={bloqueado}
              rows={1}
            />
            <button
              type="button"
              className={styles.sendBtn}
              onClick={() => ask(input)}
              disabled={!input.trim() || sending || bloqueado}
              aria-label="Preguntar"
            >
              <Send size={15} aria-hidden />
            </button>
          </div>
          <div className={styles.composerHint}>
            {apagada
              ? "Sabina está apagada para tu usuario."
              : puedeProponer
              ? "Sabina propone; nada se hace hasta que tú lo confirmas en la tarjeta."
              : "Sabina solo lee datos — no agenda, no cobra, no edita nada."}
          </div>
        </div>
      </div>
    </>
  );
}
