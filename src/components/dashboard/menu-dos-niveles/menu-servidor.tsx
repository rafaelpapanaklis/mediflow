import { getCurrentUser } from "@/lib/auth";
import { almacenMenuPersonal } from "@/lib/menu-personalizado/almacen";
import { MenuDosNiveles, type MenuDosNivelesProps } from "./menu-dos-niveles";

/**
 * El menú de dos niveles con el menú personal de quien entra ya resuelto EN EL
 * SERVIDOR: así se pinta directamente como esa persona lo dejó, sin enseñar
 * primero el de fábrica y saltar.
 *
 * Se lee aquí, y no en el layout, para que el layout cambie lo mínimo mientras
 * otras tareas trabajan sobre ese mismo archivo.
 *
 * El usuario y la clínica salen de la SESIÓN (getCurrentUser, que en la misma
 * petición ya está en caché de React: no es otra consulta), nunca de las props.
 * Si la tabla del SQL todavía no existe o la base tarda, la lectura devuelve
 * «no disponible» y sale el menú de fábrica, sin «Personalizar» y sin romper
 * nada. Con la clínica suspendida ni se consulta: ese menú es Facturación +
 * Soporte y no se personaliza.
 */
export async function MenuDosNivelesServidor(props: MenuDosNivelesProps) {
  const user = props.isExpired ? null : await getCurrentUser().catch(() => null);
  const menuPersonal = user
    ? await almacenMenuPersonal.leer(user.id, user.clinicId)
    : { disponible: false, diseno: null, revision: null };
  return <MenuDosNiveles {...props} menuPersonal={menuPersonal} />;
}
