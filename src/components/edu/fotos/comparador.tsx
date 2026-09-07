"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Columns2, MoveHorizontal } from "lucide-react";
import { eduParFotosComparador, type EduPhotoRow } from "@/lib/edu/fotos-core";
import { EDU_PHOTO_STAGE_LABELS, EDU_PHOTO_TYPE_LABELS } from "@/lib/edu/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL COMPARADOR ANTES/DESPUÉS DEL INSTITUTO — propio, de arriba abajo.
 *
 * 🔴 NO IMPORTA NI UNA LÍNEA DEL DENTAL, y es a propósito: Rafael lo pidió
 * con todas sus letras («no quiero compartir tanta cosa con Dental»). Se
 * MIRÓ `PhotoCompareSlider` para no olvidarse de ningún gesto —el par
 * propuesto, los dos desplegables, el botón de intercambio, el tirador con
 * chevrons, las etiquetas dentro de la imagen, el `<input type=range>`
 * para el teclado— y se escribió aquí, con clases `edu-*` y tokens
 * `--edu-*`. Si el dental cambia, esto no cambia. Hay una prueba que lo
 * fija (cero imports de dashboard/ y de clinical-shared/).
 *
 * 🔴 EL PAR A/B NO SE DECIDE AQUÍ. Sale de `eduParFotosComparador`
 * (fotos-core.ts), que es puro y tiene su prueba: A = la primera PRE (o la
 * más antigua), B = la última POST o CONTROL que no sea A (o la más
 * reciente). Un componente no es un buen sitio para una regla que hay que
 * poder probar sin montar React.
 *
 * ⚠️ PUNTEROS Y NO `mousedown`: el deslizador se arrastra igual con el
 * ratón y con el dedo porque escucha `pointer*` y captura el puntero. Con
 * eventos de ratón, en un teléfono no se movía; con `touch*` aparte,
 * serían dos caminos que se desincronizan.
 *
 * ⚠️ Y ADEMÁS UN `<input type="range">` DEBAJO. No es decoración: es la
 * única forma de mover el corte con el teclado y con un lector de
 * pantalla. El arrastre es el gesto principal, no el único.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduFotosComparadorProps {
  fotos: EduPhotoRow[];
  /** Abrir la foto a pantalla completa (el visor lo monta la galería). */
  onAbrir?: (foto: EduPhotoRow) => void;
}

type Modo = "deslizador" | "lado";

function etiqueta(f: EduPhotoRow): string {
  return `${EDU_PHOTO_STAGE_LABELS[f.stage]} · ${f.capturedLabel}`;
}

function opcion(f: EduPhotoRow): string {
  return `${f.capturedLabel} · ${EDU_PHOTO_STAGE_LABELS[f.stage]} · ${EDU_PHOTO_TYPE_LABELS[f.photoType]}`;
}

