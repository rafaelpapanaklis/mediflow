/**
 * La ayuda del panel que Sabina puede recitar — «¿cómo configuro Mercado
 * Pago?», «¿dónde bloqueo la agenda de un doctor?».
 *
 * 🔴 LA REGLA: aquí solo entra lo que está comprobado contra el código o contra
 * una guía que Rafael ya aprobó. Una instrucción falsa le hace perder media hora
 * a una recepcionista, así que Sabina NO completa con lo que «suena lógico»: si
 * el tema no está en esta lista, lo dice (ver `ayuda_del_panel`).
 *
 * ── DE DÓNDE SALE CADA TEMA ────────────────────────────────────────────
 *  · `guia-ticket` — la guía «Ortodoncia, evoluciones y WhatsApp» que se
 *    escribió para el ticket del 19-sep-2026 y aprobó Rafael (trabajo del
 *    tablero 20260920-1602, `material/ayuda-cliente.html`). Nunca llegó al repo
 *    como página; aquí está condensada. El 23-sep-2026 el código ya la había
 *    dejado atrás en cuatro puntos y se corrigió contra él: el consentimiento
 *    ya no exige plantilla (c58dfb7f), el bot ya no pide la fecha de
 *    nacimiento a un paciente único (saldo-core.ts), un abono de más se
 *    rechaza (no queda saldo a favor) y el PDF no trae las notas de Clínico.
 *  · `codigo` — escrito para esta herramienta (ws1-t4, 23-sep-2026), con cada
 *    etiqueta sacada de `src/i18n/dictionaries/{es,en}.json` o del JSX de la
 *    pantalla. Son los cuatro que pidió Rafael: Mercado Pago, bloqueos,
 *    horario por doctor e importar pacientes.
 *
 * ── POR QUÉ POR TEMAS, Y NO TODO EN EL PROMPT ──────────────────────────
 * Sabina cobra por token (Saldo IA). Meter toda la ayuda en el prompt la haría
 * pagar en CADA pregunta —«¿cuántas citas tengo hoy?» incluida—. Así, lo fijo
 * es la lista de temas (el enum de la herramienta) y el texto de UN tema solo
 * viaja cuando alguien pregunta por él.
 *
 * ── AL AÑADIR UN TEMA ──────────────────────────────────────────────────
 * Cada tema tiene que caber en `TOPE_TEMA` y llevar sus dos idiomas; lo
 * vigila `tools/__tests__/sabe-del-panel.test.ts`. Si una pantalla cambia
 * de etiqueta, el tema se corrige aquí: esta lista NO se actualiza sola.
 *
 * Puro: sin base, sin Prisma, sin `server-only`.
 */

export type IdiomaAyuda = "es" | "en";

export interface TemaAyuda {
  /** snake_case: es lo que el modelo pasa en `tema`. */
  id: string;
  /** Una línea para la descripción de la herramienta (la ve el modelo en cada llamada: corta). */
  pista: string;
  fuente: "guia-ticket" | "codigo";
  texto: Record<IdiomaAyuda, string>;
}

/** Caracteres máximos por tema e idioma: lo que cuesta, como mucho, una pregunta de ayuda. */
export const TOPE_TEMA = 1600;

