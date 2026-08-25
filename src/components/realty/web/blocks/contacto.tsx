/* ═══════════════════════════════════════════════════════════════════════
   BLOQUE: CONTACTO.

   Obligatorio en las nueve plantillas. Lo que se escribe aquí NO se manda
   a un correo: cae directo en el CRM como prospecto con la fuente marcada
   (ver lead-action.ts). Un formulario público que solo manda un correo es
   un prospecto que se pierde en cuanto alguien no revisa la bandeja.
   ═══════════════════════════════════════════════════════════════════════ */

import { ligaWhatsApp, type RealtyWebData } from "@/lib/realty/landing";
import { copia, subtitulo, titulo, variante, whatsappDe, Encabezado, Sec } from "@/components/realty/web/helpers";
import { ContactoForm } from "@/components/realty/web/contacto-form";

const ID = "contacto";

export function BloqueContacto({ data }: { data: RealtyWebData }) {
  const v = variante(data, ID);
  const wa = ligaWhatsApp(whatsappDe(data), `Hola, vi ${data.cuenta.nombre} en internet.`);

  return (
    <Sec id={ID} variante={v}>
      <Encabezado titulo={titulo(data, ID)} subtitulo={subtitulo(data, ID)} centrado={v === "compacto"} />
      <ContactoForm
        slug={data.cuenta.slug}
        whatsapp={wa}
        editando={data.editando}
        etiquetas={{
          nombre: copia(data, ID, "contacto.nombre"),
          telefono: copia(data, ID, "contacto.telefono"),
          mensaje: copia(data, ID, "contacto.mensaje"),
          enviar: copia(data, ID, "contacto.enviar"),
          whatsapp: copia(data, ID, "contacto.whatsapp"),
          aviso: copia(data, ID, "contacto.aviso"),
        }}
      />
    </Sec>
  );
}
