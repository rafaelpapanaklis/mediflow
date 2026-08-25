// ═══════════════════════════════════════════════════════════════════════
// Armazón de /barberias/comparar/**.
//
// Trae el tema caramelo (.barber-shell) y la piel de las comparativas, y
// pinta la barra de arriba y el pie UNA vez para las cuatro páginas.
//
// ⚠️ COORDINACIÓN CON LA TERMINAL DE LA LANDING
// ────────────────────────────────────────────────────────────────────────
// Cuando escribí esto, /barberias todavía no existía, así que estas páginas
// se sostienen solas: traen su propia barra y su propio pie. Si la landing
// crea src/app/barberias/layout.tsx CON barra y pie propios, van a salir
// dos. El arreglo es de un archivo: borrar el <CompararShell> de aquí y
// dejar `return <>{children}</>`, conservando los dos imports de CSS. Los
// componentes de las páginas no cambian.
// ═══════════════════════════════════════════════════════════════════════
import { getBarberT } from "@/i18n/dictionaries/barber";
import { CompararShell } from "@/components/public/barberias/comparar/comparar-ui";
import "@/app/barber/barber-theme.css";
import "@/components/public/barberias/comparar/comparar.css";

export default function CompararLayout({ children }: { children: React.ReactNode }) {
  // Las comparativas se escriben para el mercado mexicano: locale fijo `es`.
  // El diccionario tiene su gemelo en inglés (comparar.en.json) por si el
  // vertical algún día abre rutas por idioma; hoy no las hay.
  const t = getBarberT("es");
  return <CompararShell t={t}>{children}</CompararShell>;
}
