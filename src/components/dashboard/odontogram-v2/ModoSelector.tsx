"use client";

import { memo } from "react";
import { I18N } from "./data";
import type { Lang } from "./types";
import type { ModoMarca } from "@/lib/odontogram/estado-marca";

/**
 * «Por hacer» (rojo) / «Realizado» (azul) — ws1-t6, decisión 1 de Rafael. Con un modo activo,
 * cada pieza o cara que el doctor toca con un procedimiento queda pintada en ese color: un solo
 * paso. En «Realizado», la casilla «De otra clínica» lo marca como trabajo previo (azul, «previo»).
 */
export const ModoSelector = memo(function ModoSelector({ lang, modo, previo, onModo, onPrevio, compacto }: {
  lang: Lang;
  modo: ModoMarca;
  previo: boolean;
  onModo: (m: ModoMarca) => void;
  onPrevio: (v: boolean) => void;
  /** En el panel del diente: sin la ayuda de abajo. */
  compacto?: boolean;
}) {
  const t = I18N[lang];
  const opciones: { v: ModoMarca; l: string }[] = [
    { v: "por_hacer", l: t.modoPorHacer },
    { v: "hecho", l: t.modoHecho },
  ];
  return (
    <div className="odo-modo" data-modo-actual={modo}>
      <div className="odo-modo-seg" role="radiogroup" aria-label={t.modoTitulo}>
        {opciones.map((o) => (
          <button
            type="button"
            key={o.v}
            role="radio"
            aria-checked={modo === o.v}
            data-modo={o.v}
            className={"odo-modo-btn" + (modo === o.v ? " on" : "")}
            onClick={() => onModo(o.v)}
          >
            <span className="odo-modo-dot" aria-hidden="true" />
            {o.l}
          </button>
        ))}
      </div>
      {modo === "hecho" && (
        <label className="odo-modo-previo">
          <input type="checkbox" checked={previo} onChange={(e) => onPrevio(e.target.checked)} data-modo-previo="" />
          {t.modoPrevio}
        </label>
      )}
      {!compacto && <span className="odo-modo-ayuda">{t.modoAyuda}</span>}
    </div>
  );
});
