"use client";

// ═══════════════════════════════════════════════════════════════════════
// LO ÚNICO QUE ESTA PANTALLA GUARDA EN EL NAVEGADOR: la vista elegida.
//
// Por qué existe, con el caso concreto: pasando de CRM_TABLERO_COMODO
// (150) prospectos la vista por DEFECTO es la lista. Rafael dijo que la
// que usa es el tablero. Hasta ahora tenía que pulsar "Tablero" cada vez
// que abría /admin/crm, porque lo elegido vivía en la querystring y la
// querystring no sobrevive a abrir la pantalla desde el menú.
//
// Qué NO cambia: el corte de 150 se queda intacto para el arranque en
// frío. Quien nunca ha elegido no tiene nada guardado y cae en
// `crmVistaEfectiva` como siempre.
//
// Por qué no es una preferencia de la cuenta en la base: es una
// preferencia de PANTALLA —el mismo administrador quiere lista en el
// móvil y tablero en el escritorio—, no de persona. Y una columna nueva
// en la base es esquema, que está fuera de esta tarea.
//
// Todo va en try/catch: en una ventana privada, con las cookies de sitio
// bloqueadas o con el disco lleno, el simple hecho de LEER localStorage
// lanza. Una preferencia de maquetación no puede tumbar el CRM.
// ═══════════════════════════════════════════════════════════════════════
import type { CrmVista } from "@/lib/admin/crm/crm-core";

const CLAVE = "dc.crm.vista";

/** La vista guardada, o `null` si no hay ninguna o no se puede leer. */
export function crmLeerVistaGuardada(): CrmVista | null {
  try {
    const v = window.localStorage.getItem(CLAVE);
    return v === "tablero" || v === "lista" ? v : null;
  } catch {
    return null;
  }
}

export function crmGuardarVista(vista: CrmVista): void {
  try {
    window.localStorage.setItem(CLAVE, vista);
  } catch {
    // Sin sitio donde guardar, la pantalla sigue funcionando igual: lo
    // único que se pierde es no tener que elegir dos veces.
  }
}
