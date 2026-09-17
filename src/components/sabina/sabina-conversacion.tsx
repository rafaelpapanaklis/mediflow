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
import { CLASES_PIEZAS_SABINA } from "@/components/dashboard/layout-rediseno/sabina";
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
function ThinkingIndicator({ startedAt, c = styles }: { startedAt: number; c?: Record<string, string> }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, []);
  const hint = SABINA_THINKING_HINTS[tick % SABINA_THINKING_HINTS.length];
  const lento = Date.now() - startedAt > SABINA_SLOW_HINT_MS;
  return (
    <div className={c.thinking} aria-live="polite">
      <span className={c.thinkingDots} aria-hidden>
        <i /><i /><i />
      </span>
      <span>{hint}</span>
      {lento && <span className={c.thinkingSlow}>Las preguntas abiertas tardan un poco más.</span>}
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
  /**
   * REDISEÑO (interruptor `menu-dos-niveles`): el juego de clases que eligió la
   * pantalla de Sabina (`CLASES_REDISENO` o `styles`, en `sabina-client.tsx`).
   * Sin él —el cajón lateral— se pintan las clases de siempre, tal cual.
   */
  clases?: Record<string, string>;
  /** Lo mismo para las tarjetas de confirmación, que traen su propio mapa. */
  rediseno?: boolean;
}

export function SabinaConversacion({
  firstName,
  apagada: apagadaAlEntrar = false,
  puedeProponer = false,
  compacto = false,
  autoFocus = false,
  clases,
  rediseno = false,
}: SabinaConversacionProps) {
  // Un solo juego de clases por render: el que baja la pantalla o el de siempre.
  const c: Record<string, string> = clases ?? styles;
  // Las piezas del hilo (contenido, rastro de herramientas, avisos) traen su
  // propia hoja: con la bandera se visten con `layout-rediseno/sabina.ts`;
  // sin ella no reciben nada y pintan las suyas de siempre.
  const piezas = rediseno ? CLASES_PIEZAS_SABINA : undefined;
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
      <div className={c.scroll}>
        <div className={c.scrollInner}>
          {openingConv ? (
            <div className={c.centerNotice}>
              <Loader2 size={16} aria-hidden className={c.spin} /> Abriendo conversación…
            </div>
          ) : activeFailed ? (
            <div className={c.centerNotice}>
              <CloudOff size={20} strokeWidth={1.75} aria-hidden />
              <span>No se pudo abrir esta conversación.</span>
              <button type="button" className={c.retryLink} onClick={nuevaConversacion}>
                <RotateCcw size={12} aria-hidden /> Empezar una nueva
              </button>
            </div>
          ) : empty && apagada ? (
            <div className={c.systemRow}>
              <SabinaErrorNotice kind="apagada" clases={piezas} />
            </div>
          ) : empty ? (
            <div className={c.welcome}>
              <div className={c.welcomeIcon}><Sparkles size={compacto ? 20 : 24} aria-hidden /></div>
              <h1 className={c.welcomeTitle}>Pregúntale a Sabina</h1>
              <p className={c.welcomeText}>
                {compacto
                  ? "Sabe en qué pantalla estás. Si tienes abierta la ficha de un paciente, no hace falta que le digas su nombre."
                  : "Sabina lee los datos de tu clínica y contesta con lo que encuentra — nunca inventa un número. Pregunta en lenguaje normal, como si le hablaras a tu recepcionista."}
              </p>
              <div className={c.suggestions}>
                {sugerencias.map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    className={c.suggestion}
                    onClick={() => {
                      escribir(s.text);
                      setTimeout(() => textareaRef.current?.focus(), 30);
                    }}
                  >
                    <span className={c.suggestionText}>{s.text}</span>
                    <span className={c.suggestionHint}>{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m: SabinaMessage) =>
              m.role === "system" ? (
                <div key={m.id} className={c.systemRow}>
                  <SabinaErrorNotice
                    kind={m.errorKind ?? "unknown"}
                    retrying={retryingId === m.id}
                    onRetry={() => reintentar(m.id, contextoDe())}
                    clases={piezas}
                  />
                </div>
              ) : (
                <div key={m.id} className={`${c.message} ${m.role === "user" ? c.messageUser : ""}`}>
                  <div className={m.role === "user" ? c.avatarUser : c.avatarSabina}>
                    {m.role === "user" ? (firstName ? firstName[0]?.toUpperCase() : "D") : <Sparkles size={13} aria-hidden />}
                  </div>
                  <div className={`${c.bubbleCol} ${m.propuestas?.length ? c.bubbleColWide : ""}`}>
                    <div className={c.bubble}>
                      {m.pending ? (
                        <ThinkingIndicator startedAt={m.timestamp} c={c} />
                      ) : m.role === "assistant" ? (
                        <SabinaMessageContent content={m.content || "—"} clases={piezas} />
                      ) : (
                        <p className={c.userText}>{m.content}</p>
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
                          rediseno={rediseno}
                        />
                      ))}
                    {!m.pending && m.role === "assistant" && <ToolTrace tools={m.herramientasUsadas} clases={piezas} />}
                    <span className={c.timestamp}>{formatTime(m.timestamp)}</span>
                  </div>
                </div>
              ),
            )
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className={c.composerWrap}>
        <div className={c.composerInner}>
          <div className={c.composerBox}>
            <textarea
              ref={textareaRef}
              className={c.textarea}
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
              className={c.sendBtn}
              onClick={() => ask(input)}
              disabled={!input.trim() || sending || bloqueado}
              aria-label="Preguntar"
            >
              <Send size={15} aria-hidden />
            </button>
          </div>
          <div className={c.composerHint}>
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
