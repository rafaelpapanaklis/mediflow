"use client";

// ═══════════════════════════════════════════════════════════════════════
// FIRMAR — /i/firmar/{token}. La pantalla que ve el que NO es cliente
// nuestro: un inquilino, un aval, un comprador. En su celular.
//
// ── LAS TRES DECISIONES QUE MANDAN AQUÍ ───────────────────────────────
// 1. EL DOCUMENTO COMPLETO, SIN RECORTES. Nada de "ver más" ni de un
//    resumen: si alguien va a quedar obligado por un texto, tiene que
//    poder leerlo entero en la misma pantalla donde firma. El papel de
//    esta pantalla NO tiene max-height (ver .sgn__paper).
//
// 2. EL TRAZO SE GUARDA COMO PUNTOS, NO COMO PÍXELES. Girar el teléfono
//    redimensiona el canvas y eso BORRA lo dibujado. Guardando los trazos
//    (x normalizada 0..1, y en píxeles sobre una caja de alto fijo) se
//    vuelven a pintar solos. Sin esto, media firma se pierde por girar la
//    mano y nadie entiende por qué.
//
// 3. LA CASILLA ES EL ACTO, NO EL SCROLL. Se pensó en detectar que
//    llegara al final del texto y se descartó: un documento corto no
//    dispara el observador, y quien no puede firmar tampoco puede
//    quejarse — se queda mirando un botón apagado. La casilla explícita
//    ("leí el documento completo y estoy de acuerdo") es lo que de verdad
//    vale como manifestación de voluntad, y nunca deja a nadie encerrado.
//
// 🔴 LA HORA DE LA FIRMA NO SALE DE AQUÍ. La pone el servidor. Un reloj de
// teléfono lo cambia cualquiera desde ajustes; una evidencia con la hora
// que dijo el firmante no prueba nada.
//
// 🔴 SE MANDA EL HASH QUE ESTA PANTALLA ENSEÑÓ (`seenHash`). Si el
// documento cambiara entre que se abre y que se firma, el servidor
// rechaza la firma: nadie firma algo distinto de lo que leyó.
//
// i18n CONVENCIÓN B: el servidor ya recortó el sub-árbol; prefijo VACÍO.
// El idioma es el de la INMOBILIARIA, no el del navegador: el documento
// está redactado en ese idioma y los botones tienen que ir a juego.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Eraser, PenLine, ShieldCheck } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { Note } from "../rentals/ui";
import "../rentals/rentals.css";
import "./contracts.css";
import type { PublicSigningDTO } from "./shared";

/** Alto fijo del recuadro, en CSS px. Tiene que coincidir con .sgn__canvas. */
const CANVAS_H = 190;

/** Un trazo = los puntos de un "dedo abajo → dedo arriba". */
type Punto = { x: number; y: number };

