/**
 * Cómo llega la confirmación del alta a POST /api/patients: llamando al route
 * handler EN PROCESO, dentro de la misma petición del usuario que confirma.
 *
 * Por qué así (MAPA §6, «aceptable como paso intermedio»):
 *  · Cero copias de reglas: corre el handler entero —validación, cupo del
 *    plan, guarda de duplicados, folio, auditoría, enlace de WhatsApp—.
 *  · La identidad es la del usuario: `getAuthContext()` lee las cookies y
 *    cabeceras de la petición EN CURSO (la de confirmar), no las de la
 *    `NextRequest` que se arma aquí. Por eso aquí no se copian cookies.
 *    Y como esa petición entra por /api/sabina, las puertas de 2FA y de plan
 *    vencido también corren.
 *  · No es un `fetch` a la propia URL reenviando cookies (el MAPA lo descarta).
 *
 * Lo que sí se copia son las cabeceras de las que `logMutation` saca la IP y
 * el navegador, para que la bitácora del alta apunte a quien confirmó.
 *
 * 🔴 Solo lo usa la fase 2. `registrar_paciente` (la propuesta) no importa
 * este archivo, y registrar-paciente.test.ts lo vigila.
 */

import { NextRequest } from "next/server";
import { POST as altaDePaciente } from "@/app/api/patients/route";
import type { LlamarAlta } from "./registrar-paciente-confirmar";

const CABECERAS_DE_AUDITORIA = ["user-agent", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"];

/** `origen` es la petición con la que el usuario confirmó. */
export function llamarAltaEnProceso(origen: Request): LlamarAlta {
  return async (cuerpo) => {
    const headers = new Headers({ "content-type": "application/json" });
    for (const h of CABECERAS_DE_AUDITORIA) {
      const v = origen.headers.get(h);
      if (v) headers.set(h, v);
    }
    const req = new NextRequest(new URL("/api/patients", origen.url), {
      method: "POST",
      headers,
      body: JSON.stringify(cuerpo),
    });
    const res = await altaDePaciente(req);
    return { status: res.status, cuerpo: await res.json().catch(() => null) };
  };
}
