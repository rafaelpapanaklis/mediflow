"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { registrarPaso } from "@/lib/analytics/embudo";
import {
  enlaceIniciarConversacion,
  normalizarNombre,
  normalizarNumeroWhatsapp,
} from "@/lib/landing/whatsapp-widget";
import { WHATSAPP_CTA } from "./landing-data";
import { EVENTO_ABRIR_WHATSAPP } from "./whatsapp-widget-eventos";
import { WhatsappGlyph } from "./whatsapp-glyph";

/**
 * Botón flotante de WhatsApp de la portada y el blog (reemplaza al chat de
 * LiveChat). Abre una tarjeta con dos caminos:
 *  · «Iniciar conversación» → wa.me al número oficial (WHATSAPP_CTA): abre la
 *    app si la tiene, o WhatsApp Web si no.
 *  · «Te escribimos nosotros» → nombre + número; POST /api/public/whatsapp-lead
 *    avisa al equipo por correo (origen «whatsapp-widget»).
 *
 * El número sale de `WHATSAPP_CTA.numberE164`; aquí no se repite. En móvil el
 * botón se asienta sobre la barra fija (landing-v2.css, `.dcv4-wawidget`).
 */

type Estado = "idle" | "enviando" | "listo";

export function WhatsappWidget() {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<Estado>("idle");
  const [nombre, setNombre] = useState("");
  const [numero, setNumero] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [errores, setErrores] = useState<{ nombre?: string; numero?: string; general?: string }>({});
  const id = useId();
  const lanzador = useRef<HTMLButtonElement>(null);
  const campoNombre = useRef<HTMLInputElement>(null);
  const campoNumero = useRef<HTMLInputElement>(null);

  const tarjeta = useRef<HTMLDivElement>(null);
  /** Quien tenía el foco al abrir (el botón verde, o «WhatsApp» de la barra): ahí vuelve al cerrar. */
  const focoPrevio = useRef<HTMLElement | null>(null);
  /** Desde dónde se abrió: la barra de móvil registra su conversión con su propio origen. */
  const origenApertura = useRef<"barra_movil" | undefined>(undefined);
  /** En táctil NO se enfoca Nombre al abrir (sacaría el teclado y taparía «Iniciar conversación»). */
  const enfocarNombre = useRef(true);

  function abrir(opts: { origen?: "barra_movil"; conTeclado?: boolean } = {}) {
    focoPrevio.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    origenApertura.current = opts.origen;
    const tactil = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    enfocarNombre.current = !tactil || !!opts.conTeclado;
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
    // Si el botón verde está escondido (barra de móvil a la vista), el foco vuelve a quien abrió.
    const previo = focoPrevio.current;
    const visible = (el: HTMLElement | null) => !!el && el.isConnected && el.getClientRects().length > 0;
    (visible(previo) ? previo : visible(lanzador.current) ? lanzador.current : null)?.focus();
  }

  // Al abrir con ratón o teclado el foco va al primer campo (el botón va antes que la tarjeta en el DOM:
  // Tab sigue ahí); en táctil, a la propia tarjeta, sin teclado.
  useEffect(() => {
    if (!abierto) return;
    (enfocarNombre.current ? campoNombre.current : tarjeta.current)?.focus();
  }, [abierto]);

  // «WhatsApp» de la barra fija de móvil abre esta tarjeta.
  useEffect(() => {
    const alAbrir = (e: Event) => {
      e.preventDefault();
      const d = (e as CustomEvent<{ origen?: "barra_movil"; conTeclado?: boolean }>).detail;
      abrir({ origen: d?.origen, conTeclado: d?.conTeclado });
    };
    window.addEventListener(EVENTO_ABRIR_WHATSAPP, alAbrir);
    return () => window.removeEventListener(EVENTO_ABRIR_WHATSAPP, alAbrir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cerrar();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierto]);

  function alternar(e: React.MouseEvent) {
    if (abierto) cerrar();
    else abrir({ conTeclado: e.detail === 0 });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (estado === "enviando") return;
    const n = normalizarNombre(nombre);
    const t = normalizarNumeroWhatsapp(numero);
    const nuevos = { nombre: "error" in n ? n.error : undefined, numero: "error" in t ? t.error : undefined };
    setErrores(nuevos);
    if ("error" in n || "error" in t) {
      ("error" in n ? campoNombre : campoNumero).current?.focus();
      return;
    }
    setEstado("enviando");
    try {
      const r = await fetch("/api/public/whatsapp-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: (n as { nombre: string }).nombre,
          numero,
          empresa_web: honeypot,
          pagina: window.location.pathname,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; campo?: "nombre" | "numero" };
      if (!r.ok) {
        setEstado("idle");
        if (j.campo) (j.campo === "nombre" ? campoNombre : campoNumero).current?.focus();
        setErrores(
          j.campo ? { [j.campo]: j.error } : { general: j.error ?? "No pudimos enviar tu solicitud. Toca «Iniciar conversación» para escribirnos directo." },
        );
        return;
      }
      setEstado("listo");
      // Enviar el formulario es una conversación iniciada: aquí se registra la conversión.
      registrarPaso("whatsapp_clic", origenApertura.current ? { origen: origenApertura.current } : {});
    } catch {
      setEstado("idle");
      setErrores({ general: "No hay conexión. Revisa tu internet o toca «Iniciar conversación»." });
    }
  }

  return (
    // El botón va primero en el DOM (Tab entra a la tarjeta al abrirla); el CSS
    // (`column-reverse`) lo pinta debajo de ella.
    <div className="dcv4-wawidget" data-abierto={abierto ? "" : undefined}>
      <button
        ref={lanzador}
        type="button"
        className="dcv4-wawidget__fab"
        aria-expanded={abierto}
        aria-label={abierto ? "Cerrar WhatsApp" : "Escríbenos por WhatsApp"}
        onClick={alternar}
      >
        <WhatsappGlyph size={28} />
      </button>

      {abierto && (
        <div ref={tarjeta} tabIndex={-1} role="dialog" aria-labelledby={`${id}-t`} className="dcv4-wawidget__card">
          <div className="dcv4-wawidget__head">
            <span aria-hidden="true" className="dcv4-wawidget__avatar">
              <WhatsappGlyph size={22} />
            </span>
            <div style={{ minWidth: 0 }}>
              <p id={`${id}-t`} className="dcv4-wawidget__title">DaleControl por WhatsApp</p>
              <p className="dcv4-wawidget__sub">Te respondemos en cuanto podemos.</p>
            </div>
            <button
              type="button"
              className="dcv4-wawidget__close"
              aria-label="Cerrar"
              onClick={cerrar}
            >
              ×
            </button>
          </div>

          <div className="dcv4-wawidget__body">
            <a
              href={enlaceIniciarConversacion(WHATSAPP_CTA.numberE164)}
              target="_blank"
              rel="noopener noreferrer"
              className="dcv2-btn-wa dcv4-wawidget__start"
              onClick={() => registrarPaso("whatsapp_clic", origenApertura.current ? { origen: origenApertura.current } : {})}
            >
              <WhatsappGlyph size={19} />
              Iniciar conversación
            </a>

            <p className="dcv4-wawidget__or"><span>o</span></p>

            {estado === "listo" ? (
              <p role="status" className="dcv4-wawidget__ok">
                Listo, te escribimos por WhatsApp en breve.
              </p>
            ) : (
              <form onSubmit={enviar} noValidate>
                <p className="dcv4-wawidget__legend">Te escribimos nosotros</p>
                <label className="dcv4-wawidget__label" htmlFor={`${id}-n`}>Nombre</label>
                <input
                  ref={campoNombre}
                  id={`${id}-n`}
                  className="dcv4-wawidget__input"
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  aria-invalid={errores.nombre ? true : undefined}
                  aria-describedby={errores.nombre ? `${id}-ne` : undefined}
                />
                {errores.nombre && <p id={`${id}-ne`} className="dcv4-wawidget__err">{errores.nombre}</p>}

                <label className="dcv4-wawidget__label" htmlFor={`${id}-w`}>Número de WhatsApp</label>
                <input
                  ref={campoNumero}
                  id={`${id}-w`}
                  className="dcv4-wawidget__input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="999 123 4567"
                  maxLength={24}
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  aria-invalid={errores.numero ? true : undefined}
                  aria-describedby={errores.numero ? `${id}-we` : undefined}
                />
                {errores.numero && <p id={`${id}-we`} className="dcv4-wawidget__err">{errores.numero}</p>}

                {/* Honeypot: una persona no lo ve ni llega con el teclado. */}
                <div aria-hidden="true" className="dcv4-wawidget__hp">
                  <label>
                    Sitio web
                    <input
                      type="text"
                      name="empresa_web"
                      tabIndex={-1}
                      autoComplete="off"
                      value={honeypot}
                      onChange={(e) => setHoneypot(e.target.value)}
                    />
                  </label>
                </div>

                {errores.general && <p role="alert" className="dcv4-wawidget__err">{errores.general}</p>}

                <button type="submit" className="dcv4-wawidget__send" disabled={estado === "enviando"}>
                  {estado === "enviando" ? "Enviando…" : "Enviar"}
                </button>
                <p className="dcv4-wawidget__fine">
                  Usamos tu nombre y número solo para escribirte.{" "}
                  <a href="/privacidad">Aviso de privacidad</a>
                </p>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
