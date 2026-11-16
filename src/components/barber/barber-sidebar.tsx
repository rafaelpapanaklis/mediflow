"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { BarberNavItem } from "@/lib/barber/types";
import { BARBER_NAV_ICON, BarberIcon } from "./barber-icons";
import { useMensajesSinLeer } from "./mensajes/sin-leer";
import { textoContador, usePedidosPorAtender } from "./products/pedidos-aviso";

/**
 * Menú lateral del panel BARBER — rediseño 15-nov-2026 (el menú de la
 * propuesta C que eligió Rafael, con la letra y los tamaños del panel).
 *
 *  · Arriba, el rótulo: el poste de barbero, «Barbería» chico y el NOMBRE DE
 *    LA BARBERÍA de la sesión en grande. «DaleControl» baja al pie, discreto.
 *  · Secciones en minúsculas discretas; cada entrada con su icono del oficio
 *    (src/components/barber/barber-icons.tsx); la activa, pastilla crema.
 *  · Los items, su orden, permisos y el recorte sin pagar NO se deciden
 *    aquí: llegan ya resueltos del layout (server). El menú solo pinta.
 *  · Estilos: .barber-menu* en src/app/barber/barber-theme.css.
 */

const SECTION_ORDER: BarberNavItem["section"][] = [
  "operacion",
  "negocio",
  "crecimiento",
  "cuenta",
];

