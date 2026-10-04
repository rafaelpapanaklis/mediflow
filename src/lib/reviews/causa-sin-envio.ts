// N-65 (ws1-t8, segunda auditoría de uso): en Reseñas, «Invitaciones enviadas»
// decía «No se envió» con tres causas posibles a la vez («sin WhatsApp
// conectado, sin plantilla de reseñas o sin correo») y sin forma de
// resolverlo. Con lo que la clínica sí sabe —si tiene WhatsApp conectado— se
// dice la causa probable y se da el botón que la arregla.

export interface CausaSinEnvio {
  texto: string;
  accion: { texto: string; href: string };
}

export function causaSinEnvio(whatsappConectado: boolean | undefined, locale: string = "es"): CausaSinEnvio {
  const en = locale.startsWith("en");
  if (whatsappConectado === false) {
    return {
      texto: en
        ? "Not sent: the clinic has no WhatsApp connected and the patient had no email."
        : "No se envió: la clínica no tiene WhatsApp conectado y el paciente no tenía correo.",
      accion: { texto: en ? "Connect WhatsApp" : "Conectar WhatsApp", href: "/dashboard/whatsapp" },
    };
  }
  return {
    texto: en
      ? "Not sent: WhatsApp didn't accept it (the review template isn't approved) and the patient had no email."
      : "No se envió: WhatsApp no lo aceptó (la plantilla de reseñas no está aprobada) y el paciente no tenía correo.",
    accion: { texto: en ? "Check WhatsApp templates" : "Revisar plantillas de WhatsApp", href: "/dashboard/whatsapp/plantillas" },
  };
}
