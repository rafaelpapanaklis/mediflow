import Link from "next/link";
export const metadata = { title: "Pago cancelado — MediFlow" };
export default function PagoCanceladoPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md text-center">
        <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-4xl mx-auto mb-6">⚠️</div>
        <h1 className="text-2xl font-extrabold mb-2">Pago cancelado</h1>
        <p className="text-muted-foreground mb-6">El pago no fue procesado. Puedes intentar de nuevo cuando estés listo.</p>
        <Link href="/" className="inline-block bg-brand-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-brand-700 transition-colors">Volver al inicio</Link>
      </div>
    </div>
  );
}
