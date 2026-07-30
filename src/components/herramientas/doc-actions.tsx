"use client";

import { useState } from "react";
import { Copy, Printer } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Botones "Copiar texto" e "Imprimir" de los dos generadores.
//
// Copiar usa navigator.clipboard, que sólo existe en contextos seguros (https o
// localhost) y puede fallar si el navegador niega el permiso: en ese caso se le
// dice al usuario qué hacer en lugar de dejar un botón que no responde.
//
// Imprimir es window.print() a secas — la hoja limpia la arma el bloque
// @media print de herramientas.css, que oculta todo menos `.tool-doc`. Cero
// librerías de PDF.
// ─────────────────────────────────────────────────────────────────────────────

export function DocActions({ text }: { text: string }) {
  const [msg, setMsg] = useState("");
  const [isError, setIsError] = useState(false);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard no disponible");
      await navigator.clipboard.writeText(text);
      setIsError(false);
      setMsg("Texto copiado al portapapeles");
    } catch {
      setIsError(true);
      setMsg("Tu navegador no permitió copiar. Selecciona el texto de la vista previa y usa Ctrl+C.");
    }
  }

  function print() {
    setMsg("");
    window.print();
  }

  return (
    <div className="tool-actions">
      <button type="button" className="tool-btn tool-btn--primary" onClick={copy}>
        <Copy aria-hidden="true" /> Copiar texto
      </button>
      <button type="button" className="tool-btn" onClick={print}>
        <Printer aria-hidden="true" /> Imprimir
      </button>
      {msg ? (
        <span className="tool-actions__state" data-error={isError} role="status">
          {msg}
        </span>
      ) : null}
    </div>
  );
}
