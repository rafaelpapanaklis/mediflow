import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="text-6xl mb-4">🏥</div>
        <h1 className="text-3xl font-extrabold mb-2">404</h1>
        <p className="text-muted-foreground mb-6">Página no encontrada</p>
        <Link href="/" className="bg-brand-600 text-white font-bold px-6 py-2.5 rounded-xl hover:bg-brand-700 transition-colors">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
