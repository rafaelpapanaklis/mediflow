"use client";

/**
 * WS1-T5 (grupo Salamanca) — «¿SEGURO?» ANTES DE SOBREAGENDAR.
 *
 * La pregunta que sale ahí mismo, antes de guardar, cuando la cita cae encima
 * de otra del mismo doctor (o sillón) o en la hora de comida del doctor, y la
 * clínica tiene la bandera `agenda-flexible`. La montan «Nueva cita» y
 * «Editar cita» (cambiar hora o duración); al mover arrastrando, el mismo
 * aviso va DENTRO de la ventana «Mover cita» (`confirmar-movimiento.tsx`)
 * para no encadenar dos confirmaciones por un solo gesto.
 *
 * Nada se guarda hasta «Sí, sobreagendar»: entonces quien la monta reenvía la
 * petición con `sobreagendar: true` y el servidor deja el rastro.
 *
 * Misma ropa que la confirmación de bloqueo (`confirmar-bloqueo.module.css`),
 * y el mismo candado del doble clic: dos clics rápidos no pueden mandar dos
 * peticiones.
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Layers, Loader2 } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { textoDelAviso, type AvisoSobreagenda } from "@/lib/agenda/agenda-flexible";
import s from "@/components/dashboard/bloqueos/confirmar-bloqueo.module.css";

export interface ConfirmarSobreagendaProps {
  aviso: AvisoSobreagenda;
  guardando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarSobreagenda({ aviso, guardando = false, onConfirmar, onCancelar }: ConfirmarSobreagendaProps) {
  const t = useT();
  const [yaPulsado, setYaPulsado] = useState(false);
  const bloqueado = guardando || yaPulsado;
  const { clave, vars, extras } = textoDelAviso(aviso);

  return (
    <Dialog.Root
      open
      onOpenChange={(abierto) => {
        if (!abierto && !bloqueado) onCancelar();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.velo} />
        <Dialog.Content
          className={s.caja}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (bloqueado) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (bloqueado) e.preventDefault();
          }}
        >
          <div className={s.cabecera}>
            <span className={s.icono} aria-hidden>
              <Layers size={20} strokeWidth={2.2} />
            </span>
            <Dialog.Title className={s.titulo}>{t("agenda.flexible.sobreagendar.titulo")}</Dialog.Title>
          </div>

          <p className={s.explicacion} role="alert">
            {t(clave, vars)}
            {extras.map((e) => (
              <span key={e.clave}>
                <br />
                {t(e.clave, e.vars)}
              </span>
            ))}
          </p>

          <div className={s.pie}>
            <button type="button" className={s.cancelar} onClick={onCancelar} disabled={bloqueado}>
              {t("agenda.flexible.sobreagendar.cancelar")}
            </button>
            <button
              type="button"
              className={s.confirmar}
              disabled={bloqueado}
              autoFocus
              onClick={() => {
                setYaPulsado(true);
                onConfirmar();
              }}
            >
              {bloqueado ? <Loader2 size={16} className={s.girando} aria-hidden /> : null}
              {t("agenda.flexible.sobreagendar.confirmar")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
