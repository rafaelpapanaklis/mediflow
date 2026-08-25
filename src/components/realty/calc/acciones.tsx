"use client";

// ═══════════════════════════════════════════════════════════════════════
// Qué se hace con un resultado: copiarlo, mandarlo por WhatsApp, bajarlo en
// PDF y —la que de verdad importa— guardarlo en la bitácora del prospecto.
//
// El texto que se comparte lo arma cada calculadora y llega aquí ya hecho:
// así el mensaje de WhatsApp, el PDF y la bitácora dicen EXACTAMENTE lo
// mismo, y la leyenda de "esto es un estimado" viaja pegada en los tres.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { Check, Copy, Download, MessageCircle, Search, UserPlus, X } from "lucide-react";
import { Boton } from "./ui";

export interface ProspectoLite {
  id: string;
  nombre: string;
  telefono: string | null;
  etapa: string;
}

export interface AccionesTextos {
  guardar: string;
  guardando: string;
  guardado: string;
  compartir: string;
  copiar: string;
  copiado: string;
  pdf: string;
  generandoPdf: string;
  buscarTitulo: string;
  buscarLabel: string;
  sinResultados: string;
  escribeAlgo: string;
  cancelar: string;
  errorGenerico: string;
}

/**
 * `texto` es el resultado ya redactado en español, listo para pegarse en
 * cualquier lado. `pdf` es lo que se manda a la ruta que lo dibuja.
 */
