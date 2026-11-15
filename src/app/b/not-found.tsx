import Link from "next/link";

/**
 * 404 de las páginas públicas de barbería (`/b/<slug>…`).
 *
 * Antes caía en el 404 de la raíz, que es el del dental: un hospital 🏥 y
 * «Volver al inicio» llevando a otro producto. Aquí el cliente de una barbería
 * que ya no existe (o cuya página se apagó) lee algo que sí le sirve.
 * Bilingüe porque aquí no hay barbería de la que leer el idioma.
 */
export default function BarberPublicNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="max-w-sm text-center">
        <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-500">404</p>
        <h1 className="mb-2 text-2xl font-extrabold text-slate-900">No encontramos esta barbería</h1>
        <p className="mb-1 text-slate-600">Revisa que la liga esté completa o pídele a tu barbería que te la mande otra vez.</p>
        <p className="mb-6 text-sm text-slate-500">
          We couldn&apos;t find this barbershop. Check the link or ask them to send it again.
        </p>
        <Link
          href="/barberias"
          className="inline-block rounded-xl bg-slate-900 px-6 py-2.5 font-bold text-white transition-opacity hover:opacity-90"
        >
          DaleControl Barber
        </Link>
      </div>
    </main>
  );
}
