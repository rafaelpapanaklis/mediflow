# Auditoría del vertical DaleControl INSTITUCIONAL

**Rama:** `audit/edu-vertical` (basada en `origin/main`, HEAD `c4dd7228`)
**Fecha:** 2026-08-30
**Alcance leído:** `src/app/instituto` (32 archivos), `src/app/api/instituto`
(61 route handlers), `src/components/edu` (38 componentes), `src/lib/edu`
(38 módulos + 16 archivos de prueba), `src/lib/edu-auth.ts` y los 29 modelos
`Edu*` de `prisma/schema.prisma`. **~43 000 líneas.**

> ⛔ **Esta rama no cambia una sola línea de código.** Todo lo de abajo está
> documentado con ruta y línea para que otra ola lo arregle con la lista en
> la mano.

---

## Resumen en una pantalla

| Gravedad | Cuántos | Qué son |
|---|---|---|
| 🔴 **P0** | **2** | Un endpoint sin recorte que le enseña a un alumno las calificaciones y los pacientes de sus compañeros · el alumno que entrega un caso NO pierde la llave del paciente |
| 🟠 **P1** | **2** | Reagendar deja la cita colgada del caso de OTRO alumno · el padrón completo viaja al navegador de quien no debe verlo |
| 🟡 **P2** | **10** | Un dato que se captura y no filtra nada, el historial entero en una consulta, el "segundo candado" del dinero que no existe, la pantalla de permisos que nunca se construyó, `mustChangePassword` que nadie lee, doble cobro por doble petición, las horas de acreditación que se autorreportan, la IA sin freno, el alumno firmando su propia nota, la fecha de firma calculada en el navegador |
| ⚪ **P3** | **4** | Las pruebas sin script, el buscador sin índice, dos consultas sin tope, código muerto |

### Lo que se buscó y NO apareció

Vale tanto como lo que sí apareció, así que va explícito:

- **NO hay fuga entre institutos.** Recorrí las 259 llamadas a Prisma de
  `src/lib/edu` y `src/app/api/instituto`. Ninguna acepta `institutionId` del
  body, del query ni de un parámetro de ruta; todas lo sacan de
  `getEduContext()`. Las cinco funciones de `where` de `visibility.ts`
  **lanzan** si les llega vacío (`requireInstitutionId`, `visibility.ts:218`),
  y `padron-core.ts` y `tarifas.ts` hacen lo mismo. Las 41 llamadas que no
  llevan `institutionId` literal en el cuerpo lo hacen sobre un `id` que salió
  de una lectura previa YA recortada (patrón `findFirst` con alcance → `update`
  por id), o son catálogos de instituto. Los tres `findUnique` sin tenant son
  sobre `EduConsent.token`, que es la credencial pública y es globalmente único.
- **NO hay textos con "Ola", "residente" ni "programa".** Barrí
  `src/app/instituto`, `src/components/edu` y `src/lib/edu` quitando
  comentarios. Los únicos aciertos son identificadores internos (nombres de
  variable, `id`/`htmlFor`, clases CSS, `?programa=` de la URL) y dos
  strings que no ve nadie: el vocabulario que se le manda a Whisper
  (`ia-core.ts:244`) y el mapa de alias para pegar una lista de personas
  (`equipo-core.ts:143`, `residente → ALUMNO`). El producto dice
  "especialidad" en todas partes.
- **NO encontré pantalla blanca.** `src/app/instituto/(panel)/error.tsx`
  cubre las 25 pantallas del grupo, y `src/app/error.tsx` cubre lo que queda
  fuera (`/instituto/login`, `/instituto/consentimiento/[token]`,
  `/instituto/page.tsx`) y también un throw del propio `(panel)/layout.tsx`,
  que su `error.tsx` hermano no atrapa. El único `JSON.parse` del vertical
  (`odontograma-screen.tsx:471`) es un clon en memoria, no un campo de la base.
  `getEduContext` nunca propaga (`edu-auth.ts:60-72`).
- **El antifraude del precio funciona.** `resolveEduChargeLines`
  (`tarifas.ts:490-599`) descarta el `unitPriceCents` del cliente en toda
  línea con `procedureId`, lo guarda en `clientPriceCents` para auditarlo y
  lo registra en el log del servidor (`tarifas.ts:576-586`). El precio queda
  **congelado** en `EduChargeItem.unitPriceCents` (`caja.ts:530-531`) y el
  nombre de la lista también (`caja.ts:495-497`). **Todo el dinero va en
  enteros de centavos**; no hay un solo `float` en la aritmética. Las
  calificaciones van en enteros ×100 por la misma razón
  (`evaluacion-core.ts:20-26`).
- **Ningún `Promise.all` llega a 7.** El máximo es 6
  (`agenda/page.tsx:86` y `padron/page.tsx:72`).
