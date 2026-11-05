"use client";

/**
 * ws1-t11 · fase 2 · P2 — QUIÉN MIRA LA AGENDA DE SIEMPRE (rol e id), para la cita «Sin doctor».
 *
 * La agenda de siempre no bajaba el rol por su árbol (el panel solo recibía `permissions`). Con la
 * cita «Sin doctor» hace falta: un DOCTOR con «solo sus citas» ve también las «Sin doctor» de
 * pacientes que puede ver (decisión D3) y puede TOMARLAS (asignárselas a sí mismo), marcar la
 * llegada e iniciar la consulta, pero no editarlas, moverlas, cancelarlas ni marcarlas no-asistió
 * mientras no sean suyas: el servidor le daría 403 (`doctorAlCambiarEstado` y `doctorPuedeEditar`
 * en src/lib/agenda/sin-doctor.ts). Aquí solo se esconde lo que el servidor va a rechazar; quien
 * decide sigue siendo el servidor.
 *
 * Sin proveedor (p. ej. el arnés de pruebas del panel) vale `{}`: se comporta como un rol que no
 * es DOCTOR, que es lo de siempre.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "@prisma/client";
import { doctorAlCambiarEstado } from "@/lib/agenda/sin-doctor";
import { possibleTransitions } from "@/lib/agenda/transitions";
import type { AppointmentStatus } from "@/lib/agenda/types";

export interface QuienMira {
  userRole?: Role;
  userId?: string;
}

const Contexto = createContext<QuienMira>({});

export function QuienMiraProvider({ value, children }: { value: QuienMira; children: ReactNode }) {
  return <Contexto.Provider value={value}>{children}</Contexto.Provider>;
}

export function useQuienMira(): QuienMira {
  return useContext(Contexto);
}

/** ¿Un DOCTOR mirando una cita «Sin doctor»? Entonces no la edita, mueve, cancela ni marca no-asistió. */
export function esDoctorConCitaSinDoctor(
  role: string | null | undefined,
  cita: { doctor?: { id: string } | null },
): boolean {
  return role === "DOCTOR" && !cita.doctor?.id;
}

/**
 * ¿Se le ofrece este cambio de estado? Solo descarta lo que el servidor rechazaría con 403 por ser
 * una «Sin doctor» que el DOCTOR todavía no tomó (no el 409 «elige quién atiende», que se pregunta).
 */
export function estadoPermitidoConSinDoctor(args: {
  role: string | null | undefined;
  userId: string | null | undefined;
  citaDoctorId: string | null | undefined;
  destino: string;
}): boolean {
  if (args.role !== "DOCTOR" || args.citaDoctorId) return true;
  const r = doctorAlCambiarEstado({
    role: "DOCTOR",
    userId: args.userId ?? "",
    citaDoctorId: null,
    destino: args.destino,
    pedido: undefined,
  });
  return r.rechazo?.status !== 403;
}

/**
 * ws1-t11 · P2 v2 (m1) — ¿se le ofrece este paso a quien mira? La tabla de ROLES de `transitions.ts` (la misma
 * que usa la agenda nueva y el servidor: p. ej. «Llegó» y «Confirmar» son de recepción, no del DOCTOR) y, encima,
 * la regla de la «Sin doctor». Sin rol (arneses, quien no lo pasa), solo la regla de la «Sin doctor».
 */
export function pasoPermitido(args: {
  role: string | null | undefined;
  userId: string | null | undefined;
  citaDoctorId: string | null | undefined;
  desde: AppointmentStatus;
  destino: AppointmentStatus;
}): boolean {
  if (args.role && !possibleTransitions(args.desde, { role: args.role as Role }).includes(args.destino)) return false;
  return estadoPermitidoConSinDoctor(args);
}
