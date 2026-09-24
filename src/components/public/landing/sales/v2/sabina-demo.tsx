"use client";

import { useEffect, useRef, useState } from "react";
import { IconoPanel } from "./icono-panel";
import { SABINA_COPY, SABINA_EJEMPLOS, type SabinaRespuesta } from "./sabina-data";

/**
 * La conversación con Sabina, como se ve dentro del panel.
 *
 * Es una SIMULACIÓN con guion (sabina-data.ts): el doctor teclea la pregunta,
 * aparece «pensando» y en ~2 s llega la respuesta con sus cifras y el «Miré: …».
 * No llama a ningún servidor ni a ninguna IA: el HTML del servidor trae la
 * primera respuesta ya pintada (sin JS se ve una conversación completa), y el
 * cliente sólo anima.
 *
 * Reglas:
 *  · arranca cuando la caja entra en pantalla, no antes;
 *  · recorre los 7 ejemplos solo hasta que el visitante toca una píldora:
 *    a partir de ahí manda él;
 *  · con prefers-reduced-motion no hay tecleo ni ciclo automático — cada
 *    píldora enseña su respuesta al instante;
 *  · el alto de la conversación está reservado (CSS), así que cambiar de
 *    pregunta no mueve la página.
 */

type Phase = "idle" | "typing" | "thinking" | "answer";
type EstadoPropuesta = "pendiente" | "hecha" | "descartada";

