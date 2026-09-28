// Módulo de Ortodoncia — «Primeros pasos» en el Tablero (ws1-t5, fila 29 del
// mapa de conexiones). Después de contratar, la clínica entraba a un Tablero
// vacío sin saber por dónde empezar. Solo pinta lo que recibe: qué pasos hay y
// cuál está hecho lo decide `src/lib/orthodontics/primeros-pasos.ts`.
//
// Sin hooks ni manejadores: es una pieza de servidor, como las de `piezas.tsx`.
import Link from "next/link";
import { Check, Rocket } from "lucide-react";
import type { PrimerosPasos } from "@/lib/orthodontics/primeros-pasos";
import { Tarjeta } from "./piezas";
import m from "./modulo.module.css";
import s from "./primeros-pasos.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function PrimerosPasosOrtodoncia({ pasos }: { pasos: PrimerosPasos }) {
  // Todo hecho: el bloque desaparece y el Tablero queda como siempre.
  if (pasos.completo) return null;

  return (
    <div className={s.bloque} data-primeros-pasos>
      <Tarjeta
        icono={Rocket}
        titulo="Primeros pasos con Ortodoncia"
        sub="Lo que falta para que el módulo trabaje con los datos de tu clínica. Este bloque desaparece al terminar."
        accion={
          <span className={s.avance} aria-label={`${pasos.hechos} de ${pasos.total} pasos hechos`}>
            {pasos.hechos} de {pasos.total}
          </span>
        }
      >
        <ol className={s.lista}>
          {pasos.pasos.map((p, i) => {
            const siguiente = p.clave === pasos.siguiente;
            return (
              <li key={p.clave} className={s.paso} data-paso={p.clave} data-hecho={p.hecho ? "si" : "no"}>
                <span className={cx(s.marca, p.hecho && s.marcaHecha, siguiente && s.marcaSiguiente)} aria-hidden>
                  {p.hecho ? <Check size={14} strokeWidth={2.4} /> : i + 1}
                </span>
                <div className={s.textos}>
                  <p className={cx(s.titulo, p.hecho && s.tituloHecho)}>{p.titulo}</p>
                  {!p.hecho && <p className={s.detalle}>{p.detalle}</p>}
                </div>
                {p.hecho ? (
                  <span className={s.hecho}>Hecho</span>
                ) : (
                  <Link
                    href={p.href}
                    className={cx(m.boton, m.botonPeq, siguiente && m.botonPrincipal, s.accion)}
                    aria-label={`${p.accion}: ${p.titulo}`}
                  >
                    {p.accion}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </Tarjeta>
    </div>
  );
}
