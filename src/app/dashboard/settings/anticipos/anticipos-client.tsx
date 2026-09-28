"use client";

import { useState } from "react";
import { Banknote, CreditCard, Link2, MessageCircle, QrCode, Receipt, Wallet } from "lucide-react";
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
import { useT } from "@/i18n/i18n-provider";
import type { AnticipoReciente, PantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import {
  ANTICIPO_MINIMO_MXN,
  MINUTOS_MAX,
  MINUTOS_MIN,
  PANEL_HORAS_MAX,
  PANEL_HORAS_MIN,
  formatoPesos,
  notasAnticipoReciente,
  type ModoAnticipo,
  type ModoAnticipoPanel,
} from "@/lib/anticipos/core";

/**
 * Configuración → Anticipos por WhatsApp (WS1-T5).
 *
 * En este orden, porque cada una depende de la anterior:
 *   1. La cuenta de Mercado Pago de la clínica (conectar / con qué cuenta / desconectar).
 *   2. El pago en línea del PORTAL del paciente (ws1-t2): su propio
 *      interruptor, aparte del anticipo. Solo existe con cuenta conectada, se
 *      enciende solo la PRIMERA vez que se conecta la cuenta (reconectar respeta
 *      lo que eligió la clínica) y se guarda en cuanto se mueve.
 *   3. El anticipo: apagado hasta que haya cuenta. Sin cuenta NO hay botón que
 *      falle: la sección se ve atenuada y dice por qué.
 *   4. Los últimos anticipos: el rastro para el día que alguien diga «yo pagué».
 */

const MOTIVOS: Record<string, string> = {
  estado: "La conexión caducó o no la iniciaste desde esta pantalla. Vuelve a intentarlo.",
  sesion: "La sesión cambió a mitad de la conexión. Vuelve a intentarlo desde esta pantalla.",
  permiso: "Tu usuario no tiene permiso para cambiar las integraciones de la clínica.",
  plataforma: "DaleControl todavía no tiene activados los cobros con Mercado Pago.",
  canje: "Mercado Pago no confirmó la autorización. Vuelve a intentarlo.",
  guardar: "No se pudo guardar la conexión de forma segura. Avisa a soporte.",
};

const ESTADOS: Record<string, { texto: string; tono: "neutro" | "info" | "exito" | "alerta" | "peligro" }> = {
  PENDING: { texto: "Esperando pago", tono: "info" },
  PAID: { texto: "Pagado", tono: "exito" },
  // N11 (QA ronda 4): "Venció" solo pasa por el cron del plazo. Este mismo
  // estado también lo pone `cerrarAnticiposDePanel` cuando la factura se
  // canceló o cambió de precio con el anticipo todavía pendiente — "Cerrado"
  // es cierto en los dos casos; "Venció" no lo era en el segundo.
  EXPIRED: { texto: "Cerrado sin pago", tono: "neutro" },
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
  const t = useT();
  const [datos, setDatos] = useState<PantallaAnticipos>(inicial);
  const [activo, setActivo] = useState(inicial.config.activo);
  const [modo, setModo] = useState<ModoAnticipo>(inicial.config.modo);
  const [monto, setMonto] = useState(inicial.config.monto > 0 ? String(inicial.config.monto) : "");
  const [porcentaje, setPorcentaje] = useState(inicial.config.porcentaje > 0 ? String(inicial.config.porcentaje) : "");
  const [minutos, setMinutos] = useState(String(inicial.config.minutos));
  const [guardando, setGuardando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [guardandoPortal, setGuardandoPortal] = useState(false);

  // ── ws1-t3 fase 1 — anticipo pedido DESDE EL PANEL (cita o factura).
  // Config PROPIA, con su propio "Guardar": no toca la del bot de arriba. ──
  const [panelModo, setPanelModo] = useState<ModoAnticipoPanel>(inicial.configPanel.modo);
  const [panelMonto, setPanelMonto] = useState(inicial.configPanel.monto > 0 ? String(inicial.configPanel.monto) : "");
  const [panelPorcentaje, setPanelPorcentaje] = useState(inicial.configPanel.porcentaje > 0 ? String(inicial.configPanel.porcentaje) : "");
  const [panelHoras, setPanelHoras] = useState(String(inicial.configPanel.horas));
  const [guardandoPanel, setGuardandoPanel] = useState(false);

  // ── ws1-t3 fase 2 — datos bancarios de la sede, para «Pedir anticipo →
  // Transferencia» y su PDF/texto. Canal INDEPENDIENTE de Mercado Pago: no
  // exige cuenta conectada. ──
  const [banco, setBanco] = useState(inicial.datosBancarios?.banco ?? "");
  const [beneficiario, setBeneficiario] = useState(inicial.datosBancarios?.beneficiario ?? "");
  const [clabe, setClabe] = useState(inicial.datosBancarios?.clabe ?? "");
  const [referenciaBanco, setReferenciaBanco] = useState(inicial.datosBancarios?.referencia ?? "");
  const [guardandoBanco, setGuardandoBanco] = useState(false);

  // ── ws1-t3 fase 3 — plantillas OPCIONALES (link de anticipo y recibo). ──
  const [plantillas, setPlantillas] = useState(inicial.plantillas);
  const [encendiendoPlantilla, setEncendiendoPlantilla] = useState<"deposit_request" | "payment_receipt" | null>(null);

  const { plataforma, cuenta, comision } = datos;
  const puedeConectar = datos.tablasListas && plataforma.lista;
  const puedeCobrar = puedeConectar && cuenta.conectada;
  // ws1-t1 (M5): el anticipo PEDIDO DESDE EL PANEL (3b) no es del bot — puede
  // cobrarse por Mercado Pago O por transferencia (canales independientes,
  // fase 2), así que su sección no puede apagarse solo porque falte Mercado
  // Pago. El servidor ya decide esto (pantalla.server.ts, configPanel.disponible).
  const puedeConfigurarPanel = datos.configPanel.disponible;

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

  async function guardarPanel() {
    setGuardandoPanel(true);
    try {
      const res = await fetch("/api/settings/anticipos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Solo `panel`: la config del bot de arriba no se toca con este botón.
        body: JSON.stringify({
          panel: {
            modo: panelModo,
            monto: panelMonto.trim() === "" ? 0 : Number(panelMonto),
            porcentaje: panelPorcentaje.trim() === "" ? 0 : Number(panelPorcentaje),
            horas: Number(panelHoras),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "No se pudo guardar.");
        return;
      }
      setDatos(json as PantallaAnticipos);
      toast.success("Guardado.");
    } finally {
      setGuardandoPanel(false);
    }
  }

  async function guardarBanco() {
    setGuardandoBanco(true);
    try {
      const res = await fetch("/api/settings/anticipos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Solo `banco`: no toca ni el bot ni el panel config de arriba.
        body: JSON.stringify({ banco: { banco, beneficiario, clabe, referencia: referenciaBanco } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : "No se pudo guardar.");
        return;
      }
      setDatos(json as PantallaAnticipos);
      toast.success("Datos bancarios guardados.");
    } finally {
      setGuardandoBanco(false);
    }
  }

  /** Enciende UNA plantilla opcional (Meta se la cobra a la clínica fuera de ventana). */
  async function encenderPlantilla(kind: "deposit_request" | "payment_receipt") {
    setEncendiendoPlantilla(kind);
    try {
      const res = await fetch("/api/settings/anticipos/plantilla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(typeof json.reason === "string" ? json.reason : typeof json.error === "string" ? json.error : "No se pudo activar la plantilla.");
        return;
      }
      const pantalla = json.pantalla as PantallaAnticipos | undefined;
      if (pantalla) { setDatos(pantalla); setPlantillas(pantalla.plantillas); }
      toast.success("Plantilla enviada a Meta para su aprobación.");
    } finally {
      setEncendiendoPlantilla(null);
    }
  }

  /** El interruptor del portal se guarda al moverlo (apagar pide confirmación). */
  async function cambiarPortal(siguiente: boolean) {
    if (!siguiente) {
      const ok = await confirm({
        title: t("anticiposPortal.confirmarTitulo"),
        description: t("anticiposPortal.confirmarTexto"),
        confirmText: t("anticiposPortal.confirmarBoton"),
        variant: "danger",
      });
      if (!ok) return;
    }
    setGuardandoPortal(true);
    try {
      const res = await fetch("/api/settings/anticipos/portal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: siguiente }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof json.error === "string" ? json.error : t("anticiposPortal.errorGuardar"));
        return;
      }
      setDatos(json as PantallaAnticipos);
      toast.success(siguiente ? t("anticiposPortal.encendido") : t("anticiposPortal.apagado"));
    } finally {
      setGuardandoPortal(false);
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
          <Aviso tono="exito">
            Cuenta de Mercado Pago conectada. Ya puedes encender el anticipo.{" "}
            {datos.portal.activo ? t("anticiposPortal.conectadaAviso") : t("anticiposPortal.conectadaAvisoApagado")}
          </Aviso>
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
              <EnlaceBoton href="/api/mercadopago/oauth/conectar" variante="principal" externo>
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

        {/* ── 2. El pago en línea del portal (solo con cuenta: sin ella no hay interruptor) ── */}
        {puedeCobrar && (
          <Seccion
            icono={<QrCode size={18} strokeWidth={1.75} aria-hidden />}
            titulo={t("anticiposPortal.titulo")}
            subtitulo={t("anticiposPortal.subtitulo")}
            extra={
              datos.portal.activo ? (
                <Insignia tono="exito" punto>{t("anticiposPortal.insigniaEncendido")}</Insignia>
              ) : (
                <Insignia>{t("anticiposPortal.insigniaApagado")}</Insignia>
              )
            }
          >
            <FilaInterruptor
              titulo={t("anticiposPortal.interruptor")}
              descripcion={t("anticiposPortal.interruptorAyuda")}
              activo={datos.portal.activo}
              onCambiar={cambiarPortal}
              disabled={guardandoPortal}
            />
          </Seccion>
        )}

        {/* ── 3. El anticipo ── */}
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

        {/* ── 3b. El anticipo pedido DESDE EL PANEL (ws1-t3 fase 1) ──
            Config PROPIA, separada de la del bot de arriba: "Guardar" aquí
            no toca ni enciende ni apaga el anticipo del bot. */}
        <Seccion
          icono={<Wallet size={18} strokeWidth={1.75} aria-hidden />}
          titulo="Anticipo pedido desde el panel"
          subtitulo="El sugerido y el plazo cuando recepción pide un anticipo desde la cita o la factura. El monto final siempre lo puede cambiar quien lo pide."
          apagada={!puedeConfigurarPanel}
          nota={
            !puedeConfigurarPanel ? (
              <Aviso tono="info">Conecta la cuenta de Mercado Pago de la clínica o carga sus datos bancarios (abajo) para poder pedir anticipos desde el panel.</Aviso>
            ) : undefined
          }
          pie={
            puedeConfigurarPanel ? (
              <BotonGuardar guardando={guardandoPanel} texto="Guardar" textoGuardando="Guardando…" onClick={guardarPanel} />
            ) : undefined
          }
        >
          <Campos2>
            <Campo etiqueta="Cómo se calcula">
              <Selector value={panelModo} onChange={(e) => setPanelModo(e.target.value as ModoAnticipoPanel)} disabled={!puedeConfigurarPanel}>
                <option value="fixed">Monto fijo</option>
                <option value="percent">Porcentaje del total de la factura</option>
              </Selector>
            </Campo>
            <Campo
              etiqueta={panelModo === "fixed" ? "Monto sugerido (MXN)" : "Monto de respaldo (MXN)"}
              ayuda={panelModo === "fixed" ? `Mínimo ${formatoPesos(ANTICIPO_MINIMO_MXN)}.` : "Se sugiere si la factura no tiene total (aún no hay concepto)."}
            >
              <Entrada
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={panelMonto}
                onChange={(e) => setPanelMonto(e.target.value)}
                disabled={!puedeConfigurarPanel}
                placeholder="300"
              />
            </Campo>
          </Campos2>
          <Campos2>
            {panelModo === "percent" && (
              <Campo etiqueta="Porcentaje (%)" ayuda="Del TOTAL de la factura.">
                <Entrada
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={panelPorcentaje}
                  onChange={(e) => setPanelPorcentaje(e.target.value)}
                  disabled={!puedeConfigurarPanel}
                  placeholder="20"
                />
              </Campo>
            )}
            <Campo
              etiqueta="Plazo para pagar (horas)"
              ayuda={`Entre ${PANEL_HORAS_MIN} y ${PANEL_HORAS_MAX}. Pasado el plazo, la cita se libera y se avisa a recepción (no al paciente).`}
            >
              <Entrada
                type="number"
                inputMode="numeric"
                min={PANEL_HORAS_MIN}
                max={PANEL_HORAS_MAX}
                value={panelHoras}
                onChange={(e) => setPanelHoras(e.target.value)}
                disabled={!puedeConfigurarPanel}
              />
            </Campo>
          </Campos2>
        </Seccion>

        {/* ── 3c. Datos bancarios de la sede (ws1-t3 fase 2) ──
            Canal INDEPENDIENTE de Mercado Pago: no exige cuenta conectada,
            así que esta sección se ve entera aunque la de arriba esté apagada. */}
        <Seccion
          icono={<Banknote size={18} strokeWidth={1.75} aria-hidden />}
          titulo="Datos bancarios para transferencia"
          subtitulo="Cuando «Pedir anticipo» se manda por transferencia, estos son los datos que ve el paciente (texto y PDF). Sin ellos, ese canal no se ofrece."
          pie={<BotonGuardar guardando={guardandoBanco} texto="Guardar" textoGuardando="Guardando…" onClick={guardarBanco} />}
        >
          <Campos2>
            <Campo etiqueta="Banco">
              <Entrada value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="BBVA" />
            </Campo>
            <Campo etiqueta="Beneficiario">
              <Entrada value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} placeholder="Clínica Dental Sonrisa SC" />
            </Campo>
          </Campos2>
          <Campos2>
            <Campo etiqueta="CLABE" ayuda="18 dígitos, con dígito verificador.">
              <Entrada value={clabe} onChange={(e) => setClabe(e.target.value)} inputMode="numeric" placeholder="012345678901234567" />
            </Campo>
            <Campo etiqueta="Referencia (opcional)" ayuda='Guía para el paciente, p. ej. "Escribe tu nombre en el concepto".'>
              <Entrada value={referenciaBanco} onChange={(e) => setReferenciaBanco(e.target.value)} placeholder="Escribe el nombre del paciente" />
            </Campo>
          </Campos2>
          {!datos.datosBancarios?.banco && (
            <p className={cr.campoAyuda} style={{ fontSize: 13 }}>
              Sin datos bancarios cargados, «Pedir anticipo» no ofrece transferencia — solo Mercado Pago, si está conectado.
            </p>
          )}
        </Seccion>

        {/* ── 3d. Plantillas de WhatsApp opcionales (ws1-t3 fase 3) ──
            Apagadas por defecto: Meta se las cobra a la clínica fuera de la
            ventana de 24 h. Sin encenderlas, esos avisos siguen ofreciendo
            copiar texto/PDF, como hasta ahora. */}
        <Seccion
          icono={<MessageCircle size={18} strokeWidth={1.75} aria-hidden />}
          titulo="Plantillas de WhatsApp (opcionales)"
          subtitulo="Para pacientes que no han escrito en las últimas 24 h. Meta las cobra a esta clínica; sin encenderlas, siempre se puede copiar el texto o el PDF."
        >
          <Filas>
            <Fila etiqueta="Link de anticipo (dc_anticipo_cita)">
              {plantillas.anticipo.encendida ? (
                <Insignia tono={plantillas.anticipo.estado === "REJECTED" ? "peligro" : plantillas.anticipo.estado === "PENDING" ? "info" : "exito"}>
                  {plantillas.anticipo.estado === "REJECTED" ? "Rechazada por Meta" : plantillas.anticipo.estado === "PENDING" ? "En revisión" : "Activa"}
                </Insignia>
              ) : (
                <Boton variante="secundario" onClick={() => encenderPlantilla("deposit_request")} disabled={encendiendoPlantilla !== null}>
                  {encendiendoPlantilla === "deposit_request" ? "Activando…" : "Activar"}
                </Boton>
              )}
            </Fila>
            <Fila etiqueta="Recibo de pago (dc_recibo_pago)">
              {plantillas.recibo.encendida ? (
                <Insignia tono={plantillas.recibo.estado === "REJECTED" ? "peligro" : plantillas.recibo.estado === "PENDING" ? "info" : "exito"}>
                  {plantillas.recibo.estado === "REJECTED" ? "Rechazada por Meta" : plantillas.recibo.estado === "PENDING" ? "En revisión" : "Activa"}
                </Insignia>
              ) : (
                <Boton variante="secundario" onClick={() => encenderPlantilla("payment_receipt")} disabled={encendiendoPlantilla !== null}>
                  {encendiendoPlantilla === "payment_receipt" ? "Activando…" : "Activar"}
                </Boton>
              )}
            </Fila>
          </Filas>
        </Seccion>

        {/* ── 4. El rastro ── */}
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
                    {/* Diseño (ws1-t5): los importes a la derecha, uno bajo otro. */}
                    <th style={{ textAlign: "right" }}>Monto</th>
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
  // ws1-t1 (M6): lógica PURA en core.ts (notasAnticipoReciente), probada ahí
  // — sin cita ligada nunca hubo un apartado que confirmar o liberar.
  const notas = notasAnticipoReciente(r);
  return (
    <tr>
      <td className={cr.tablaApagado}>{fecha(r.creado, tz)}</td>
      <td style={{ minWidth: 120 }}>{r.paciente}</td>
      <td className={cr.tablaApagado}>{fecha(r.cita, tz)}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {formatoPesos(r.pagado ?? r.monto)}
      </td>
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
