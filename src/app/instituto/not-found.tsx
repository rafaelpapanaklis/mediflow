import Link from "next/link";
import { DoorClosed } from "lucide-react";
import { EDU_BRAND } from "@/lib/edu/types";
import "./edu-theme.css";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-155 · EL 404 DEL INSTITUTO, QUE NO EXISTÍA.
 *
 * No había ningún `not-found.tsx` bajo `src/app/instituto/`, así que las
 * **33** llamadas a `notFound()` del panel caían en el 404 del DENTAL: un
 * emoji 🏥, «404 · Página no encontrada» y un botón a la landing comercial
 * del producto dental.
 *
 * Y eso no es un caso raro: en este vertical el 404 **es el camino de
 * denegación normal**. Está escrito y es deliberado (visibility.ts) — a un
 * alumno al que le traspasaron un caso se le contesta «no existe» en vez de
 * «existe y no es tuyo», porque lo segundo confirma que ese paciente está
 * en la escuela. Así que la pantalla que más veces ve alguien que se topa
 * con el límite de su alcance era la de OTRO producto.
 *
 * También la ve un paciente que copió mal el enlace de su carta de
 * consentimiento o de su presupuesto: por eso el texto no supone que quien
 * lo lee tenga cuenta, y por eso la salida no es un botón sino DOS.
 *
 * ── QUÉ DICE, Y QUÉ NO ────────────────────────────────────────────────
 * NO dice «no tienes permiso»: este archivo no puede saber si la pantalla
 * no existe o si existe y no le toca —ésa es toda la gracia del 404 como
 * denegación—. Dice las dos posibilidades, en el orden en que le sirven a
 * quien lee, y no le echa la culpa.
 *
 * ── SIN DATOS Y SIN SESIÓN ────────────────────────────────────────────
 * Es un Server Component sin `getEduContext`: un `not-found` que consulta
 * la base es un `not-found` que puede fallar, y entonces no queda nada.
 * Por lo mismo no lleva el shell del panel (menú, sedes, nombre): eso
 * necesita sesión, y aquí puede no haberla.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default function InstitutoNotFound() {
  return (
    <div className="edu-auth">
      <div className="edu-auth__panel">
        <div className="edu-auth__inner">
          <div className="edu-auth__mark">
            <div className="edu-sidebar__logo" aria-hidden="true">
              <DoorClosed size={19} />
            </div>
            <div>
              <div className="edu-sidebar__brandname">{EDU_BRAND.product}</div>
              <div className="edu-sidebar__brandsub">{EDU_BRAND.vertical}</div>
            </div>
          </div>

          <div>
            <h1 className="edu-auth__title">Esta pantalla no está aquí</h1>
            <p className="edu-auth__lead">
              O el enlace ya no existe, o es de algo que no te toca ver. Las dos cosas se ven
              igual desde fuera, a propósito: el instituto no confirma qué hay del otro lado de
              una puerta cerrada.
            </p>
          </div>

          <p className="edu-note">
            Si llegaste desde un enlace de tu escuela y creías que sí te tocaba, díselo a la
            dirección de tu instituto: puede darte el acceso en un clic. Y si estabas siguiendo el
            enlace de tu carta o de tu presupuesto, pídeselo otra vez a la clínica — los enlaces
            caducan.
          </p>

          <div className="edu-actions">
            <Link href="/instituto" className="edu-btn edu-btn--primary">
              Ir a mi instituto
            </Link>
            <Link href="/instituto/login" className="edu-btn edu-btn--ghost">
              Entrar con otra cuenta
            </Link>
          </div>

          <p className="edu-auth__foot">
            {/* Ni una liga al producto dental: quien está aquí es de una
                escuela, y la landing comercial de otro producto no es una
                salida, es un desvío. */}
            Acceso exclusivo para institutos con contrato.
          </p>
        </div>
      </div>
    </div>
  );
}
