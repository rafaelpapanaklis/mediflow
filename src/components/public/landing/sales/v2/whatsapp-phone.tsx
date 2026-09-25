"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Un teléfono con WhatsApp DE VERDAD (cabecera verde, globos con pico,
 * palomitas azules, «escribiendo…», el paciente tecleando abajo) que recorre
 * el guion del material: son las 11 de la noche, la clínica está cerrada y el
 * bot agenda la cita con un anticipo por Mercado Pago.
 *
 * Es el teléfono del PACIENTE: lo que él escribe sale en verde a la derecha y
 * lo que contesta el bot de la clínica llega en blanco a la izquierda.
 *
 * El guion es fijo (no hay servidor detrás) y el servidor pinta la charla
 * completa, así que sin JS se ve todo. El cliente sólo la reproduce paso a
 * paso y vuelve a empezar. Con prefers-reduced-motion se queda completa y
 * quieta.
 */

type Paso =
  | { de: "paciente"; texto: string; hora: string }
  | { de: "bot"; texto: ReactNode; hora: string; mp?: boolean };

const GUION: Paso[] = [
  { de: "paciente", texto: "Hola, me duele una muela desde ayer 😣", hora: "23:04" },
  {
    de: "bot",
    hora: "23:04",
    texto: (
      <>
        Lo siento 😕 ¿Te viene bien mañana? Me quedan <b>10:30 con la Dra. Ruiz</b> y <b>17:00 con el Dr. Marín</b>.
      </>
    ),
  },
  { de: "paciente", texto: "Mañana a las 10:30 está bien", hora: "23:05" },
  {
    de: "bot",
    hora: "23:05",
    mp: true,
    texto: (
      <>
        Perfecto. Para apartarla te dejo el anticipo de <b>$200</b>: <span className="dcv4-wa__link">mpago.la/dc-8241</span>
      </>
    ),
  },
  { de: "paciente", texto: "Listo, ya pagué ✅", hora: "23:07" },
  {
    de: "bot",
    hora: "23:07",
    texto: (
      <>
        ¡Gracias! Quedó agendada para <b>mañana 10:30</b> con la Dra. Ruiz 🦷 Te recuerdo un día antes.
      </>
    ),
  },
];

/** Cuántos mensajes van pintados y qué está pasando ahora mismo. */
interface Estado {
  visibles: number;
  /** El paciente teclea el paso `visibles` (letras ya escritas). */
  typed: number;
  escribiendo: boolean;
  /** Palomitas azules hasta este índice (leído por la clínica). */
  leidos: number;
}

