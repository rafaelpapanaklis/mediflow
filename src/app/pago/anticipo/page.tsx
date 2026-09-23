export const metadata = { title: "Pago de anticipo — DaleControl" };

/**
 * /pago/anticipo — a donde vuelve el paciente desde Mercado Pago tras pagar el
 * anticipo de su cita (WS1-T5).
 *
 * Página SIN datos a propósito: no lee la base ni dice de qué clínica ni de qué
 * cita se trata. Lo que manda es el webhook, no esta vuelta: la confirmación
 * de verdad le llega al paciente por WhatsApp. Solo se lee el estado que
 * Mercado Pago pega en la URL, para no decir «¡listo!» a quien le rechazaron
 * la tarjeta.
 */
export default function PagoAnticipoPage({
  searchParams,
}: {
  searchParams?: { collection_status?: string; status?: string };
}) {
  const estado = searchParams?.collection_status ?? searchParams?.status ?? "";
  const aprobado = estado === "approved";
  const rechazado = estado === "rejected" || estado === "null" || estado === "cancelled";

  const icono = aprobado ? "✅" : rechazado ? "⚠️" : "⏳";
  const titulo = aprobado ? "¡Pago recibido!" : rechazado ? "El pago no se completó" : "Estamos revisando tu pago";
  const texto = aprobado
    ? "En unos segundos te llega por WhatsApp la confirmación de tu cita. Ya puedes cerrar esta ventana."
    : rechazado
      ? "No se hizo ningún cargo. Puedes volver a intentarlo con el mismo link mientras siga vigente, o escribirle a la clínica por WhatsApp."
      : "Cuando Mercado Pago lo acredite te avisamos por WhatsApp. Si el plazo vence antes, el horario se libera.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md text-center">
        <div className="w-20 h-20 rounded-full bg-white dark:bg-slate-900 border border-border flex items-center justify-center text-4xl mx-auto mb-6">
          {icono}
        </div>
        <h1 className="text-2xl font-extrabold mb-2">{titulo}</h1>
        <p className="text-muted-foreground">{texto}</p>
      </div>
    </div>
  );
}
