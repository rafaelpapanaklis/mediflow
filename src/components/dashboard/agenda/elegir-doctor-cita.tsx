"use client";

/**
 * ws1-t11 · fase 2 · P2 — ELEGIR EL DOCTOR DE UNA CITA «SIN DOCTOR» (decisión D9 del plan).
 *
 *  · «Llegó» (`llegada`): «¿Quién lo atiende?», OPCIONAL. Abre en «Sin doctor»; registrar la llegada
 *    así deja la cita como estaba.
 *  · «Pasar a consulta» (`iniciar`): OBLIGATORIO. La nota, el cobro y los reportes van a nombre del
 *    doctor de la cita, así que no se ofrece «Sin doctor». Un DOCTOR que la inicia se la queda solo
 *    (lo hace el servidor): a él no se le pregunta.
 *  · «Asignar doctor» (`asignar`): desde el panel de la cita, a quien pueda editarla.
 *
 * Nunca se pide al cobrar ni al recetar. Quién puede qué lo decide el servidor
 * (`doctorAlCambiarEstado` en src/lib/agenda/sin-doctor.ts); aquí solo se pregunta.
 *
 * Uso: `const { pedir, dialogo } = usePedirDoctor();` — `pedir` resuelve con el elegido
 * (`{ doctorId }`, `null` = «Sin doctor») o con `null` si la persona canceló. `dialogo` se monta
 * donde sea (va en un portal).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Stethoscope, UserRound } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { OPCION_SIN_DOCTOR, doctorIdParaEnviar } from "@/components/dashboard/new-appointment/doctor-inicial";
import s from "./elegir-doctor-cita.module.css";

export type ModoElegirDoctor = "llegada" | "iniciar" | "asignar";

export interface DoctorElegible {
  id: string;
  nombre: string;
}

/**
 * ¿Hay que preguntar el doctor antes de este cambio de estado? `null` = no (se manda tal cual).
 * Solo con una cita «Sin doctor» y quien la mueve no es DOCTOR (al DOCTOR el servidor se la
 * asigna solo al iniciar o terminar, y al llegar no la toma salvo que la pida).
 */
export function preguntaAntesDelEstado(args: {
  destino: string;
  citaDoctorId: string | null | undefined;
  role: string | null | undefined;
}): ModoElegirDoctor | null {
  if (args.citaDoctorId) return null;
  if (args.role === "DOCTOR") return null;
  if (args.destino === "CHECKED_IN") return "llegada";
  if (args.destino === "IN_PROGRESS") return "iniciar";
  return null;
}

interface Pregunta {
  modo: ModoElegirDoctor;
  paciente: string | null;
  doctores: DoctorElegible[];
  responder: (r: { doctorId: string | null } | null) => void;
}

export function usePedirDoctor(): {
  pedir: (args: { modo: ModoElegirDoctor; paciente?: string | null; doctores: DoctorElegible[] }) => Promise<{ doctorId: string | null } | null>;
  dialogo: ReactNode;
} {
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);
  // La pregunta abierta, para no dejar una promesa sin resolver si llega otra o el componente se desmonta
  // (quien espera queda como si hubieran pulsado «Cancelar»).
  const abierta = useRef<Pregunta | null>(null);
  useEffect(
    () => () => {
      abierta.current?.responder(null);
      abierta.current = null;
    },
    [],
  );

  const pedir = useCallback(
    (args: { modo: ModoElegirDoctor; paciente?: string | null; doctores: DoctorElegible[] }) =>
      new Promise<{ doctorId: string | null } | null>((responder) => {
        abierta.current?.responder(null);
        const nueva: Pregunta = { modo: args.modo, paciente: args.paciente ?? null, doctores: args.doctores, responder };
        abierta.current = nueva;
        setPregunta(nueva);
      }),
    [],
  );

  const dialogo = pregunta ? (
    <ElegirDoctorCita
      modo={pregunta.modo}
      paciente={pregunta.paciente}
      doctores={pregunta.doctores}
      onElegir={(doctorId) => {
        pregunta.responder({ doctorId });
        abierta.current = null;
        setPregunta(null);
      }}
      onCancelar={() => {
        pregunta.responder(null);
        abierta.current = null;
        setPregunta(null);
      }}
    />
  ) : null;

  return { pedir, dialogo };
}

