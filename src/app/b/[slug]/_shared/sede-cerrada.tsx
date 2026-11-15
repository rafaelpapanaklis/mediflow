import Link from "next/link";

/**
 * Pantalla de una sede cerrada (la cadena sigue abierta): en vez de invitar a
 * reservar o dar un 404 sin salida, le dice al cliente a dónde ir.
 */
export function SedeCerrada({ nombre, otras }: { nombre: string; otras: { name: string; slug: string }[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-1 text-2xl font-extrabold text-slate-900">Esta sucursal ya no está disponible</h1>
        <p className="mb-1 text-slate-600">{nombre} cerró. Puedes reservar en otra sede:</p>
        <p className="mb-5 text-sm text-slate-500">This branch is no longer available. You can book at another location:</p>
        <ul className="grid gap-2">
          {otras.map((o) => (
            <li key={o.slug}>
              <Link
                href={`/b/${o.slug}`}
                className="block rounded-xl bg-slate-900 px-6 py-3 font-bold text-white transition-opacity hover:opacity-90"
              >
                {o.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
