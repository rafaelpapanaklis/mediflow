import type { HomeActionItem } from "@/lib/home/types";

/**
 * «N citas sin confirmar» (ws1-t1, C-101). Antes el botón «Recordar por WhatsApp» llevaba a
 * `/dashboard/whatsapp?intent=remind`, que es la pantalla de CONECTAR WhatsApp (recepción no la administra) y
 * no recordaba nada. Ahora abre la Agenda del día en la primera cita sin confirmar, donde están «Confirmar» y
 * «Enviar recordatorio». Sin WhatsApp conectado no promete un WhatsApp: lo dice y propone llamar.
 */
export function accionCitasSinConfirmar(
  unconfirmed: Array<{ id: string; patient: { name: string } }>,
  dateISO: string,
  waConnected: boolean,
): HomeActionItem {
  const nombres = unconfirmed
    .slice(0, 3)
    .map((a) => a.patient.name.split(" ")[0])
    .join(", ");
  return {
    id: "unconfirmed",
    tone: "warning",
    title: `${unconfirmed.length} cita${unconfirmed.length === 1 ? "" : "s"} sin confirmar`,
    detail: waConnected
      ? nombres
      : `${nombres} · WhatsApp no está conectado: al paciente no le llega ningún recordatorio`,
    cta: {
      label: waConnected ? "Recordar por WhatsApp" : "Confirmar por teléfono",
      href: `/dashboard/agenda?date=${dateISO}&highlight=${encodeURIComponent(unconfirmed[0].id)}`,
    },
  };
}
