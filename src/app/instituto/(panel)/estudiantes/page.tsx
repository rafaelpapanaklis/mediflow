import { redirect } from "next/navigation";

/**
 * /instituto/estudiantes no es una pantalla: es la RAÍZ de las fichas.
 *
 * La lista de estudiantes ya existe y se llama Padrón. Esta ruta existe solo
 * para que quien borre el id de la barra de direcciones —que es lo que hace
 * cualquiera para "subir un nivel"— caiga en la lista y no en un 404.
 *
 * ⛔ No lleva item de menú propio ni etiqueta nueva. El sidebar enciende
 * "Padrón" en toda esta rama con los `matchPrefixes` de EDU_NAV_ITEMS.
 */
export default function InstitutoEstudiantesIndex() {
  redirect("/instituto/padron");
}