- **No hay N+1.** Las 7 llamadas a Prisma dentro de un bucle son bucles
  acotados: tres reintentos de folio (`caja.ts:514`, `pacientes.ts:410`),
  ≤20 criterios de rúbrica (`rubricas.ts:435`) y ≤N listas de precios
  (`tarifas.ts:1230`). La bandeja de autorizaciones evita el N+1 de manual a
  propósito (`autorizaciones.ts:282-334`).
- **Las 516 pruebas del vertical pasan.** Ver el cierre.

---

## 🔴 P0 — se explota hoy

| id | ruta:línea | qué pasa |
|---|---|---|
| **P0-1** | `src/lib/edu/rubricas.ts:600-616` | `GET /api/instituto/calificaciones?alumno=` devuelve las calificaciones **de cualquier alumno del instituto**, con los nombres y folios de sus pacientes |
| **P0-2** | `src/lib/edu/visibility.ts:344-362` + `src/components/edu/clinica/agenda-screen.tsx:473-486` | El alumno que entrega un caso **conserva** el expediente del paciente. La mitad invisible de la Ola 6 no funciona en la práctica |

### P0-1 · El único endpoint del vertical que no pasa por el alcance

`src/lib/edu/rubricas.ts:600-616`

```ts
export async function listEduStudentGrades(ctx, studentId, timeZone) {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(studentId);
  if (!id) return [];
  const rows = await prisma.eduCaseGrade.findMany({
    where: { institutionId, studentId: id },   // ← ni eduStudentScopeWhere ni eduCaseScopeWhere
```

Lo expone `src/app/api/instituto/calificaciones/route.ts:32-35`, que exige
`evaluacion.view` — key que por defecto tienen **DIRECCION, DOCENTE y
ALUMNO** (`permissions.ts:462, 490, 514`). La cabecera de ese mismo route
dice, en el comentario de las líneas 16-19, que «lo que cada quien ve lo
decide el ALCANCE, no este endpoint». Para la rama `?alumno=` eso es falso.

**Qué sale.** `GRADE_SELECT` (`rubricas.ts:469-504`) trae, por cada
calificación: la puntuación final y la de **cada criterio** con sus
comentarios, el nombre de quien calificó, el nombre y correo del alumno, y
—lo que de verdad duele— `case.patient.firstName`, `case.patient.lastName`,
`case.patient.folio`, `case.program.name` y `case.procedure.name`. Es decir:
**identidad de pacientes** que el que pregunta no atiende.

**Cómo se reproduce.** Con sesión de ALUMNO:

1. Abrir `/instituto/agenda` (el alumno tiene `agenda.view` por defecto). El
   payload RSC de esa página ya trae el `EduStudent.id`, el nombre y la
   matrícula de **todos** los alumnos activos del instituto — ver **P1-4**.
2. Desde la consola del navegador:
   `fetch('/api/instituto/calificaciones?alumno=<id de un compañero>').then(r=>r.json())`
3. Llega el expediente académico completo del compañero, con los pacientes
   que atendió por nombre y folio.

Para un DOCENTE el paso 1 es aún más directo: `/instituto/docentes` le da los
ids de los alumnos de **todos** sus colegas. Y como el `where` no mira la
vigencia, un docente que ya rotó sigue leyendo las calificaciones de los
alumnos que entregó — que es exactamente lo que la Ola 1A existe para impedir.

**Contraste que lo confirma.** El endpoint gemelo,
`GET /api/instituto/evaluacion?alumno=` (`evaluacion/route.ts:29-36`), sí lo
hace bien: llama a `getEduBitacora`, que busca al alumno **dentro** del
alcance (`evaluacion.ts:621-634`) y contesta 404 si no le toca. Los dos
endpoints se parecen tanto que el hueco pasa desapercibido.

**Arreglo propuesto.** Resolver primero al alumno con
`eduStudentScopeWhere({ institutionId, scope: eduVisibility(ctx,"cases"), now })`
—igual que `getEduBitacora`— y solo entonces leer sus calificaciones; o
borrar la rama `?alumno=` directamente: **ninguna pantalla la usa** (la
bitácora recibe sus calificaciones del servidor, `evaluacion.ts:652`, y el
único `fetch` a `/api/instituto/calificaciones` del cliente es el POST de
`bitacora-screen.tsx:579`).

---

### P0-2 · El traspaso no quita la llave, porque casi ninguna cita tiene caso

`src/lib/edu/visibility.ts:344-362` decide que un paciente es "mío" también
por mis **citas**, y descarta las que colgaban de un caso transferido:

```ts
appointments: { some: { institutionId, student,
  OR: [{ caseId: null }, { case: { status: { not: EDU_CASE_TRANSFERRED } } }] } }
```

El `{ caseId: null }` está pensado para la cita de TAMIZAJE, que existe antes
que el caso. El problema es que **en el producto, casi todas las citas tienen
`caseId: null`**: la pantalla de agenda no manda `caseId` en ningún momento.

- `src/components/edu/clinica/agenda-screen.tsx:473-486` — el cuerpo del POST
  a `/api/instituto/agenda` lleva `patientId, studentId, chairId,
  supervisorUserId, day, startMinute, minutes, type, notes`. **No lleva
  `caseId`**, y el modal "Agendar cita" no tiene selector de caso.
