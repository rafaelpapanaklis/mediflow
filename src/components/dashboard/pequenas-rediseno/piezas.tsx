"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import s from "./pequenas.module.css";

/**
 * Piezas comunes a las tres pantallas pequeñas. Todas leen las clases de
 * `pequenas.module.css`, que a su vez solo leen los tokens `--m2-*` del menú.
 * Aquí no hay un solo color escrito a mano.
 */

export { s as estilos };

// ── Cabecera de pantalla ───────────────────────────────────────────

export function Cabecera({
  icono,
  titulo,
  subtitulo,
  acciones,
}: {
  icono?: ReactNode;
  titulo: string;
  subtitulo?: string;
  acciones?: ReactNode;
}) {
  return (
    <header className={s.cabecera}>
      <div className={s.cabeceraTextos}>
        {icono && <span className={s.cabeceraIcono} aria-hidden>{icono}</span>}
        <div>
          <h1 className={s.titulo}>{titulo}</h1>
          {subtitulo && <p className={s.subtitulo}>{subtitulo}</p>}
        </div>
      </div>
      {acciones && <div className={s.acciones}>{acciones}</div>}
    </header>
  );
}

// ── Botones ────────────────────────────────────────────────────────

export function Boton({
  principal,
  suave,
  peq,
  className,
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  principal?: boolean;
  suave?: boolean;
  peq?: boolean;
}) {
  const clases = [
    s.boton,
    principal ? s.botonPrincipal : "",
    suave ? s.botonSuave : "",
    peq ? s.botonPeq : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return (
    <button type="button" className={clases} {...resto}>
      {children}
    </button>
  );
}

/** Botón cuadrado de un solo ícono. Con `href` es un enlace (misma pinta). */
export function BotonIcono({
  etiqueta,
  peligro,
  peq,
  href,
  onClick,
  children,
}: {
  etiqueta: string;
  peligro?: boolean;
  peq?: boolean;
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const clases = [s.botonIcono, peligro ? s.botonIconoPeligro : "", peq ? s.botonIconoPeq : ""]
    .filter(Boolean)
    .join(" ");
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={clases} title={etiqueta} aria-label={etiqueta}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={clases} onClick={onClick} title={etiqueta} aria-label={etiqueta}>
      {children}
    </button>
  );
}

export function Girando({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} strokeWidth={1.75} className={s.girando} aria-hidden />;
}

// ── Etiquetas ──────────────────────────────────────────────────────

export type TonoEtiqueta = "neutra" | "violeta" | "exito" | "ambar" | "peligro" | "info";

const CLASE_TONO: Record<TonoEtiqueta, string> = {
  neutra: s.etiquetaNeutra,
  violeta: s.etiquetaVioleta,
  exito: s.etiquetaExito,
  ambar: s.etiquetaAmbar,
  peligro: s.etiquetaPeligro,
  info: s.etiquetaInfo,
};

/** Del tono semántico del sistema (BadgeNew / audit-core) al de la etiqueta. */
export const TONO_DESDE_SISTEMA: Record<"success" | "warning" | "danger" | "info" | "brand" | "neutral", TonoEtiqueta> = {
  success: "exito",
  warning: "ambar",
  danger: "peligro",
  info: "info",
  brand: "violeta",
  neutral: "neutra",
};

export function Etiqueta({ tono = "neutra", children }: { tono?: TonoEtiqueta; children: ReactNode }) {
  return <span className={`${s.etiqueta} ${CLASE_TONO[tono]}`}>{children}</span>;
}

// ── Estados ────────────────────────────────────────────────────────

export function Vacio({
  icono,
  titulo,
  pista,
  children,
}: {
  icono?: ReactNode;
  titulo: string;
  pista?: string;
  children?: ReactNode;
}) {
  return (
    <div className={s.vacio}>
      {icono && <span className={s.vacioIcono} aria-hidden>{icono}</span>}
      <span className={s.vacioTitulo}>{titulo}</span>
      {pista && <span className={s.vacioPista}>{pista}</span>}
      {children && <div className={s.vacioAcciones}>{children}</div>}
    </div>
  );
}

export function Cargando({ texto }: { texto: string }) {
  return (
    <div className={s.cargando} role="status">
      <Girando size={18} /> {texto}
    </div>
  );
}

export function Aviso({ children }: { children: ReactNode }) {
  return <div className={s.aviso} role="alert">{children}</div>;
}

// ── Formularios ────────────────────────────────────────────────────

export function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <label className={s.campo}>
      <span className={s.campoEtiqueta}>{etiqueta}</span>
      {children}
      {ayuda && <span className={s.campoAyuda}>{ayuda}</span>}
    </label>
  );
}

// ── Modal ──────────────────────────────────────────────────────────

export function Modal({
  titulo,
  tituloId,
  etiquetaCerrar,
  ancho,
  onCerrar,
  pie,
  children,
}: {
  titulo: ReactNode;
  tituloId: string;
  etiquetaCerrar: string;
  ancho?: boolean;
  onCerrar: () => void;
  pie?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  return (
    <div
      className={s.velo}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
    >
      <div className={`${s.modal} ${ancho ? s.modalAncho : ""}`.trim()}>
        <div className={s.modalCabeza}>
          <h3 id={tituloId} className={s.modalTitulo}>{titulo}</h3>
          <BotonIcono etiqueta={etiquetaCerrar} onClick={onCerrar}>
            <X size={14} strokeWidth={1.75} aria-hidden />
          </BotonIcono>
        </div>
        <div className={s.modalCuerpo}>{children}</div>
        {pie && <div className={s.modalPie}>{pie}</div>}
      </div>
    </div>
  );
}