export function SignClient({
  dict,
  token,
  doc,
}: {
  dict: Dictionary;
  token: string;
  doc: PublicSigningDTO;
}) {
  const t = makeRealtyT(dict);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trazosRef = useRef<Punto[][]>([]);
  const dibujandoRef = useRef(false);

  const [hayTrazo, setHayTrazo] = useState(false);
  const [acepto, setAcepto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `previo` distingue "acabas de firmar" de "ya habías firmado": el texto
  // que corresponde es distinto y confundirlos hace dudar de si la firma se
  // registró dos veces. Quien ya firmó entra en modo lectura — la liga
  // caduca para FIRMAR, no para LEER: negarle su propio documento firmado
  // sería esconderle una prueba que es suya.
  const [listo, setListo] = useState<{ complete: boolean; previo: boolean } | null>(
    doc.signedAt ? { complete: doc.complete, previo: true } : null,
  );

  /** Repinta el canvas entero desde los trazos guardados. */
  const repintar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth || 1;
    const h = CANVAS_H;
    // Solo se redimensiona el búfer si cambió: asignar width/height LIMPIA
    // el canvas, así que hacerlo en cada repintado sería trabajo de más.
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    // setTransform y no scale: scale se ACUMULA en cada llamada.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#14201a";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const trazo of trazosRef.current) {
      if (trazo.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(trazo[0].x * w, trazo[0].y);
      for (let i = 1; i < trazo.length; i += 1) {
        ctx.lineTo(trazo[i].x * w, trazo[i].y);
      }
      // Un toque suelto (un punto) tiene que dejar marca: sin esto, una
      // firma hecha de puntitos no se ve.
      if (trazo.length === 1) ctx.lineTo(trazo[0].x * w + 0.6, trazo[0].y);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    repintar();
    window.addEventListener("resize", repintar);
    window.addEventListener("orientationchange", repintar);
    return () => {
      window.removeEventListener("resize", repintar);
      window.removeEventListener("orientationchange", repintar);
    };
  }, [repintar, listo]);

  function puntoDe(e: React.PointerEvent<HTMLCanvasElement>): Punto {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / w)),
      y: Math.min(CANVAS_H, Math.max(0, e.clientY - rect.top)),
    };
  }

  function abajo(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    // setPointerCapture: si el dedo se sale del recuadro a media firma, los
    // eventos siguen llegando aquí en vez de perderse.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* algún navegador viejo sin captura: se dibuja igual */
    }
    dibujandoRef.current = true;
    trazosRef.current.push([puntoDe(e)]);
    setHayTrazo(true);
    repintar();
  }

  function mueve(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujandoRef.current) return;
    e.preventDefault();
    const trazo = trazosRef.current[trazosRef.current.length - 1];
    if (!trazo) return;
    trazo.push(puntoDe(e));
    repintar();
  }

  function arriba() {
    dibujandoRef.current = false;
  }

  function limpiar() {
    trazosRef.current = [];
    setHayTrazo(false);
    repintar();
  }

  async function firmar() {
    if (enviando) return;
    setError(null);
    if (!hayTrazo) {
      setError(t("firmar.faltaTrazo"));
      return;
    }
    if (!acepto) {
      setError(t("firmar.faltaAcepto"));
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    setEnviando(true);
    try {
      const res = await fetch(`/api/realty/signatures/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stroke: canvas.toDataURL("image/png"),
          seenHash: doc.documentHash,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("comun.error"));
        return;
      }
      setListo({ complete: data.complete === true, previo: false });
    } catch {
      setError(t("comun.error"));
    } finally {
      setEnviando(false);
    }
  }

  const pdfUrl = `/api/realty/signatures/${encodeURIComponent(token)}/pdf`;

  return (
    <div className="sgn">
      <div className="sgn__wrap">
        <header className="sgn__head">
          <span className="sgn__brand">{t("firmar.brand")}</span>
          <h1 className="sgn__title">{doc.title}</h1>
          <div className="sgn__sub">
            {t("firmar.de", { inmobiliaria: doc.accountName })} · {t("firmar.folio")} {doc.folio}
          </div>
          <div className="sgn__sub">
            {t("firmar.eres", { nombre: doc.signerName, rol: t(`roles.${doc.signerRole}`) })}
          </div>
        </header>

        {listo ? (
          <div className="sgn__done">
            <div style={{ display: "grid", placeItems: "center", color: "var(--brand)" }}>
              <CheckCircle2 size={34} />
            </div>
            <div className="sgn__done-title">
              {listo.previo ? t("firmar.yaFirmaste") : t("firmar.listoTitle")}
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>
              {listo.complete ? t("firmar.listoCompleto") : t("firmar.listoFaltan")}
            </p>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--text-3)" }}>
              {t("firmar.listoBody")}
            </p>
            <div>
              <a className="rnt-btn rnt-btn--primary" href={pdfUrl} target="_blank" rel="noreferrer">
                <Download size={14} />
                {t("firmar.descargar")}
              </a>
            </div>
          </div>
        ) : (
          <p className="sgn__sub" style={{ margin: 0 }}>
            {t("firmar.lee")}
          </p>
        )}

        <article className="sgn__paper">{doc.body}</article>

        {doc.others.length > 0 ? (
          <section>
            <div className="sgn__sub" style={{ marginBottom: 6 }}>
              {t("firmar.otros")}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {doc.others.map((o, i) => (
                <li key={i}>
                  {o.name} — {t(`roles.${o.role}`)}:{" "}
                  {o.signed ? t("firmar.otrosFirmo") : t("firmar.otrosFalta")}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!listo ? (
          <section>
            <div className="sgn__sub" style={{ marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
              <PenLine size={14} />
              {t("firmar.traza")} — {t("firmar.trazaHint")}
            </div>
            <canvas
              ref={canvasRef}
              className="sgn__canvas"
              onPointerDown={abajo}
              onPointerMove={mueve}
              onPointerUp={arriba}
              onPointerCancel={arriba}
              onPointerLeave={arriba}
            />
            <div style={{ marginTop: 8 }}>
              <button type="button" className="rnt-btn rnt-btn--sm" onClick={limpiar} disabled={!hayTrazo}>
                <Eraser size={13} />
                {t("firmar.limpiar")}
              </button>
            </div>
          </section>
        ) : null}

        <section>
          <div className="sgn__sub" style={{ marginBottom: 4 }}>
            {t("firmar.huella")}
          </div>
          <div className="ctr-hash">{doc.documentHash}</div>
        </section>

        <section
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--text-3)",
          }}
        >
          <ShieldCheck size={16} style={{ flex: "none", marginTop: 2, color: "var(--brand)" }} />
          <p style={{ margin: 0 }}>{t("firmar.aviso")}</p>
        </section>

        {error ? <Note tone="danger">{error}</Note> : null}
      </div>

      {!listo ? (
        <div className="sgn__bar">
          <div className="sgn__bar-in">
            <label className="sgn__accept">
              <input
                type="checkbox"
                checked={acepto}
                onChange={(e) => setAcepto(e.target.checked)}
              />
              <span>{t("firmar.acepto")}</span>
            </label>
            <button
              type="button"
              className="rnt-btn rnt-btn--primary sgn__cta"
              onClick={firmar}
              disabled={enviando || !hayTrazo || !acepto}
            >
              {enviando ? t("firmar.firmando") : t("firmar.firmar")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
