/* ═══════════════════════════════════════════════════════════════════════
   Layout NEUTRO de la web pública de una cuenta de inmuebles.

   No pinta nada y no lleva guard: /i/** es PÚBLICO y el middleware ni
   siquiera lo intercepta (su matcher son /dashboard, /admin, /api y
   /proveedores). Tampoco importa CSS: la piel viaja con el motor
   (src/components/realty/web/skin.css), que solo se carga en las rutas que
   de verdad pintan una plantilla.

   Existe para que las cinco rutas de dentro compartan el mismo árbol y
   para dejar escrito, aquí, POR QUÉ está vacío — si no, alguien lo
   "arregla" metiéndole el tema del panel y le mete a un visitante de
   Google el CSS del sidebar.
   ═══════════════════════════════════════════════════════════════════════ */

export default function LayoutWebInmuebles({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