export interface ElegirDoctorCitaProps {
  modo: ModoElegirDoctor;
  paciente?: string | null;
  doctores: DoctorElegible[];
  /** `null` = «Sin doctor» (solo en `llegada`). */
  onElegir: (doctorId: string | null) => void;
  onCancelar: () => void;
}

export function ElegirDoctorCita({ modo, paciente = null, doctores, onElegir, onCancelar }: ElegirDoctorCitaProps) {
  const t = useT();
  const conSinDoctor = modo === "llegada";
  // Con un solo doctor en `iniciar`/`asignar` ya va elegido: un clic menos y nada que adivinar.
  const [valor, setValor] = useState<string>(
    conSinDoctor ? OPCION_SIN_DOCTOR : doctores.length === 1 ? doctores[0].id : "",
  );
  const [yaPulsado, setYaPulsado] = useState(false);
  const listo = valor !== "" && !yaPulsado;

  const titulo =
    modo === "llegada"
      ? t("agenda.sinDoctor.llegada.titulo")
      : modo === "iniciar"
        ? t("agenda.sinDoctor.iniciar.titulo")
        : t("agenda.sinDoctor.asignar.titulo");
  const explicacion =
    modo === "llegada"
      ? t("agenda.sinDoctor.llegada.explicacion")
      : modo === "iniciar"
        ? t("agenda.sinDoctor.iniciar.explicacion")
        : t("agenda.sinDoctor.asignar.explicacion");
  const confirmar =
    modo === "llegada"
      ? t("agenda.sinDoctor.llegada.confirmar")
      : modo === "iniciar"
        ? t("agenda.sinDoctor.iniciar.confirmar")
        : t("agenda.sinDoctor.asignar.confirmar");

  return (
    <Dialog.Root
      open
      onOpenChange={(abierto) => {
        if (!abierto && !yaPulsado) onCancelar();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.velo} />
        <Dialog.Content
          className={s.caja}
          aria-describedby={undefined}
          data-elegir-doctor={modo}
          onEscapeKeyDown={(e) => {
            if (yaPulsado) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (yaPulsado) e.preventDefault();
          }}
        >
          <div className={s.cabecera}>
            <span className={s.icono} aria-hidden>
              {modo === "iniciar" ? <Stethoscope size={20} strokeWidth={2.2} /> : <UserRound size={20} strokeWidth={2.2} />}
            </span>
            <Dialog.Title className={s.titulo}>{titulo}</Dialog.Title>
          </div>

          <p className={s.explicacion}>
            {paciente ? (
              <>
                <span className={s.paciente}>{paciente}</span>
                {" · "}
              </>
            ) : null}
            {explicacion}
          </p>

          <label className={s.campo}>
            <span className={s.rotulo}>{t("agenda.sinDoctor.campoProfesional")}</span>
            <select
              className={s.selector}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              autoFocus
              data-selector-doctor
            >
              {conSinDoctor ? (
                <option value={OPCION_SIN_DOCTOR}>{t("agenda.sinDoctor.decidirDespues")}</option>
              ) : (
                <option value="" disabled>
                  {t("agenda.sinDoctor.eligeDoctor")}
                </option>
              )}
              {doctores.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </label>

          <div className={s.pie}>
            <button type="button" className={s.cancelar} onClick={onCancelar} disabled={yaPulsado}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={s.confirmar}
              disabled={!listo}
              data-confirmar-doctor
              onClick={() => {
                setYaPulsado(true);
                onElegir(doctorIdParaEnviar(valor));
              }}
            >
              {yaPulsado ? <Loader2 size={16} className={s.girando} aria-hidden /> : null}
              {confirmar}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
