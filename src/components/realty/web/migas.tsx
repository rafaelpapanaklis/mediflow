/* ═══════════════════════════════════════════════════════════════════════
   MIGAS DE PAN.

   Las mismas que se marcan como BreadcrumbList: si lo que se pinta y lo
   que se declara no coinciden, el marcado es contenido oculto y Google lo
   trata como tal. Por eso la lista se arma UNA vez (migasDe en
   _shared/seo.ts) y se le pasa a las dos.

   El último elemento no lleva liga: es la página en la que ya estás.
   ═══════════════════════════════════════════════════════════════════════ */

export function Migas({ migas }: { migas: Array<{ nombre: string; ruta: string }> }) {
  if (migas.length < 2) return null;
  return (
    <nav className="dcrw-migas" aria-label="Migas de pan">
      <ol>
        {migas.map((m, i) => {
          const ultima = i === migas.length - 1;
          return (
            <li key={m.ruta}>
              {ultima ? (
                <span aria-current="page">{m.nombre}</span>
              ) : (
                <a href={m.ruta}>{m.nombre}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
