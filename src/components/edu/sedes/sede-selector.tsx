"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import { EDU_CAMPUS_ALL, type EduCampusOption } from "@/lib/edu/campus-core";

/**
 * EL SELECTOR DE SEDE de la barra superior.
 *
 * 🔴 CON UNA SOLA OPCIÓN NO SE PINTA. Nadie elige entre una opción, y un
 * desplegable de un solo elemento en la barra superior hace creer que falta
 * algo. Una escuela de una sola sede —que son casi todas— no se entera
 * nunca de que esta ola existe. La decisión la toma el SERVIDOR
 * (`scope.showPicker`, en campus-core.ts); aquí solo se respeta, con un
 * cinturón por si alguien lo monta a mano.
 *
 * 🔴 NO ES UN PERMISO. Cambiar de sede es moverse entre lo que el ACCESO ya
 * autoriza (edu_user_campus_access): las opciones que llegan aquí son
 * exactamente las que esa persona puede ver, y el servidor las vuelve a
 * calcular en cada lectura. Un `value` fabricado desde la consola se
 * degrada solo a la vista consolidada de lo suyo.
 *
 * NAVEGACIÓN DURA y no `router.refresh()`, igual que el selector de
 * sucursal del vertical de barbería y por la lección que costó allí: con un
 * refresh se quedaba en pantalla estado de cliente de la sede anterior
 * (filtros, formularios a medio llenar) y la persona creía estar viendo otra
 * sede. Recargar es más lento y es lo correcto.
 */
export interface EduSedeSelectorProps {
  options: EduCampusOption[];
  /** id de la sede activa, o null = vista consolidada. */
  activeId: string | null;
  /** Cómo se llama la opción consolidada ("Todas las sedes" / "Todas mis sedes"). */
  allLabel: string;
  /** Para distinguir los dos sitios donde se pinta (móvil y escritorio). */
  slot: string;
}

export function EduSedeSelector({ options, activeId, allLabel, slot }: EduSedeSelectorProps) {
  const [busy, setBusy] = useState(false);

  // Cinturón: si alguien monta este componente con una sola sede, no se
  // pinta igual. La regla vive en el servidor, pero no puede vivir SOLO
  // ahí si el componente es público.
  if (!Array.isArray(options) || options.length < 2) return null;

  async function elegir(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      await eduRequest("/api/instituto/sedes/elegir", {
        method: "POST",
        body: { campusId: value },
      });
    } catch {
      // Aunque el POST falle, recargamos: la cookie no cambió y la persona
      // ve la sede en la que seguía. Un mensaje de error en la barra
      // superior no tendría dónde vivir.
    } finally {
      window.location.reload();
    }
  }

  const id = `edu-sede-${slot}`;

  return (
    <div className="edu-sedepick">
      <Building2 size={15} aria-hidden="true" className="edu-sedepick__icon" />
      <label className="edu-sr-only" htmlFor={id}>
        Sede que estás viendo
      </label>
      <select
        id={id}
        className="edu-sedepick__select"
        value={activeId ?? EDU_CAMPUS_ALL}
        disabled={busy}
        onChange={(e) => {
          void elegir(e.target.value);
        }}
      >
        <option value={EDU_CAMPUS_ALL}>{allLabel}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.isActive ? "" : " · cerrada"}
          </option>
        ))}
      </select>
    </div>
  );
}
