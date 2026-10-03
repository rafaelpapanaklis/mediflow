// Cobro automático (ws1-t6) — lo que pasa ALREDEDOR de un cobro: el recibo al
// paciente, la línea en Movimientos y el refresco de la factura. Ninguno lanza:
// el dinero ya quedó registrado y un WhatsApp que no sale no lo deshace.

import { prisma } from "@/lib/prisma";
import { registrarMovimientoDelPaciente, registrarMovimientoExterno } from "@/lib/movimientos-paciente/registrar";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { contactoDelResponsableDeLaFactura } from "@/lib/orthodontics/responsable-telefono-db";
import { destinatariosDeEnvio } from "@/lib/invoices/destinatarios";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { formatoPesos } from "./core";
import type { EfectosCobro } from "./servicio.server";

/** El texto del recibo (dentro de la ventana de 24 h; fuera, la plantilla dc_recibo_pago si la clínica la encendió). */
export function textoReciboAutomatico(d: { nombre: string; clinica: string; monto: number; folio: string; cuota: string | null }): string {
  const detalle = [d.cuota, d.folio ? `factura ${d.folio}` : null].filter(Boolean).join(", ");
  return (
    `Hola ${d.nombre}, en ${d.clinica} recibimos el cobro automático de ${formatoPesos(d.monto)} con tu tarjeta` +
    `${detalle ? ` (${detalle})` : ""}. ¡Gracias!`
  );
}

export const efectos: EfectosCobro = {
  async recibo(a) {
    try {
      const inv = await prisma.invoice.findFirst({
        where: { id: a.invoiceId, clinicId: a.clinicId },
        select: {
          patient: { select: { firstName: true, lastName: true, phone: true } },
          clinic: { select: { id: true, name: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, waTemplates: true } },
        },
      });
      const clinic = inv?.clinic;
      if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) return;
      const paciente = inv?.patient ? `${inv.patient.firstName} ${inv.patient.lastName ?? ""}`.trim() : "Paciente";
      // Mismo criterio que «Enviar recibo»: al responsable de pago si tiene teléfono, si no al paciente.
      const responsable = await contactoDelResponsableDeLaFactura(a.clinicId, a.invoiceId);
      const { destinatarios } = destinatariosDeEnvio({
        paciente: { nombre: paciente, telefono: inv?.patient?.phone },
        responsable: responsable ? { nombre: responsable.nombre, parentesco: responsable.parentesco, telefono: responsable.telefono } : null,
        canal: "telefono",
        destino: "auto",
      });
      for (const d of destinatarios) {
        try {
          await sendWhatsAppLogged({
            clinic: {
              id: clinic.id,
              waPhoneNumberId: clinic.waPhoneNumberId,
              waAccessToken: clinic.waAccessToken,
              waConnected: clinic.waConnected,
              waTemplates: clinic.waTemplates,
            },
            to: d.valor,
            body: textoReciboAutomatico({ nombre: d.nombre, clinica: clinic.name, monto: a.monto, folio: a.folio, cuota: a.cuota }),
            kind: "payment_receipt",
            patientId: a.patientId,
            templateParams: [d.nombre, clinic.name, formatoPesos(a.monto), a.folio],
          });
        } catch (e) {
          // Fuera de la ventana sin la plantilla encendida, o WhatsApp caído: se anota y sigue.
          console.error(`[cobro-automatico] recibo no enviado (factura ${a.invoiceId}): ${(e as Error).message}`);
        }
      }
    } catch (e) {
      console.error(`[cobro-automatico] no se pudo preparar el recibo (factura ${a.invoiceId}): ${(e as Error).message}`);
    }
  },

  async movimiento(a) {
    if (!a.patientId) return;
    if (a.userId) {
      await registrarMovimientoDelPaciente({
        clinicId: a.clinicId, userId: a.userId, patientId: a.patientId,
        entityType: a.entityType, entityId: a.entityId, action: "update", texto: a.texto, categoria: "dinero",
      });
    } else {
      await registrarMovimientoExterno({
        actor: "patient", origen: "Cobro automático (Mercado Pago)",
        clinicId: a.clinicId, patientId: a.patientId,
        entityType: a.entityType, entityId: a.entityId, action: a.entityType === "payment" ? "create" : "update",
        texto: a.texto, categoria: "dinero",
      });
    }
  },

  async saldoCambio(a) {
    await cerrarLinksDeFactura({ clinicId: a.clinicId, invoiceId: a.invoiceId }).catch(() => 0);
    try {
      revalidateAfter("invoices");
    } catch {
      // Refrescar la caché de Caja no puede tumbar un cobro ya registrado.
    }
  },
};