const COMPLETO: Estado = { visibles: GUION.length, typed: 0, escribiendo: false, leidos: GUION.length };

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WhatsappPhone({ onPaso }: { onPaso?: (visibles: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [st, setSt] = useState<Estado>(COMPLETO);

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
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Arranque: al entrar en pantalla la charla se vacía y empieza de cero.
  useEffect(() => {
    if (!started || reduced) return;
    const t = window.setTimeout(() => setSt({ visibles: 0, typed: 0, escribiendo: false, leidos: 0 }), 300);
    return () => window.clearTimeout(t);
  }, [started, reduced]);

  useEffect(() => {
    onPaso?.(st.visibles);
  }, [st.visibles, onPaso]);

  // La máquina de estados del guion.
  useEffect(() => {
    if (!started || reduced) return;
    if (st.visibles === GUION.length) {
      // Charla completa: ~2 s para leerla y vuelta a empezar.
      const t = window.setTimeout(() => setSt({ visibles: 0, typed: 0, escribiendo: false, leidos: 0 }), 2000);
      return () => window.clearTimeout(t);
    }
    const paso = GUION[st.visibles];
    let t = 0;
    if (!paso) return;
    if (paso.de === "paciente") {
      if (st.typed < paso.texto.length) {
        // Un tecleo humano: algo irregular, más lento en los espacios.
        const ch = paso.texto[st.typed];
        // Ritmo del ajuste 4: la charla completa cabe en ~10 s.
        const pausa = ch === " " ? 42 : 22 + Math.round(Math.random() * 16);
        t = window.setTimeout(() => setSt((s) => ({ ...s, typed: s.typed + 1 })), st.typed === 0 ? 350 : pausa);
      } else {
        // Enviar: sale con palomita gris.
        t = window.setTimeout(() => setSt((s) => ({ ...s, visibles: s.visibles + 1, typed: 0 })), 250);
      }
    } else if (!st.escribiendo) {
      // El bot lo lee (palomitas azules) y se pone a escribir.
      t = window.setTimeout(() => setSt((s) => ({ ...s, escribiendo: true, leidos: s.visibles })), 350);
    } else {
      t = window.setTimeout(() => setSt((s) => ({ ...s, visibles: s.visibles + 1, escribiendo: false, leidos: s.visibles + 1 })), paso.mp ? 1000 : 850);
    }
    return () => window.clearTimeout(t);
  }, [started, reduced, st]);

  // La charla se mantiene abajo, como en el teléfono.
  useEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st.visibles, st.escribiendo]);

  const paso = GUION[st.visibles];
  const tecleando = paso && paso.de === "paciente" ? paso.texto.slice(0, st.typed) : "";

  return (
    <div ref={box} className="dcv4-phone" aria-hidden="true">
      <div className="dcv4-phone__isla" />
      <div className="dcv4-phone__screen">
        {/* Barra de estado */}
        <div className="dcv4-wa__status">
          <span>23:0{st.visibles >= 4 ? "7" : st.visibles >= 2 ? "5" : "4"}</span>
          <span className="dcv4-wa__statusr">
            <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor" aria-hidden="true"><rect x="0" y="6" width="2.4" height="4" rx=".6" /><rect x="3.8" y="4" width="2.4" height="6" rx=".6" /><rect x="7.6" y="2" width="2.4" height="8" rx=".6" /><rect x="11.4" y="0" width="2.4" height="10" rx=".6" /></svg>
            <svg width="22" height="10" viewBox="0 0 22 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x=".6" y=".6" width="18" height="8.8" rx="2.2" /><rect x="2.2" y="2.2" width="14" height="5.6" rx="1" fill="currentColor" stroke="none" /><rect x="19.6" y="3.2" width="1.8" height="3.6" rx=".6" fill="currentColor" stroke="none" /></svg>
          </span>
        </div>

        {/* Cabecera del chat */}
        <div className="dcv4-wa__head">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          <span className="dcv4-wa__avatar">CA</span>
          <span className="dcv4-wa__who">
            <span className="dcv4-wa__name">Clínica Altabrisa <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#25D366" /><path d="m7.5 12.5 3 3 6-7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="dcv4-wa__state">{st.escribiendo ? "escribiendo…" : "Cuenta de empresa"}</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M23 7 16 12l7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
        </div>

        {/* La charla */}
        <div ref={scroll} className="dcv4-wa__chat">
          <span className="dcv4-wa__day">Hoy</span>
          <span className="dcv4-wa__sys">🔒 Los mensajes están cifrados de extremo a extremo. Esta es una cuenta de empresa.</span>
          {GUION.slice(0, st.visibles).map((p, i) => (
            <div key={i} className={`dcv4-wa__row${p.de === "paciente" ? " is-out" : ""}`}>
              <span className={`dcv4-wa__bubble${p.de === "paciente" ? " is-out" : " is-in"}`}>
                <span className="dcv4-wa__text">{p.texto}</span>
                {p.de === "bot" && p.mp && (
                  <span className="dcv4-wa__mp">
                    <span className="dcv4-wa__mplogo">
                      <svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><ellipse cx="15" cy="10" rx="14" ry="9.2" fill="#fff" /><path d="M6 10c3-3.6 6-3.6 9 0s6 3.6 9 0" fill="none" stroke="#009EE3" strokeWidth="2" strokeLinecap="round" /><path d="M4.5 12.5c3.5 4.2 7 4.2 10.5 0" fill="none" stroke="#009EE3" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </span>
                    <span className="dcv4-wa__mptx">
                      <b>Anticipo de cita · $200.00 MXN</b>
                      <span>Pagas a: Clínica Altabrisa</span>
                      <span className="dcv4-wa__mpdom">mpago.la</span>
                    </span>
                  </span>
                )}
                <span className="dcv4-wa__meta">
                  {p.hora}
                  {p.de === "paciente" && (
                    <svg className={`dcv4-wa__ticks${i < st.leidos ? " is-read" : ""}`} width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m1 6 3 3 6-8" /><path d="m7 9 1 1 6-8" /></svg>
                  )}
                </span>
              </span>
            </div>
          ))}
          {st.escribiendo && (
            <div className="dcv4-wa__row">
              <span className="dcv4-wa__bubble is-in dcv4-wa__typing"><i /><i /><i /></span>
            </div>
          )}
        </div>

        {/* Caja de escritura */}
        <div className="dcv4-wa__bar">
          <span className="dcv4-wa__input">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M8 14.5s1.4 2 4 2 4-2 4-2" /><circle cx="9" cy="9.5" r=".8" fill="currentColor" /><circle cx="15" cy="9.5" r=".8" fill="currentColor" /></svg>
            <span className={tecleando ? "dcv4-wa__typed" : "dcv4-wa__ph"}>
              {tecleando || "Mensaje"}
              {tecleando && <i className="dcv4-wa__caret" />}
            </span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.4 11.05-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
            {!tecleando && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>}
          </span>
          <span className={`dcv4-wa__fab${tecleando ? " is-send" : ""}`}>
            {tecleando ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 22 12 3.4 3.6 3.4 10l12 2-12 2z" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /></svg>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