export function EduFotosComparador({ fotos, onAbrir }: EduFotosComparadorProps) {
  const par = eduParFotosComparador(fotos);
  const [aId, setAId] = useState(par.a?.id ?? "");
  const [bId, setBId] = useState(par.b?.id ?? "");
  const [modo, setModo] = useState<Modo>("deslizador");
  const [corte, setCorte] = useState(50);
  const marcoRef = useRef<HTMLDivElement | null>(null);
  const arrastrando = useRef(false);

  // Cuando cambian las fotos (una subida, un filtro), la propuesta se
  // vuelve a calcular. Sin esto, el desplegable seguiría apuntando a una
  // foto que ya no está en la lista y el comparador saldría en blanco.
  useEffect(() => {
    const nuevo = eduParFotosComparador(fotos);
    setAId((prev) => (fotos.some((f) => f.id === prev) ? prev : nuevo.a?.id ?? ""));
    setBId((prev) => (fotos.some((f) => f.id === prev) ? prev : nuevo.b?.id ?? ""));
  }, [fotos]);

  const a = fotos.find((f) => f.id === aId) ?? par.a;
  const b = fotos.find((f) => f.id === bId) ?? par.b;
  const hayDos = Boolean(a && b && a.id !== b.id);

  function cortarEn(clientX: number) {
    const r = marcoRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setCorte(Math.min(100, Math.max(0, Math.round(((clientX - r.left) / r.width) * 100))));
  }

  return (
    <section className="edu-fotos-comp" aria-label="Comparador antes y después">
      <div className="edu-fotos-comp__head">
        <div>
          <h2 className="edu-section__title">Antes y después</h2>
          <p className="edu-fotos-comp__lead">
            Se proponen la primera foto de «Antes» y la última de «Después» o «Control». Cámbialas
            si quieres comparar otras dos.
          </p>
        </div>
        <div className="edu-seg" role="group" aria-label="Cómo se comparan">
          <button
            type="button"
            className={`edu-seg__btn ${modo === "deslizador" ? "edu-seg__btn--on" : ""}`}
            aria-pressed={modo === "deslizador"}
            onClick={() => setModo("deslizador")}
          >
            <MoveHorizontal size={14} aria-hidden /> Deslizador
          </button>
          <button
            type="button"
            className={`edu-seg__btn ${modo === "lado" ? "edu-seg__btn--on" : ""}`}
            aria-pressed={modo === "lado"}
            onClick={() => setModo("lado")}
          >
            <Columns2 size={14} aria-hidden /> Lado a lado
          </button>
        </div>
      </div>

      {/* ── Los dos desplegables y el intercambio ───────────────────── */}
      <div className="edu-fotos-comp__picks">
        <span className="edu-fotos-comp__ab edu-fotos-comp__ab--a" aria-hidden>
          A
        </span>
        <select
          className="edu-input edu-fotos-comp__sel"
          aria-label="Foto A (el antes)"
          value={a?.id ?? ""}
          onChange={(e) => setAId(e.target.value)}
        >
          {fotos.map((f) => (
            <option key={f.id} value={f.id}>
              {opcion(f)}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm edu-fotos-comp__swap"
          title="Intercambiar A y B"
          aria-label="Intercambiar A y B"
          onClick={() => {
            const previo = a?.id ?? "";
            setAId(b?.id ?? "");
            setBId(previo);
          }}
        >
          <ArrowLeftRight size={15} aria-hidden />
        </button>

        <span className="edu-fotos-comp__ab edu-fotos-comp__ab--b" aria-hidden>
          B
        </span>
        <select
          className="edu-input edu-fotos-comp__sel"
          aria-label="Foto B (el después)"
          value={b?.id ?? ""}
          onChange={(e) => setBId(e.target.value)}
        >
          {fotos.map((f) => (
            <option key={f.id} value={f.id}>
              {opcion(f)}
            </option>
          ))}
        </select>
      </div>

      {!hayDos ? (
        /* Con 0 o 1 foto la tarjeta NO se encoge ni desaparece: el aviso va
           DENTRO del área de imagen, donde se estaba mirando. Si el
           comparador se escondiera, nadie sabría que existe. */
        <div className="edu-fotos-comp__vacio">
          {fotos.length === 0
            ? "Todavía no hay fotos que comparar."
            : "Hace falta una segunda foto. Sube el «después» —o marca una foto ya subida como «Después»— y aquí aparecerán las dos."}
        </div>
      ) : modo === "deslizador" ? (
        <>
          <div
            ref={marcoRef}
            className="edu-fotos-comp__marco"
            onPointerDown={(e) => {
              arrastrando.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              cortarEn(e.clientX);
            }}
            onPointerMove={(e) => {
              if (arrastrando.current) cortarEn(e.clientX);
            }}
            onPointerUp={() => {
              arrastrando.current = false;
            }}
            onPointerCancel={() => {
              arrastrando.current = false;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- URL
                firmada que caduca: next/image la cachearía en una ruta que
                después contesta 403. */}
            <img
              className="edu-fotos-comp__img"
              src={a!.url}
              alt={`A · ${etiqueta(a!)}`}
              draggable={false}
            />
            <div
              className="edu-fotos-comp__capa"
              style={{ clipPath: `inset(0 0 0 ${corte}%)` }}
              aria-hidden
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="edu-fotos-comp__img" src={b!.url} alt="" draggable={false} />
            </div>

            <div className="edu-fotos-comp__linea" style={{ left: `${corte}%` }} aria-hidden>
              <span className="edu-fotos-comp__tirador">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m9 7-5 5 5 5" />
                  <path d="m15 7 5 5-5 5" />
                </svg>
              </span>
            </div>

            <span className="edu-fotos-comp__tag edu-fotos-comp__tag--a">A · {etiqueta(a!)}</span>
            <span className="edu-fotos-comp__tag edu-fotos-comp__tag--b">B · {etiqueta(b!)}</span>
          </div>

          {/* Teclado y lector de pantalla. El arrastre es el gesto
              principal; éste es el que hace que exista para todo el mundo. */}
          <input
            type="range"
            min={0}
            max={100}
            value={corte}
            className="edu-fotos-comp__range"
            aria-label="Posición del corte entre la foto A y la B"
            onChange={(e) => setCorte(Number(e.target.value))}
          />
        </>
      ) : (
        <div className="edu-fotos-comp__lado">
          {[
            { tag: "A", foto: a! },
            { tag: "B", foto: b! },
          ].map(({ tag, foto }) => (
            <button
              key={tag}
              type="button"
              className="edu-fotos-comp__mitad"
              onClick={() => onAbrir?.(foto)}
              aria-label={`Abrir ${tag} · ${etiqueta(foto)} a pantalla completa`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="edu-fotos-comp__img" src={foto.url} alt="" draggable={false} />
              <span
                className={`edu-fotos-comp__tag edu-fotos-comp__tag--${tag === "A" ? "a" : "b"}`}
              >
                {tag} · {etiqueta(foto)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
