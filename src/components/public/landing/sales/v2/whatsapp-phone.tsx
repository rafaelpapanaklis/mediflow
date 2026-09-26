"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Un teléfono con WhatsApp DE VERDAD (cabecera verde, globos con pico,
 * palomitas azules, «escribiendo…», el paciente tecleando abajo). Es el
 * teléfono del PACIENTE: lo que él escribe sale en verde a la derecha y lo que
 * manda la clínica llega en blanco a la izquierda.
 *
 * Ajuste 5 (Rafael): el teléfono ya no aparta una cita con anticipo; enseña
 * cómo la clínica COBRA TRATAMIENTOS por WhatsApp con Mercado Pago. Dos
 * historias que se alternan, una por vuelta (~10 s cada una):
 *   a) el pago de un implante dental;
 *   b) una mensualidad de ortodoncia (pago 4 de 12, plan de pago).
 * En las dos: la clínica manda el cobro con el link de Mercado Pago desde la
 * factura → el paciente paga → llega la confirmación.
 *
 * Hechos en los que se apoya (comprobados en el código): el link de pago sale
 * de la factura (api/invoices/[id]/send-whatsapp, `linkPago`); el pago cae en
 * la cuenta de Mercado Pago de la clínica y el webhook (kind "factura") lo
 * registra solo en la factura; existen planes de pago en mensualidades
 * (PaymentPlan, 12 por defecto).
 *
 * El guion es fijo (no hay servidor detrás) y el servidor pinta la primera
 * historia completa, así que sin JS se ve todo. Con prefers-reduced-motion se
 * queda completa y quieta.
 */

type Paso =
  | { de: "paciente"; texto: string; hora: string }
  | { de: "clinica"; texto: ReactNode; hora: string; mp?: { concepto: string; monto: string } };

export interface Historia {
  id: "implante" | "ortodoncia";
  pasos: Paso[];
}

const MP = ({ children }: { children: ReactNode }) => <span className="dcv4-wa__link">{children}</span>;

export const HISTORIAS: Historia[] = [
  {
    id: "implante",
    pasos: [
      { de: "paciente", texto: "Hola, ¿me mandan el cobro del implante? Quiero pagarlo hoy", hora: "10:12" },
      {
        de: "clinica",
        hora: "10:12",
        mp: { concepto: "Implante dental · Factura P-1024", monto: "$18,500.00 MXN" },
        texto: (
          <>
            ¡Claro, Arturo! Tu tratamiento: <b>Implante dental · $18,500</b>. Puedes pagarlo aquí: <MP>mpago.la/dc-5120</MP>
          </>
        ),
      },
      { de: "paciente", texto: "Listo, ya pagué ✅", hora: "10:14" },
      {
        de: "clinica",
        hora: "10:14",
        texto: (
          <>
            ¡Recibido! 🦷 Tu factura <b>P-1024</b> quedó al día. Te esperamos el jueves a las 10:30.
          </>
        ),
      },
    ],
  },
  {
    id: "ortodoncia",
    pasos: [
      { de: "paciente", texto: "Hola, ¿cuánto me toca este mes de la ortodoncia?", hora: "09:04" },
      {
        de: "clinica",
        hora: "09:05",
        mp: { concepto: "Ortodoncia · Mensualidad 4 de 12", monto: "$1,250.00 MXN" },
        texto: (
          <>
            Hola, Sofía 👋 Toca tu mensualidad de ortodoncia: <b>pago 4 de 12 · $1,250</b>. Link: <MP>mpago.la/dc-7733</MP>
          </>
        ),
      },
      { de: "paciente", texto: "Pagado ✅ ¿cuántas me quedan?", hora: "09:07" },
      {
        de: "clinica",
        hora: "09:07",
        texto: (
          <>
            ¡Gracias! <b>Mensualidad 4 de 12</b> registrada; te quedan 8. Te espero el 15 de octubre para el ajuste.
          </>
        ),
      },
    ],
  },
];

/** Cuántos mensajes van pintados y qué está pasando ahora mismo. */
interface Estado {
  historia: number;
  visibles: number;
  /** El paciente teclea el paso `visibles` (letras ya escritas). */
  typed: number;
  escribiendo: boolean;
  /** Palomitas azules hasta este índice (leído por la clínica). */
  leidos: number;
}