export function AccionesResultado({
  texto,
  titulo,
  pdf,
  textos,
}: {
  texto: string;
  titulo: string;
  pdf: Record<string, unknown>;
  textos: AccionesTextos;
}) {
  const [copiado, setCopiado] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const copiadoTimer = useRef<number | null>(null);
  // Estable: el efecto de Escape del modal lo lleva en sus dependencias, y una
  // flecha nueva por render lo hacía quitar y volver a poner el listener sin
  // parar.
  const cerrar = useCallback(() => setAbierto(false), []);

  useEffect(() => {
    return () => {
      if (copiadoTimer.current !== null) window.clearTimeout(copiadoTimer.current);
    };
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      if (copiadoTimer.current !== null) window.clearTimeout(copiadoTimer.current);
      copiadoTimer.current = window.setTimeout(() => setCopiado(false), 1800);
    } catch {
      toast.error(textos.errorGenerico);
    }
  }

  // Sin número: wa.me sin destinatario abre el selector de contacto, que es
  // justo lo que hace falta cuando el asesor todavía no sabe a quién se lo
  // manda. Cuando T6 conecte el inbox, este botón cambia de destino sin
  // tocar el texto.
  const waHref = `https://wa.me/?text=${encodeURIComponent(texto)}`;

  async function descargarPdf() {
    setBajando(true);
    try {
      const res = await fetch("/api/realty/calc/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pdf),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? textos.errorGenerico);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Se quitan los acentos ANTES del filtro: \w es ASCII, así que sin este
      // paso "Ciudad de México" salía como "ciudad-de-mxico.pdf".
      a.download = `${titulo
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revocar en el mismo tick aborta la descarga en Firefox y Safari.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : textos.errorGenerico);
    } finally {
      setBajando(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Boton variante="primario" icon={<UserPlus size={14} />} onClick={() => setAbierto(true)}>
          {textos.guardar}
        </Boton>
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 36,
            padding: "0 15px",
            borderRadius: 10,
            fontSize: 12.5,
            fontWeight: 600,
            border: "1px solid var(--border-soft)",
            background: "var(--bg)",
            color: "var(--text-2)",
            textDecoration: "none",
          }}
        >
          <MessageCircle size={14} />
          {textos.compartir}
        </a>
        <Boton
          icon={copiado ? <Check size={14} /> : <Copy size={14} />}
          onClick={copiar}
        >
          {copiado ? textos.copiado : textos.copiar}
        </Boton>
        <Boton icon={<Download size={14} />} onClick={descargarPdf} disabled={bajando}>
          {bajando ? textos.generandoPdf : textos.pdf}
        </Boton>
      </div>

      {abierto && <ModalProspecto texto={texto} textos={textos} onCerrar={cerrar} />}
    </>
  );
}

function ModalProspecto({
  texto,
  textos,
  onCerrar,
}: {
  texto: string;
  textos: AccionesTextos;
  onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProspectoLite[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 🔴 ESTE MODAL SE PINTA EN UN PORTAL AL <body>, y no es preferencia.
  //
  // El contenedor .realty-page declara `container-type: inline-size`, y eso
  // implica `contain: layout`: el elemento pasa a ser BLOQUE CONTENEDOR de sus
  // descendientes `position: fixed`. Con el modal dentro, `inset: 0` se
  // resolvía contra la caja de la página —que en la pantalla de resultados
  // pasa de 2000 px de alto— y no contra el viewport, así que el diálogo
  // aterrizaba a media altura del DOCUMENTO: pulsabas "Guardar" abajo del todo
  // y el modal aparecía fuera de pantalla. Subir el z-index no arregla nada;
  // el problema es el bloque contenedor, no el orden de apilamiento.
  //
  // El aviso está escrito en la cabecera de realty-theme.css: "los modales van
  // FUERA de cualquier contenedor con container-type".
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  useEffect(() => {
    if (montado) inputRef.current?.focus();
  }, [montado]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  // Debounce SOLO porque es una búsqueda remota. El recálculo local nunca
  // se debouncea: es síncrono y cuesta menos que el propio evento.
  useEffect(() => {
    const termino = q.trim();
    if (termino.length < 2) {
      setLista([]);
      setBuscando(false);
      return;
    }
    let vivo = true;
    setBuscando(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/realty/calc/prospectos?q=${encodeURIComponent(termino)}`);
        const data = await res.json().catch(() => ({}));
        if (vivo && res.ok) setLista(((data as { items?: ProspectoLite[] }).items ?? []).slice(0, 20));
      } catch {
        if (vivo) setLista([]);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 250);
    return () => {
      vivo = false;
      window.clearTimeout(handle);
    };
  }, [q]);

  async function guardar(p: ProspectoLite) {
    setGuardandoId(p.id);
    try {
      const res = await fetch("/api/realty/calc/bitacora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: p.id, texto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? textos.errorGenerico);
      toast.success(textos.guardado);
      onCerrar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : textos.errorGenerico);
    } finally {
      setGuardandoId(null);
    }
  }

  if (!montado) return null;

  return createPortal(
    <div
      onClick={onCerrar}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(9, 18, 14, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 120,
        padding: 20,
      }}
    >
      {/* El diálogo es esta caja, no el fondo: el fondo es el que se pulsa
          para cerrar, y marcarlo como dialog le decía al lector de pantalla
          que el contenido del diálogo era la página entera. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={textos.buscarTitulo}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-elev)",
          border: "1px solid var(--border-strong)",
          borderRadius: 16,
          overflow: "hidden",
          color: "var(--text-1)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          <strong style={{ fontSize: 14, fontWeight: 700 }}>{textos.buscarTitulo}</strong>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={textos.cancelar}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-3)",
              cursor: "pointer",
              padding: 4,
              lineHeight: 0,
            }}
          >
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 11,
                top: 12,
                color: "var(--text-4)",
                pointerEvents: "none",
              }}
            />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={textos.buscarLabel}
              aria-label={textos.buscarLabel}
              style={{
                width: "100%",
                height: 38,
                background: "var(--bg)",
                color: "var(--text-1)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "0 11px 0 30px",
                fontSize: 13.5,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ overflowY: "auto", minHeight: 0, display: "grid", gap: 6 }}>
            {q.trim().length < 2 && (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-4)" }}>{textos.escribeAlgo}</p>
            )}
            {q.trim().length >= 2 && !buscando && lista.length === 0 && (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-4)" }}>{textos.sinResultados}</p>
            )}
            {lista.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => guardar(p)}
                disabled={guardandoId !== null}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg)",
                  cursor: guardandoId ? "wait" : "pointer",
                  color: "var(--text-1)",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{p.nombre}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--text-4)", marginTop: 1 }}>
                    {p.telefono ?? "—"} · {p.etapa.toLowerCase()}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-3)", flexShrink: 0 }}>
                  {guardandoId === p.id ? textos.guardando : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
