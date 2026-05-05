// Orthodontics — 4 textos legales literales. SPEC §10.3-§10.7.
// NUNCA modificar el wording sin coordinación legal (Rafael + asesor jurídico).
// Placeholders entre llaves se reemplazan al renderizar el PDF/modal.

import type { OrthoTechnique } from "@prisma/client";

/**
 * SPEC §10.4 — Consentimiento informado de tratamiento ortodóntico.
 * Llaves a sustituir: patientFullName, birthDate, fileNumber, doctorFullName,
 * doctorLicense, technique, techniqueNotes, diagnosisAccessibleSummary,
 * treatmentObjectives, estimatedDurationMonths, retentionPlanText, city,
 * day, month, year, signerRole, guardianRelationship.
 */
export const TREATMENT_CONSENT_TEXT = `
CONSENTIMIENTO INFORMADO PARA TRATAMIENTO ORTODÓNTICO

Yo, {patientFullName}, con fecha de nacimiento {birthDate} y expediente clínico número {fileNumber}, después de haber sido informado(a) por el(la) Dr(a). {doctorFullName}, con cédula profesional {doctorLicense}, en términos comprensibles para mí, manifiesto que he comprendido y acepto los siguientes puntos:

1. EN QUÉ CONSISTE EL TRATAMIENTO ORTODÓNTICO

El tratamiento ortodóntico consiste en colocar aparatos correctores (brackets, alineadores u otros dispositivos) que ejercen fuerzas controladas sobre los dientes y los maxilares, con la finalidad de modificar su posición a lo largo de un periodo prolongado de tiempo. La técnica propuesta para mi caso es: {technique}. La aparatología incluye: {techniqueNotes}.

2. POR QUÉ SE ME PROPONE ESTE TRATAMIENTO

He sido diagnosticado(a) con: {diagnosisAccessibleSummary}. El tratamiento busca corregir esta condición con los siguientes objetivos: {treatmentObjectives}.

3. DURACIÓN ESTIMADA Y FACTORES QUE LA MODIFICAN

La duración estimada del tratamiento activo es de {estimatedDurationMonths} meses. Esta duración es una estimación clínica basada en mi caso y puede extenderse hasta un 30% adicional debido a factores como inasistencia, higiene oral deficiente, características biológicas individuales, daño a la aparatología, falta de cumplimiento con elásticos o alineadores.

Después del retiro de la aparatología activa inicia la fase de retención, que es de por vida.

4. ALTERNATIVAS DE TRATAMIENTO

Las alternativas que se me han explicado son no realizar tratamiento ortodóntico, tratamiento quirúrgico ortognático combinado con ortodoncia, o tratamientos parciales o limitados.

5. RIESGOS, MOLESTIAS Y LIMITACIONES POSIBLES

Acepto que el tratamiento ortodóntico, como cualquier acto médico, no está exento de riesgos: descalcificación del esmalte, reabsorción radicular, caries y enfermedad periodontal por higiene inadecuada, recidiva si no uso retenedores correctamente, dolor o molestia los primeros días tras instalación y ajustes, daño a la aparatología por alimentos duros o pegajosos con costo de reparación a mi cargo, resultados estéticos sujetos a mi anatomía individual y cumplimiento, posible necesidad de procedimientos coadyuvantes con costo adicional acordado por escrito, y en tratamientos con extracciones cierre incompleto de espacios o asimetrías leves.

6. MIS OBLIGACIONES COMO PACIENTE

Asistir a todas las citas mensuales, mantener higiene oral exhaustiva, usar elásticos o aparatología auxiliar al menos 22 horas al día si así me es prescrito, comunicar inmediatamente cualquier daño o dolor anormal, cumplir el plan de retención de por vida, cumplir con el plan de pagos firmado en acuerdo financiero separado.

7. PLAN DE RETENCIÓN

Al finalizar el tratamiento activo se iniciará la fase de retención: {retentionPlanText}. La retención es de por vida en la mayoría de los casos. El abandono o uso incorrecto de los retenedores es la principal causa de recidiva, y la responsabilidad de su uso es exclusivamente mía.

8. LO QUE NO SE GARANTIZA

He comprendido que NO se garantiza perfección estética absoluta, estabilidad indefinida sin uso de retenedores, ausencia total de recidiva por crecimiento facial post-tratamiento, ni resultados idénticos a fotos de casos previos mostrados con fines ilustrativos.

9. AUTORIZACIÓN

Habiendo entendido todo lo anterior y habiendo tenido la oportunidad de hacer preguntas que fueron respondidas a mi satisfacción, autorizo al(a la) Dr(a). {doctorFullName} y a su equipo a iniciar el tratamiento ortodóntico descrito.

Firmo el presente documento en {city} a los {day} días del mes de {month} de {year}.


_________________________________________
{patientFullName}
{signerRole}
{guardianRelationship}


_________________________________________
Dr(a). {doctorFullName}
Cédula profesional: {doctorLicense}
`.trim();