- `src/lib/edu/agenda.ts:553-570` — el servidor solo lo pone si el cliente lo
  manda. La ficha de la cita hasta lo dice: "Sin caso"
  (`agenda-screen.tsx:843-847`).
- Los únicos dos sitios que ponen `caseId` son `createEduCase`
  (`casos.ts:411-416`, solo la cita de tamizaje) y el propio traspaso
  (`traspasos.ts:345-357`).

Consecuencia: `traspasarUno` re-engancha únicamente
`caso.screeningAppointmentId` (`traspasos.ts:329-334`) y mueve únicamente las
citas futuras con `caseId: caso.id` (`traspasos.ts:345-357`). **Todas las
demás citas del alumno saliente con ese paciente siguen con `caseId: null`**,
así que la rama 2 del `where` le sigue abriendo la puerta.

**Cómo se reproduce.**

1. Caja agenda una cita de TRATAMIENTO del paciente P con el alumno A desde
   `/instituto/agenda` → la fila nace con `caseId = null`.
2. Dirección traspasa el caso de A a B (`POST /api/instituto/traspasos`).
3. A abre `/instituto/pacientes` y **sigue viendo a P**. Entra a
   `/instituto/pacientes/<P>/expediente`, `/odontograma`, `/estudios` y
   `/consentimientos` — todos usan el mismo `eduPatientScopeWhere`. También
   puede seguir escribiendo notas.
4. Además, si esa cita era **futura**, no se movió a B: el martes que viene
   el paciente llega a la cita de alguien que ya no lleva su caso. Es
   exactamente lo que el comentario de `traspasos.ts:336-344` dice que evita.

Y el caso peor: un alumno marcado `GRADUATED` (`padron.ts:680-688`) conserva
`EduUser.isActive`, así que sigue entrando al panel con esas llaves.

**Arreglo propuesto (son dos, y hacen falta los dos).**

1. Que la agenda **enganche el caso**: un `<select>` de casos abiertos de ese
   paciente+alumno en el modal de alta. El servidor ya valida el par
   (`agenda.ts:550-570`, comprueba mismo paciente y mismo alumno); solo falta
   que el cliente lo mande. Esto además desbloquea la etapa `SESSION` del
   gate de la Ola 4, que hoy es inalcanzable porque `requestEduApproval`
   exige `caseId = caso.id` en la cita (`autorizaciones.ts:754-763`) y el
   mensaje de error dice "engánchala primero desde la agenda", cosa que la
   agenda no ofrece.
2. Y/o estrechar la rama 2 del `where`: que `{ caseId: null }` valga solo
   para `type: "TAMIZAJE"`, que es la razón por la que existe.
   Complementariamente, `traspasarUno` debería re-enganchar (o pasar a B) las
   citas sin caso del saliente con ese paciente.

---

## 🟠 P1 — rompe un flujo

| id | ruta:línea | qué pasa |
|---|---|---|
| **P1-3** | `src/lib/edu/agenda.ts:644-664, 718` | Reagendar cambia el alumno de la cita y deja el `caseId` del alumno anterior |
| **P1-4** | `(panel)/agenda/page.tsx:89,124` · `(panel)/docentes/page.tsx:49,67` | El padrón completo viaja al navegador de quien, por alcance, no debe ver ni una fila |

### P1-3 · El PATCH rompe la invariante que el POST defiende

`createEduAppointment` es explícito (`agenda.ts:550-570`):

```ts
if (caso.studentId !== partes.studentId) throw new EduPadronError("Ese caso es de otro alumno.");
```

`updateEduAppointment` cambia `data.studentId` (`agenda.ts:661`) y **nunca
vuelve a mirar el `caseId`**: no lo revalida y no lo limpia
(`agenda.ts:642-720`; el `input.caseId` ni se lee).

**Cómo se reproduce.**
`POST /api/instituto/agenda { patientId, studentId: A, caseId: <caso de A>, … }`
→ `PATCH /api/instituto/agenda/<id> { studentId: B }` → la fila queda con
`studentId = B` y `caseId` = caso cuyo `studentId` es A.

**Qué se rompe.** Las horas clínicas se cuentan por `EduAppointment.studentId`
(`evaluacion.ts:484-487`) y el caso pertenece a otro; la etapa `SESSION` de
autorizaciones firmaría una cita atendida por B sobre el caso de A; y la
bitácora enseña un par caso↔cita que no cuadra. El comentario de
`agenda.ts:550-552` describe justo este daño ("se podría colgar una cita de
la señora del caso del señor").

**Arreglo propuesto.** En `updateEduAppointment`, cuando `cambiaAlumno`: o
revalidar que el caso siga siendo del alumno nuevo, o poner
`data.caseId = null` y decirlo en la respuesta. Un `throw` con el mismo texto
que el POST es lo más consistente.

---

### P1-4 · El padrón se filtra por dos pantallas

`eduPadronScope` (`padron-core.ts:93-101`) es tajante: **ALUMNO → ninguna
fila** ("un residente no lista a su generación"), **DOCENTE → solo los suyos
vigentes**. Dos pantallas se lo saltan:

**a) `/instituto/agenda`** — `src/app/instituto/(panel)/agenda/page.tsx:89`
llama a `listEduStudentOptions(ctx, now)` **sin condición**, y lo pasa como
prop a `EduAgendaScreen`, que es `"use client"` (línea 124). Esa función
(`agenda.ts:294-330`) devuelve **todos los alumnos activos del instituto** con
`EduStudent.id`, nombre, matrícula, especialidad y su docente titular. Como es
prop de un componente cliente, va entero en el payload RSC de cualquiera con
`agenda.view` — **ALUMNO incluido**.

