"use client";
// Módulo de Ortodoncia — el submenú (ws1-t3). Es el menú que se queda a la
// vista cuando el lateral se recoge al entrar al módulo, así que dice dónde
// estás (apartado abierto en violeta, `aria-current`) y se queda pegado
// arriba. Qué apartados hay y en qué orden lo decide el layout, que es quien
// se lo pasa: aquí solo se pintan.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  CalendarClock,
  LayoutDashboard,
  Settings2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import s from "./modulo.module.css";

export interface ApartadoSubmenu {
  href: string;
  label: string;
}

/** Por la última parte de la ruta; un apartado que no esté aquí sale sin ícono. */
const ICONO: Record<string, LucideIcon> = {
  tablero: LayoutDashboard,
  pacientes: Users,
  cobranza: Wallet,
  controles: CalendarClock,
  alertas: BellRing,
  configuracion: Settings2,
};

export function SubmenuOrtodoncia({ apartados }: { apartados: readonly ApartadoSubmenu[] }) {
  const pathname = usePathname() ?? "";
  const barra = useRef<HTMLElement>(null);

  // En el teléfono la fila se desliza: que el apartado abierto quede a la
  // vista. Se mueve SOLO la barra (scrollLeft), nunca la página.
  useEffect(() => {
    const centrar = () => {
      const caja = barra.current;
      const activo = caja?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!caja || !activo || caja.scrollWidth <= caja.clientWidth) return;
      caja.scrollLeft = activo.offsetLeft - (caja.clientWidth - activo.offsetWidth) / 2;
    };
    centrar();
    // Girar el teléfono o estrechar la ventana cambia lo que cabe.
    window.addEventListener("resize", centrar);
    return () => window.removeEventListener("resize", centrar);
  }, [pathname]);

  return (
    <div className={s.submenuPegajoso}>
      <nav ref={barra} className={s.submenu} aria-label="Apartados de Ortodoncia">
        {apartados.map((a) => {
          const activo = pathname === a.href || pathname.startsWith(`${a.href}/`);
          const Icono = ICONO[a.href.split("/").pop() ?? ""];
          return (
            <Link
              key={a.href}
              href={a.href}
              aria-current={activo ? "page" : undefined}
              className={activo ? `${s.submenuItem} ${s.submenuItemActivo}` : s.submenuItem}
            >
              {Icono && <Icono size={15} strokeWidth={1.9} aria-hidden />}
              {a.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
