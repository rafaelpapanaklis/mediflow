import { getBarberContext } from "@/lib/barber-auth";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { BarberPanelNotFound } from "@/components/barber/barber-panel-not-found";

/**
 * «No encontrado» del panel de barber (QA de cierre D, 16-nov).
 *
 * Sin este archivo, un notFound() de cualquier página del panel caía en el
 * 404 de la raíz, que es el del dental: un hospital 🏥 y «Volver al inicio»
 * llevando a otro producto. Lo vio un Barbero al abrir el recibo de comisiones
 * de un compañero.
 *
 * Vive dentro de (panel): se pinta con el menú y el tema del panel, y cubre
 * recibo de comisiones, ticket, corte y ficha de cliente. La respuesta es la
 * misma si lo pedido no existe que si es de otra persona o de otra barbería.
 */
export default async function BarberPanelNotFoundPage() {
  // Solo para el idioma. Si la sesión no se puede leer, español.
  const ctx = await getBarberContext().catch(() => null);
  const t = getBarberT(ctx?.barbershop.locale);
  return (
    <BarberPanelNotFound
      title={t("barber.shell.notFound.title")}
      body={t("barber.shell.notFound.body")}
      cta={t("barber.shell.notFound.cta")}
    />
  );
}