const completa = (h: number): Estado => ({ historia: h, visibles: HISTORIAS[h].pasos.length, typed: 0, escribiendo: false, leidos: HISTORIAS[h].pasos.length });
const vacia = (h: number): Estado => ({ historia: h, visibles: 0, typed: 0, escribiendo: false, leidos: 0 });

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WhatsappPhone({ onPaso }: { onPaso?: (historia: number, visibles: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [st, setSt] = useState<Estado>(() => completa(0));

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

  // Arranque: al entrar en pantalla la charla se vacía y empieza la primera historia.
  useEffect(() => {
    if (!started || reduced) return;
    const t = window.setTimeout(() => setSt(vacia(0)), 300);
    return () => window.clearTimeout(t);
  }, [started, reduced]);

  useEffect(() => {
    onPaso?.(st.historia, st.visibles);
  }, [st.historia, st.visibles, onPaso]);

  // La máquina de estados del guion (ritmo del ajuste 4: ~10 s por historia).
  useEffect(() => {
    if (!started || reduced) return;
    const pasos = HISTORIAS[st.historia].pasos;
    if (st.visibles === pasos.length) {
      // Historia completa: ~2 s para leerla y pasa a la OTRA historia.
      const t = window.setTimeout(() => setSt(vacia((st.historia + 1) % HISTORIAS.length)), 2200);
      return () => window.clearTimeout(t);
    }
    const paso = pasos[st.visibles];
    let t = 0;
    if (paso.de === "paciente") {
      if (st.typed < paso.texto.length) {
        const ch = paso.texto[st.typed];
        const pausa = ch === " " ? 46 : 26 + Math.round(Math.random() * 18);
        t = window.setTimeout(() => setSt((s) => ({ ...s, typed: s.typed + 1 })), st.typed === 0 ? 350 : pausa);
      } else {
        t = window.setTimeout(() => setSt((s) => ({ ...s, visibles: s.visibles + 1, typed: 0 })), 350);
      }
    } else if (!st.escribiendo) {
      // La clínica lo lee (palomitas azules) y se pone a escribir.
      t = window.setTimeout(() => setSt((s) => ({ ...s, escribiendo: true, leidos: s.visibles })), st.visibles === 0 ? 600 : 450);
    } else {
      t = window.setTimeout(() => setSt((s) => ({ ...s, visibles: s.visibles + 1, escribiendo: false, leidos: s.visibles + 1 })), paso.mp ? 1300 : 1000);
    }
    return () => window.clearTimeout(t);
  }, [started, reduced, st]);

  // La charla se mantiene abajo, como en el teléfono.
  useEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st.visibles, st.escribiendo]);

  const pasos = HISTORIAS[st.historia].pasos;
  const paso = pasos[st.visibles];
  const tecleando = paso && paso.de === "paciente" ? paso.texto.slice(0, st.typed) : "";
  const ultimo = pasos[Math.max(0, st.visibles - 1)];
  const horaStatus = (st.visibles > 0 ? ultimo.hora : pasos[0].hora).replace(/^0/, "");

  return (
    <div ref={box} className="dcv4-phone" aria-hidden="true">
      <div className="dcv4-phone__isla" />
      <div className="dcv4-phone__screen">
        {/* Barra de estado */}
        <div className="dcv4-wa__status">
          <span>{horaStatus}</span>
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
          {pasos.slice(0, st.visibles).map((p, i) => (
            <div key={`${st.historia}-${i}`} className={`dcv4-wa__row${p.de === "paciente" ? " is-out" : ""}`}>
              <span className={`dcv4-wa__bubble${p.de === "paciente" ? " is-out" : " is-in"}`}>
                <span className="dcv4-wa__text">{p.texto}</span>
                {p.de === "clinica" && p.mp && (
                  <span className="dcv4-wa__mp">
                    <span className="dcv4-wa__mplogo">
                      <svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><ellipse cx="15" cy="10" rx="14" ry="9.2" fill="#fff" /><path d="M6 10c3-3.6 6-3.6 9 0s6 3.6 9 0" fill="none" stroke="#009EE3" strokeWidth="2" strokeLinecap="round" /><path d="M4.5 12.5c3.5 4.2 7 4.2 10.5 0" fill="none" stroke="#009EE3" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </span>
                    <span className="dcv4-wa__mptx">
                      <b>{p.mp.concepto}</b>
                      <span>{p.mp.monto} · Pagas a: Clínica Altabrisa</span>
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
