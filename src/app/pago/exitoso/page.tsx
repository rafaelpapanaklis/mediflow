import Link from "next/link";
export const metadata = { title: "Pago exitoso — MediFlow" };
export default function PagoExitosoPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-4xl mx-auto mb-6">✅</div>
        <h1 className="text-2xl font-extrabold mb-2">¡Pago confirmado!</h1>
        <p className="text-muted-foreground mb-6">Tu teleconsulta está confirmada. Recibirás un mensaje de WhatsApp con el link para unirte.</p>
        <div className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5 mb-6 text-sm text-left space-y-2">
          <div className="font-bold">Recomendaciones para tu teleconsulta:</div>
          <div>📶 Asegúrate de tener buena conexión a internet</div>
          <div>🎧 Usa audífonos para mejor audio</div>
          <div>📱 Puedes unirte desde celular o computadora</div>
          <div>⏰ Entra 5 minutos antes de tu cita</div>
        </div>
        <Link href="/" className="text-brand-600 font-semibold hover:underline">Volver al inicio</Link>
      </div>
    </div>
  );
}
