/**
 * Permisos del panel de la clínica — UNA sola capa.
 *
 * Keys tipo "agenda.view", "billing.charge". Se resuelven con
 * User.permissionsOverride: si está vacío, el default del rol; si tiene keys,
 * ESAS reemplazan al default (no se mergean). Es lo que el SUPER_ADMIN
 * enciende y apaga persona a persona desde el modal de Permisos del equipo, y
 * lo que leen el sidebar, las páginas (requirePermissionOrRedirect) y los
 * endpoints (denyIfMissingPermission).
 *
 * ISO-03 — aquí vivía una segunda capa "entidad.acción"
 * (`hasPermission(role, "prescription.read")`) heredada de los endpoints de
 * compliance de la Fase A. Resolvía contra una tabla por ROL y jamás miraba
 * permissionsOverride, así que el interruptor que la clínica apagaba en el
 * modal no aplicaba a recetas, al borrado de notas SOAP, placas y modelos 3D,
 * al export CDA ni a ARCO. Sus 14 llamadas se pasaron a esta capa y la tabla
 * se retiró: ya no queda forma de comprobar un permiso sin pasar por el
 * override.
 *
 * EQ-07 — regla del catálogo: cada key de ALL_PERMISSIONS la exige de verdad
 * un endpoint o una página. Un interruptor que se guarda y no cambia nada es
 * peor que no tenerlo: la clínica cree que cerró algo. Los tests de
 * `__tests__/permissions-matrix.test.ts` recorren el árbol y fallan si una key
 * deja de tener lector.
 */

import type { Role } from "@prisma/client";

/**
 * Diccionario canónico de permisos. Cada key tiene una descripción legible
 * que se muestra tal cual en el modal de permisos del SUPER_ADMIN, así que la
 * descripción tiene que decir EXACTAMENTE lo que el interruptor protege.
 * El orden importa visualmente — agrupado por área del producto.
 */
