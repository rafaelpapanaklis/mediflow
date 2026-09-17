"use client";

import { useEffect, type ReactNode, type MouseEvent } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import s from "./piezas.module.css";

/**
 * Piezas comunes de las tres pantallas (Reserva de recursos, Fila de
 * espera y Tratamientos). Solo pintan: la lógica (estado, fetch, polling)
 * vive en el cliente de siempre de cada pantalla y llega por props.
 */

export function Cabecera({
  titulo,
  subtitulo,
  acciones,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className={s.cabecera}>
      <div>
        <h1 className={s.titulo}>{titulo}</h1>
        {subtitulo && <p className={s.subtitulo}>{subtitulo}</p>}
      </div>
      {acciones && <div className={s.acciones}>{acciones}</div>}
    </div>
  );
}

type Variante = "normal" | "principal" | "suave" | "peligro" | "exito";

export function Boton({
  variante = "normal",
  peq,
  ancho,
  icono,
  children,
  className,
  type = "button",
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  peq?: boolean;
  ancho?: boolean;
  icono?: ReactNode;
}) {
  const clases = [
    s.boton,
    variante === "principal" && s.botonPrincipal,
    variante === "suave" && s.botonSuave,
    variante === "peligro" && s.botonPeligro,
    variante === "exito" && s.botonExito,
    peq && s.botonPeq,
    ancho && s.botonAncho,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={clases} {...resto}>
      {icono}
      {children}
    </button>
  );
}

export function BotonIcono({
  peligro,
  className,
  type = "button",
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { peligro?: boolean }) {
  return (
    <button
      type={type}
      className={[s.botonIcono, peligro && s.botonIconoPeligro, className].filter(Boolean).join(" ")}
      {...resto}
    />
  );
}

export function Tarjeta({
  icono,
  titulo,
  sub,
  accion,
  lista,
  children,
}: {
  icono?: ReactNode;
  titulo?: ReactNode;
  sub?: ReactNode;
  accion?: ReactNode;
  /** El cuerpo es una lista de filas: menos aire lateral. */
  lista?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={s.tarjeta}>
      {(titulo || icono || accion) && (
        <div className={s.tarjetaCabeza}>
          {icono && <span className={s.tarjetaIcono}>{icono}</span>}
          <div className={s.tarjetaTextos}>
            {titulo && <h2 className={s.tarjetaTitulo}>{titulo}</h2>}
            {sub && <p className={s.tarjetaSub}>{sub}</p>}
          </div>
          {accion && <div className={s.tarjetaAccion}>{accion}</div>}
        </div>
      )}
      <div className={lista ? s.tarjetaLista : s.tarjetaCuerpo}>{children}</div>
    </section>
  );
}

export type Tono = "neutra" | "violeta" | "exito" | "ambar" | "peligro" | "info";

const TONO_CLASE: Record<Tono, string> = {
  neutra: s.etiquetaNeutra,
  violeta: s.etiquetaVioleta,
  exito: s.etiquetaExito,
  ambar: s.etiquetaAmbar,
  peligro: s.etiquetaPeligro,
  info: s.etiquetaInfo,
};

export function Etiqueta({ tono = "neutra", children }: { tono?: Tono; children: ReactNode }) {
  return <span className={`${s.etiqueta} ${TONO_CLASE[tono]}`}>{children}</span>;
}

export function Kpi({ etiqueta, valor, icono }: { etiqueta: string; valor: string; icono: ReactNode }) {
  return (
    <div className={s.kpi}>
      <span className={s.tarjetaIcono}>{icono}</span>
      <div className={s.kpiTextos}>
        <div className={s.kpiEtiqueta}>{etiqueta}</div>
        <div className={s.kpiValor}>{valor}</div>
      </div>
    </div>
  );
}

export function Segmentos<T extends string>({
  opciones,
  valor,
  onCambio,
}: {
  opciones: { valor: T; etiqueta: string }[];
  valor: T;
  onCambio: (v: T) => void;
}) {
  return (
    <div className={s.segmentos} role="tablist">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          aria-selected={valor === o.valor}
          className={`${s.segmento} ${valor === o.valor ? s.segmentoActivo : ""}`}
          onClick={() => onCambio(o.valor)}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

export function Vacio({
  icono,
  titulo,
  pista,
  alto,
  children,
}: {
  icono: ReactNode;
  titulo: string;
  pista?: string;
  alto?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`${s.vacio} ${alto ? s.vacioAlto : ""}`}>
      <span className={s.vacioIcono}>{icono}</span>
      <div className={s.vacioTitulo}>{titulo}</div>
      {pista && <div className={s.vacioPista}>{pista}</div>}
      {children}
    </div>
  );
}

export function Iniciales({ nombre }: { nombre: string }) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const texto = ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
  return (
    <span className={s.iniciales} aria-hidden>
      {texto}
    </span>
  );
}

/**
 * Diálogo: velo + tarjeta. Escape lo cierra siempre; el clic en el velo
 * solo si la pantalla lo pide (`cerrarConVelo`), para que cada una cierre
 * igual que hoy.
 */
export function Dialogo({
  titulo,
  cabecera,
  sub,
  ancho,
  cerrarConVelo,
  onCerrar,
  pie,
  children,
}: {
  titulo?: string;
  /** Cabecera a medida (avatar + título + etiqueta); si va, `titulo` no se usa. */
  cabecera?: ReactNode;
  sub?: ReactNode;
  ancho?: boolean;
  cerrarConVelo?: boolean;
  onCerrar: () => void;
  pie?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  function alClicVelo(e: MouseEvent<HTMLDivElement>) {
    if (cerrarConVelo && e.target === e.currentTarget) onCerrar();
  }

  return (
    <div className={s.velo} onClick={alClicVelo}>
      <div className={`${s.dialogo} ${ancho ? s.dialogoAncho : ""}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className={s.dialogoCabeza}>
          {cabecera ?? (
            <div className={s.tarjetaTextos}>
              <h2 className={s.dialogoTitulo}>{titulo}</h2>
              {sub && <p className={s.dialogoSub}>{sub}</p>}
            </div>
          )}
          <BotonIcono onClick={onCerrar} aria-label={t("common.close")}>
            <X size={18} strokeWidth={1.75} />
          </BotonIcono>
        </div>
        <div className={s.dialogoCuerpo}>{children}</div>
        {pie && <div className={s.dialogoPie}>{pie}</div>}
      </div>
    </div>
  );
}

export function Campo({
  etiqueta,
  htmlFor,
  children,
}: {
  etiqueta: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={s.campo}>
      <label className={s.campoEtiqueta} htmlFor={htmlFor}>
        {etiqueta}
      </label>
      {children}
    </div>
  );
}

export function SeccionTitulo({ children }: { children: ReactNode }) {
  return <div className={s.seccionTitulo}>{children}</div>;
}

export function Progreso({ pct, exito, corto }: { pct: number; exito?: boolean; corto?: boolean }) {
  return (
    <div className={`${s.progreso} ${corto ? s.progresoCorto : ""}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`${s.progresoRelleno} ${exito ? s.progresoExito : ""}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export { s as clases };