Lo revelador es que la línea de al lado ya hace lo correcto:
`supervisors` (línea 90) y `patients` (línea 92) sí están detrás de
`canManage ? … : Promise.resolve([])`. Y `students` **solo se pinta bajo
`canManage`** (`agenda-screen.tsx:321` para el alta, `900` para reagendar):
no hay ninguna razón para mandarlo siempre.

**b) `/instituto/docentes`** — `docentes/page.tsx:49` llama a
`listEduCurrentAssignments(ctx, now)` **sin el tercer parámetro
`supervisorUserId`**, que la función acepta justo para acotar
(`padron.ts:298, 304`). Devuelve **todas** las asignaciones vigentes del
instituto, con `studentId`, matrícula y nombre. Cualquier DOCENTE ve, por
nombre, a los alumnos de todos sus colegas. El conteo agregado
(`listEduTeachers`, `padron.ts:269-273`) sí es legítimo y no hace falta
tocarlo; lo que sobra es la lista nominal.

**Por qué importa más de lo que parece.** Estas dos pantallas son la fuente de
los `EduStudent.id` que hacen trivial **P0-1**.

**Arreglo propuesto.** En la agenda, envolver `listEduStudentOptions` en el
mismo `canManage ? … : Promise.resolve([])` que ya tienen sus dos vecinos. En
docentes, pasar `ctx.eduUserId` como `supervisorUserId` cuando el rol no es
DIRECCION.

---

## 🟡 P2 — molesta, miente o cuesta

| id | ruta:línea | qué pasa |
|---|---|---|
| **P2-5** | `src/lib/edu/evaluacion-core.ts:332-347` | El rango de semestres de un requisito se captura, se guarda, se pinta… y no filtra nada |
| **P2-6** | `src/lib/edu/evaluacion.ts:474-499` | `/instituto/evaluacion` se trae TODO el historial de hasta 300 alumnos, sin `take` |
| **P2-7** | `src/lib/edu/tarifas.ts:755, 909, 1104, 1252` | El "segundo candado" del dinero que promete `permissions.ts` no existe para el tarifario |
| **P2-8** | `src/lib/edu/permissions.ts:171, 601` | No hay pantalla de permisos: el override se lee en todas partes y no se puede escribir en ninguna |
| **P2-9** | `src/lib/edu/equipo.ts:380` | `mustChangePassword` se escribe y nadie lo lee; no hay forma de cambiar la contraseña dentro del vertical |
| **P2-10** | `src/lib/edu/caja.ts:429-565` | Dos peticiones de cobro idénticas emiten dos cobros |
| **P2-11** | `src/app/api/instituto/agenda/[id]/estado/route.ts:29` | Las horas de acreditación las produce el propio alumno |
| **P2-12** | `src/app/api/instituto/ai/dictado/route.ts` · `estudios/[id]/analisis/route.ts` | Los dos endpoints que cuestan dinero no tienen freno por usuario |
| **P2-13** | `src/lib/edu/expediente.ts:501-541` + `types.ts:407-414` | El alumno firma su propia nota clínica; "ENVIADA" es decorativo |
| **P2-14** | `src/components/edu/consentimiento-publico.tsx:149, 182` | La fecha de firma del consentimiento se formatea en el navegador |

### P2-5 · Un requisito "de 3º a 5º" cuenta casos de todos los semestres