const HORA = "10:42 a.m.";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SabinaDemo() {
  const box = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [idx, setIdx] = useState(0);
  // El servidor pinta la primera respuesta completa; la animación empieza al
  // entrar en pantalla, desde la SEGUNDA pregunta, para que nunca haya hueco.
  const [phase, setPhase] = useState<Phase>("answer");
  const [typed, setTyped] = useState(0);
  const [auto, setAuto] = useState(true);
  const [propuesta, setPropuesta] = useState<EstadoPropuesta>("pendiente");

  const ejemplo = SABINA_EJEMPLOS[idx];

  useEffect(() => {
    setReduced(reducedMotion());
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // La máquina de estados: un temporizador por paso, siempre limpiado.
  useEffect(() => {
    if (!started) return;
    if (reduced) {
      // Sin movimiento: la respuesta sale de una vez y no hay ciclo.
      if (phase !== "answer") setPhase("answer");
      return;
    }
    let t = 0;
    if (phase === "idle") {
      t = window.setTimeout(() => {
        setTyped(0);
        setPhase("typing");
      }, 700);
    } else if (phase === "typing") {
      if (typed < ejemplo.q.length) {
        const ch = ejemplo.q[typed];
        const pausa = ch === " " ? 70 : ch === "," || ch === "¿" ? 140 : 34 + Math.round(Math.random() * 26);
        t = window.setTimeout(() => setTyped((n) => n + 1), pausa);
      } else {
        t = window.setTimeout(() => setPhase("thinking"), 520);
      }
    } else if (phase === "thinking") {
      t = window.setTimeout(() => setPhase("answer"), 1900);
    } else if (phase === "answer" && auto) {
      t = window.setTimeout(
        () => {
          setPropuesta("pendiente");
          setIdx((i) => (i + 1) % SABINA_EJEMPLOS.length);
          setPhase("idle");
        },
        ejemplo.a.kind === "propuesta" ? 9500 : 6800,
      );
    }
    return () => window.clearTimeout(t);
  }, [started, reduced, phase, typed, auto, idx, ejemplo]);

  // La caja tiene alto fijo y la tarjeta de propuesta es más alta que ella: la
  // conversación se mantiene abajo, como en el panel de verdad.
  useEffect(() => {
    const el = chat.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [phase, propuesta, idx]);

  function elige(i: number) {
    setAuto(false);
    setStarted(true);
    setPropuesta("pendiente");
    setIdx(i);
    if (reduced) {
      setPhase("answer");
    } else {
      setTyped(0);
      setPhase("typing");
    }
  }

  const enviado = phase === "thinking" || phase === "answer";
  const textoInput = phase === "typing" ? ejemplo.q.slice(0, typed) : "";

  return (
    <div ref={box} className="dcv4-sab">
        {/* Cabecera de la pantalla de Sabina */}
        <div className="dcv4-sab__head" aria-hidden="true">
          <IconoPanel nombre="history" size={20} className="dcv4-panel__dim" />
          <span className="dcv4-sab__brand">
            <span className="dcv4-sab__glyph"><IconoPanel nombre="auto_awesome" size={16} /></span>
            <span>
              <span className="dcv4-sab__title">Sabina</span>
              <span className="dcv4-sab__sub">{enviado ? ejemplo.q : "Hola, Dra. Ruiz"}</span>
            </span>
          </span>
          <span className="dcv4-sab__saldo"><IconoPanel nombre="account_balance_wallet" size={16} /> Saldo IA <b>$50.00</b></span>
          <IconoPanel nombre="add" size={20} className="dcv4-panel__dim" />
        </div>

        {/* Conversación (alto reservado en CSS) */}
        <div ref={chat} className="dcv4-sab__chat" aria-hidden="true">
          {enviado && (
            <div className="dcv4-sab__msg dcv4-sab__msg--user">
              <span className="dcv4-sab__avatar dcv4-sab__avatar--user">D</span>
              <span className="dcv4-sab__col">
                <span className="dcv4-sab__bubble dcv4-sab__bubble--user">{ejemplo.q}</span>
                <span className="dcv4-sab__time">{HORA}</span>
              </span>
            </div>
          )}

          {phase === "thinking" && (
            <div className="dcv4-sab__msg">
              <span className="dcv4-sab__avatar dcv4-sab__avatar--sab"><IconoPanel nombre="auto_awesome" size={15} /></span>
              <span className="dcv4-sab__thinking">
                <span className="dcv4-sab__dots"><i /><i /><i /></span>
                Pensando…
              </span>
            </div>
          )}

          {phase === "answer" && (
            <div className="dcv4-sab__msg dcv4-sab__msg--in">
              <span className="dcv4-sab__avatar dcv4-sab__avatar--sab"><IconoPanel nombre="auto_awesome" size={15} /></span>
              <span className="dcv4-sab__col dcv4-sab__col--wide">
                <Respuesta a={ejemplo.a} estado={propuesta} onConfirmar={() => { setAuto(false); setPropuesta("hecha"); }} onDescartar={() => { setAuto(false); setPropuesta("descartada"); }} />
                <span className="dcv4-sab__mire"><IconoPanel nombre="search" size={13} /> Miré: {ejemplo.mire}</span>
                <span className="dcv4-sab__time">{HORA}</span>
              </span>
            </div>
          )}
        </div>

        {/* Píldoras (las 7 preguntas, tocables) + caja de texto. Las píldoras
            son botones de verdad y quedan FUERA del aria-hidden. */}
        <div className="dcv4-sab__foot">
          <div className="dcv4-sab__chips" role="group" aria-label="Preguntas de ejemplo para Sabina">
            {SABINA_EJEMPLOS.map((e, i) => (
              <button
                key={e.id}
                type="button"
                className={`dcv4-sab__chip${i === idx ? " is-active" : ""}${e.a.kind === "propuesta" ? " is-action" : ""}`}
                aria-pressed={i === idx}
                onClick={() => elige(i)}
              >
                {e.a.kind === "propuesta" && <span aria-hidden="true">✦ </span>}
                {e.chip}
              </button>
            ))}
          </div>
          <div className={`dcv4-sab__input${phase === "typing" ? " is-typing" : ""}`} aria-hidden="true">
            <span className={textoInput ? "dcv4-sab__typed" : "dcv4-sab__ph"}>
              {textoInput || "Pregúntale algo a Sabina…"}
              {phase === "typing" && <i className="dcv4-sab__caret" />}
            </span>
            <span className={`dcv4-sab__send${textoInput ? " is-on" : ""}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>
            </span>
          </div>
          <p className="dcv4-sab__nota" aria-hidden="true">{SABINA_COPY.pie}</p>
        </div>
    </div>
  );
}

function Respuesta({
  a,
  estado,
  onConfirmar,
  onDescartar,
}: {
  a: SabinaRespuesta;
  estado: EstadoPropuesta;
  onConfirmar: () => void;
  onDescartar: () => void;
}) {
  if (a.kind === "lista") {
    return (
      <span className="dcv4-sab__bubble dcv4-sab__bubble--in">
        <span className="dcv4-sab__lead">{a.lead}</span>
        <span className="dcv4-sab__rows">
          {a.rows.map((r) => (
            <span key={r.label} className="dcv4-sab__row">
              <span>{r.label}</span>
              <b>{r.value}</b>
            </span>
          ))}
        </span>
        {a.foot && <span className="dcv4-sab__footline">{a.foot}</span>}
      </span>
    );
  }

  // Tarjeta de propuesta: réplica de propuesta-card.tsx (borde izquierdo de
  // marca, frase, detalles, avisos y los dos botones de 44 px).
  return (
    <span className="dcv4-sab__prop" data-estado={estado}>
      <span className="dcv4-sab__prophead">
        <span className="dcv4-sab__badge" data-estado={estado}>
          {estado === "pendiente" && <><IconoPanel nombre="auto_awesome" size={12} /> Propuesta · todavía no se hizo nada</>}
          {estado === "hecha" && <><IconoPanel nombre="check" size={12} /> Hecha</>}
          {estado === "descartada" && <><IconoPanel nombre="close" size={12} /> Descartada · no se hizo nada</>}
        </span>
        <span className="dcv4-sab__timer">caduca en 4:58</span>
      </span>
      <span className="dcv4-sab__propbody">
        <span className="dcv4-sab__proptitle">Agendar cita</span>
        <span className="dcv4-sab__propfrase">{estado === "hecha" ? a.hecha : a.frase}</span>
        {estado === "pendiente" && (
          <>
            <span className="dcv4-sab__det">
              {a.detalles.map((d) => (
                <span key={d.label} className="dcv4-sab__detrow">
                  <span>{d.label}</span>
                  <b>{d.value}</b>
                </span>
              ))}
            </span>
            <span className="dcv4-sab__propnota">{a.nota}</span>
            <span className="dcv4-sab__acciones">
              <button type="button" className="dcv4-sab__btn dcv4-sab__btn--ghost" onClick={onDescartar}>{a.cancelar}</button>
              <button type="button" className="dcv4-sab__btn dcv4-sab__btn--ok" onClick={onConfirmar}><IconoPanel nombre="check" size={16} /> {a.confirmar}</button>
            </span>
          </>
        )}
        {estado !== "pendiente" && (
          <span className="dcv4-sab__propnota">{estado === "hecha" ? "Ya está en la agenda. Se puede cancelar después desde ahí." : "Un «sí» escrito en el chat no confirma nada; solo el botón."}</span>
        )}
      </span>
    </span>
  );
}