export const TEMAS_AYUDA = [
  /* ── Los cuatro que pidió Rafael (ws1-t4) ──────────────────────────── */
  {
    id: "mercado_pago",
    pista: "conectar Mercado Pago y cobrar anticipo al agendar por WhatsApp",
    fuente: "codigo",
    texto: {
      es: `Mercado Pago sirve para que el bot de WhatsApp pida un anticipo al agendar. Lo configura un administrador (ADMIN o Super Admin): la tarjeta solo la ven ellos, y la pantalla pide el permiso «Editar configuración».
1. Configuración → pestaña Integraciones → tarjeta «Anticipos por WhatsApp (Mercado Pago)» → «Configurar anticipos».
2. En «Cuenta de Mercado Pago», pulsa «Conectar con Mercado Pago» y entra con la cuenta de la clínica. No hay que copiar llaves. Al volver sale «Conectada».
3. En «Anticipo al agendar por WhatsApp», enciende «Pedir anticipo al agendar».
4. En «Cómo se calcula» elige: Monto fijo, Porcentaje del precio del servicio o Precio completo del servicio. Con porcentaje o precio completo, el «Monto de respaldo» se usa si el servicio no tiene precio. Mínimo $10.
5. «Plazo para pagar (minutos)»: de 10 a 240 (30 por defecto). Si el paciente no paga a tiempo, se libera el horario.
6. Pulsa «Guardar».
El paciente recibe el link en WhatsApp. Si paga a tiempo, la cita se confirma; el anticipo queda como saldo a favor para su tratamiento, no como cobro extra. Si paga cuando el horario ya se liberó, el pago queda como saldo a favor y la cita no se confirma. «Desconectar» apaga el anticipo.
Si la pantalla dice «DaleControl todavía no activa los cobros con Mercado Pago», no depende de la clínica y no hay que hacer nada: en cuanto se active, ahí se podrá conectar la cuenta.`,
      en: `Mercado Pago lets the WhatsApp bot ask for a deposit when it books. An administrator (ADMIN or Super Admin) sets it up: only they see the card, and the screen requires the "Editar configuración" permission. This screen is only in Spanish, so the names below are in Spanish.
1. Settings → Integrations tab → card "Anticipos por WhatsApp (Mercado Pago)" → "Configurar anticipos".
2. Under "Cuenta de Mercado Pago", press "Conectar con Mercado Pago" and sign in with the clinic's account. No keys to copy. When you come back it shows "Conectada".
3. Under "Anticipo al agendar por WhatsApp", switch on "Pedir anticipo al agendar".
4. Under "Cómo se calcula", choose a fixed amount (Monto fijo), a percentage of the service price, or the full service price. With a percentage or the full price, the fallback amount ("Monto de respaldo") applies when the service has no price. Minimum $10.
5. "Plazo para pagar (minutos)": 10 to 240 (30 by default). If the patient doesn't pay in time, the slot is released.
6. Press "Guardar".
The patient gets the link on WhatsApp. If they pay in time, the appointment is confirmed; the deposit becomes credit for their treatment, not an extra charge. If they pay after the slot was released, the payment stays as credit and the appointment is not confirmed. "Desconectar" turns the deposit off.
If the screen says "DaleControl todavía no activa los cobros con Mercado Pago", it doesn't depend on the clinic and there's nothing to do: once it's switched on, the account can be connected there.`,
    },
  },
  {
    id: "bloquear_agenda",
    pista: "bloquear la agenda: vacaciones, festivos, horas sueltas, de un doctor o de toda la clínica",
    fuente: "codigo",
    texto: {
      es: `Los bloqueos se crean en Configuración → pestaña «Horarios y bloqueos» → sección Bloqueos. Desde la Agenda no se crean.
Lo hace un administrador. Un doctor solo cierra SU agenda, y solo si le dieron acceso a Configuración. Recepción no tiene esa pestaña: se lo pide a la administración.
Tarjeta «Bloqueo personalizado»:
1. «¿A quién cierra?»: Toda la clínica, o un doctor. (Un doctor no ve esta opción ni los festivos: su bloqueo es siempre el suyo.)
2. «Cuándo»: «Día completo» (Desde / Hasta; el último día entra entero) o «Solo unas horas» (Día, Hora de inicio, Hora de fin).
3. «Qué es y por qué»: Tipo (Vacaciones, Festivo, Personal, Mantenimiento, Otro) y Motivo (obligatorio).
4. Pulsa «Crear bloqueo».
Si en ese rango ya hay citas, no deja crearlo: avisa cuántas hay, con «Ver en la agenda». Hay que moverlas o cancelarlas primero. No hay bloqueos que se repitan: lo que se repite cada semana va en el horario.
Festivos: la tarjeta «Días festivos de México» deja marcar los Oficiales y los De costumbre, y luego «Aplicar N festivos».
Para quitar uno: lista «Bloqueos activos» → «Retirar». No se pueden editar: se retira y se crea otro.
El bot de WhatsApp y la reserva en línea no ofrecen horarios bloqueados.`,
      en: `Blocks are created in Settings → "Hours & blocks" tab → Blocks section. You can't create them from the Schedule.
An administrator does this. A doctor can only close THEIR own schedule, and only if they were given access to Settings. The front desk doesn't have that tab: ask the administration.
"Custom block" card:
1. "Who does it close?": The whole clinic, or one doctor. (A doctor doesn't see this option or the holidays: their block is always their own.)
2. "When": "All day" (From / To; the last day is included in full) or "Just a few hours" (Day, Start time, End time).
3. "What it is and why": Type (Vacation, Holiday, Personal, Maintenance, Other) and Reason (required).
4. Press "Create block".
If there are already appointments in that range, it won't let you create it: it says how many, with "View in the agenda". Move or cancel them first. There are no repeating blocks: anything weekly belongs in the hours.
Holidays: the "Mexican public holidays" card lets you tick Statutory and By custom days, then "Apply N holidays".
To remove one: "Active blocks" list → "Remove". Blocks can't be edited: remove it and create a new one.
The WhatsApp bot and online booking don't offer blocked times.`,
    },
  },
  {
    id: "horario_doctor",
    pista: "horario de atención de la clínica y horario propio de cada doctor",
    fuente: "codigo",
    texto: {
      es: `Horario de la clínica: Configuración → pestaña «Horarios y bloqueos» → «Horario de atención». Por cada día, casilla de abierto (sin marcar = Cerrado) y una hora de apertura y una de cierre. Solo un tramo por día. Pulsa «Guardar horarios». Lo edita un administrador; un doctor lo ve sin poder cambiarlo («Lo define la administración de la clínica»).
Horario de un doctor: Equipo → tarjeta del doctor → botón «Horario» (solo lo ve un administrador, y solo en tarjetas de doctores). Un doctor con acceso a Configuración pone el suyo en «Horarios y bloqueos» → «Mi horario».
- Sin horario propio, el doctor sigue el de la clínica («Sigue el horario de la clínica»).
- «Darle un horario propio»: marca sus días con hora de entrada y de salida, y pulsa «Guardar horario propio». Si ya tenía uno, el botón dice «Guardar cambios».
- «Volver al horario de la clínica» borra su horario propio (pide confirmación).
A un doctor solo se le ofrecen citas donde coinciden su horario y el de la clínica, y que no estén bloqueadas. Si su horario se sale del de la clínica, se guarda con un aviso y esas horas no se ofrecen.
El bot de WhatsApp respeta los dos horarios. Desde el panel se puede agendar fuera de horario: solo sale un aviso.`,
      en: `Clinic hours: Settings → "Hours & blocks" tab → "Business hours". For each day, an open checkbox (unticked = closed) and one opening and one closing time. Only one range per day. Press "Save hours". An administrator edits it; a doctor sees it read-only ("Set by the clinic's administration.").
A doctor's hours: Team → the doctor's card → "Schedule" button (only an administrator sees it, and only on doctors' cards). A doctor with access to Settings sets their own in "Hours & blocks" → "My schedule".
- With no schedule of their own, the doctor follows the clinic's ("Follows the clinic's hours").
- "Give them their own schedule": tick their days with start and end times, and press "Save own schedule". If they already had one, the button says "Save changes".
- "Go back to the clinic's hours" deletes their own schedule (asks for confirmation).
A doctor is only offered appointments where their hours and the clinic's overlap and nothing is blocked. If their hours go beyond the clinic's, it saves with a warning and those hours aren't offered.
The WhatsApp bot respects both schedules. From the panel you can still book outside hours: you just get a warning.`,
    },
  },
  {
    id: "importar_pacientes",
    pista: "importar pacientes (y saldos, citas, expedientes) desde Excel u otro sistema",
    fuente: "codigo",
    texto: {
      es: `Pacientes → botón «Importar mi clínica». Lo pueden usar administración y recepción (con permiso de crear pacientes).
Son 6 pasos:
1. Origen: tu sistema anterior (Dentalink, Medilink, Open Dental, Dentrix, Eaglesoft, Gesden, DentalCore, Dentidesk, iDentalSoft), «Mi Excel» u «Otro».
2. Exportar: cómo sacar el archivo de ese sistema, o «Descargar plantilla» (.xlsx de DaleControl).
3. Qué importar: Pacientes (recomendado), Saldos, Citas próximas, Expedientes, Notas de evolución, Presupuestos.
4. Subir: .xlsx o .csv, hasta 5 MB y 5,000 filas.
5. Mapear: empareja tus columnas con los campos de DaleControl. En Pacientes, nombre y apellido son obligatorios.
6. Revisar: cuenta Válidos, Con errores y Duplicados. «Omitir duplicados» viene marcado; un paciente duplicado = mismo correo o teléfono, en el archivo o ya en la clínica. Luego se importa.
Si los pacientes nuevos no caben en lo que le queda al plan, no se importa nada.
¿Otro formato o un archivo grande? «Migración asistida»: subes el respaldo (hasta 50 MB) con «Enviar para revisión» y el equipo de DaleControl lo importa (unas 48 h hábiles).`,
      en: `Patients → "Import my clinic" button. Administration and the front desk can use it (with permission to create patients).
There are 6 steps:
1. Source: your previous system (Dentalink, Medilink, Open Dental, Dentrix, Eaglesoft, Gesden, DentalCore, Dentidesk, iDentalSoft), "Mi Excel" or "Otro" (these two names show in Spanish).
2. Export: how to get the file out of that system, or "Download template" (DaleControl .xlsx).
3. What to import: Patients (recommended), Balances, Upcoming appointments, Medical history, Progress notes, Estimates.
4. Upload: .xlsx or .csv, up to 5 MB and 5,000 rows.
5. Map: match your columns to DaleControl fields. For Patients, first and last name are required.
6. Review: counts Valid, With errors and Duplicates. "Skip duplicates" is ticked; a duplicate patient = same email or phone, in the file or already in the clinic. Then import.
If the new patients don't fit in what's left of the plan's limit, nothing is imported.
Other format or a big file? "Assisted migration": upload the backup (up to 50 MB) with "Send for review" and the DaleControl team imports it (about 48 business hours).`,
    },
  },
  /* ── La guía del ticket del 19-sep-2026 (aprobada por Rafael) ─────── */
  {
    id: "tratamiento_a_plazos",
    pista: "cobrar ortodoncia u otro tratamiento con enganche y mensualidades",
    fuente: "guia-ticket",
    texto: {
      es: `Ortodoncia (o implante, rehabilitación, cualquier tratamiento en partes) con enganche y mensualidades, sin crear un procedimiento por mes:
1. Crea UNA factura con un renglón, p. ej. «Ortodoncia 24 meses».
2. En «Forma de pago», elige «A plazos».
3. Captura el enganche, cuántos pagos (de 2 a 60) y cada cuánto.
4. Guarda. El calendario de vencimientos queda hecho.
Abonos: cada abono se cobra normal desde Caja; el sistema lo aplica solo a la cuota más antigua pendiente.
En la ficha del paciente se ve por qué cuota va, la fecha de la siguiente, cuánto falta y si lleva cuotas vencidas. Ese saldo alimenta Caja, Finanzas y «quién me debe».`,
      en: `Orthodontics (or an implant, rehab, any treatment paid in parts) with a down payment and monthly payments, without creating one procedure per month:
1. Create ONE invoice with one line, e.g. "Orthodontics 24 months".
2. Under "Payment terms", choose "Installments".
3. Enter the down payment, how many payments (2 to 60) and how often.
4. Save. The due-date schedule is created.
Payments: each payment is charged as usual from the Cash register; the system applies it to the oldest pending installment.
The patient's record shows which installment they're on, the next date, what's left and any overdue installments. That balance feeds the Cash register, Finances and "who owes me".`,
    },
  },
  {
    id: "notas_de_evolucion",
    pista: "escribir notas de evolución y usar plantillas de notas y consentimientos",
    fuente: "guia-ticket",
    texto: {
      es: `Notas de evolución (se escriben libres; la plantilla nunca es obligatoria):
1. Abre el paciente → Clínico → Nota de evolución.
2. Pulsa «Nueva nota de evolución».
3. Escribe. La cabecera (clínica, fecha, paciente, doctor y cédula) se llena sola.
Si quieres plantilla, está como botón dentro del editor, también a mitad de escribir, y no pisa lo ya escrito. Si falta un dato (cédula, logo, CURP), la nota lo avisa arriba con el enlace para capturarlo; se puede firmar igual.
El consentimiento informado también empieza en blanco; su plantilla es opcional.
Plantillas: Administración → Plantillas, con dos pestañas: Notas de evolución y Consentimientos informados. Los consentimientos ya traen plantillas cargadas, y se pueden editar.`,
      en: `Progress notes (free text; a template is never required):
1. Open the patient → Clinical → Progress note.
2. Press "New progress note".
3. Write. The header (clinic, date, patient, doctor and licence number) fills itself in.
If you want a template, it's a button inside the editor, even halfway through, and it won't overwrite what you wrote. If something is missing (licence number, logo, CURP), the note warns at the top with a link to fill it in; you can still sign it.
Informed consent also starts blank; its template is optional.
Templates: Administration → Templates, with two tabs: Progress notes and Informed consents. Consents come with templates preloaded, and you can edit them.`,
    },
  },
  {
    id: "expediente_pdf",
    pista: "descargar el expediente clínico completo en PDF",
    fuente: "guia-ticket",
    texto: {
      es: `Todo el expediente clínico en un solo PDF (NOM-004):
1. Abre el paciente.
2. Pulsa los tres puntitos, arriba a la derecha, junto a «Cobrar».
3. Elige «Descargar expediente completo».
4. Marca si incluyes imágenes o lo administrativo (las dos casillas vienen apagadas) y pulsa «Generar PDF».
Trae ficha de identificación, antecedentes, las notas del expediente, odontograma, planes de tratamiento, recetas, consentimientos, estudios y citas. OJO: hoy las notas escritas en Clínico → Nota de evolución NO salen en este PDF.`,
      en: `The whole clinical record in one PDF (NOM-004):
1. Open the patient.
2. Press the three dots, top right, next to "Charge".
3. Choose "Download full medical record".
4. Tick whether to include images or the administrative part (both boxes start unticked) and press "Generate PDF".
It includes the identification sheet, health history, the record's notes, odontogram, treatment plans, prescriptions, consents, studies and appointments. NOTE: notes written in Clinical → Progress note currently do NOT appear in this PDF.`,
    },
  },
  {
    id: "bot_whatsapp",
    pista: "qué hace el bot de WhatsApp: horarios, agendar, dudas, mensualidad",
    fuente: "guia-ticket",
    texto: {
      es: `El bot de WhatsApp ofrece horarios reales, agenda citas, resuelve dudas y, si la clínica lo enciende, dice la próxima mensualidad.
- Los horarios salen de la agenda real: respeta el horario de la clínica, que el doctor esté disponible y que no haya empalmes. Las citas que agenda quedan marcadas para que recepción las valide.
- Las dudas las responde con las preguntas frecuentes que configura cada clínica.
- La mensualidad viene apagada. Si el número es de un solo paciente, contesta directo. Si es de varios, pide la fecha de nacimiento para saber de cuál se trata, y si no coincide con uno solo, deriva a la clínica. Responde solo la próxima cuota y lo pendiente.
- También hay un aviso automático de mensualidad por vencer, con el texto que quiera la clínica. Viene apagado.`,
      en: `The WhatsApp bot offers real time slots, books appointments, answers questions and, if the clinic turns it on, tells the next monthly payment.
- Time slots come from the real schedule: it respects the clinic's hours, doctor availability and no double-booking. Appointments it books are flagged for the front desk to validate.
- It answers questions with the FAQs each clinic sets up.
- Monthly payment info is off by default. If the number belongs to one patient, it answers directly. If it belongs to several, it asks for the date of birth to tell which one, and if that doesn't match exactly one, it refers them to the clinic. It only gives the next installment and what's pending.
- There's also an automatic reminder before an installment is due, with the clinic's own text. It's off by default.`,
    },
  },
] as const satisfies ReadonlyArray<TemaAyuda>;

export type IdTemaAyuda = (typeof TEMAS_AYUDA)[number]["id"];

export const IDS_TEMAS_AYUDA = TEMAS_AYUDA.map((t) => t.id) as [IdTemaAyuda, ...IdTemaAyuda[]];

export function temaAyuda(id: string): TemaAyuda | undefined {
  return (TEMAS_AYUDA as ReadonlyArray<TemaAyuda>).find((t) => t.id === id);
}
