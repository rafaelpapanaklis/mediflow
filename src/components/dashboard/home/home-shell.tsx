// src/components/dashboard/home/home-shell.tsx
import type { ReactNode } from "react";
import styles from "./home.module.css";

/**
 * Envoltorio de /dashboard (única ruta que lo usa: src/app/dashboard/page.tsx).
 *
 * El padding LATERAL ya lo pone el <main> del layout — clamp(12px,1.5vw,28px).
 * Duplicarlo aquí le quitaba ~48 px al contenido a 1280 px. En `.shell` sólo
 * queda el vertical, y además se declara el contenedor de consulta que usan
 * los grids del home (ver home.module.css).
 */
export function HomeShell({ children }: { children: ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}
