"use client";

import { useState } from "react";
import { CreditCard, Link2, MessageCircle, Receipt } from "lucide-react";
import toast from "react-hot-toast";
import { RaizConfiguracion } from "@/components/dashboard/configuracion-rediseno/raiz";
import {
  Aviso,
  Boton,
  BotonGuardar,
  Campo,
  Campos2,
  Columna,
  Encabezado,
  Enlace,
  EnlaceBoton,
  Entrada,
  Fila,
  FilaInterruptor,
  Filas,
  Insignia,
  Seccion,
  Selector,
  Vacio,
} from "@/components/dashboard/configuracion-rediseno/piezas";
import cr from "@/components/dashboard/configuracion-rediseno/configuracion.module.css";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { AnticipoReciente, PantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import {
  ANTICIPO_MINIMO_MXN,
  MINUTOS_MAX,
  MINUTOS_MIN,
  formatoPesos,
  type ModoAnticipo,
} from "@/lib/anticipos/core";

/**
 * Configuración → Anticipos por WhatsApp (WS1-T5).
 *
 * Tres cosas, en este orden, porque cada una depende de la anterior:
 *   1. La cuenta de Mercado Pago de la clínica (conectar / con qué cuenta / desconectar).
 *   2. El anticipo: apagado hasta que haya cuenta. Sin cuenta NO hay botón que
 *      falle: la sección se ve atenuada y dice por qué.
 *   3. Los últimos anticipos: el rastro para el día que alguien diga «yo pagué».
 */

const MOTIVOS: Record<string, string> = {
  estado: "La conexión caducó o no la iniciaste desde esta pantalla. Vuelve a intentarlo.",
  sesion: "La sesión cambió a mitad de la conexión. Vuelve a intentarlo desde esta pantalla.",
  permiso: "Tu usuario no tiene permiso para cambiar las integraciones de la clínica.",
  plataforma: "DaleControl todavía no tiene activados los cobros con Mercado Pago.",
  canje: "Mercado Pago no confirmó la autorización. Vuelve a intentarlo.",
  guardar: "No se pudo guardar la conexión de forma segura. Avisa a soporte.",
};

/** Lo que Mercado Pago dice de un intento que no se aprobó, en español. */
const ESTADOS_MP: Record<string, string> = {
  rejected: "rechazado",
  in_process: "en revisión",
  pending: "pendiente",
  cancelled: "cancelado",
  refunded: "devuelto",
  charged_back: "contracargo",
  otra_cuenta: "pagó en la cuenta de Mercado Pago anterior; vuelve a conectar esa cuenta para aplicarlo",
};

const ESTADOS: Record<string, { texto: string; tono: "neutro" | "info" | "exito" | "alerta" | "peligro" }> = {
  PENDING: { texto: "Esperando pago", tono: "info" },
  PAID: { texto: "Pagado", tono: "exito" },
  EXPIRED: { texto: "Venció sin pago", tono: "neutro" },
  FAILED: { texto: "Sin link", tono: "peligro" },
};

function fecha(iso: string | null, tz: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function AnticiposClient({
  inicial,
  timezone,
  resultado,
  motivo,
}: {
  inicial: PantallaAnticipos;
  timezone: string;
  resultado: string | null;
  motivo: string | null;
}) {
  const confirm = useConfirm();
  const [datos, setDatos] = useState<PantallaAnticipos>(inicial);
  const [activo, setActivo] = useState(inicial.config.activo);
  const [modo, setModo] = useState<ModoAnticipo>(inicial.config.modo);
  const [monto, setMonto] = useState(inicial.config.monto > 0 ? String(inicial.config.monto) : "");
  const [porcentaje, setPorcentaje] = useState(inicial.config.porcentaje > 0 ? String(inicial.config.porcentaje) : "");
  const [minutos, setMinutos] = useState(String(inicial.config.minutos));
  const [guardando, setGuardando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  const { plataforma, cuenta, comision } = datos;
  const puedeConectar = datos.tablasListas && plataforma.lista;
  const puedeCobrar = puedeConectar && cuenta.conectada;

  async function guardar() {
    setGuardando(true);
    try {
      const res = await fetch("/api/settings/anticipos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activo,
          modo,
          monto: monto.trim() === "" ? 0 : Number(monto),
          porcentaje: porcentaje.trim() === "" ? 0 : Number(porcentaje),
          minutos: Number(minutos),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "No se pudo guardar.");
        return;
      }
      setDatos(json as PantallaAnticipos);
      setActivo((json as PantallaAnticipos).config.activo);
      toast.success(activo ? "Listo: el bot pedirá anticipo al agendar." : "Guardado. El bot agenda sin anticipo.");
    } finally {
      setGuardando(false);
    }
  }

  async function desconectar() {
    const ok = await confirm({
      title: "¿Desconectar Mercado Pago?",
      description:
        "El bot dejará de pedir anticipo. Si alguien paga un link que ya se mandó, ese pago no se aplicará solo hasta que vuelvas a conectar ESTA misma cuenta.",
      confirmText: "Desconectar",
      variant: "danger",
    });
    if (!ok) return;
    setDesconectando(true);
    try {
      const res = await fetch("/api/settings/anticipos/desconectar", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "No se pudo desconectar.");
        return;
      }
      setDatos(json as PantallaAnticipos);
      setActivo(false);
      toast.success("Cuenta desconectada. El anticipo quedó apagado.");
    } finally {
      setDesconectando(false);
    }
  }

  return (
    <RaizConfiguracion estrecha>
      <Encabezado
        titulo="Anticipos por WhatsApp"
        subtitulo="Cuando el bot agenda una cita, puede pedir un anticipo con Mercado Pago. Al acreditarse, la cita queda confirmada sola."
        volver={{ href: "/dashboard/settings?tab=integraciones", texto: "Configuración" }}
      />
      <Columna>
        {resultado === "conectada" && (
          <Aviso tono="exito">Cuenta de Mercado Pago conectada. Ya puedes encender el anticipo.</Aviso>
        )}
        {resultado === "cancelado" && <Aviso tono="alerta">No se conectó: la autorización se canceló en Mercado Pago.</Aviso>}
        {resultado === "error" && (
          <Aviso tono="peligro">{MOTIVOS[motivo ?? ""] ?? "No se pudo conectar la cuenta. Vuelve a intentarlo."}</Aviso>
        )}

        {!datos.tablasListas && (
          <Aviso tono="alerta">
            <strong>Esta función todavía no está disponible.</strong> Falta un paso de DaleControl (actualizar la base
            de datos). Mientras tanto el bot agenda como siempre, sin anticipo.
          </Aviso>
        )}
        {datos.tablasListas && !plataforma.lista && (
          <Aviso tono="alerta">
            <strong>DaleControl todavía no activa los cobros con Mercado Pago.</strong> Esta función está apagada y el
            bot agenda como siempre. No tienes que hacer nada: en cuanto se active, aquí podrás conectar tu cuenta.
            <div className={cr.campoAyuda} style={{ marginTop: 6 }}>Detalle para soporte: falta {plataforma.falta.join(", ")}.</div>
          </Aviso>
        )}

        {/* ── 1. La cuenta ── */}
        <Seccion
          icono={<Link2 size={18} strokeWidth={1.75} aria-hidden />}
          titulo="Cuenta de Mercado Pago"
          subtitulo="El dinero del anticipo va directo a esta cuenta. DaleControl nunca lo toca."
          extra={
            cuenta.conectada ? (
              <Insignia tono="exito" punto>Conectada</Insignia>
            ) : (
              <Insignia>Sin conectar</Insignia>
            )
          }
          pie={
            cuenta.conectada ? (
              <Boton variante="peligro" onClick={desconectar} disabled={desconectando}>
                {desconectando ? "Desconectando…" : "Desconectar"}
              </Boton>
            ) : puedeConectar ? (
              <EnlaceBoton href="/api/mercadopago/oauth/conectar" variante="principal">
                Conectar con Mercado Pago
              </EnlaceBoton>
            ) : undefined
          }
        >
          {cuenta.conectada ? (
            <Filas>
              <Fila etiqueta="Cuenta">{cuenta.apodo ?? cuenta.cuentaId ?? "—"}</Fila>
              {cuenta.correo && <Fila etiqueta="Correo">{cuenta.correo}</Fila>}
              <Fila etiqueta="Id de la cuenta">{cuenta.cuentaId ?? "—"}</Fila>
              <Fila etiqueta="Conectada el">{fecha(cuenta.conectadaEl, timezone)}</Fila>
              {cuenta.modoPruebas && (
                <Fila etiqueta="Modo">
                  <Insignia tono="alerta">Cuenta de pruebas: no cobra dinero real</Insignia>
                </Fila>
              )}
            </Filas>
          ) : (
            <p className={cr.campoAyuda} style={{ fontSize: 13 }}>
              Al pulsar «Conectar» te llevamos a Mercado Pago para que inicies sesión con la cuenta de la clínica y
              autorices a DaleControl a crear links de pago en ella. No tienes que copiar ninguna clave.
              {cuenta.desconectadaEl && <> Última desconexión: {fecha(cuenta.desconectadaEl, timezone)}.</>}
            </p>
          )}
        </Seccion>

        {/* ── 2. El anticipo ── */}
        <Seccion
          icono={<CreditCard size={18} strokeWidth={1.75} aria-hidden />}
          titulo="Anticipo al agendar por WhatsApp"
          subtitulo="Queda como saldo a favor del paciente y se descuenta de su tratamiento. No es un cargo extra."
          apagada={!puedeCobrar}
          nota={
            !puedeCobrar ? (
              <Aviso tono="info">Conecta primero la cuenta de Mercado Pago de la clínica para poder encender el anticipo.</Aviso>
            ) : undefined
          }
          pie={
            puedeCobrar ? (
              <BotonGuardar guardando={guardando} texto="Guardar" textoGuardando="Guardando…" onClick={guardar} />
            ) : undefined
          }
        >
          <FilaInterruptor
            titulo="Pedir anticipo al agendar"
            descripcion="El bot aparta el horario, manda el link de pago y confirma la cita en cuanto se acredita. Si no pagan a tiempo, el horario se libera solo."
            activo={activo && puedeCobrar}
            onCambiar={setActivo}
            disabled={!puedeCobrar}
          />
          <Campos2>
            <Campo etiqueta="Cómo se calcula">
              <Selector value={modo} onChange={(e) => setModo(e.target.value as ModoAnticipo)} disabled={!puedeCobrar}>
                <option value="fixed">Monto fijo</option>
                <option value="percent">Porcentaje del precio del servicio</option>
                <option value="total">Precio completo del servicio</option>
              </Selector>
            </Campo>
            <Campo
              etiqueta={modo === "fixed" ? "Monto del anticipo (MXN)" : "Monto de respaldo (MXN)"}
              ayuda={
                modo === "fixed"
                  ? `Mínimo ${formatoPesos(ANTICIPO_MINIMO_MXN)}.`
                  : "Se cobra cuando el paciente no elige un servicio con precio. Vacío = esas citas van sin anticipo."
              }
            >
              <Entrada
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                disabled={!puedeCobrar}
                placeholder="300"
              />
            </Campo>
          </Campos2>
          <Campos2>
            {modo === "percent" && (
              <Campo etiqueta="Porcentaje (%)" ayuda="Del precio del servicio en tu catálogo.">
                <Entrada
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={porcentaje}
                  onChange={(e) => setPorcentaje(e.target.value)}
                  disabled={!puedeCobrar}
                  placeholder="20"
                />
              </Campo>
            )}
            <Campo
              etiqueta="Plazo para pagar (minutos)"
              ayuda={`Entre ${MINUTOS_MIN} y ${MINUTOS_MAX}. Pasado el plazo, el horario vuelve a estar libre para otros.`}
            >
              <Entrada
                type="number"
                inputMode="numeric"
                min={MINUTOS_MIN}
                max={MINUTOS_MAX}
                value={minutos}
                onChange={(e) => setMinutos(e.target.value)}
                disabled={!puedeCobrar}
              />
            </Campo>
          </Campos2>
          <Filas>
            <Fila etiqueta="Comisión de Mercado Pago">La de tu cuenta</Fila>
            <Fila etiqueta="Comisión de DaleControl">
              {comision.valor > 0
                ? comision.modo === "percent"
                  ? `${comision.valor}% del anticipo`
                  : `${formatoPesos(comision.valor)} por anticipo`
                : "Sin comisión"}
            </Fila>
          </Filas>
          <p className={cr.campoAyuda} style={{ fontSize: 13 }}>
            <MessageCircle size={13} strokeWidth={1.75} aria-hidden style={{ verticalAlign: "-2px" }} /> Funciona con el
            bot de WhatsApp con agenda activada. <Enlace href="/dashboard/whatsapp">Ir a WhatsApp</Enlace>
          </p>
        </Seccion>

        {/* ── 3. El rastro ── */}
        <Seccion
          icono={<Receipt size={18} strokeWidth={1.75} aria-hidden />}
          titulo="Últimos anticipos"
          subtitulo="Para comprobar un «yo pagué»: la referencia es el número de pago en Mercado Pago."
          sinRelleno={datos.recientes.length > 0}
        >
          {datos.recientes.length === 0 ? (
            <Vacio>Todavía no se ha pedido ningún anticipo.</Vacio>
          ) : (
            <div className={cr.tablaCaja}>
              <table className={cr.tabla}>
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Paciente</th>
                    <th>Cita</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Ref. Mercado Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.recientes.map((r) => (
                    <FilaAnticipo key={r.id} r={r} tz={timezone} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Seccion>
      </Columna>
    </RaizConfiguracion>
  );
}

function FilaAnticipo({ r, tz }: { r: AnticipoReciente; tz: string }) {
  const est = ESTADOS[r.estado] ?? { texto: r.estado, tono: "neutro" as const };
  const notas: string[] = [];
  if (r.estado === "PAID") {
    notas.push(r.citaConfirmada ? "Cita confirmada" : "El horario ya se había liberado: quedó como saldo a favor");
  }
  if ((r.estado === "PENDING" || r.estado === "EXPIRED") && r.ultimoEstadoMp && r.ultimoEstadoMp !== "approved") {
    const detalle = r.ultimoEstadoMp === "otra_cuenta" && r.ultimoDetalleMp ? ` (${r.ultimoDetalleMp})` : "";
    notas.push(`Último intento: ${ESTADOS_MP[r.ultimoEstadoMp] ?? r.ultimoEstadoMp}${detalle}`);
  }
  if (r.avisoError) notas.push(`Aviso al paciente no enviado: ${r.avisoError}`);
  notas.push(...r.anomalias);
  return (
    <tr>
      <td className={cr.tablaApagado}>{fecha(r.creado, tz)}</td>
      <td>{r.paciente}</td>
      <td className={cr.tablaApagado}>{fecha(r.cita, tz)}</td>
      <td>{formatoPesos(r.pagado ?? r.monto)}</td>
      <td>
        <Insignia tono={est.tono}>{est.texto}</Insignia>
        {notas.length > 0 && (
          <div className={cr.campoAyuda} style={{ marginTop: 4, maxWidth: 280 }}>
            {notas.join(" · ")}
          </div>
        )}
      </td>
      <td className={cr.tablaApagado}>{r.referenciaMp ?? "—"}</td>
    </tr>
  );
}
