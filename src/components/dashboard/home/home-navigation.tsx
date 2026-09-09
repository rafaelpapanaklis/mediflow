"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CalendarDays, ChevronDown, ClipboardList, Home, Inbox, MoreHorizontal, Settings, Users } from "lucide-react";
import styles from "./home-navigation.module.css";

const frequentItems = [
  { href: "/dashboard", label: "Hoy", icon: Home },
  { href: "/dashboard/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/dashboard/patients", label: "Pacientes", icon: Users },
  { href: "/dashboard/inbox", label: "Mensajes", icon: Inbox },
];

const moreGroups = [
  {
    label: "Trabajo clínico",
    items: [{ href: "/dashboard/clinical", label: "Actividad clínica", icon: ClipboardList }],
  },
  {
    label: "Espacio",
    items: [{ href: "/dashboard/settings", label: "Configuración", icon: Settings }],
  },
];

export function HomeNavigation() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="Navegación principal">
      <div className={styles.inner}>
        <div className={styles.links}>
          {frequentItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`${styles.link} ${active ? styles.active : ""}`} aria-current={active ? "page" : undefined}>
                <Icon aria-hidden />
                <span>{label}</span>
              </Link>
            );
          })}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className={styles.more} aria-label="Abrir más módulos">
              <MoreHorizontal aria-hidden />
              <span>Más</span>
              <ChevronDown aria-hidden className={styles.chevron} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={styles.menu} align="start" sideOffset={8}>
                {moreGroups.map((group) => (
                  <DropdownMenu.Group key={group.label}>
                    <DropdownMenu.Label className={styles.groupLabel}>{group.label}</DropdownMenu.Label>
                    {group.items.map(({ href, label, icon: Icon }) => (
                      <DropdownMenu.Item key={href} asChild>
                        <Link href={href} className={styles.menuItem} aria-current={pathname.startsWith(href) ? "page" : undefined}>
                          <Icon aria-hidden />
                          {label}
                        </Link>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Group>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <span className={styles.context}>Espacio clínico</span>
      </div>
    </nav>
  );
}

export default HomeNavigation;
                                                                        
