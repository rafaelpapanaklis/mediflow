"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Las pestañas de la ficha de un paciente.
 *
 * MÓVIL PRIMERO: en el teléfono es una tira que se arrastra con el pulgar
 * (ver `.edu-tabs` en edu-theme.css) y no tres renglones de píldoras, que
 * se leen como cualquier cosa menos como pestañas.
 *
 * 🔴 CADA PESTAÑA ES UNA RUTA, no un `useState`. Tres razones concretas:
 *   · se puede compartir el enlace ("mira el odontograma de P-0042");
 *   · sobrevive a un refresh, que es lo que hace un teléfono cuando la
 *     pantalla se apaga y el sistema recicla la pestaña;
 *   · cada pestaña carga SOLO sus datos. Con una sola página, abrir la
 *     ficha se traería las notas, el odontograma y las radiografías de
 *     golpe — y las radiografías pesan.
 *
 * 🔴 LO QUE ESTE COMPONENTE **NO** HACE: decidir quién ve qué. Los items
 * llegan ya filtrados por permiso desde el layout (servidor) y CADA página
 * vuelve a exigir el suyo. Esconder una pestaña no cierra ninguna puerta:
 * basta con teclear la URL.
 */
export interface EduPacienteTab {
  key: string;
  href: string;
  label: string;
}

export function EduPacienteTabs({ tabs }: { tabs: EduPacienteTab[] }) {
  const pathname = usePathname() ?? "";

  // Activo = el href que COINCIDE MÁS (el más largo), igual que el sidebar
  // del vertical. Con un `startsWith` suelto, /pacientes/[id] encendería
  // también su propia pestaña estando en /pacientes/[id]/estudios.
  let activo = "";
  for (const t of tabs) {
    if ((pathname === t.href || pathname.startsWith(`${t.href}/`)) && t.href.length > activo.length) {
      activo = t.href;
    }
  }

  return (
    <nav className="edu-tabs" aria-label="Secciones del paciente">
      {tabs.map((t) => {
        const on = t.href === activo;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`edu-tab ${on ? "edu-tab--on" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
