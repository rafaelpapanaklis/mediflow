"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LOS CONTROLES DEL EDITOR.

   Piezas genéricas (campo de texto, interruptor, ranura de foto) más
   `EditorSeccion`, que dibuja los controles de UNA sección LEYENDO su
   manifiesto. Ninguna de estas funciones conoce una plantilla por su
   nombre: recorren `seccion.textos`, `seccion.copia` y `seccion.fotos`.

   Ese es el trato del motor: la novena plantilla escribe su manifiesto y
   sus controles aparecen solos.
   ═══════════════════════════════════════════════════════════════════════ */

import { useRef, useState, type ReactNode } from "react";
import type {
  BarberWebConfig,
  BarberWebFuente,
  BarberWebManifestSeccion,
} from "@/lib/barber/landing";
import { ImagenNoLegible, ImagenPesada, subirFoto } from "./imagen";

export type TFn = (k: string, vars?: Record<string, string | number>) => string;

/* ══════════════════════════════════════════════════════════════
   Piezas genéricas
   ══════════════════════════════════════════════════════════════ */

export function Panel({
  titulo,
  ayuda,
  abierto = false,
  onToggle,
  children,
}: {
  titulo: string;
  ayuda?: string;
  abierto?: boolean;
  /**
   * Se avisa al abrir y al cerrar. Lo usa el selector de plantillas para
   * montar las ocho miniaturas SOLO cuando hacen falta.
   *
   * Se dispara con el evento `toggle` del <details> y no con un hover: en
   * una tableta —que es donde una barbería edita su web— no hay hover, y
   * las miniaturas no habrían aparecido nunca.
   */
  onToggle?: (abierto: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="dcbwe-panel"
      open={abierto}
      onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
    >
      <summary>
        <span>{titulo}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </summary>
      <div className="dcbwe-panel-cuerpo">
        {ayuda && <p className="dcbwe-ayuda">{ayuda}</p>}
        {children}
      </div>
    </details>
  );
}

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
    <label className="dcbwe-campo">
      <span className="dcbwe-etiqueta">{etiqueta}</span>
      {children}
      {ayuda && <span className="dcbwe-ayuda">{ayuda}</span>}
    </label>
  );
}

/**
 * Un texto de la plantilla.
 *
 * `porDefecto` va de placeholder, no de valor: es lo que la barbería ve
 * en gris como "esto sale si lo dejas vacío". Vaciar el campo BORRA la
 * clave y vuelve a salir el literal de la plantilla — por eso el valor
 * guardado nunca es el default.
 */
export function CampoTexto({
  etiqueta,
  valor,
  porDefecto,
  maxLen = 160,
  area = false,
  ayuda,
  onChange,
}: {
  etiqueta: string;
  valor: string | null;
  porDefecto?: string;
  maxLen?: number;
  area?: boolean;
  ayuda?: string;
  onChange: (v: string) => void;
}) {
  const props = {
    value: valor ?? "",
    placeholder: porDefecto || "",
    maxLength: maxLen,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    className: "dcbwe-input",
  };
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda}>
      {area ? <textarea {...props} rows={3} /> : <input type="text" {...props} />}
    </Campo>
  );
}

export function Interruptor({
  etiqueta,
  activo,
  onChange,
  disabled,
}: {
  etiqueta: string;
  activo: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`dcbwe-switch ${disabled ? "dcbwe-switch-off" : ""}`}>
      <input
        type="checkbox"
        checked={activo}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="dcbwe-switch-pista" aria-hidden />
      <span>{etiqueta}</span>
    </label>
  );
}

/* ══════════════════════════════════════════════════════════════
   Ranura de foto
   ══════════════════════════════════════════════════════════════ */

