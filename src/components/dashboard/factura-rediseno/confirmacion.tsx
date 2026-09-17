"use client";

/**
 * «¿Marcar pagada?» y «¿Eliminar borrador?» con el diseño nuevo.
 *
 * Es el MISMO paso que la confirmación global (`useConfirm`, el
 * `ConfirmProvider` del layout raíz): una pregunta con dos botones, y nada
 * pasa hasta que se acepta. Lo que cambia es la ropa: el `ConfirmProvider` es
 * un singleton que se pinta con las variables viejas y no sabe de banderas,
 * así que con el interruptor encendido el detalle de factura monta esta
 * ventana en su lugar, con los tokens del menú. Con el interruptor apagado no
 * se monta: sigue `useConfirm` tal cual.
 *
 * No toca la acción: quien la abre le pasa `onConfirmar`, que es exactamente
 * la misma llamada al servidor que corría después del `await confirm(...)`.
 */

import { AlertCircle, Info } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "./raiz";

export interface ConfirmacionFacturaProps {
  abierta: boolean;
  titulo: string;
  descripcion: string;
  textoConfirmar: string;
  textoCancelar: string;
  /** Acción destructiva (eliminar): icono y botón en rojo. */
  peligro?: boolean;
  /**
   * `busy` del detalle. La acción corre con la pregunta ya cerrada (igual que
   * tras el `await confirm(...)` de siempre); esto solo cubre la animación de
   * salida, para que no se pueda volver a pulsar mientras se cierra.
   */
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmacionFactura({
  abierta, titulo, descripcion, textoConfirmar, textoCancelar, peligro = false, ocupado = false, onConfirmar, onCancelar,
}: ConfirmacionFacturaProps) {
  const Icono = peligro ? AlertCircle : Info;
  return (
    <Dialog open={abierta} onOpenChange={(o) => { if (!o && !ocupado) onCancelar(); }}>
      <DialogContent
        role="alertdialog"
        className={`${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`}
        onEscapeKeyDown={(e) => { if (ocupado) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (ocupado) e.preventDefault(); }}
      >
        <div className={c.confirmacion}>
          <div className={`${c.confirmacionIcono} ${peligro ? c.confirmacionIconoPeligro : ""}`} aria-hidden>
            <Icono size={20} aria-hidden />
          </div>
          <div className={c.confirmacionTextos}>
            <DialogTitle className={c.confirmacionTitulo}>{titulo}</DialogTitle>
            <p className={c.confirmacionTexto}>{descripcion}</p>
          </div>
        </div>
        <DialogFooter className={c.pie}>
          <ButtonNew variant="ghost" onClick={onCancelar} disabled={ocupado}>{textoCancelar}</ButtonNew>
          <ButtonNew variant={peligro ? "danger" : "primary"} onClick={onConfirmar} disabled={ocupado} autoFocus>
            {textoConfirmar}
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