`EduRequirement` guarda `semesterFrom`/`semesterTo`, `evaluacion.ts:254-275`
los valida con `eduSemesterRangeCheck`, `evaluacion-core.ts:409-410` los
devuelve en el progreso y `requisitos-screen.tsx:167-168` los pinta ("3º –
fin"). Pero `eduCaseCountsFor` (`evaluacion-core.ts:332-347`), que decide si
un caso cuenta, mira **especialidad, procedimiento/categoría y estado**, y
nunca el semestre. Ni tampoco `eduRequirementProgress`
(`evaluacion-core.ts:375-412`).

**Reproducir:** capturar un requisito con semestres 5–6 y ver que un caso
hecho en 1.º lo cumple igual. La escuela lee "3º – fin" en la pantalla y cree
que la restricción existe.

**Arreglo:** o se aplica el rango (comparando `EduStudent.semester` cuando se
abrió el caso, o el actual, y decidiéndolo explícitamente), o se quita de la
captura y de la pantalla. Un dato que se enseña y no hace nada es peor que no
tenerlo — es la misma regla que el catálogo de permisos se aplica a sí mismo
(`permissions.ts:20-27`).

### P2-6 · La pantalla de evaluación crece sin techo

`listEduEvaluacion` (`evaluacion.ts:474-499`) lee hasta 300 alumnos
(`EDU_EVALUACION_MAX_ROWS`, `evaluacion-core.ts:60`) y después, en un solo
`Promise.all`, **tres consultas sin `take`**:

- `eduCase.findMany({ institutionId, studentId: { in: [300 ids] } })` — todos
  los casos de la historia de esos alumnos;
- `eduAppointment.findMany({ …, status: "COMPLETED" })` — **todas** sus citas
  completadas, que con años de uso son decenas de miles de filas. Además el
  índice `edu_appointments_student_idx` es `(institutionId, studentId,
  startsAt)`: `status` no entra, así que se filtra después de leer.
- `eduCaseGrade.findMany({ … })` — todas sus calificaciones.

Se cargan enteras en memoria en cada carga de `/instituto/evaluacion`. La
cabecera del archivo (`evaluacion.ts:18-22`) reconoce el costo y adelanta el
arreglo ("lo que hay que poner es un filtro por generación, no un contador").
Hoy no duele; con la primera escuela que lleve dos generaciones dentro, sí.

**Arreglo:** filtrar por generación/ciclo en las tres consultas, o al menos
acotar las citas por rango de fechas del `cohort` y ponerles `take`.

### P2-7 · El dinero está cerrado una vez, no dos

`permissions.ts:80-87` promete, con todas sus letras, que el dinero está
cerrado **en dos sitios** — permiso y alcance — «para que encenderle
"caja.view" a un alumno por error siga sin enseñarle un solo peso». Eso es
cierto para `caja.ts` (todas sus funciones pasan por `requireDinero`,
`caja.ts:93-99`) y para `getEduTarifaDePaciente` (`tarifas.ts:657-659`).

**No lo es para el tarifario.** `listEduProcedures` (`tarifas.ts:755`),
`listEduFeeSchedules` (`tarifas.ts:909`), `getEduTarifario`
(`tarifas.ts:1104`) y `listEduProcedureOptions` (`tarifas.ts:1252`) solo
llaman a `requireInstitution`. El comentario de `tarifas.ts:750-752` lo dice
sin darse cuenta: «Lecturas: exigen "tarifarios.view" **en el endpoint**».

**Reproducir:** encenderle `tarifarios.view` a un ALUMNO (hoy solo por SQL,
ver **P2-8**) y abrir `/instituto/tarifarios`: ve la tabla de precios
completa. Con el segundo candado no vería nada.

**Arreglo:** añadir el mismo `if (eduScopeIsEmpty(eduVisibility(ctx,
"charges"))) throw …` que ya tiene `getEduTarifaDePaciente` a las cuatro
lecturas del tarifario. Son cuatro líneas.

### P2-8 · La pantalla de permisos no existe

`EDU_PERMISSION_GROUPS` (`permissions.ts:171-253`) existe explícitamente
«para la pantalla de permisos del instituto (la construye la ola de Equipo)»,
y `sanitizeEduPermissionKeys` (`permissions.ts:601`) es «lo que tiene que
pasar TODO lo que venga del cliente antes de guardarse en
`EduUser.permissionsOverride`».

**Ninguna de las dos tiene un solo llamador**, y no hay ningún endpoint ni
pantalla del vertical que escriba `permissionsOverride`
(`equipo/[id]/route.ts` solo mueve `isActive`). El único camino es SQL a
mano.

Esto no es solo código muerto: **las mitigaciones que el propio catálogo
describe son teóricas**. Todos los comentarios del estilo "si mañana alguien
le enciende caja.view a un alumno desde la pantalla de permisos" hablan de
una pantalla que no existe, y a la vez el vertical no puede hacer lo que
`permissions.ts:447-451` dice que se hace ("se le enciende por override desde
la pantalla de permisos — a sabiendas y una por una").

**Arreglo:** construir la pantalla (usando los dos helpers, que ya están
escritos y probados) o retirar el andamiaje y decir en el catálogo que hoy el
rol es lo único que decide.

### P2-9 · La contraseña temporal no caduca nunca

`createEduTeamMember` genera una contraseña temporal, se la enseña a quien da
de alta (`equipo.ts:320, 393`) y marca `mustChangePassword: !reused`
(`equipo.ts:380`). El propio comentario lo admite: «HOY EL PANEL DEL
INSTITUTO NO LEE ESTA BANDERA: no existe `/instituto/cambiar-contrasena`».

Confirmado: ningún `page.tsx`, `layout.tsx` ni route de `/instituto` la
consulta, y `/api/auth/change-password` es del dental (usa `getAuthContext`,
que exige una fila `User` de clínica — un `EduUser` recibe 401).

**Consecuencia real:** quien administra el instituto se queda con la
contraseña de todos los alumnos que dio de alta, indefinidamente, y la persona
no tiene forma de cambiarla desde el producto.

**Arreglo:** una pantalla `/instituto/cambiar-contrasena` + el check en
`(panel)/layout.tsx`, espejo de `dashboard/layout.tsx:110`.

### P2-10 · Dos peticiones idénticas emiten dos cobros

`createEduCharge` (`caja.ts:429-565`) no tiene clave de idempotencia. El
bucle de reintentos (`caja.ts:514`) resuelve la colisión de **folio**, no la
duplicación: dos POST idénticos producen dos cobros con folios distintos, los
dos con su pago.

La UI lo tapa (`caja-screen.tsx:538, 653` deshabilita el botón mientras
`busy`), así que el doble clic humano está cubierto; lo que no está cubierto
es un reintento de red, un `Enter` doble en dos pestañas, o cualquier cliente
que no sea esa pantalla.

Es notable porque **la subida de estudios sí es idempotente** y lo explica
(`estudios.ts:313-315, 335-339`): "un reintento del cliente (o un doble clic)
devuelve la fila que ya existe". La caja no heredó esa lección.

*(Menor, del mismo archivo:* `addEduPayment` *lee el tope de pago fuera de la
transacción (`caja.ts:627-642`) y recalcula dentro (`caja.ts:670-702`). Dos
pagos simultáneos pueden pasar los dos el tope; el recálculo deja
`balanceCents` en 0 y `paidCents` por encima del total. Ventana de
milisegundos.)*

**Arreglo:** aceptar un `Idempotency-Key` opcional y guardarlo con índice
único `(institutionId, idempotencyKey)`, devolviendo el cobro existente —
mismo patrón que `confirmEduStudyUpload`.

### P2-11 · Las horas que mira una acreditación las teclea el alumno

`PATCH /api/instituto/agenda/[id]/estado` exige **`agenda.view`**
(`route.ts:29`), no `agenda.manage`. Es deliberado y está bien explicado
(el alumno tiene que poder marcar su propio día). Pero la consecuencia sí es
un dato que puede mentir:

- `eduAppointmentStamps` (`agenda-core.ts:519-541`) deriva `startedAt` y
  `completedAt` **de `now`** al mover el estado;
- `eduAppointmentMinutes` (`evaluacion-core.ts:474-507`) cuenta esos sellos
  como hora clínica real;
- esas horas son la métrica que la escuela enseña en una acreditación
  (`evaluacion.ts:24-26`).

Un alumno marca IN_CHAIR a las 8:00 y COMPLETED a las 16:00 y su cita vale 8 h
— el tope `EDU_HORAS_MAX_MINUTOS_POR_CITA` (`evaluacion-core.ts:94`) es lo
único que lo limita. Además **nada comprueba que la cita ya haya ocurrido**:
`setEduAppointmentStatus` (`agenda.ts:736-791`) no mira `startsAt` contra
`now`, así que una cita del mes que viene se puede marcar como completada hoy.

**Arreglo:** rechazar los estados clínicos en citas con `startsAt > now`
(una línea en `setEduAppointmentStatus`), y —si la escuela lo pide— marcar en
la bitácora las citas cuyos sellos los puso el propio alumno, como ya se marca
lo estimado (`hours.estimatedMinutes`).

### P2-12 · Los dos endpoints que gastan dinero no tienen freno

- `POST /api/instituto/ai/dictado` — **sin rate limit**. Cualquiera con
  `expediente.write` (ALUMNO incluido) puede llamarlo en bucle; el único tope
  es el tamaño del audio (`ia.ts:174-176`).
- `POST /api/instituto/estudios/[id]/analisis` — solo un freno de 90 s **por
  estudio** (`ia.ts:329, 383-392`). Nada impide recorrer N estudios.

Ninguno lleva cuota ni contabilidad de gasto por instituto. El propio vertical
sabe que le falta: la IA nace **apagada** por `EDU_IA_ENABLED`
(`ia.ts:106-113`) precisamente porque «el gasto de IA del instituto todavía no
tiene a quién cargarse» (`ai/dictado/route.ts:26-28`). Aun así, el día que se
encienda, esto es lo que hay.

Que se puede: la ruta pública de consentimientos sí usa `rateLimit`
(`consentimientos/publico/[token]/route.ts:39, 73`).

**Arreglo:** `rateLimit` por sesión en los dos, y una cuota por instituto
antes de encender la bandera.

### P2-13 · El alumno firma su propia nota

`EDU_RECORD_TRANSITIONS` (`types.ts:407-414`) permite `BORRADOR → FIRMADA`
directo, y `updateEduRecord` (`expediente.ts:501-541`) no distingue quién
firma: sella `signedByUserId = ctx.eduUserId` con el único permiso
`expediente.write`, que el ALUMNO tiene por defecto (`permissions.ts:500`).
Una nota FIRMADA es inmutable (`expediente-core.ts:115-117`).

Resultado: el estado `ENVIADA` —"se la entrego a mi docente"— no lo exige
nadie; el alumno puede escribir, firmar y cerrar sin que su docente vea la
nota. Contrasta con las dos separaciones de funciones que el vertical sí
defiende con dureza: nadie firma su propia autorización
(`autorizaciones.ts:914-927`) y la contrafirma del consentimiento la decide la
sesión, no el cuerpo (`consentimientos.ts:614-627`).

**No lo marco como bug** porque la descripción de la key lo dice
explícitamente ("Escribir, enviar **y firmar** notas clínicas",
`permissions.ts:72`): es una decisión tomada. Lo dejo aquí porque es la
decisión de la Ola 3 que más chirría con el resto del vertical y con la
NOM-004, y merece una revisión consciente —partir la key en
`expediente.write` / `expediente.sign`— antes de que una escuela la audite.

### P2-14 · La única fecha del vertical que formatea el navegador

`src/components/edu/consentimiento-publico.tsx:149` y `:182`:

```tsx
{vista.signedAt ? ` el ${new Date(vista.signedAt).toLocaleString("es-MX")}` : ""}
```

Es un componente `"use client"` que la página server-rendea
(`consentimiento/[token]/page.tsx:55`), así que el servidor lo formatea en SU
zona (UTC en Vercel) y el navegador en la del paciente: **hydration mismatch**
en un documento legal, y una hora que no es la del instituto.

Todo el resto del vertical formatea en el servidor con
`ctx.institution.timezone` y manda la etiqueta ya hecha — `rubricas.ts:511`
lo explica: "nunca la del navegador, que rompería la hidratación y además
diría otra hora".

**Arreglo:** que `getEduConsentPublic` (`consentimientos.ts:734-802`)
devuelva `signedLabel` ya formateado con la zona del instituto, como hace
`toRow` para el panel (`consentimientos.ts:223`).

---

## ⚪ P3 — cosmético / deuda

| id | ruta:línea | qué pasa |
|---|---|---|
| **P3-15** | `package.json` | Los 16 archivos de prueba del vertical no tienen ningún script `test:edu*`. Ninguna gate los corre |
| **P3-16** | `search.ts:155` · `padron-core.ts:328-336` · `caja.ts:248-255` | El buscador usa `contains` (`LIKE '%…%'`) sobre `searchIndex`, y ninguno de los tres modelos tiene índice en esa columna |
| **P3-17** | `traspasos.ts:397` · `tarifas.ts:1191` | Dos entradas sin tope: `listEduTransferableCases` sin `take`, y el array `precios` de `setEduProcedurePrices` sin límite de longitud |
| **P3-18** | `rubricas.ts:814-854` | `mapEduCurrentGrades` no tiene un solo llamador |

**P3-15.** Se corren a mano y **pasan las 516** (ver el cierre). Sin script,
nadie las va a correr: el gate del repo es el build, y el build no las toca.
Bastan tres líneas en `package.json` (`test:edu`, `test:edu-dinero`,
`test:edu-clinica`, o una sola con los 16 archivos).

**P3-16.** Es inherente a `contains` con comodín inicial: ningún B-tree lo
usa. Hoy da igual (una escuela son cientos de filas y hay `take: 300`); con
decenas de miles de pacientes hará falta un índice GIN de `pg_trgm`. Lo anoto
porque el brief lo pide y porque el comentario de `search.ts:15-26` explica
por qué se eligió la columna normalizada, pero no menciona el índice.

**P3-17.** `listEduTransferableCases` es la única `findMany` de lectura del
vertical sin `take`; el resto tiene todos su tope. Y `setEduProcedurePrices`
valida cada `feeScheduleId` contra las listas del instituto pero no rechaza
repetidos, así que un cliente puede mandar el mismo id 10 000 veces y forzar
10 000 `upsert` dentro de una transacción. Ninguno es explotable con la UI.

---

## Qué arreglar primero

1. **P0-1** — dos líneas en `rubricas.ts:609` (meter el alcance) o borrar la
   rama `?alumno=` del route. Es el arreglo más barato y el más grave.
2. **P1-4** — un `canManage ?` en `agenda/page.tsx:89` y pasar
   `ctx.eduUserId` en `docentes/page.tsx:49`. Corta la fuente de ids de P0-1 y
   cierra dos fugas del padrón por su cuenta.
3. **P0-2** — el más caro de los cuatro, porque toca UI (selector de caso en
   la agenda) + `traspasos.ts` + posiblemente `visibility.ts`. Hacerlo
   completo: de paso desbloquea la etapa `SESSION` del gate de la Ola 4.
4. **P1-3** — una decisión y tres líneas en `updateEduAppointment`.
5. **P2-7** — cuatro líneas, cierra la promesa que el catálogo ya hace por
   escrito.
6. **P2-9 + P2-8** — la pantalla de contraseña y la de permisos. Son las dos
   pantallas que faltan para que el vertical se administre solo; hasta que
   existan, dirección conserva contraseñas y los overrides se escriben por SQL.
7. **P2-5** — decidir: aplicar el semestre o quitarlo de la pantalla. No
   dejarlo como está.
8. **P2-11 + P2-10** — un `if` en `setEduAppointmentStatus` y una clave de
   idempotencia en el cobro.
9. **P3-15** — los scripts de prueba. Cuesta tres minutos y es lo que hace
   que los ocho arreglos de arriba no se rompan solos.
10. El resto (**P2-6, P2-12, P2-13, P2-14, P3-16..18**) cuando toque la ola
    correspondiente.

---

## Cierre: build y pruebas

**`npm run build` completo, sin pipe: VERDE.** `exit 0`, `prisma generate`
limpio (v5.22.0), type-check completo, `Generating static pages (454/454)` y
tabla de rutas entera — las 61 rutas `/api/instituto/*` y las 25 pantallas
`/instituto/*` salen como `ƒ (Dynamic)`, que es lo que deben ser. Corrido con
`NODE_OPTIONS=--max-old-space-size=8192` (el árbol de tipos del repo no cabe
en el heap por defecto; nada que ver con este vertical).

Dos ruidos que **no** son de esta rama —que no cambia una línea de código— y
que ya estaban en `main`: `⚠ Compiled with warnings` por
`Critical dependency` de `node_modules/file-type` (lo arrastra
`/api/ai-wallet/spei/topup`), tres warnings de clases Tailwind ambiguas, y el
spam de `prisma:error … Environment variable not found: DATABASE_URL` durante
"Generating static pages", esperado en un worktree sin `.env`.

**Pruebas del vertical (16 archivos, corridos a mano con `npx tsx --test`
porque no hay script):**

| lote | tests | fallos |
|---|---|---|
| `edu-visibility`, `edu-permissions`, `edu-padron`, `edu-contract` | 103 | **0** |
| `edu-agenda`, `edu-autorizaciones`, `edu-caja`, `edu-consentimientos`, `edu-equipo`, `edu-evaluacion` | 234 | **0** |
| `edu-expediente`, `edu-ia`, `edu-pacientes`, `edu-search`, `edu-tarifas`, `edu-traspaso` | 179 | **0** |
| **total** | **516** | **0** |

Vale la pena señalar que la suite es buena y aun así **ninguno de los cuatro
hallazgos graves la habría hecho fallar**, y por una razón que se puede
nombrar: las pruebas comprueban los módulos PUROS (`visibility.ts`,
`*-core.ts`) y ahí no hay nada roto. Lo que falla está en la capa que
**consume** esos módulos — un `findMany` que se olvidó de llamar al helper
(P0-1), un `page.tsx` que manda al cliente lo que el helper habría recortado
(P1-4), un `update` que no revalida (P1-3) y un cliente que no manda un campo
opcional (P0-2). La prueba de `edu-traspaso.test.ts` verifica exactamente el
`where` correcto de la Ola 6 y pasa; lo que no puede ver es que en producción
casi ninguna cita tenga `caseId`.

Si hay que agregar UN tipo de prueba, es el que recorre los route handlers y
comprueba que toda lectura que reciba un id de fuera pase por un helper de
`visibility.ts` — el mismo truco que ya usa `edu-permissions.test.ts` para
que ninguna key se quede sin dueño de servidor.

---

## Lo que NO alcancé a revisar

Honestidad sobre los límites de esta pasada:

- **Sin base de datos.** Nada de lo de arriba se ejecutó contra Postgres:
  todo sale de leer el código. Los cuatro hallazgos graves están confirmados
  leyendo las dos puntas (el `where` y quien lo llama), pero el `curl` que lo
  demuestra no se corrió.
- **Sin navegador.** No se abrió una sola pantalla. Los hallazgos de UI
  (P1-4, P0-2 paso 1, P2-14) se dedujeron de las props y del cuerpo de los
  `fetch`.
- **Los `.sql` de las olas** (`sql/edu-ola-*.sql`) no se auditaron contra el
  `schema.prisma`: no comprobé que los índices y los backfills que declara
  cada ola estén realmente aplicados en la base de producción. El schema y el
  código sí cuadran entre sí.
- **`src/components/edu` se leyó por partes.** Barrí los 38 componentes
  buscando throws al pintar, textos prohibidos, y los `fetch` que salen a los
  endpoints; pero no revisé a fondo la lógica de estado de los cinco más
  grandes (`caja-screen` 1370 líneas, `agenda-screen` 1016, `bitacora-screen`
  948, `padron-screen` 889, `pacientes-screen` 870). Puede haber bugs de UI
  ahí que esta pasada no vio.
- **Accesibilidad, i18n y responsive**: fuera del alcance pedido, no se
  miraron.
- **Concurrencia real.** Las tres ventanas de carrera que anoto (P2-10, el
  turno de caja en `caja.ts:910-916`, el lote de autorizaciones en
  `autorizaciones.ts:1079-1083`) están documentadas en el propio código como
  asumidas; no las medí.
