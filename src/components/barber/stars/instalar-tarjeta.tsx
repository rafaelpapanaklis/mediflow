"use client";

import { useEffect, useRef, useState } from "react";
import { claveAvisoInstalar, decidirAvisoInstalar, type AvisoInstalar } from "@/lib/barber/tarjeta-instalar-aviso";

/* ═══════════════════════════════════════════════════════════════════════
   «Agrégala a tu pantalla de inicio» — el aviso amable de la tarjeta de
   estrellas (ws6-t2, punto 5).

   · Android / Chrome: cuando el navegador ofrece instalar
     (beforeinstallprompt) sale UN botón; al tocarlo, el diálogo del sistema.
   · iPhone / iPad: Safari no ofrece nada, así que se explica con un dibujo:
     Compartir → «Agregar a inicio».
   · Android sin oferta (otro navegador): la instrucción del menú ⋮.

   Se puede cerrar y no vuelve a salir (se recuerda en el teléfono, por
   barbería). Si la tarjeta ya corre como app, no sale nunca. Sin service
   worker: no hace falta para instalar y aquí no hay nada que guardar.

   Los textos llegan resueltos desde la página (servidor).
   ═══════════════════════════════════════════════════════════════════════ */

export interface InstalarLabels {
  title: string;
  body: string;
  button: string;
  close: string;
  iphoneStep1: string;
  iphoneStep2: string;
  androidStep1: string;
  androidStep2: string;
  done: string;
}

/** El evento de Chrome; no está en lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Cuánto se espera a que Android ofrezca instalar antes de explicar el menú. */
const ESPERA_OFERTA_MS = 3500;

function recordar(slug: string) {
  try {
    window.localStorage.setItem(claveAvisoInstalar(slug), "1");
  } catch {
    /* modo privado: se cierra solo por esta visita */
  }
}

function yaCerrado(slug: string): boolean {
  try {
    return window.localStorage.getItem(claveAvisoInstalar(slug)) === "1";
  } catch {
    return false;
  }
}

function yaInstalada(): boolean {
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function InstalarTarjeta({ slug, labels }: { slug: string; labels: InstalarLabels }) {
  // En el servidor (y hasta montar) no se pinta nada: el aviso depende del teléfono.
  const [aviso, setAviso] = useState<AvisoInstalar>(null);
  const [listo, setListo] = useState(false);
  const oferta = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let vivo = true;
    let esperaVencida = false;
    const decidir = () => {
      if (!vivo) return;
      setAviso(
        decidirAvisoInstalar({
          userAgent: window.navigator.userAgent,
          maxTouchPoints: window.navigator.maxTouchPoints,
          instalada: yaInstalada(),
          cerrado: yaCerrado(slug),
          ofrecida: oferta.current !== null,
          esperaVencida,
        }),
      );
    };
    const alOfrecer = (e: Event) => {
      // Sin esto Chrome enseña su propia barra; aquí el botón es el nuestro.
      e.preventDefault();
      oferta.current = e as BeforeInstallPromptEvent;
      decidir();
    };
    const alInstalar = () => {
      oferta.current = null;
      recordar(slug);
      if (vivo) {
        setAviso(null);
        setListo(true);
      }
    };
    window.addEventListener("beforeinstallprompt", alOfrecer);
    window.addEventListener("appinstalled", alInstalar);
    decidir();
    const t = window.setTimeout(() => {
      esperaVencida = true;
      decidir();
    }, ESPERA_OFERTA_MS);
    return () => {
      vivo = false;
      window.clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", alOfrecer);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, [slug]);

  const cerrar = () => {
    recordar(slug);
    setAviso(null);
  };

  const instalar = async () => {
    const ev = oferta.current;
    if (!ev) return;
    try {
      await ev.prompt();
      const r = await ev.userChoice;
      // La oferta es de un solo uso: aceptada o no, no se vuelve a insistir.
      oferta.current = null;
      recordar(slug);
      setAviso(null);
      if (r.outcome === "accepted") setListo(true);
    } catch {
      oferta.current = null;
      setAviso(null);
    }
  };

  if (listo) {
    return (
      <p className="dcb-instalar-listo" role="status">
        {labels.done}
      </p>
    );
  }
  if (!aviso) return null;

  return (
    <aside className="dcb-instalar" aria-label={labels.title}>
      <button type="button" className="dcb-instalar__cerrar" onClick={cerrar} aria-label={labels.close}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className="dcb-instalar__cab">
        <span className="dcb-instalar__ico" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" focusable="false">
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
          </svg>
        </span>
        <div>
          <p className="dcb-instalar__titulo">{labels.title}</p>
          <p className="dcb-instalar__texto">{labels.body}</p>
        </div>
      </div>

      {aviso === "boton" ? (
        <button type="button" className="dcb-btn dcb-btn--primary dcb-instalar__btn" onClick={() => void instalar()}>
          {labels.button}
        </button>
      ) : (
        <ol className="dcb-instalar__pasos">
          <li>
            <span className="dcb-instalar__dibujo" aria-hidden="true">
              {aviso === "iphone" ? <DibujoCompartir /> : <DibujoMenu />}
            </span>
            <span>{aviso === "iphone" ? labels.iphoneStep1 : labels.androidStep1}</span>
          </li>
          <li>
            <span className="dcb-instalar__dibujo" aria-hidden="true">
              <DibujoAgregar />
            </span>
            <span>{aviso === "iphone" ? labels.iphoneStep2 : labels.androidStep2}</span>
          </li>
        </ol>
      )}
    </aside>
  );
}

const trazo = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  focusable: "false" as const,
};

/** El botón «Compartir» de iPhone: un cuadro con una flecha hacia arriba. */
function DibujoCompartir() {
  return (
    <svg {...trazo}>
      <path d="M12 15V3.5" />
      <path d="M8 7l4-3.8L16 7" />
      <path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H16" />
    </svg>
  );
}

/** «Agregar a inicio»: un cuadro con un signo de más. */
function DibujoAgregar() {
  return (
    <svg {...trazo}>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

/** El menú de tres puntos de Android. */
function DibujoMenu() {
  return (
    <svg {...trazo} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="12" cy="19" r="1.9" />
    </svg>
  );
}
