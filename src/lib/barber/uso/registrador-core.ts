// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — USO DEL PANEL: la cola del NAVEGADOR (ws6-t4).
// Client-safe y sin DOM: el componente RegistradorUso le pasa el reloj, el
// almacenamiento y el envío, y las pruebas le pasan los suyos.
//
//   · Junta eventos y los manda en LOTE (cada USO_FLUSH_MS y al salir).
//   · Tope propio por minuto (USO_TOPE_CLIENTE_MIN): una pestaña desbocada
//     no inunda al servidor (que además tiene el suyo por usuario).
//   · Si el servidor dice { off: true } (no hay tabla), se apaga para toda la
//     pestaña y tira lo que tenía.
//   · No sabe NADA de lo que se escribe en campos: solo recibe lo que el
//     componente ya limpió (ruta, data-accion, texto del botón sin dígitos).
// ═══════════════════════════════════════════════════════════════════════
import {
  USO_MAX_LOTE,
  USO_SESION_INACTIVA_MS,
  USO_TOPE_CLIENTE_MIN,
  type UsoEventoCliente,
  type UsoLoteCliente,
} from "./uso-core";

export const USO_SID_KEY = "dcb_uso_sid";
export const USO_SID_TS_KEY = "dcb_uso_sid_ts";
export const USO_OFF_KEY = "dcb_uso_off";
/** Si la cola crece (sin red), lo más viejo se tira: nunca más de esto en memoria. */
const MAX_COLA = 200;

export interface AlmacenSimple {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface EntornoRegistrador {
  ahora: () => number;
  /** sessionStorage (por pestaña). null si el navegador no deja. */
  almacen: AlmacenSimple | null;
  nuevoId: () => string;
  /**
   * Envía un lote. `alSalir` = la pestaña se va (sendBeacon, sin respuesta).
   * Si no es al salir, puede devolver la respuesta del servidor.
   */
  enviar: (lote: UsoLoteCliente, alSalir: boolean) => Promise<{ off?: boolean } | null> | void;
}

export interface Registrador {
  /** Entró a una pantalla (también abre la sesión si hace falta). */
  pantalla(path: string): void;
  /** Tocó algo accionable. */
  clic(e: Omit<UsoEventoCliente, "k" | "t">): void;
  /** Manda lo que haya. */
  vaciar(alSalir: boolean): Promise<void>;
  /** Para las pruebas y para saber si sigue vivo. */
  estado(): { apagado: boolean; cola: number; sid: string };
}

export function crearRegistrador(env: EntornoRegistrador): Registrador {
  let apagado = env.almacen?.getItem(USO_OFF_KEY) === "1";
  let cola: UsoEventoCliente[] = [];
  let sid = "";
  let ultimaPantalla = "";
  let marcasMinuto: number[] = [];

  function guardar(k: string, v: string): void {
    try {
      env.almacen?.setItem(k, v);
    } catch {
      /* el navegador no deja: se sigue en memoria */
    }
  }

  /** La sesión de la pestaña; si es nueva (o caducó por inactividad) encola S. */
  function asegurarSesion(path: string): void {
    const t = env.ahora();
    const previa = sid || env.almacen?.getItem(USO_SID_KEY) || "";
    const ts = Number(env.almacen?.getItem(USO_SID_TS_KEY) || "0") || 0;
    const caduco = !previa || !ts || t - ts > USO_SESION_INACTIVA_MS;
    if (caduco) {
      sid = env.nuevoId();
      guardar(USO_SID_KEY, sid);
      meter({ k: "S", p: path, t });
    } else {
      sid = previa;
    }
    guardar(USO_SID_TS_KEY, String(t));
  }

  function dentroDelTope(t: number): boolean {
    marcasMinuto = marcasMinuto.filter((x) => t - x < 60_000);
    if (marcasMinuto.length >= USO_TOPE_CLIENTE_MIN) return false;
    marcasMinuto.push(t);
    return true;
  }

  function meter(e: UsoEventoCliente): void {
    if (apagado) return;
    const t = e.t ?? env.ahora();
    if (!dentroDelTope(t)) return;
    cola.push({ ...e, t });
    if (cola.length > MAX_COLA) cola = cola.slice(cola.length - MAX_COLA);
  }

  function apagar(): void {
    apagado = true;
    cola = [];
    guardar(USO_OFF_KEY, "1");
  }

  async function vaciar(alSalir: boolean): Promise<void> {
    if (apagado || cola.length === 0 || !sid) return;
    const lote: UsoLoteCliente = { sid, events: cola.splice(0, USO_MAX_LOTE) };
    try {
      const r = await env.enviar(lote, alSalir);
      if (r && r.off) apagar();
    } catch {
      /* sin red: lo enviado se pierde; la analítica nunca estorba */
    }
  }

  return {
    pantalla(path) {
      if (apagado) return;
      asegurarSesion(path);
      if (path === ultimaPantalla) return;
      ultimaPantalla = path;
      meter({ k: "V", p: path });
    },
    clic(e) {
      if (apagado) return;
      asegurarSesion(e.p);
      meter({ ...e, k: "C" });
    },
    vaciar,
    estado: () => ({ apagado, cola: cola.length, sid }),
  };
}
