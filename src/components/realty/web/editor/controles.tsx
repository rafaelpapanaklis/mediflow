"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LOS CONTROLES DEL EDITOR.

   Primitivas propias y no `src/components/ui/**` por dos motivos: ese
   catálogo no tiene ni selector de color, ni interruptor, ni acordeón, y
   además está escrito para el panel dental (raíz de 13px, tokens violeta).
   Aquí todo vive bajo el prefijo `dcrwe-` y no se lleva nada por delante.

   El editor NO conoce ninguna plantilla por su nombre: EditorBloque recorre
   lo que declara el manifiesto (textos, copia, fotos) y dibuja un control
   por cada cosa declarada. Agregar la décima plantilla no toca este
   archivo.
   ═══════════════════════════════════════════════════════════════════════ */

import { useId, useRef, useState, type ReactNode } from "react";
import type {
  RealtyWebFuente,
  RealtyWebManifestBloque,
} from "@/lib/realty/landing";
import { bloqueDef, consumeDe } from "@/lib/realty/landing";

/* ── Panel plegable ───────────────────────────────────────────────── */

export function Panel({
  titulo,
  ayuda,
  abierto,
  children,
}: {
  titulo: string;
  ayuda?: string;
  abierto?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="dcrwe-panel" open={abierto}>
      <summary>
        <span>{titulo}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="dcrwe-panel-cuerpo">
        {ayuda ? <p className="dcrwe-ayuda">{ayuda}</p> : null}
        {children}
      </div>
    </details>
  );
}

/* ── Campo con etiqueta ───────────────────────────────────────────── */

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
    <label className="dcrwe-campo">
      <span className="dcrwe-etiqueta">{etiqueta}</span>
      {children}
      {ayuda ? <span className="dcrwe-ayuda">{ayuda}</span> : null}
    </label>
  );
}

/**
 * Campo de texto.
 *
 * 🔴 `porDefecto` va de PLACEHOLDER, nunca de valor: vaciar el campo BORRA
 * la clave y vuelve a salir el literal de la plantilla. Si el default se
 * materializara al guardar, cambiar de plantilla arrastraría el texto de
 * la anterior y la inmobiliaria no entendería por qué su web dice algo que
 * ella no escribió.
 */
export function CampoTexto({
  etiqueta,
  ayuda,
  valor,
  porDefecto,
  maxLen,
  area,
  filas,
  onChange,
}: {
  etiqueta: string;
  ayuda?: string;
  valor: string;
  porDefecto?: string;
  maxLen?: number;
  area?: boolean;
  filas?: number;
  onChange: (v: string) => void;
}) {
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda}>
      {area ? (
        <textarea
          className="dcrwe-input"
          rows={filas ?? 3}
          maxLength={maxLen}
          value={valor}
          placeholder={porDefecto}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          className="dcrwe-input"
          maxLength={maxLen}
          value={valor}
          placeholder={porDefecto}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Campo>
  );
}

/* ── Interruptor ──────────────────────────────────────────────────── */

export function Interruptor({
  etiqueta,
  ayuda,
  activo,
  onChange,
}: {
  etiqueta: string;
  ayuda?: string;
  activo: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="dcrwe-switch">
      <input
        id={id}
        type="checkbox"
        checked={activo}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>
        <span className="dcrwe-switch-pista" aria-hidden="true" />
        <span>
          {etiqueta}
          {ayuda ? <small>{ayuda}</small> : null}
        </span>
      </label>
    </div>
  );
}

/* ── Lista de textos sueltos (zonas, requisitos) ──────────────────── */

