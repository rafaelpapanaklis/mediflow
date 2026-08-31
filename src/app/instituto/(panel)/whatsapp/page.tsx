export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduWaConnectionDTO, getEduWaConfig, listEduWaMessages } from "@/lib/edu/whatsapp";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduWhatsappScreen } from "@/components/edu/whatsapp/whatsapp-screen";

export const metadata: Metadata = {
  title: "WhatsApp · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/whatsapp — la conexión del instituto con la Cloud API de Meta.
 *
 * EXIGE "whatsapp.view" AQUÍ, no solo en el menú: esconder el item del
 * sidebar no cierra ninguna puerta, basta con teclear la URL. Y lo vuelven a
 * exigir los cuatro endpoints, porque una página no protege a una API.
 *
 * 🔴 ES UNA PANTALLA DE DIRECCIÓN, y por eso las dos keys son solo suyas:
 * aquí se entrega un token que puede mandar mensajes en nombre de la escuela
 * y se encienden avisos que Meta le cobra a su tarjeta. MANDAR un documento
 * a un paciente NO se decide aquí —caja manda el recibo, el alumno manda la
 * carta— y por eso eso vive en la ficha del paciente, con el permiso del
 * documento.
 */
export default async function InstitutoWhatsappPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "whatsapp.view")) {
    return (
      <EduDenied
        permission="whatsapp.view"
        what="La conexión de WhatsApp del instituto: qué número está conectado, qué plantillas aprobó Meta, qué avisos salen y qué se le ha mandado a cada paciente."
      />
    );
  }

  const cfg = await getEduWaConfig(ctx.institutionId);
  const connection = eduWaConnectionDTO(cfg);
  const messages = await listEduWaMessages(ctx, { take: 50 });

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">WhatsApp</h1>
          <p className="edu-page__lead">
            Desde aquí sale el recordatorio de cita y desde aquí se autoriza mandar cartas de
            consentimiento y recibos. Todo va por <strong>plantilla aprobada</strong>: este panel no
            lee los mensajes que entran, así que no puede saber si la ventana de 24 h de WhatsApp
            está abierta y no manda texto libre nunca.
          </p>
        </div>
      </header>

      <EduWhatsappScreen
        connection={connection}
        messages={messages}
        canManage={hasEduPermission(permUser, "whatsapp.manage")}
        institutionName={ctx.institution.name}
      />
    </div>
  );
}
