// ─────────────────────────────────────────────────────────────────────────────
// <script type="application/ld+json"> — helper ÚNICO del blog.
//
// Por qué hace falta un helper y no se puede pasar el JSON como children:
// React escapa el texto de un hijo (`"` → `&quot;`), y dentro de <script> el
// parser HTML no decodifica entidades → el JSON llegaría corrupto a Google.
// La inyección cruda es el patrón oficial de Next.js para JSON-LD y el que ya
// usan src/app/page.tsx y /descubre/**.
//
// Este es el ÚNICO archivo del blog que inyecta HTML. Nunca recibe contenido
// del artículo tal cual: sólo objetos que construimos nosotros y pasamos por
// JSON.stringify. Además se escapa el signo de menor-que a su forma unicode,
// que cierra el único vector real aquí: un título que contenga una etiqueta
// de cierre de script y parta el bloque en dos.
// ─────────────────────────────────────────────────────────────────────────────

export function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
