"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import s from "./pago.module.css";

/**
 * Copia `valor` al portapapeles. Sin API de portapapeles (http, iframe, modo
 * privado) cae a un textarea temporal; si tampoco, el botón no promete nada:
 * el dato sigue a la vista para copiarlo a mano.
 */
async function copiarTexto(valor: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(valor);
      return true;
    }
  } catch {
    /* cae al plan B */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = valor;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function BotonCopiar({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  return (
    <button
      type="button"
      className={`${s.copiar} ${copiado ? s.copiado : ""}`}
      aria-label={`Copiar ${etiqueta}`}
      onClick={async () => {
        if (!(await copiarTexto(valor))) return;
        setCopiado(true);
        if (temporizador.current) clearTimeout(temporizador.current);
        temporizador.current = setTimeout(() => setCopiado(false), 1800);
      }}
    >
      {copiado ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
    </button>
  );
}