export const ALL_PERMISSIONS = {
  // Hoy
  "today.view":           "Ver pestaña Hoy",
  // Agenda
  "agenda.view":          "Ver agenda",
  "agenda.create":        "Crear citas",
  "agenda.edit":          "Editar/mover citas",
  "agenda.delete":        "Cancelar citas",
  // Pacientes
  "patients.view":        "Ver lista de pacientes",
  "patients.create":      "Crear pacientes",
  "patients.edit":        "Editar pacientes",
  "patients.delete":      "Archivar/eliminar pacientes",
  // Expediente clínico. `medicalRecord.edit` cubre también BORRAR notas SOAP
  // (solo borradores), placas y modelos 3D, y anotar/interpretar placas: no hay
  // una key aparte de borrado y darle el borrado a "Subir radiografías" se lo
  // regalaría a recepción.
  "medicalRecord.view":   "Ver expediente clínico",
  "medicalRecord.edit":   "Editar notas SOAP / firmar (y borrar borradores, placas y modelos 3D)",
  // Recetas. `prescription.create` cubre también ANULAR (el inverso de firmar,
  // mismo criterio que consents.revoke) y el chequeo de contraindicaciones.
  "prescription.view":    "Ver recetas (lista, PDF y envío al paciente)",
  "prescription.create":  "Crear/firmar y anular recetas",
  // Consentimientos informados
  "consents.view":        "Ver consentimientos",
  "consents.create":      "Crear, enviar y firmar como doctor los consentimientos",
  "consents.revoke":      "Revocar y eliminar consentimientos",
  // Radiografías. POST /api/xrays es también la subida genérica de archivos
  // del paciente (fotos, PDFs, adjuntos de la nota), de ahí la etiqueta.
  "xrays.view":           "Ver radiografías y archivos del paciente",
  "xrays.upload":         "Subir radiografías y archivos del paciente",
  "xrays.analyze":        "Analizar radiografías con IA (cobra tokens)",
  // Planes de tratamiento (TreatmentPlan de cada paciente; el catálogo de
  // precios es "procedures"). Antes decía "Editar tratamientos (admin)" y
  // vivía en Catálogo: mentía dos veces — son planes, y el autor natural del
  // plan es el doctor.
  "treatments.view":      "Ver planes de tratamiento",
  "treatments.edit":      "Crear y editar planes de tratamiento (y registrar sesiones)",
  // Inbox / Mensajes
  "inbox.view":           "Ver inbox",
  "inbox.send":           "Enviar mensajes",
  "inbox.delete":         "Borrar threads del inbox",
  "whatsapp.view":        "Ver WhatsApp",
  "whatsapp.send":        "Enviar WhatsApp",
  // Catálogo
  "resources.view":       "Ver sillones / consultorios",
  "resources.edit":       "Editar sillones / consultorios",
  "inventory.view":       "Ver inventario",
  "inventory.edit":       "Editar inventario (altas, ajustes de existencias y precios, bajas)",
  // Proveedores / Compras (marketplace B2B)
  "suppliers.view":       "Ver proveedores y laboratorios",
  "suppliers.order":      "Hacer y pagar pedidos a proveedores y laboratorios",
  // Administración
  "billing.view":         "Ver facturación",
  "billing.create":       "Crear facturas",
  "billing.charge":       "Cobrar pagos",
  "billing.refund":       "Reembolsar / cancelar",
  "billing.edit":         "Editar precio / descuento de facturas",
  "analytics.view":       "Ver Analytics",
  "tvModes.view":         "Ver Pantallas TV",
  "tvModes.edit":         "Configurar Pantallas TV",
  "reports.view":         "Ver reportes",
  "team.view":            "Ver equipo",
  // El modal de Permisos y el reset de contraseña siguen siendo SOLO del
  // SUPER_ADMIN por ROL en su endpoint: no dependen de este interruptor.
  "team.edit":            "Editar equipo (dar de alta, editar y dar de baja miembros)",
  "settings.view":        "Ver configuración",
  "settings.edit":        "Editar configuración (datos de la clínica, horarios, recordatorios, CFDI e integraciones)",
  "landing.view":         "Ver página web pública",
  "landing.edit":         "Editar landing",
  "procedures.view":      "Ver procedimientos",
  "procedures.edit":      "Editar procedimientos",
  "clinicLayout.view":    "Ver Mi Clínica Visual",
  "clinicLayout.edit":    "Editar Mi Clínica Visual",
  // Privacidad — solicitudes ARCO (acceso, rectificación, cancelación y
  // oposición) que llegan desde el aviso de privacidad. Ver y resolver van
  // juntas: quien atiende una solicitud tiene que leerla. A propósito NO acaba
  // en ".view" para que READONLY no la herede por el filtro de abajo: son datos
  // personales de terceros, del mismo calibre que el expediente.
  "arco.manage":          "Ver y atender solicitudes ARCO (privacidad)",
  // Marketplace — todos los roles ven por default (es el catálogo de módulos
  // de la clínica). Comprar es admin-only y se valida en server actions.
  "marketplace.view":     "Ver marketplace de módulos",
  // Especialidades — gating de páginas dedicadas de los módulos del
  // marketplace. La visibilidad real ADEMÁS exige el módulo activo en
  // ClinicModule (canAccessModule). Estas keys solo cubren la dimensión
  // de "tiene permiso UI"; el módulo se valida server-side.
  "specialties.pediatrics":   "Ver Odontopediatría",
  "specialties.endodontics":  "Ver Endodoncia",
  "specialties.periodontics": "Ver Periodoncia",
  "specialties.orthodontics": "Ver Ortodoncia",
  "specialties.implants":     "Ver Implantología",
} as const;

export type PermissionKey = keyof typeof ALL_PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(ALL_PERMISSIONS) as PermissionKey[];

/**
 * Agrupación visual para el modal del SUPER_ADMIN. Cada grupo se renderiza
 * como una sección con su título. Las keys aquí deben coincidir 1:1 con las
 * de ALL_PERMISSIONS (TypeScript lo verifica vía PermissionKey, y el test de
 * la matriz comprueba que ninguna key se quede fuera de los grupos).
 */
