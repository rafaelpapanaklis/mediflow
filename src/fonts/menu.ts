import localFont from "next/font/local";

// Menú de dos niveles (`src/components/dashboard/menu-dos-niveles/`): la
// tipografía del menú y su juego de íconos. Solo lo pinta la clínica que tiene
// el menú encendido, así que ninguna de las dos se PRECARGA: con `preload`, el
// layout del panel —que importa los dos menús— haría que TODAS las clínicas
// descargaran estos archivos aunque nunca los usaran. Sin precarga, el
// navegador los pide solo cuando algo en pantalla los usa.

export const instrumentSans = localFont({
  src: [{ path: "./instrument-sans-latin-var.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-menu",
  display: "swap",
  preload: false,
});

// Material Symbols Rounded recortado a los íconos del menú (ver
// `ICONOS_MENU` en menu-dos-niveles/iconos.ts y el README de esta carpeta).
// Es una fuente de LIGADURAS: el texto "home" se dibuja como el ícono. Con
// `block`, mientras carga no se ve la palabra, se ve un hueco.
export const materialSymbols = localFont({
  src: [{ path: "./material-symbols-rounded-menu.woff2", style: "normal" }],
  variable: "--font-iconos-menu",
  display: "block",
  preload: false,
  adjustFontFallback: false,
});
