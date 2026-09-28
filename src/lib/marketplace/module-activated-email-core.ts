/**
 * Correo «Módulo activado» — lo que recibe la clínica cuando se le enciende un
 * módulo, lo haya comprado (Stripe) o se lo haya dado soporte desde /admin.
 * Antes no salía ningún correo: la clínica pagaba y no le llegaba nada.
 *
 * Puro: arma asunto, HTML y texto a partir de datos ya resueltos. El envío y
 * la consulta a la base viven en `./module-activated-email.ts`.
 *
 *   npx tsx --test src/lib/marketplace/module-activated-email-core.test.ts
 *
 * IMPORTES: el correo enseña lo que la clínica PAGÓ (el subtotal que guardó el
 * webhook), nunca un precio escrito aquí.
 */

export type OrigenActivacion = "compra" | "cortesia";

export interface DatosCorreoModulo {
  firstName?: string | null;
  clinicName: string;
  moduleName: string;
  origen: OrigenActivacion;
  /** Lo pagado por el periodo, sin IVA. Se ignora en una cortesía. */
  amountMxn?: number | null;
  billing?: "monthly" | "annual" | null;
  /** "card" | "spei" | "oxxo". Con tarjeta se renueva sola; con SPEI/OXXO no. */
  method?: string | null;
  /** Fin del periodo pagado. */
  periodEnd?: Date | null;
  /** A dónde lleva el botón. */
  moduleUrl: string;
  /** Pasos para estrenar el módulo. Vacío = no se pinta el bloque. */
  primerosPasos?: readonly string[];
  /** Zona horaria de la clínica, para que la fecha no salga un día antes. */
  timeZone?: string | null;
}

export interface CorreoArmado {
  subject: string;
  html: string;
  text: string;
}

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pesos(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

function fechaLarga(d: Date, timeZone?: string | null): string {
  const opciones: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  try {
    return new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: timeZone || "America/Mexico_City" }).format(d);
  } catch {
    // Zona horaria inválida en la clínica: la de México antes que fallar.
    return new Intl.DateTimeFormat("es-MX", { ...opciones, timeZone: "America/Mexico_City" }).format(d);
  }
}

/** La línea que dice qué se pagó y qué pasa después. `null` si no hay nada que decir. */
export function lineaDeCobro(d: DatosCorreoModulo): string | null {
  if (d.origen === "cortesia") return "Lo activó el equipo de DaleControl: no se te cobra nada por él.";
  const pagado = Number(d.amountMxn ?? 0);
  if (!(pagado > 0)) return null;
  const ciclo = d.billing === "annual" ? "al año" : "al mes";
  const hasta = d.periodEnd ? fechaLarga(d.periodEnd, d.timeZone) : null;
  const importe = `${pesos(pagado)} MXN ${ciclo} más IVA`;
  if (d.method === "spei" || d.method === "oxxo") {
    return hasta
      ? `Pagaste ${importe}. Es un pago único: el módulo queda activo hasta el ${hasta} y no se renueva solo.`
      : `Pagaste ${importe}. Es un pago único: no se renueva solo.`;
  }
  return hasta
    ? `Pagaste ${importe}. Se renueva solo el ${hasta}; puedes cancelarlo cuando quieras desde tu panel.`
    : `Pagaste ${importe}. Se renueva solo; puedes cancelarlo cuando quieras desde tu panel.`;
}

export function armarCorreoModuloActivado(d: DatosCorreoModulo): CorreoArmado {
  const nombre = d.firstName?.trim() ? `, ${d.firstName.trim()}` : "";
  const cobro = lineaDeCobro(d);
  const pasos = (d.primerosPasos ?? []).filter((p) => p.trim().length > 0);
  const entrada =
    d.origen === "cortesia"
      ? `Activamos el módulo de ${d.moduleName} en tu clínica «${d.clinicName}». Ya puedes usarlo.`
      : `Confirmamos tu pago. El módulo de ${d.moduleName} ya está activo en tu clínica «${d.clinicName}».`;

  const subject = `Tu módulo de ${d.moduleName} está activo · DaleControl`;

  const e = escaparHtml;
  const html = `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      DaleControl
    </div>
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      Listo${e(nombre)}: ${e(d.moduleName)} está activo
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      ${e(entrada)}
    </p>
${cobro ? `
    <div style="padding: 18px 20px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; margin: 24px 0;">
      <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #a78bfa; font-weight: 600; margin-bottom: 6px;">
        ${d.origen === "cortesia" ? "Sin costo" : "Tu pago"}
      </div>
      <div style="font-size: 14px; color: rgba(245,245,247,0.85); line-height: 1.5;">
        ${e(cobro)}
      </div>
    </div>
` : ""}
    <a href="${e(d.moduleUrl)}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 32px 0;">
      Abrir ${e(d.moduleName)} →
    </a>
${pasos.length ? `
    <div style="font-size: 13px; color: rgba(245,245,247,0.6); line-height: 1.6;">
      <div style="font-weight: 600; color: rgba(245,245,247,0.85); margin-bottom: 10px;">Primeros pasos:</div>
      <ol style="margin: 0; padding-left: 20px;">
${pasos.map((p) => `        <li>${e(p)}</li>`).join("\n")}
      </ol>
    </div>
` : ""}
    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      ¿Tienes dudas? Responde este correo o escríbenos a
      <a href="mailto:soporte@dalecontrol.com" style="color: #a78bfa;">soporte@dalecontrol.com</a>.
      <br /><br />
      DaleControl
    </div>
  </div>
</body>
</html>`;

  const text =
    `Listo${nombre}: ${d.moduleName} está activo.\n\n` +
    `${entrada}\n\n` +
    (cobro ? `${cobro}\n\n` : "") +
    `Abrir ${d.moduleName}: ${d.moduleUrl}\n\n` +
    (pasos.length ? `Primeros pasos:\n${pasos.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n` : "") +
    `¿Dudas? soporte@dalecontrol.com\n` +
    `DaleControl`;

  return { subject, html, text };
}