export function ListaSimple({
  etiqueta,
  ayuda,
  items,
  maxItems,
  placeholder,
  onChange,
}: {
  etiqueta: string;
  ayuda?: string;
  items: string[];
  maxItems: number;
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [nuevo, setNuevo] = useState("");

  function agregar() {
    const v = nuevo.trim();
    if (!v || items.includes(v) || items.length >= maxItems) return;
    onChange([...items, v]);
    setNuevo("");
  }

  return (
    <div className="dcrwe-lista">
      <span className="dcrwe-etiqueta">{etiqueta}</span>
      {ayuda ? <p className="dcrwe-ayuda">{ayuda}</p> : null}
      <ul>
        {items.map((it, i) => (
          <li key={`${it}-${i}`}>
            <span>{it}</span>
            <button
              type="button"
              className="dcrwe-btn dcrwe-btn-icono"
              aria-label={`Quitar ${it}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {items.length < maxItems ? (
        <div className="dcrwe-lista-alta">
          <input
            type="text"
            className="dcrwe-input"
            value={nuevo}
            placeholder={placeholder}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar();
              }
            }}
          />
          <button type="button" className="dcrwe-btn" onClick={agregar}>
            Agregar
          </button>
        </div>
      ) : (
        <p className="dcrwe-ayuda">Llegaste al máximo ({maxItems}).</p>
      )}
    </div>
  );
}

/* ── Ranura de foto ───────────────────────────────────────────────── */

export function RanuraFoto({
  nombre,
  proporcion,
  ayuda,
  url,
  subiendo,
  onSubir,
  onQuitar,
}: {
  nombre: string;
  proporcion: string;
  ayuda?: string;
  url: string | null;
  subiendo: boolean;
  onSubir: (file: File) => void;
  onQuitar: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="dcrwe-foto">
      <div className="dcrwe-foto-vista">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={nombre} />
        ) : (
          <span className="dcrwe-foto-hueco">{proporcion}</span>
        )}
      </div>
      <div className="dcrwe-foto-datos">
        <strong>{nombre}</strong>
        <small>{ayuda ?? proporcion}</small>
        <div className="dcrwe-foto-acciones">
          <button
            type="button"
            className="dcrwe-btn"
            disabled={subiendo}
            onClick={() => input.current?.click()}
          >
            {subiendo ? "Subiendo…" : url ? "Cambiar" : "Subir"}
          </button>
          {url ? (
            <button type="button" className="dcrwe-btn dcrwe-btn-sutil" onClick={onQuitar}>
              Quitar
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSubir(f);
          // Se limpia para que volver a elegir el MISMO archivo dispare el
          // change otra vez (si no, el segundo intento no hace nada).
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ── El bloque, dibujado LEYENDO el manifiesto ────────────────────── */

const NOMBRE_FUENTE: Record<RealtyWebFuente, string> = {
  inmuebles: "inmuebles publicados",
  agentes: "asesores con ficha pública",
  sucursales: "oficinas",
  credenciales: "credenciales",
  zonas: "zonas",
  testimonios: "testimonios",
  requisitos: "requisitos",
  numeros: "números",
  historia: "historia",
  contacto: "datos de contacto",
};

export interface EditorBloqueProps {
  bloque: RealtyWebManifestBloque;
  primera: boolean;
  ultima: boolean;
  visible: boolean;
  hayDatos: (f: RealtyWebFuente) => boolean;
  textoDe: (campo: "titulo" | "subtitulo") => string;
  copiaDe: (clave: string) => string;
  fotoDe: (slot: string) => string | null;
  subiendo: string | null;
  onVisible: (v: boolean) => void;
  onMover: (dir: -1 | 1) => void;
  onTexto: (campo: "titulo" | "subtitulo", v: string) => void;
  onCopia: (clave: string, v: string) => void;
  onFoto: (slot: string, file: File) => void;
  onQuitarFoto: (slot: string) => void;
}

export function EditorBloque(p: EditorBloqueProps) {
  const def = bloqueDef(p.bloque.id);
  const fuentes = consumeDe(p.bloque);
  const faltan = fuentes.filter((f) => !p.hayDatos(f));
  const sinDatos = fuentes.length > 0 && faltan.length === fuentes.length;

  return (
    <Panel titulo={def.nombre}>
      <div className="dcrwe-bloque-barra">
        {p.bloque.obligatoria ? (
          <span className="dcrwe-chip">Siempre se ve</span>
        ) : (
          <Interruptor etiqueta="Mostrar esta sección" activo={p.visible} onChange={p.onVisible} />
        )}
        {p.bloque.obligatoria ? null : (
          <div className="dcrwe-mover">
            <button
              type="button"
              className="dcrwe-btn dcrwe-btn-icono"
              aria-label="Subir la sección"
              title="Subir"
              disabled={p.primera}
              onClick={() => p.onMover(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="dcrwe-btn dcrwe-btn-icono"
              aria-label="Bajar la sección"
              title="Bajar"
              disabled={p.ultima}
              onClick={() => p.onMover(1)}
            >
              ↓
            </button>
          </div>
        )}
      </div>

      {sinDatos ? (
        <p className="dcrwe-aviso">
          Esta sección se llena con {faltan.map((f) => NOMBRE_FUENTE[f]).join(" o ")}. Mientras no
          los tengas, no se pinta en tu web pública (aquí sí, para que veas dónde va).
        </p>
      ) : null}

      {(p.bloque.textos ?? []).map((t) => (
        <CampoTexto
          key={t.campo}
          etiqueta={t.etiqueta}
          valor={p.textoDe(t.campo)}
          porDefecto={t.porDefecto}
          maxLen={t.campo === "titulo" ? 120 : 300}
          area={t.campo === "subtitulo"}
          filas={2}
          onChange={(v) => p.onTexto(t.campo, v)}
        />
      ))}

      {(p.bloque.copia ?? []).map((c) => (
        <CampoTexto
          key={c.clave}
          etiqueta={c.etiqueta}
          valor={p.copiaDe(c.clave)}
          porDefecto={c.porDefecto}
          maxLen={c.maxLen ?? 160}
          onChange={(v) => p.onCopia(c.clave, v)}
        />
      ))}

      {(p.bloque.fotos ?? []).map((f) => (
        <RanuraFoto
          key={f.id}
          nombre={f.nombre}
          proporcion={f.proporcion}
          ayuda={f.ayuda}
          url={p.fotoDe(f.id)}
          subiendo={p.subiendo === f.id}
          onSubir={(file) => p.onFoto(f.id, file)}
          onQuitar={() => p.onQuitarFoto(f.id)}
        />
      ))}
    </Panel>
  );
}