export function BarberSidebar({
  shopName,
  items: initialItems,
  sectionLabels,
  brandName,
  brandSub,
  logoutLabel,
  navLabel,
  unreadLabel,
  unreadLabelOne,
  ordersLabel,
  ordersLabelOne,
  loginHref,
}: {
  shopName: string;
  items: BarberNavItem[];
  sectionLabels: Record<string, string>;
  brandName: string;
  brandSub: string;
  logoutLabel: string;
  /** Nombre accesible del menú («Menú principal» / «Main menu»). */
  navLabel: string;
  /** «{count} chats sin leer» / «1 chat sin leer», para el contador de Mensajes. */
  unreadLabel: string;
  unreadLabelOne: string;
  /** «{count} pedidos por atender» / «1 pedido por atender», para el contador de Productos. */
  ordersLabel: string;
  ordersLabelOne: string;
  /** A dónde ir al cerrar sesión: la entrada del vertical (/barber/entrar). */
  loginHref: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = useMenuAlDia(initialItems, pathname);
  // Chats sin leer, solo si «Mensajes» está en el menú (ya pasó su candado).
  // Se pregunta al servidor solo cuando el contador se ve y nadie más lo
  // sabe: no en /barber/mensajes (la bandeja lo avisa) ni en celular con el
  // cajón cerrado. Ver mensajes/sin-leer.ts.
  const escritorio = useEsEscritorio();
  const conMensajes = items.some((i) => i.key === "mensajes");
  const enMensajes = Boolean(pathname?.startsWith("/barber/mensajes"));
  const sinLeer = useMensajesSinLeer({
    mostrar: conMensajes,
    sondear: conMensajes && !enMensajes && (escritorio || mobileOpen),
  });
  // Pedidos de la tienda por atender, solo si «Productos» está en el menú
  // (plan con productos + products.view; el servidor lo vuelve a revisar).
  // Se pregunta al navegar y cada minuto mientras el contador se ve. Ver
  // products/pedidos-aviso.ts.
  const conProductos = items.some((i) => i.key === "productos");
  const porAtender = usePedidosPorAtender({
    mostrar: conProductos,
    sondear: conProductos && (escritorio || mobileOpen),
    ruta: pathname,
  });
  // Cada entrada con contador: cuánto y cómo se le dice a un lector de pantalla.
  const cuentas: Record<string, { n: number; uno: string; varios: string }> = {
    mensajes: { n: sinLeer, uno: unreadLabelOne, varios: unreadLabel },
    productos: { n: porAtender, uno: ordersLabelOne, varios: ordersLabel },
  };
  const navRef = useRef<HTMLElement | null>(null);

  // ¿Queda menú escondido arriba o abajo? El CSS desvanece esa orilla para
  // que se note que hay más (pase 6: «Soporte» no se veía y nada lo decía).
  // Y la entrada activa siempre a la vista, aunque esté al final.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const medir = () => {
      const arriba = nav.scrollTop > 2;
      const abajo = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2;
      nav.toggleAttribute("data-mas-arriba", arriba);
      nav.toggleAttribute("data-mas-abajo", abajo);
    };
    // Solo el scroll del menú (scrollIntoView también movería la página).
    const activa = nav.querySelector<HTMLElement>("[aria-current=\"page\"]");
    if (activa) {
      const n = nav.getBoundingClientRect();
      const r = activa.getBoundingClientRect();
      if (r.bottom > n.bottom - 40) nav.scrollTop += r.bottom - n.bottom + 48;
      else if (r.top < n.top) nav.scrollTop -= n.top - r.top + 8;
    }
    medir();
    nav.addEventListener("scroll", medir, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(nav);
    return () => {
      nav.removeEventListener("scroll", medir);
      ro.disconnect();
    };
  }, [mobileOpen, pathname]);

  async function handleLogout() {
    try {
      await fetch("/api/barber/auth/logout", { method: "POST" });
    } finally {
      // A la entrada PROPIA del vertical, no al /login de las clínicas.
      window.location.href = loginHref;
    }
  }

  function isActive(href: string) {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + "/");
  }

  const sections = SECTION_ORDER.map((section) => ({
    section,
    label: sectionLabels[section] ?? section,
    items: items.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

  // El rótulo lleva a Inicio solo si Inicio está en el menú (sin pagar no lo está).
  const homeHref = items.find((i) => i.key === "inicio")?.href ?? null;

  const rotulo = (
    <>
      <span className="barber-menu__poste" aria-hidden="true">
        <span />
      </span>
      <span className="barber-menu__rotulo-txt">
        <span className="barber-menu__sobre">{brandSub}</span>
        <span className="barber-menu__nombre" title={shopName}>
          {shopName}
        </span>
      </span>
    </>
  );

  return (
    <>
      {/* Hamburguesa móvil. Posición y tamaño: .barber-menu-btn en
          barber-theme.css (queda sobre la barra superior, que en celular
          deja libre ese hueco a la izquierda de las migas). */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="icon-btn-new barber-menu-btn lg:hidden"
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
        aria-controls="barber-sidebar"
      >
        <BarberIcon name="rayas" size={18} />
      </button>

      {/* Velo móvil */}
      {mobileOpen && (
        <div onClick={() => setMobileOpen(false)} className="barber-menu-veil lg:hidden" />
      )}

      {/* En celular (<lg) el menú NO ocupa sitio: barber-theme.css lo
          esconde y solo lo muestra, flotando sobre la pantalla, cuando lleva
          .barber-sidebar--open. En escritorio esa clase no hace nada. */}
      <aside
        id="barber-sidebar"
        className={`sidebar-new barber-menu${mobileOpen ? " barber-sidebar--open" : ""}`}
        style={{ zIndex: 41 }}
      >
        <div className="barber-menu__cab">
          {homeHref ? (
            <Link href={homeHref} className="barber-menu__rotulo" onClick={() => setMobileOpen(false)}>
              {rotulo}
            </Link>
          ) : (
            <div className="barber-menu__rotulo">{rotulo}</div>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="barber-menu__cerrar lg:hidden"
            aria-label="Cerrar menú"
          >
            <BarberIcon name="equis" size={16} />
          </button>
        </div>

        {/* Navegación (gating por plan + rol ya resuelto en el layout server) */}
        <nav className="barber-menu__nav" aria-label={navLabel} ref={navRef}>
          {sections.map((s) => (
            <div key={s.section} className="barber-menu__grupo">
              <p className="barber-menu__titulo" id={`barber-menu-${s.section}`}>
                {s.label}
              </p>
              <ul className="barber-menu__lista" aria-labelledby={`barber-menu-${s.section}`}>
                {s.items.map((item) => {
                  const active = isActive(item.href);
                  const cuenta = cuentas[item.key];
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className="barber-menu__ent"
                      >
                        <BarberIcon name={BARBER_NAV_ICON[item.key] ?? "poste"} size={18} />
                        <span>{item.label}</span>
                        {cuenta && cuenta.n > 0 ? (
                          <>
                            <span className="barber-menu__cuenta" aria-hidden="true" data-cuenta={item.key}>
                              {textoContador(cuenta.n)}
                            </span>
                            <span className="sr-only">
                              {", "}
                              {cuenta.n === 1 ? cuenta.uno : cuenta.varios.replace("{count}", String(cuenta.n))}
                            </span>
                          </>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="barber-menu__pie">
          <button type="button" onClick={handleLogout} className="barber-menu__ent barber-menu__salir">
            <BarberIcon name="salir" size={18} />
            <span>{logoutLabel}</span>
          </button>
          <div className="barber-menu__marca">{brandName}</div>
        </div>
      </aside>
    </>
  );
}

/** ¿Pantalla de escritorio (el menú siempre a la vista, ≥ 1024 px)? */
function useEsEscritorio(): boolean {
  const [es, setEs] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const cambio = () => setEs(mq.matches);
    cambio();
    mq.addEventListener("change", cambio);
    return () => mq.removeEventListener("change", cambio);
  }, []);
  return es;
}

/**
 * El menú, al día con los permisos (m4, auditoría de permisos 16-nov).
 *
 * Next conserva el layout entre páginas: el menú que pintó el servidor al
 * entrar se quedaba igual aunque el dueño le quitara a esta persona un
 * permiso (en panel.108, «Caja» seguía en el menú de Recepción tras quitarle
 * «Ver caja» y navegar). En cada navegación interna se vuelve a pedir
 * GET /api/barber/nav —el MISMO cálculo del layout— y se pinta lo que diga.
 * La primera vez no: acaba de llegar del servidor. Si la petición falla, se
 * queda el menú que había (las páginas y las APIs cortan igual).
 */
export function useMenuAlDia(initialItems: BarberNavItem[], pathname: string | null): BarberNavItem[] {
  const [items, setItems] = useState(initialItems);
  // Si el servidor vuelve a pintar el layout (router.refresh), manda ése.
  useEffect(() => setItems(initialItems), [initialItems]);
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    let vivo = true;
    fetch("/api/barber/nav", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { items?: BarberNavItem[] }) : null))
      .then((d) => {
        if (vivo && d && Array.isArray(d.items)) setItems(d.items);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [pathname]);
  return items;
}
