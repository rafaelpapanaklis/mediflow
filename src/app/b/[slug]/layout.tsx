/* ═══════════════════════════════════════════════════════════════════════
   LAYOUT DE /b/[slug] — deliberadamente NEUTRO.

   Debajo de esta ruta viven tres cosas de DOS terminales distintas:

     /b/[slug]            · la página de la barbería   (esta terminal)
     /b/[slug]/reservar   · el embudo de reserva       (T5)
     /b/[slug]/mi-cuenta  · el portal del cliente      (T5)

   Un layout que pintara cabecera, tema o CSS de la mini-web se los
   impondría a las dos rutas de T5 y las obligaría a pelearse con él. Por
   eso aquí no hay nada: ni <div>, ni clase, ni import de CSS. La piel de
   la mini-web la trae su propio componente de plantilla (que importa
   skins.css) y termina donde termina la plantilla.

   Tampoco hay guard de sesión: /b/** es PÚBLICO. El middleware ni
   siquiera lo intercepta (su matcher es /dashboard, /admin, /api y
   /proveedores). Cada página resuelve su propio tenant por el slug de la
   URL.

   Si alguna vez hace falta algo compartido de verdad aquí (una fuente,
   un tema), se acuerda con T5 antes: este archivo es de los dos.
   ═══════════════════════════════════════════════════════════════════════ */

export default function BarberWebLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
