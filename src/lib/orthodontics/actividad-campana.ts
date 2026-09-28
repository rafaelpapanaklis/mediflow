// Ortodoncia en la campana de actividad (ws1-t5, 28-sep-2026; fila 8 del mapa
// de la revisión de lógica de uso). PURO: sin Prisma ni React.
//
// La campana no tenía ningún evento de ortodoncia: un control atendido salía
// como «Cita completada» y abría la agenda; el pago de una mensualidad, como
// un «Pago recibido» cualquiera; y abrir un caso no salía en ningún sitio.
//
// Aquí solo se decide QUÉ DICE cada evento y A DÓNDE LLEVA. Qué filas se leen,
// de qué clínica y con qué visibilidad lo decide la ruta
// (src/app/api/dashboard/activity/route.ts) con la sesión.

import { esCitaControlOrto } from "./agenda-constants";

function nombre(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function fichaEnOrtodoncia(patientId: string): string {
  return `/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia`;
}

/**
 * Una cita completada. Si es un control de ortodoncia lo dice, y —para quien
 * puede entrar al módulo— lleva al caso del paciente en vez de a la agenda.
 */
export function eventoDeCitaCompletada(
  cita: { type: string | null | undefined; patientId: string | null; patient: { firstName: string; lastName: string } },
  e: { accesoOrtodoncia: boolean; hrefDeLaCita: string },
): { title: string; href: string } {
  if (!esCitaControlOrto(cita.type)) {
    return { title: `Cita completada — ${nombre(cita.patient)}`, href: e.hrefDeLaCita };
  }
  return {
    title: `Control de ortodoncia atendido — ${nombre(cita.patient)}`,
    href: e.accesoOrtodoncia && cita.patientId ? fichaEnOrtodoncia(cita.patientId) : e.hrefDeLaCita,
  };
}

/** Un pago. Si la factura es la de un caso de ortodoncia, lo dice. El enlace no cambia: abre la factura. */
export function eventoDePago(
  factura: { paid: number; paymentMethod: string | null; patient: { firstName: string; lastName: string } },
  e: { esDeOrtodoncia: boolean },
): { title: string; subtitle: string } {
  const importe = `$${Number(factura.paid).toLocaleString("es-MX")}`;
  const metodo = factura.paymentMethod ? ` · ${factura.paymentMethod}` : "";
  return e.esDeOrtodoncia
    ? { title: `Pago de ortodoncia — ${nombre(factura.patient)}`, subtitle: `${importe}${metodo} · plan de pago del caso` }
    : { title: `Pago recibido — ${nombre(factura.patient)}`, subtitle: `${importe}${metodo}` };
}

export interface EventoCasoAbierto {
  id: string;
  type: "ortho_case";
  title: string;
  href: string;
  at: Date;
}

/** Un caso de ortodoncia recién abierto: lleva al caso. */
export function eventoDeCasoAbierto(plan: {
  id: string;
  patientId: string;
  createdAt: Date;
  patient: { firstName: string; lastName: string };
}): EventoCasoAbierto {
  return {
    id: `orto-caso-${plan.id}`,
    type: "ortho_case",
    title: `Caso de ortodoncia abierto — ${nombre(plan.patient)}`,
    href: fichaEnOrtodoncia(plan.patientId),
    at: plan.createdAt,
  };
}
