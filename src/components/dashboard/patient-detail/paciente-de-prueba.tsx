"use client";

// ws1-t11 (11d) — «Paciente de prueba / no contactar» en la ficha.
//
// Tres piezas que comparten UN estado (`usePacienteDePrueba`):
//   · `EtiquetaPacienteDePrueba` — la etiqueta ámbar en la fila de alertas de la
//     cabecera. Solo si está marcado. Se lee con texto, no solo con color.
//   · `ItemMenuPacienteDePrueba` — «Marcar como paciente de prueba» / «Quitar
//     marca de prueba» en el menú «…» de la cabecera. Solo para quien puede
//     cambiarla (patients.delete; la API lo vuelve a exigir).
//   · `DialogoPacienteDePrueba` — la confirmación, que dice qué deja de pasar.
//
// El estado lo pide el propio hook a GET /api/patients/[id]/prueba: así la
// cabecera no necesita otra prop desde page.tsx y, sin el SQL pegado, todo
// queda apagado sin errores (`activo: false`).

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FlaskConical, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTextosPacienteDePrueba } from "@/lib/patients/textos-paciente-de-prueba";
import s from "./paciente-de-prueba.module.css";

export interface EstadoPacienteDePrueba {
  cargado: boolean;
  /** El SQL ya está pegado. */
  activo: boolean;
  marcado: boolean;
  puedeEditar: boolean;
  guardando: boolean;
  dialogoAbierto: boolean;
  abrirDialogo: () => void;
  cerrarDialogo: () => void;
  /** Guarda lo contrario de lo que hay. */
  confirmar: () => Promise<void>;
}

export function usePacienteDePrueba(patientId: string): EstadoPacienteDePrueba {
  const textos = useTextosPacienteDePrueba();
  const [cargado, setCargado] = useState(false);
  const [activo, setActivo] = useState(false);
  const [marcado, setMarcado] = useState(false);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/patients/${encodeURIComponent(patientId)}/prueba`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { activo?: boolean; marcado?: boolean; puedeEditar?: boolean } | null) => {
        if (!vivo || !d) return;
        setActivo(d.activo === true);
        setMarcado(d.marcado === true);
        setPuedeEditar(d.puedeEditar === true);
      })
      .catch(() => {})
      .finally(() => {
        if (vivo) setCargado(true);
      });
    return () => {
      vivo = false;
    };
  }, [patientId]);

  const confirmar = useCallback(async () => {
    const nuevo = !marcado;
    setGuardando(true);
    try {
      const r = await fetch(`/api/patients/${encodeURIComponent(patientId)}/prueba`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marcado: nuevo }),
      });
      const d = (await r.json().catch(() => null)) as { marcado?: boolean; code?: string } | null;
      if (!r.ok) {
        toast.error(d?.code === "columna_faltante" ? textos.inactivo : textos.errorGuardar);
        if (d?.code === "columna_faltante") setActivo(false);
        return;
      }
      setMarcado(d?.marcado === true);
      setDialogoAbierto(false);
      toast.success(nuevo ? textos.okMarcado : textos.okQuitado);
    } catch {
      toast.error(textos.errorGuardar);
    } finally {
      setGuardando(false);
    }
  }, [marcado, patientId, textos]);

  return {
    cargado,
    activo,
    marcado,
    puedeEditar,
    guardando,
    dialogoAbierto,
    abrirDialogo: () => setDialogoAbierto(true),
    cerrarDialogo: () => setDialogoAbierto(false),
    confirmar,
  };
}

/** La etiqueta de la cabecera. `className` = las clases de chip de quien la monta. */
export function EtiquetaPacienteDePrueba({
  estado,
  className,
}: {
  estado: EstadoPacienteDePrueba;
  className?: string;
}) {
  const textos = useTextosPacienteDePrueba();
  if (!estado.activo || !estado.marcado) return null;
  return (
    <span className={className} title={textos.significado} data-paciente-de-prueba="">
      <FlaskConical size={11} strokeWidth={1.75} aria-hidden /> {textos.etiqueta}
    </span>
  );
}

/** El renglón del menú «…». Sin permiso, no se pinta. */
export function ItemMenuPacienteDePrueba({
  estado,
  className,
  onElegir,
}: {
  estado: EstadoPacienteDePrueba;
  className?: string;
  /** Lo llama al pulsarlo (para cerrar el menú) antes de abrir la confirmación. */
  onElegir?: () => void;
}) {
  const textos = useTextosPacienteDePrueba();
  if (!estado.cargado || !estado.puedeEditar) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={!estado.activo}
      title={estado.activo ? textos.significado : textos.inactivo}
      onClick={() => {
        onElegir?.();
        estado.abrirDialogo();
      }}
    >
      <FlaskConical size={12} strokeWidth={1.75} aria-hidden />{" "}
      {!estado.activo ? textos.menuInactivo : estado.marcado ? textos.menuQuitar : textos.menuMarcar}
    </button>
  );
}

export function DialogoPacienteDePrueba({ estado }: { estado: EstadoPacienteDePrueba }) {
  const textos = useTextosPacienteDePrueba();
  const quitar = estado.marcado;
  const puntos = quitar ? textos.cuerpoQuitar : textos.cuerpoMarcar;
  return (
    <Dialog.Root
      open={estado.dialogoAbierto}
      onOpenChange={(abierto) => {
        if (!abierto && !estado.guardando) estado.cerrarDialogo();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.velo} />
        <Dialog.Content className={s.caja} aria-describedby={undefined}>
          <div className={s.cabecera}>
            <span className={s.icono} aria-hidden>
              <FlaskConical size={18} strokeWidth={1.75} />
            </span>
            <Dialog.Title className={s.titulo}>{quitar ? textos.tituloQuitar : textos.tituloMarcar}</Dialog.Title>
          </div>
          <ul className={s.lista}>
            {puntos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className={s.nota}>{textos.quedaEnMovimientos}</p>
          <div className={s.pie}>
            <button type="button" className={s.cancelar} onClick={estado.cerrarDialogo} disabled={estado.guardando}>
              {textos.cancelar}
            </button>
            <button
              type="button"
              className={s.confirmar}
              data-tono={quitar ? "normal" : undefined}
              onClick={() => void estado.confirmar()}
              disabled={estado.guardando}
            >
              {estado.guardando ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden /> {textos.guardando}
                </>
              ) : quitar ? (
                textos.botonQuitar
              ) : (
                textos.botonMarcar
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Etiqueta corta para las listas (Pacientes). */
export function EtiquetaListaPacienteDePrueba() {
  const textos = useTextosPacienteDePrueba();
  return (
    <span className={s.etiquetaLista} title={`${textos.etiqueta}. ${textos.significado}`}>
      <FlaskConical size={10} strokeWidth={2} aria-hidden /> {textos.etiquetaCorta}
    </span>
  );
}
