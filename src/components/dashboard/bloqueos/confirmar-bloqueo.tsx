"use client";

/**
 * «Ese día está bloqueado» — LA PREGUNTA ANTES DE AGENDAR. WS1-T3.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ES UNA CONFIRMACIÓN, NO UN PERMISO NUEVO
 *
 * Quien hoy puede crear o mover una cita la sigue pudiendo crear y mover:
 * recepción, doctor, admin y superadmin. Esta ventana no pregunta QUIÉN eres,
 * pregunta SI LO SABÍAS. El servidor sigue sin prohibir nada (ver
 * `agenda-bloqueos/core.ts`, «al staff se le avisa, no se le prohíbe»); lo
 * único que cambia es que ahora se entera antes y no después.
 *
 * 🔴 Y SOLO SALE SI DE VERDAD HAY UN BLOQUEO ENCIMA. El 99 % de las citas no
 * tocan ninguno y no pueden ganar un clic extra: quien llama comprueba con
 * `bloqueoQueTapa` —la misma función que usa el servidor— y si devuelve
 * `null` esta ventana ni se monta.
 *
 * Antes de esto la cita se guardaba y salía un toast gris de seis segundos
 * DESPUÉS. Se agendaba por accidente y nadie se enteraba.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DÓNDE SE MONTA, Y DÓNDE NO
 *
 * Se monta en los TRES caminos que abren un formulario: el alta
 * (`new-appointment-dialog`), el reagendar (`agenda-edit-appointment-modal`) y
 * la pantalla de citas de siempre (`appointments-client`). Una sola ventana
 * para los tres: con una por camino, el día que cambie el texto habría tres
 * versiones de la verdad.
 *
 * Los DOS caminos de arrastre —`agenda-nueva/confirmar-movimiento` y
 * `agenda/agenda-reschedule-confirm-modal`— NO la montan: pintan este mismo
 * aviso DENTRO de la ventana de confirmar que ya tienen. Soltar una cita ya
 * abre una confirmación, y encadenar dos para un solo gesto se convierte en
 * dos «aceptar» seguidos que nadie lee.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { diaLargo } from "./fechas";
import s from "./confirmar-bloqueo.module.css";

/**
 * Lo mínimo que hay que saber del bloqueo para preguntar. Es un subconjunto
 * del `BloqueoDTO` a propósito: así lo puede construir tanto quien lo sacó del
 * payload de la agenda como quien lo pidió a `/api/settings/bloqueos`.
 */
export interface BloqueoParaConfirmar {
  /** `null` = toda la clínica. Con id, solo ese doctor. */
  doctorId: string | null;
  doctorNombre: string | null;
  /** El MOTIVO que escribió la persona. Es obligatorio justo para esto. */
  reason: string;
}

export interface ConfirmarBloqueoProps {
  bloqueo: BloqueoParaConfirmar;
  /** El día de la cita, `YYYY-MM-DD` en la zona de la CLÍNICA. */
  dayISO: string;
  /** Mientras se guarda: los dos botones se bloquean y no se puede cerrar. */
  guardando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarBloqueo({
  bloqueo,
  dayISO,
  guardando = false,
  onConfirmar,
  onCancelar,
}: ConfirmarBloqueoProps) {
  const t = useT();
  const locale = useLocale();
  /**
   * 🔴 EL CANDADO DEL DOBLE CLIC, aquí y no en cada uno de los tres sitios
   * que montan esta ventana.
   *
   * Los tres cierran la confirmación antes de lanzar el guardado (para que
   * un error del servidor salga sobre el formulario y no sobre un aviso ya
   * cumplido), así que `guardando` puede no llegar a `true` antes de que el
   * componente se desmonte. En esa rendija, dos clics rápidos en «Agendar de
   * todas formas» mandan dos POST y crean DOS citas. Con el estado local el
   * botón se apaga en el primer clic pase lo que pase fuera.
   *
   * Efecto de ese desmontaje: la rama de `guardando` (el spinner) casi nunca
   * llega a verse. Se conserva igual porque el prop es parte del contrato y
   * quien monte esta ventana sin desmontarla sí lo necesita.
   */
  const [yaPulsado, setYaPulsado] = useState(false);
  const bloqueado = guardando || yaPulsado;

  // El alcance, escrito: «toda la clínica» o el nombre de quien se ausenta.
  // Es la diferencia entre «la clínica está en obra» y «la Dra. Ruiz está en
  // un congreso, pero los otros tres atienden».
  const alcance =
    bloqueo.doctorId === null
      ? t("agenda.bloqueos.confirmar.alcanceClinica")
      : bloqueo.doctorNombre ?? t("agenda.bloqueos.confirmar.alcanceDoctorSinNombre");

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
            {/* El triángulo de aviso, el mismo `AlertTriangle` de lucide que
                usa el resto del repo. El color NO es lo único que lo dice: el
                icono y el texto bastan sin verlo. */}
            <span className={s.icono} aria-hidden>
              <AlertTriangle size={20} strokeWidth={2.2} />
            </span>
            <Dialog.Title className={s.titulo}>
              {t("agenda.bloqueos.confirmar.titulo")}
            </Dialog.Title>
          </div>

          {/* La línea de datos: el día, el motivo y a quién alcanza. El MOTIVO
              y no la etiqueta del tipo — «Mantenimiento de clínica» explica el
              día; «Mantenimiento» a secas, no. */}
          <p className={s.datos}>
            <span className={s.dia}>{diaLargo(dayISO, locale)}</span>
            {/* El separador viaja DENTRO del trozo que introduce, no suelto:
                si no, al partir de línea se queda un «·» colgando al final del
                renglón anterior. */}
            <span className={s.motivo}>
              <span className={s.punto} aria-hidden>
                ·{" "}
              </span>
              {bloqueo.reason}
            </span>
            <span className={s.alcance}>
              <span className={s.punto} aria-hidden>
                ·{" "}
              </span>
              {alcance}
            </span>
          </p>

          <p className={s.explicacion}>
            {t("agenda.bloqueos.confirmar.cerradaPara")}
            <br />
            {t("agenda.bloqueos.confirmar.tuSiPuedes")}
          </p>

          <div className={s.pie}>
            <button
              type="button"
              className={s.cancelar}
              onClick={onCancelar}
              disabled={bloqueado}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={s.confirmar}
              onClick={() => {
                if (bloqueado) return;
                setYaPulsado(true);
                onConfirmar();
              }}
              disabled={bloqueado}
              autoFocus
            >
              {bloqueado ? (
                <>
                  <Loader2 size={15} className={s.girando} aria-hidden />
                  {t("agenda.bloqueos.confirmar.guardando")}
                </>
              ) : (
                t("agenda.bloqueos.confirmar.agendarIgual")
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
