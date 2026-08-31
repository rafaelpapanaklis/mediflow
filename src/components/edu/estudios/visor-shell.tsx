"use client";

import { useEffect, useId, useRef } from "react";
import { Maximize, Minimize, X } from "lucide-react";
import { useEduPantallaCompleta } from "@/components/edu/estudios/visor-medidas";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA HOJA DEL VISOR — ocupa la VENTANA, no 1160 px.
 *
 * Por qué no es `EduModal`: esa hoja es la del vertical entero (formularios,
 * confirmaciones, fichas) y su forma —560 px, 1160 px "ancha", centrada con
 * aire alrededor— es la correcta para lo que hace. Un CBCT no es eso: son
 * cinco vistas que quieren cada píxel del monitor, y quien lo abre en una
 * pantalla de 27" no está mirando un formulario. Ensanchar `EduModal` una
 * tercera vez habría cambiado un componente que usan ~20 pantallas del
 * vertical para arreglar UNA; aquí vive la hoja del visor y solo la usa el
 * visor.
 *
 * Lo que SÍ se conserva de `EduModal`, porque son las reglas de la casa y no
 * un detalle del modal: Escape cierra, el fondo no se desplaza, el foco entra
 * al abrir y VUELVE al elemento que lo abrió al cerrar, y el diálogo se
 * anuncia con `role="dialog"` + `aria-modal` + `aria-labelledby`.
 *
 * Y encima trae lo que un visor necesita:
 *   · alto REAL de la ventana con `100dvh` (en el móvil, la barra del
 *     navegador aparece y desaparece; `100vh` dejaría el pie por debajo del
 *     borde),
 *   · pantalla completa DE VERDAD, la del sistema, sobre esta misma hoja.
 *     En el iPhone el botón no se pinta —WebKit solo deja pantalla completa
 *     al vídeo— y no hay nada que explicar: la hoja ya ocupa todo,
 *   · un cuerpo que desplaza con `scrollbar-gutter: stable`, para que
 *     aparecer o desaparecer la barra de desplazamiento no cambie el ancho y
 *     la rejilla no se remida en bucle.
 *
 * ⚠️ NO hay trampa de foco completa (Tab puede salirse a la página de
 * atrás). Es la misma limitación conocida de `EduModal` y se anota igual: la
 * alternativa era traer una biblioteca de diálogos al vertical.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduVisorShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function EduVisorShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: EduVisorShellProps) {
  const hojaRef = useRef<HTMLDivElement | null>(null);
  const volverA = useRef<HTMLElement | null>(null);
  const tituloId = useId();
  const pantalla = useEduPantallaCompleta(hojaRef);

  useEffect(() => {
    volverA.current = (document.activeElement as HTMLElement) ?? null;
    hojaRef.current?.focus();
    return () => {
      volverA.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // En pantalla completa, Escape es del NAVEGADOR: sale de pantalla
      // completa. Cerrar además el visor dejaría a quien solo quería salir
      // de pantalla completa de vuelta en la galería, sin su estudio.
      if (pantalla.activa) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pantalla.activa]);

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  return (
    <div
      ref={hojaRef}
      className="edu-visorhoja"
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      tabIndex={-1}
    >
      <div className="edu-visorhoja__head">
        <div className="edu-visorhoja__titulos">
          <h2 className="edu-visorhoja__title" id={tituloId}>
            {title}
          </h2>
          {subtitle && <p className="edu-visorhoja__sub">{subtitle}</p>}
        </div>
        {pantalla.soportada && (
          <button
            type="button"
            className="edu-iconbtn"
            onClick={pantalla.alternar}
            aria-pressed={pantalla.activa}
            title={pantalla.activa ? "Salir de pantalla completa" : "Pantalla completa"}
            aria-label={pantalla.activa ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {pantalla.activa ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        )}
        <button type="button" className="edu-iconbtn" onClick={onClose} aria-label="Cerrar">
          <X size={17} />
        </button>
      </div>

      <div className="edu-visorhoja__body">{children}</div>

      {footer && <div className="edu-visorhoja__foot">{footer}</div>}
    </div>
  );
}