/**
 * SPEC §10.5 — Acuerdo financiero. Pieza más sensible legalmente.
 * Llaves: clinicLegalName, clinicRepresentative, patientFullName,
 * guardianFullName, guardianRelationship, totalCostMxn, technique,
 * estimatedDurationMonths, initialDownPayment, installmentCount,
 * installmentAmount, paymentDayOfMonth, startDate, endDate,
 * preferredPaymentMethod, removalAppointmentCost, rfc, razonSocial,
 * regimenFiscal, usoCfdi, city, day, month, year, signerRole.
 */
export const FINANCIAL_AGREEMENT_TEXT = `
ACUERDO FINANCIERO PARA TRATAMIENTO ORTODÓNTICO

Entre {clinicLegalName} (en adelante "la Clínica"), representada por {clinicRepresentative}, y {patientFullName} (en adelante "el Paciente"), o en su caso {guardianFullName} en calidad de {guardianRelationship} actuando como responsable financiero del Paciente menor de edad, se celebra el presente acuerdo financiero conforme a los siguientes términos:

1. TRATAMIENTO Y COSTO TOTAL

El tratamiento ortodóntico autorizado en consentimiento informado separado tiene un costo total de $ {totalCostMxn} M.N., correspondiente a la técnica {technique} con duración estimada de {estimatedDurationMonths} meses.

2. ESTRUCTURA DE PAGO

Pago inicial (enganche): $ {initialDownPayment} M.N. al inicio del tratamiento.
Mensualidades: {installmentCount} pagos consecutivos de $ {installmentAmount} M.N. cada uno.
Día de pago de cada mensualidad: día {paymentDayOfMonth} de cada mes.
Fecha de inicio: {startDate}. Fecha de fin: {endDate}.
Método de pago preferente: {preferredPaymentMethod}.

3. TOLERANCIA Y CONSECUENCIAS DE RETRASO

a) Tolerancia: la Clínica acepta hasta 30 días naturales sin penalización.
b) Retraso mayor a 30 días: la Clínica se reserva el derecho de suspender citas de control hasta regularización. La suspensión NO modifica vencimientos subsecuentes.
c) Retraso reiterado: tres o más mensualidades vencidas no regularizadas autorizan a la Clínica a aplicar las cláusulas de abandono (numeral 5).

4. REFINANCIAMIENTO Y MODIFICACIONES

Cualquier modificación al calendario requiere acuerdo escrito separado. Acuerdos verbales no tienen efecto.

5. ABANDONO DEL TRATAMIENTO POR EL PACIENTE

Si el Paciente abandona unilateralmente (3 inasistencias consecutivas sin reagendamiento, sin respuesta durante 30 días naturales, o por declaración expresa):
a) NO procede reembolso del enganche.
b) NO procede reembolso de mensualidades pagadas.
c) Mensualidades vencidas hasta la fecha del abandono SÍ son exigibles por vía legal.
d) Retiro de aparatología en cita de retiro con costo de $ {removalAppointmentCost} M.N.

6. INCUMPLIMIENTO POR LA CLÍNICA

Si la Clínica suspende el tratamiento sin causa justificada, debe reembolsar mensualidades pagadas correspondientes a meses futuros no realizados.

7. RECETAS, ESTUDIOS Y PROCEDIMIENTOS NO INCLUIDOS

NO incluidos en el costo total: estudios de imagen, extracciones por especialista distinto, reparación por mal uso del Paciente, procedimientos coadyuvantes no contemplados, retenedores adicionales por pérdida o daño después del primer set.

8. EXPEDICIÓN DE COMPROBANTES FISCALES

La Clínica expedirá CFDI por cada pago. Datos de facturación: {rfc, razonSocial, regimenFiscal, usoCfdi}.

9. PROTECCIÓN DE DATOS PERSONALES

El tratamiento de datos se rige por el aviso de privacidad de la Clínica conforme a LFPDPPP.

10. JURISDICCIÓN

Para interpretación y cumplimiento, ambas partes se someten a la jurisdicción de tribunales competentes de {city}.

LEÍDO Y ACEPTADO en {city} a los {day} días del mes de {month} de {year}.


_________________________________________
{patientFullName}
{signerRole}


_________________________________________
{clinicRepresentative}
Por {clinicLegalName}
`.trim();

