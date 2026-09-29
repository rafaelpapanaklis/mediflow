"use client";

// El aviso de «caja cerrada» (ws1-t6 H25). Una sola pieza para todos los
// caminos de cobro en efectivo: ver `useFrenoCajaCerrada`. No bloquea nada:
// «Abrir caja» lleva a Caja y «Cobrar de todos modos» sigue con el cobro.
import { useEffect, useRef } from "react";
import { RUTA_CAJA } from "./aviso-caja-cerrada";

export const TEXTO_CAJA_CERRADA = "La caja está cerrada: este efectivo no entrará en ningún corte. ¿Abrir caja?";

export function AvisoCajaCerrada({ onCobrarDeTodosModos, ocupado = false }: {
  onCobrarDeTodosModos: () => void;
  ocupado?: boolean;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  // El botón de cobrar puede estar lejos (pie del detalle): el aviso se trae a la vista.
  useEffect(() => { raiz.current?.scrollIntoView?.({ block: "nearest" }); }, []);
  return (
    <div
      ref={raiz}
      role="alert"
      style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 8, background: "var(--warning-soft)", color: "var(--text-1)", fontSize: 13 }}
    >
      {TEXTO_CAJA_CERRADA}
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <a href={RUTA_CAJA} className="btn-new btn-new--primary btn-new--sm">Abrir caja</a>
        <button type="button" className="btn-new btn-new--ghost btn-new--sm" onClick={onCobrarDeTodosModos} disabled={ocupado}>
          Cobrar de todos modos
        </button>
      </div>
    </div>
  );
}
