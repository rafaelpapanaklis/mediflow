"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { registrarPaso } from "@/lib/analytics/embudo";
import {
  enlaceIniciarConversacion,
  normalizarNombre,
  normalizarNumeroWhatsapp,
} from "@/lib/landing/whatsapp-widget";
import { WHATSAPP_CTA } from "./landing-data";
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
  const primerCampo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        lanzador.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierto]);

  function alternar() {
    setAbierto((a) => !a);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (estado === "enviando") return;
    const n = normalizarNombre(nombre);
    const t = normalizarNumeroWhatsapp(numero);
    const nuevos = { nombre: "error" in n ? n.error : undefined, numero: "error" in t ? t.error : undefined };
    setErrores(nuevos);
    if ("error" in n || "error" in t) {
      (e.currentTarget.querySelector("[aria-invalid=true]") as HTMLElement | null)?.focus();
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
        setErrores(
          j.campo ? { [j.campo]: j.error } : { general: r.status === 429
            ? "Ya recibimos varias solicitudes. Intenta más tarde o toca «Iniciar conversación»."
            : j.error ?? "No pudimos enviar tu solicitud. Toca «Iniciar conversación» para escribirnos directo." },
        );
        return;
      }
      setEstado("listo");
    } catch {
      setEstado("idle");
      setErrores({ general: "No hay conexión. Revisa tu internet o toca «Iniciar conversación»." });
    }
  }

  return (
    <div className="dcv4-wawidget" data-abierto={abierto ? "" : undefined}>
      {abierto && (
        <div role="dialog" aria-labelledby={`${id}-t`} className="dcv4-wawidget__card">
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
              onClick={() => {
                setAbierto(false);
                lanzador.current?.focus();
              }}
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
              onClick={() => registrarPaso("whatsapp_clic")}
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
                  ref={primerCampo}
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
    </div>
  );
}