/**
 * SPEC §10.6 — Asentimiento del menor (≥12 y <18 años).
 * Llaves: minorFirstName, minorAge, techniqueAccessibleName,
 * estimatedDurationMonths, estimatedDurationPlus30Percent, minorFullName, today.
 */
export const MINOR_ASSENT_TEXT = `
ASENTIMIENTO PARA TRATAMIENTO ORTODÓNTICO

Hola {minorFirstName},

Tus papás (o el familiar que es tu tutor) ya firmaron un papel donde dicen que están de acuerdo con que te pongan {techniqueAccessibleName}. Como tú ya tienes {minorAge} años, queremos que tú también nos digas que entiendes lo que vamos a hacer y que estás de acuerdo.

QUÉ VAMOS A HACER

Te vamos a poner unos aparatos en los dientes que poco a poco los van a mover para que queden derechos. El tratamiento va a tomar entre {estimatedDurationMonths} y {estimatedDurationPlus30Percent} meses. Tendrás que venir cada mes a una cita corta donde te ajustamos los aparatos.

QUÉ TIENES QUE HACER TÚ

Cepillarte los dientes muy bien después de cada comida. Te vamos a enseñar la técnica especial.
Usar hilo dental todos los días.
NO comer cosas muy duras (palomitas duras, hielo, hueso de pollo, dulces duros).
NO comer cosas muy pegajosas (chicle, caramelos masticables, goma).
Si te ponen elásticos o tienes que usar alineadores, usarlos como te indique el doctor.
Avisarle a tus papás o llamarnos a la clínica si algo se rompe, se sale o te duele mucho.
Venir a TODAS tus citas mensuales.

QUÉ VAS A SENTIR AL PRINCIPIO

Los primeros 3 a 7 días te van a doler un poco al masticar. Es normal. Tu mamá o tu papá te puede dar paracetamol o ibuprofeno. La molestia se quita sola. Después de cada cita mensual también puede haber un par de días de molestia leve.

CUÁNTO VA A DURAR EN TOTAL

Tu tratamiento activo va a durar más o menos {estimatedDurationMonths} meses. Después usarás retenedores especiales por mucho tiempo (durante años, casi toda la vida).

LO QUE NO TE PODEMOS PROMETER

No podemos prometerte que tus dientes queden exactamente igual a alguna foto que hayas visto. Lo que sí te prometemos es trabajar con todo el cuidado posible para que tu sonrisa quede sana, funcional y con la mejor estética posible para ti.

¿ESTÁS DE ACUERDO?

Si entiendes lo que te explicamos y estás de acuerdo en empezar tu tratamiento, firma aquí abajo.


_________________________________________
{minorFullName}
Edad: {minorAge} años
Fecha: {today}
`.trim();

