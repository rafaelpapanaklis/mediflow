export const metadata = { title: "Pago de tu nota — DaleControl" };

/**
 * /pago/factura — a donde vuelve el paciente desde Mercado Pago tras pagar el
 * saldo de una factura con el link que le mandó la clínica (ws1-t1).
 *
 * Página SIN datos a propósito, como /pago/anticipo: no lee la base ni dice de
 * qué clínica ni de qué nota se trata. Lo que registra el pago es el webhook,
 * no esta vuelta. Solo se lee el estado que Mercado Pago pega en la URL, para
 * no decir «¡listo!» a quien le rechazaron la tarjeta.
 */
export default function PagoFacturaPage({
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
    ? "Tu pago quedó registrado en tu nota. Ya puedes cerrar esta ventana."
    : rechazado
      ? "No se hizo ningún cargo. Puedes volver a intentarlo con el mismo link mientras siga vigente, o comunicarte con la clínica."
      : "Cuando Mercado Pago lo acredite, el pago se registra solo en tu nota. Ya puedes cerrar esta ventana.";

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