export const PERMISSION_GROUPS: { title: string; keys: PermissionKey[] }[] = [
  { title: "Hoy",            keys: ["today.view"] },
  { title: "Agenda",         keys: ["agenda.view", "agenda.create", "agenda.edit", "agenda.delete"] },
  { title: "Pacientes",      keys: ["patients.view", "patients.create", "patients.edit", "patients.delete"] },
  { title: "Expediente",     keys: ["medicalRecord.view", "medicalRecord.edit"] },
  { title: "Recetas",        keys: ["prescription.view", "prescription.create"] },
  { title: "Consentimientos", keys: ["consents.view", "consents.create", "consents.revoke"] },
  { title: "Radiografías",   keys: ["xrays.view", "xrays.upload", "xrays.analyze"] },
  { title: "Planes de tratamiento", keys: ["treatments.view", "treatments.edit"] },
  { title: "Comunicación",   keys: ["inbox.view", "inbox.send", "inbox.delete", "whatsapp.view", "whatsapp.send"] },
  { title: "Catálogo",       keys: ["resources.view", "resources.edit", "inventory.view", "inventory.edit", "suppliers.view", "suppliers.order"] },
  { title: "Facturación",    keys: ["billing.view", "billing.create", "billing.charge", "billing.refund", "billing.edit"] },
  { title: "Reportes y TV",  keys: ["analytics.view", "reports.view", "tvModes.view", "tvModes.edit"] },
  { title: "Equipo",         keys: ["team.view", "team.edit"] },
  { title: "Configuración",  keys: ["settings.view", "settings.edit", "landing.view", "landing.edit", "procedures.view", "procedures.edit", "clinicLayout.view", "clinicLayout.edit"] },
  { title: "Privacidad",     keys: ["arco.manage"] },
  { title: "Marketplace",    keys: ["marketplace.view"] },
  { title: "Especialidades", keys: ["specialties.pediatrics", "specialties.endodontics", "specialties.periodontics", "specialties.orthodontics", "specialties.implants"] },
];

/**
 * Defaults por rol. Estos son los permisos que aplican cuando
 * User.permissionsOverride está vacío.
 *
 * Regla al EMPEZAR A EXIGIR una key (EQ-07): el default de cada rol tiene que
 * cubrir lo que ese rol ya hacía en su trabajo diario, y nada más. Lo que se
 * añadió aquí al cablear los interruptores muertos, con el porqué:
 *   · RECEPTIONIST + xrays.view/upload — la asistente sube la placa y los
 *     archivos del paciente desde la ficha (y ese POST es la subida genérica).
 *     NO xrays.analyze: interpretar la placa con IA es clínico y cobra tokens.
 *   · DOCTOR y RECEPTIONIST + treatments.edit — el doctor es el autor del
 *     plan; recepción arma presupuestos y registra sesiones. Antes el default
 *     decía "solo admin" y el endpoint no lo comprobaba, así que ambos lo
 *     hacían igual.
 *   · ADMIN + team.edit — POST/PATCH/DELETE /api/team ya lo dejaban pasar por
 *     rol; el default lo excluía por una etiqueta ("solo SUPER_ADMIN") que no
 *     describía el gate real. Lo que sí es solo del dueño (modal de Permisos y
 *     reset de contraseña) se gatea por ROL en su endpoint.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, PermissionKey[]> = {
  SUPER_ADMIN: [...ALL_PERMISSION_KEYS], // todo
  ADMIN: [...ALL_PERMISSION_KEYS],       // todo (ver nota de team.edit arriba)
  DOCTOR: [
    "today.view",
    "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
    "patients.view", "patients.create", "patients.edit",
    "medicalRecord.view", "medicalRecord.edit",
    "prescription.view", "prescription.create",
    // El consentimiento lo explica y lo firma el profesional que va a tratar:
    // revocarlo también es suyo (mismo criterio que prescription.*).
    "consents.view", "consents.create", "consents.revoke",
    "xrays.view", "xrays.upload", "xrays.analyze",
    "treatments.view", "treatments.edit",
    "resources.view", "suppliers.view",
    "inbox.view", "inbox.send",
    "marketplace.view",
    "specialties.pediatrics",
    "specialties.endodontics",
    "specialties.periodontics",
    "specialties.orthodontics",
    "specialties.implants",
  ],
  RECEPTIONIST: [
    "today.view",
    "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
    "patients.view", "patients.create", "patients.edit",
    // billing.edit: la recepción con Caja borra borradores y edita facturas desde
    // el detalle — DELETE y PATCH de /api/invoices/[id] ahora lo exigen (edit-price ya).
    "billing.view", "billing.create", "billing.charge", "billing.edit",
    // Recepción prepara la carta y se la manda al paciente por WhatsApp (el
    // envío exige consents.create además de whatsapp.send). Revocar NO: eso es
    // del profesional responsable.
    "consents.view", "consents.create",
    // Sube placas y archivos del paciente; no los interpreta con IA.
    "xrays.view", "xrays.upload",
    "treatments.view", "treatments.edit",
    "inbox.view", "inbox.send",
    "whatsapp.view", "whatsapp.send",
    "resources.view", "inventory.view", "suppliers.view",
    "marketplace.view",
    "specialties.pediatrics",
    "specialties.endodontics",
    "specialties.periodontics",
    "specialties.orthodontics",
    "specialties.implants",
  ],
  // READONLY: solo *.view excepto medical/prescription/xrays/consentimientos.
  // El consentimiento es un documento clínico con el mismo contenido sensible
  // que la receta y el expediente — se excluye por el mismo motivo. Y por
  // construcción tampoco recibe nada que no acabe en ".view" (arco.manage,
  // specialties.*): un rol de solo lectura no atiende solicitudes ni entra a
  // los módulos clínicos.
  READONLY: ALL_PERMISSION_KEYS.filter((k) =>
    k.endsWith(".view") &&
    !k.startsWith("medicalRecord.") &&
    !k.startsWith("prescription.") &&
    !k.startsWith("consents.") &&
    !k.startsWith("xrays."),
  ),
};

/**
 * Resuelve los permisos efectivos del usuario.
 * - Si permissionsOverride está vacío → default del role.
 * - Si tiene keys → esas REEMPLAZAN al default (no se mergean).
 *
 * Filtramos keys inválidas que pueda haber quedado en DB tras un cambio
 * de catálogo (defensivo).
 */
