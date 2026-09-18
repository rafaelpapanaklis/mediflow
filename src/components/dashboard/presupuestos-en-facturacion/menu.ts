// Qué SALE del menú con el interruptor `menu-dos-niveles` encendido (ws1-t1).
//
// Rafael: «quiero unir facturación y presupuestos para que sea 1», y Marketplace
// fuera. Facturación ya hace lo de Presupuestos (un pago o a plazos, con qué
// paga, envío por correo y WhatsApp, y la ficha con la frase del trato).
//
// Esto QUITA DEL MENÚ; no borra nada. Las pantallas, las rutas, las tablas y el
// menú de siempre (bandera apagada) siguen exactamente igual. Deshacerlo es
// vaciar una de estas dos listas.
//
// Sin React ni Next a propósito: lo prueban los tests en node.

/**
 * Apartados de la ficha del paciente que el menú NUEVO no enseña. La pestaña
 * sigue viva: `?tab=presupuestos` la abre (la validación de enlaces profundos
 * usa `buildPatientNavItems`, que no cambia) y Facturación enlaza a ella cuando
 * el paciente tiene presupuestos guardados.
 *
 * «Referencias» salió en ws1-t3. Rafael: «el "Más" solo tiene referencias,
 * elimina referencias no es necesario y por lo tanto "Más" también». Igual que
 * Presupuestos: ni la pantalla, ni la ruta `/api/referrals`, ni la tabla se
 * tocan; `?tab=referencias` la abre y «Referir» desde la consulta sigue
 * llevando a ella. Con la bandera apagada el menú de siempre la enseña igual.
 */
export const APARTADOS_FUERA_DEL_MENU: readonly string[] = ["presupuestos", "referencias"];

/**
 * Llaves de módulo que NO se le pasan al menú lateral nuevo. La opción
 * «Marketplace» de `sidebar-nav.ts` declara `moduleKey: "marketplace"`, y
 * `shouldShowItem` —el filtro de siempre— la esconde si la clínica no tiene esa
 * llave. Quitándola de lo que recibe el menú NUEVO, la opción deja de salir sin
 * tocar ni `sidebar-nav.ts` (compartido con el menú de siempre) ni
 * `menu-dos-niveles/**` (solo lectura).
 *
 * Ninguna otra opción declara esta llave (lo fija una prueba), así que no se
 * lleva por delante nada más.
 */
export const MODULOS_FUERA_DEL_MENU: readonly string[] = ["marketplace"];

/** Las llaves de módulo de la clínica, tal como las debe recibir el menú nuevo. */
export function modulosParaMenuNuevo(clinicModuleKeys: readonly string[] | null | undefined): string[] {
  return (clinicModuleKeys ?? []).filter((k) => MODULOS_FUERA_DEL_MENU.indexOf(k) === -1);
}