/**
 * SPEC §10.7 — Consentimiento de uso de fotografías clínicas.
 * Llaves: patientFullName, guardianFullName, guardianRelationship,
 * clinicLegalName, city, day, month, year, signerRole, clinicRepresentative.
 */
export const PHOTO_USE_CONSENT_TEXT = `
CONSENTIMIENTO PARA USO DE FOTOGRAFÍAS CLÍNICAS

Yo, {patientFullName}, o en su caso {guardianFullName} actuando como {guardianRelationship} del Paciente menor de edad, autorizo a {clinicLegalName} al uso de las fotografías clínicas tomadas durante mi tratamiento ortodóntico (extra/intraorales, T0/T1/T2/CONTROL).

Esta autorización es OPCIONAL. Marco con una "X" cada uso al que doy autorización expresa. Los usos NO marcados quedan automáticamente excluidos.

USOS CLÍNICOS (uso interno de la Clínica)

[ ] Expediente clínico personal del Paciente. Las fotografías forman parte del expediente clínico y se conservan según NOM-024-SSA3-2012. Este uso es intrínseco al tratamiento.

[ ] Casos de estudio interno entre profesionales de la Clínica con fines educativos, de calidad o de discusión clínica, SIN identificación visible del Paciente.

USOS EDUCATIVOS Y COMERCIALES (uso externo)

[ ] Materiales educativos para futuros pacientes (folletos, presentaciones), SIN nombre pero pudiendo incluir fotografías parciales o intraorales identificables.

[ ] Publicación en redes sociales, sitio web o materiales publicitarios con fines comerciales, INCLUYENDO fotografías extraorales completas e identificables, sin nombre.

[ ] Publicación en redes sociales, sitio web o materiales publicitarios con fines comerciales, INCLUYENDO fotografías y nombre o iniciales del Paciente.

CONDICIONES

1. La autorización se otorga sin contraprestación económica.
2. La autorización es REVOCABLE en cualquier momento por escrito. La revocación NO afecta usos previos pero detiene futuros usos.
3. La revocación NO obliga a retirar materiales ya impresos o publicados antes de la fecha de revocación.
4. La autorización NO transfiere derechos de autor sobre las fotografías.
5. El uso autorizado se limita a los fines descritos.
6. Esta autorización se rige por LFPDPPP y se complementa con el aviso de privacidad de la Clínica.

LEÍDO Y AUTORIZADO en {city} a los {day} días del mes de {month} de {year}.


_________________________________________
{patientFullName}
{signerRole}


_________________________________________
{clinicRepresentative}
Por {clinicLegalName}
`.trim();

/** Etiqueta accesible para el menor por técnica. */
export function techniqueAccessibleName(t: OrthoTechnique): string {
  if (t === "CLEAR_ALIGNERS") return "alineadores";
  if (t === "LINGUAL_BRACKETS") return "brackets por dentro";
  return "brackets";
}

/** Etiqueta humana de cada técnica para el cuerpo del consentimiento. */
export function techniqueLabel(t: OrthoTechnique): string {
  const map: Record<OrthoTechnique, string> = {
    METAL_BRACKETS: "brackets metálicos",
    CERAMIC_BRACKETS: "brackets cerámicos (estéticos)",
    SELF_LIGATING_METAL: "brackets autoligado metálicos",
    SELF_LIGATING_CERAMIC: "brackets autoligado cerámicos",
    LINGUAL_BRACKETS: "brackets linguales",
    CLEAR_ALIGNERS: "alineadores transparentes",
    HYBRID: "técnica híbrida (brackets + alineadores)",
  };
  return map[t];
}