export function getEffectivePermissions(user: { role: Role; permissionsOverride?: string[] | null }): PermissionKey[] {
  const override = user.permissionsOverride ?? [];
  if (override.length === 0) return ROLE_DEFAULT_PERMISSIONS[user.role] ?? [];
  return override.filter((k): k is PermissionKey => k in ALL_PERMISSIONS);
}

/**
 * ¿Tiene el usuario esta key? (default del rol + override). Es la ÚNICA forma
 * de comprobar un permiso: recibe el usuario, nunca el rol suelto. La firma
 * anterior `hasPermission(role: Role, "entidad.acción")` —que se saltaba el
 * override— se retiró en ISO-03; pasar un string aquí ya no compila.
 */
export function hasPermission(
  user: { role: Role | string; permissionsOverride?: string[] | null },
  key: PermissionKey,
): boolean {
  // Cinturón por si algo llega casteado (`ctx.role as any`): un rol suelto no
  // es un usuario y no tiene override que consultar → se niega, no se adivina.
  if (typeof user !== "object" || user === null) return false;
  return getEffectivePermissions({ role: user.role as Role, permissionsOverride: user.permissionsOverride }).includes(key);
}

// ════════════════════════════════════════════════════════════════════
// Helpers de validación (para el endpoint PATCH /api/team/[id]/permissions)
// ════════════════════════════════════════════════════════════════════

/** Devuelve solo las keys válidas, descarta las inventadas. */
export function sanitizePermissionKeys(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<PermissionKey>();
  for (const k of input) {
    if (typeof k === "string" && k in ALL_PERMISSIONS) seen.add(k as PermissionKey);
  }
  return Array.from(seen);
}

// ════════════════════════════════════════════════════════════════════
// Marketplace modules — extensión pediatría (spec §4.B.4)
//
// Los módulos del marketplace viven en DB (tabla modules + clinic_modules).
// Aquí re-exportamos las helpers puras del módulo pediátrico para que el
// resto del producto pueda gating-ear sin tocar `lib/pediatrics/*`.
// ════════════════════════════════════════════════════════════════════

export {
  canSeePediatrics,
  hasPediatricsModule,
  PEDIATRICS_MODULE_KEY,
  DEFAULT_PEDIATRICS_CUTOFF_YEARS,
  type PediatricsContext,
} from "@/lib/pediatrics/permissions";
