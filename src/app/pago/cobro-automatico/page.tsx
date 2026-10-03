export const metadata = { title: "Cobro automático — DaleControl" };

/**
 * /pago/cobro-automatico — a donde vuelve el paciente desde Mercado Pago tras
 * registrar su tarjeta para el cobro automático de sus mensualidades (ws1-t6).
 *
 * Página SIN datos a propósito, como /pago/factura: no lee la base ni dice de qué
 * clínica se trata. Lo que activa el cobro es el aviso de Mercado Pago al
 * webhook, no esta vuelta. La tarjeta se queda en Mercado Pago: DaleControl
 * nunca la ve.
 */
export default function PagoCobroAutomaticoPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md text-center">
        <div className="w-20 h-20 rounded-full bg-white dark:bg-slate-900 border border-border flex items-center justify-center text-4xl mx-auto mb-6">
          💳
        </div>
        <h1 className="text-2xl font-extrabold mb-2">Listo, gracias</h1>
        <p className="text-muted-foreground">
          Si Mercado Pago aceptó tu tarjeta, tus mensualidades se cobrarán solas en las fechas de tu plan y recibirás
          un recibo por cada cobro. Tu tarjeta se queda guardada en Mercado Pago; la clínica no la ve. Para cancelar
          el cobro automático, avisa a la clínica.
        </p>
        <p className="text-muted-foreground mt-4">
          All set. If Mercado Pago accepted your card, your monthly payments will be charged automatically on your
          plan dates. Your card stays with Mercado Pago; the clinic never sees it.
        </p>
      </div>
    </div>
  );
}