function pesoLegible(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function RanuraFoto({
  t,
  nombre,
  ayuda,
  proporcion,
  destino,
  url,
  onChange,
}: {
  t: TFn;
  nombre: string;
  ayuda?: string;
  proporcion?: string;
  destino: string;
  url: string | null;
  onChange: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<"listo" | "subiendo">("listo");
  const [aviso, setAviso] = useState<string | null>(null);
  const [peso, setPeso] = useState<string | null>(null);

  async function elegir(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setEstado("subiendo");
    setAviso(null);
    try {
      const r = await subirFoto(f, destino);
      onChange(r.url);
      setPeso(pesoLegible(r.bytes));
    } catch (e) {
      setAviso(
        e instanceof ImagenNoLegible || e instanceof ImagenPesada
          ? e.message
          : (e as Error)?.message || t("errorGenerico"),
      );
    } finally {
      setEstado("listo");
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="dcbwe-foto">
      <div className="dcbwe-foto-cab">
        <span className="dcbwe-etiqueta">{nombre}</span>
        {proporcion && <span className="dcbwe-pastilla">{proporcion}</span>}
      </div>

      <div className="dcbwe-foto-caja">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={nombre} />
        ) : (
          <span className="dcbwe-foto-vacia">{ayuda ?? t("fotoSubir")}</span>
        )}
      </div>

      <div className="dcbwe-foto-acciones">
        <button
          type="button"
          className="dcbwe-btn dcbwe-btn-suave"
          onClick={() => input.current?.click()}
          disabled={estado === "subiendo"}
        >
          {estado === "subiendo" ? t("fotoSubiendo") : url ? t("fotoCambiar") : t("fotoSubir")}
        </button>
        {url && (
          <button type="button" className="dcbwe-btn dcbwe-btn-texto" onClick={() => onChange(null)}>
            {t("fotoQuitar")}
          </button>
        )}
      </div>

      {url && ayuda && <p className="dcbwe-ayuda">{ayuda}</p>}
      {peso && <p className="dcbwe-ayuda">{t("fotoPeso", { peso })}</p>}
      {aviso && <p className="dcbwe-error">{aviso}</p>}

      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => elegir(e.target.files)}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Los controles de UNA sección, leídos del manifiesto
   ══════════════════════════════════════════════════════════════ */

const ETIQUETA_FUENTE: Record<BarberWebFuente, string> = {
  servicios: "fuenteServicios",
  barberos: "fuenteBarberos",
  galeria: "fuenteGaleria",
  resenas: "fuenteResenas",
  horario: "fuenteHorario",
  contacto: "fuenteHorario",
};

export function EditorSeccion({
  t,
  seccion,
  config,
  hayDatos,
  primera,
  ultima,
  onSeccion,
  onCopia,
  onFoto,
  onMover,
}: {
  t: TFn;
  seccion: BarberWebManifestSeccion;
  config: BarberWebConfig;
  hayDatos: (f: BarberWebFuente) => boolean;
  primera: boolean;
  ultima: boolean;
  onSeccion: (id: string, parche: { visible?: boolean; titulo?: string; subtitulo?: string }) => void;
  onCopia: (clave: string, v: string) => void;
  onFoto: (slot: string, url: string | null) => void;
  onMover: (id: string, dir: -1 | 1) => void;
}) {
  const estado = config.secciones[seccion.id];
  const visible = estado?.visible !== false;

  // El aviso honesto: la sección está encendida pero no hay qué enseñar,
  // así que en la página NO se ve. Vale más decirlo que dejar que la
  // barbería crea que publicó algo que no sale.
  const faltan = seccion.consume.filter((f) => !hayDatos(f));
  const sinDatos = seccion.consume.length > 0 && faltan.length === seccion.consume.length;

  return (
    <div className={`dcbwe-seccion ${visible ? "" : "dcbwe-seccion-oculta"}`}>
      <div className="dcbwe-seccion-cab">
        <div className="dcbwe-seccion-nombre">
          <strong>{seccion.nombre}</strong>
          {seccion.obligatoria ? (
            <span className="dcbwe-pastilla">{t("seccionFija")}</span>
          ) : (
            <Interruptor
              etiqueta={visible ? t("seccionVisible") : t("seccionOculta")}
              activo={visible}
              onChange={(v) => onSeccion(seccion.id, { visible: v })}
            />
          )}
        </div>
        {!seccion.obligatoria && (
          <div className="dcbwe-seccion-mover">
            <button
              type="button"
              className="dcbwe-btn dcbwe-btn-icono"
              aria-label={t("seccionSubir")}
              title={t("seccionSubir")}
              disabled={primera}
              onClick={() => onMover(seccion.id, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="dcbwe-btn dcbwe-btn-icono"
              aria-label={t("seccionBajar")}
              title={t("seccionBajar")}
              disabled={ultima}
              onClick={() => onMover(seccion.id, 1)}
            >
              ↓
            </button>
          </div>
        )}
      </div>

      {sinDatos && (
        <p className="dcbwe-aviso">
          {t("seccionSinDatos", { que: faltan.map((f) => t(ETIQUETA_FUENTE[f])).join(", ") })}
        </p>
      )}

      {(seccion.textos?.length ?? 0) > 0 && (
        <div className="dcbwe-grupo">
          {seccion.textos!.map((tx) => (
            <CampoTexto
              key={tx.campo}
              etiqueta={tx.etiqueta}
              valor={tx.campo === "titulo" ? estado?.titulo ?? null : estado?.subtitulo ?? null}
              porDefecto={tx.porDefecto}
              maxLen={tx.campo === "titulo" ? 120 : 300}
              area={tx.campo === "subtitulo"}
              onChange={(v) =>
                onSeccion(seccion.id, tx.campo === "titulo" ? { titulo: v } : { subtitulo: v })
              }
            />
          ))}
        </div>
      )}

      {(seccion.copia?.length ?? 0) > 0 && (
        <div className="dcbwe-grupo">
          {seccion.copia!.map((c) => (
            <CampoTexto
              key={c.clave}
              etiqueta={c.etiqueta}
              valor={config.copia[c.clave] ?? null}
              porDefecto={c.porDefecto}
              maxLen={c.maxLen ?? 160}
              onChange={(v) => onCopia(c.clave, v)}
            />
          ))}
        </div>
      )}

      {(seccion.fotos?.length ?? 0) > 0 && (
        <div className="dcbwe-fotos">
          {seccion.fotos!.map((f) => (
            <RanuraFoto
              key={f.id}
              t={t}
              nombre={f.nombre}
              ayuda={f.ayuda}
              proporcion={f.proporcion}
              destino={f.id}
              url={config.fotos[f.id] ?? null}
              onChange={(url) => onFoto(f.id, url)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