/**
 * Llave del candado de «un solo correo por activación». Stripe reenvía sus
 * eventos y manda dos por el mismo pago; la activación es la misma mientras
 * sea la misma suscripción (o la misma sesión de pago, en SPEI/OXXO).
 */
export function llaveCorreoModulo(input: { clinicId: string; moduleKey: string; referencia: string }): string {
  return `modulo-activado:${input.clinicId}:${input.moduleKey}:${input.referencia}`;
}

// ── El aviso completo, con sus dependencias inyectadas ─────────────────────

export interface AvisoModuloActivado {
  clinicId: string;
  moduleKey: string;
  origen: OrigenActivacion;
  /**
   * Lo que identifica ESTA activación: el id de la suscripción de Stripe, el de
   * la sesión de pago (SPEI/OXXO) o, en una cortesía, el momento en que se dio.
   */
  referencia: string;
  amountMxn?: number | null;
  billing?: "monthly" | "annual" | null;
  method?: string | null;
  periodEnd?: Date | null;
}

export interface DestinoCorreoModulo {
  email: string | null;
  firstName: string | null;
  clinicName: string;
  timeZone: string | null;
}

export interface DepsAvisoModulo {
  /** Dueño de la clínica (o el correo de la clínica). `null` si la clínica no existe. */
  cargarDestino: (clinicId: string) => Promise<DestinoCorreoModulo | null>;
  /** Nombre del módulo en el catálogo. `null` si no existe. */
  cargarNombreModulo: (moduleKey: string) => Promise<string | null>;
  /**
   * Reserva el candado de «un solo correo». `true` solo si ESTA llamada lo
   * consiguió; `false` si ya estaba tomado o no se pudo comprobar (sin poder
   * deduplicar se prefiere no enviar antes que enviar dos veces).
   */
  reservar: (llave: string, clinicId: string, email: string) => Promise<boolean>;
  enviar: (correo: { to: string; subject: string; html: string; text: string }) => Promise<unknown>;
  /** Base pública del sitio, sin barra final. */
  siteUrl: string;
  /** Ruta del módulo dentro del panel y sus primeros pasos. */
  destinoDelModulo: (moduleKey: string) => { ruta: string; primerosPasos: readonly string[] };
}

export type ResultadoAviso =
  | { enviado: true; a: string }
  | { enviado: false; motivo: "sin-clinica" | "sin-modulo" | "sin-correo" | "ya-enviado" | "error" };

/** Arma y manda el correo. Nunca lanza: un fallo aquí no puede tumbar la activación. */
export async function avisarModuloActivado(
  aviso: AvisoModuloActivado,
  deps: DepsAvisoModulo,
): Promise<ResultadoAviso> {
  try {
    const destino = await deps.cargarDestino(aviso.clinicId);
    if (!destino) return { enviado: false, motivo: "sin-clinica" };
    const moduleName = await deps.cargarNombreModulo(aviso.moduleKey);
    if (!moduleName) return { enviado: false, motivo: "sin-modulo" };
    const email = destino.email?.trim() || null;
    if (!email) return { enviado: false, motivo: "sin-correo" };

    const llave = llaveCorreoModulo({
      clinicId: aviso.clinicId,
      moduleKey: aviso.moduleKey,
      referencia: aviso.referencia,
    });
    if (!(await deps.reservar(llave, aviso.clinicId, email))) return { enviado: false, motivo: "ya-enviado" };

    const { ruta, primerosPasos } = deps.destinoDelModulo(aviso.moduleKey);
    const correo = armarCorreoModuloActivado({
      firstName: destino.firstName,
      clinicName: destino.clinicName,
      moduleName,
      origen: aviso.origen,
      amountMxn: aviso.amountMxn,
      billing: aviso.billing,
      method: aviso.method,
      periodEnd: aviso.periodEnd,
      moduleUrl: `${deps.siteUrl.replace(/\/+$/, "")}${ruta}`,
      primerosPasos,
      timeZone: destino.timeZone,
    });
    await deps.enviar({ to: email, ...correo });
    return { enviado: true, a: email };
  } catch (e) {
    console.error("[modulo-activado] no se pudo avisar:", e);
    return { enviado: false, motivo: "error" };
  }
}
