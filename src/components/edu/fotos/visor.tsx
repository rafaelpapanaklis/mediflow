"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import type { EduPhotoRow } from "@/lib/edu/fotos-core";
import { EDU_PHOTO_STAGE_LABELS, EDU_PHOTO_TYPE_LABELS } from "@/lib/edu/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA FOTO A PANTALLA COMPLETA — visor propio del vertical.
 *
 * 🔴 NO ES `PhotoLightbox` DEL DENTAL. Se miró para no olvidar ningún
 * gesto (Escape cierra, flechas navegan, el contador "3 / 12", el pie con
 * la nota) y se escribió aquí, con clases `edu-*` en vez de estilos en
 * línea con los tokens del dental. Hay una prueba que fija que esta
 * carpeta no importa nada de `components/dashboard/` ni de
 * `clinical-shared/`.
 *
 * Lo que se le añadió respecto al del dental, porque hacía falta:
 *   · ZOOM de verdad (el del dental solo ajusta a pantalla), con el mismo
 *     rótulo que el visor de estudios del vertical — «Ampliar»/«Ajustar»;
 *   · el FOCO entra al abrir y vuelve al elemento que lo abrió al cerrar.
 *     Sin lo segundo, quien navega con teclado aparece al principio de la
 *     página cada vez que cierra una foto;
 *   · el fondo NO se desplaza mientras está abierto: en un teléfono, el
 *     dedo arrastraba la galería de atrás y el visor parecía pegado.
 *
 * ⚠️ `useEffect` con `[índice, total]` y NO con el objeto de props: con el
 * objeto entero, el listener de teclado se quita y se vuelve a poner en
 * CADA render, y en medio de un repintado se pierden pulsaciones.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduFotoVisorProps {
  fotos: EduPhotoRow[];
  indice: number;
  onCerrar: () => void;
  onIr: (indice: number) => void;
}

export function EduFotoVisor({ fotos, indice, onCerrar, onIr }: EduFotoVisorProps) {
  const total = fotos.length;
  const foto = fotos[indice];
  const [zoom, setZoom] = useState(false);
  const cajaRef = useRef<HTMLDivElement | null>(null);
  const volverA = useRef<HTMLElement | null>(null);

  useEffect(() => {
    volverA.current = (document.activeElement as HTMLElement) ?? null;
    cajaRef.current?.focus();
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
      volverA.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
      if (e.key === "ArrowLeft" && indice > 0) onIr(indice - 1);
      if (e.key === "ArrowRight" && indice < total - 1) onIr(indice + 1);
    }
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [indice, total, onCerrar, onIr]);

  // Al cambiar de foto se vuelve a "ajustada": quedarse ampliado al pasar
  // a la siguiente enseña una esquina de una foto que nadie pidió ampliar.
  useEffect(() => {
    setZoom(false);
  }, [indice]);

  if (!foto) return null;

  return (
    <div
      className="edu-fotos-visor"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto clínica ${indice + 1} de ${total}`}
      ref={cajaRef}
      tabIndex={-1}
    >
      <header className="edu-fotos-visor__barra">
        <span className="edu-fotos-visor__cuenta">
          {indice + 1} / {total} · {EDU_PHOTO_STAGE_LABELS[foto.stage]} ·{" "}
          {EDU_PHOTO_TYPE_LABELS[foto.photoType]} · {foto.capturedLabel}
        </span>
        <span className="edu-fotos-visor__acc">
          <button
            type="button"
            className="edu-fotos-visor__btn"
            onClick={() => setZoom((z) => !z)}
            aria-label={zoom ? "Ajustar a la pantalla" : "Ampliar"}
          >
            {zoom ? <ZoomOut size={20} aria-hidden /> : <ZoomIn size={20} aria-hidden />}
          </button>
          <button
            type="button"
            className="edu-fotos-visor__btn"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <X size={22} aria-hidden />
          </button>
        </span>
      </header>

      <div className="edu-fotos-visor__cuerpo">
        <button
          type="button"
          className="edu-fotos-visor__nav"
          aria-label="Anterior"
          disabled={indice === 0}
          onClick={() => onIr(indice - 1)}
        >
          <ChevronLeft size={28} aria-hidden />
        </button>

        <div className={`edu-fotos-visor__marco ${zoom ? "edu-fotos-visor__marco--zoom" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- URL
              firmada que caduca: next/image la cachearía y después daría
              403. */}
          <img
            className="edu-fotos-visor__img"
            src={foto.url}
            alt={foto.notes ?? `${EDU_PHOTO_STAGE_LABELS[foto.stage]} · ${EDU_PHOTO_TYPE_LABELS[foto.photoType]}`}
          />
        </div>

        <button
          type="button"
          className="edu-fotos-visor__nav"
          aria-label="Siguiente"
          disabled={indice >= total - 1}
          onClick={() => onIr(indice + 1)}
        >
          <ChevronRight size={28} aria-hidden />
        </button>
      </div>

      <footer className="edu-fotos-visor__pie">
        <span>
          Subió {foto.uploadedByName}
          {foto.caseProgramName ? ` · ${foto.caseProgramName}` : ""} · {foto.sizeLabel}
        </span>
        {foto.notes && <span className="edu-fotos-visor__nota">{foto.notes}</span>}
        <span className="edu-fotos-visor__ayuda">← → para pasar · Esc para cerrar</span>
      </footer>
    </div>
  );
}
