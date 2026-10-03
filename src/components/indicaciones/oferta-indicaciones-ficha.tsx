"use client";

// Ficha del paciente → «Terminar consulta» (ws1-t10, mejora 12): cuando la
// consulta se cierra desde la ficha y los procedimientos de la cita proponen
// alguna hoja de indicaciones, un aviso lo ofrece («Ver indicaciones») sin
// abrir nada encima de lo que ya abre la ficha (p. ej. los tratamientos a
// cobrar). El cuadro es el mismo de la agenda.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { conValores, useTextosIndicaciones } from "@/lib/indicaciones/textos";
import type { ContextoCita } from "@/lib/indicaciones/tipos";
import { DialogoIndicaciones } from "./dialogo-indicaciones";

interface Props {
  /** La cita que se acaba de terminar desde la ficha; null = ninguna. */
  citaTerminada: string | null;
}

export function OfertaIndicacionesFicha({ citaTerminada }: Props) {
  const tx = useTextosIndicaciones();
  const [abierta, setAbierta] = useState<{ id: string; ctx: ContextoCita } | null>(null);

  useEffect(() => {
    if (!citaTerminada) return;
    let vivo = true;
    fetch(`/api/indicaciones/cita/${encodeURIComponent(citaTerminada)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ContextoCita>) : null))
      .then((d) => {
        if (!vivo || !d || !d.disponible || !d.admiteIndicaciones || d.sugeridas.length === 0) return;
        const nombre = d.sugeridas.length === 1 ? d.indicaciones.find((h) => h.id === d.sugeridas[0])?.nombre : null;
        toast(
          (aviso) => (
            <span>
              <b>{tx.ofrecerTitulo}.</b>{" "}
              {nombre
                ? conValores(tx.ofrecerTexto, { nombre })
                : conValores(tx.ofrecerTextoVarias, { n: d.sugeridas.length })}{" "}
              <button
                type="button"
                style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, textDecoration: "underline", cursor: "pointer", color: "inherit" }}
                onClick={() => {
                  toast.dismiss(aviso.id);
                  setAbierta({ id: citaTerminada, ctx: d });
                }}
              >
                {tx.ofrecerSi}
              </button>
            </span>
          ),
          { duration: 15000, id: `indicaciones-${citaTerminada}` },
        );
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [citaTerminada, tx]);

  if (!abierta) return null;
  return <DialogoIndicaciones appointmentId={abierta.id} open inicial={abierta.ctx} onClose={() => setAbierta(null)} />;
}
