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

## ✅ Estado de los arreglos — 2026-08-31

**Los cuatro hallazgos graves (P0-1, P0-2, P1-3 y P1-4) están ARREGLADOS**
en la rama `fix/edu-auditoria`, commit
*«fix(instituto): las calificaciones del compañero se leían sin alcance, y
el alumno que entrega un caso conserva la llave porque su cita no cuelga de
ningún caso»* (PR contra `main`).

| id | estado | dónde se arregló |
|---|---|---|
| **P0-1** | ✅ arreglado | `src/lib/edu/rubricas.ts` — `listEduStudentGrades` resuelve al alumno con `eduStudentScopeWhere` antes de leer |
| **P0-2** | ✅ arreglado | `src/lib/edu/agenda.ts` (la cita se engancha sola a su caso) · `src/lib/edu/traspasos.ts` (el traspaso engancha las sueltas) · `src/lib/edu/visibility.ts` (una cita suelta no abre la ficha de un paciente entregado) · `sql/edu-fix-auditoria.sql` (las filas viejas) |
| **P1-3** | ✅ arreglado | `src/lib/edu/agenda.ts` — `updateEduAppointment` revalida el caso cuando cambia el alumno |
| **P1-4** | ✅ arreglado | `src/app/instituto/(panel)/agenda/page.tsx` · `.../docentes/page.tsx` · **y también** `src/app/api/instituto/docentes/route.ts`, que tenía la misma fuga a un `fetch` de distancia |
| **P2-5 … P3-18** | ✅ **los catorce** | La **ola de cierre** (rama `fix/edu-cierre`, 2026-08-31) arregló doce — cada sección lleva su bloque «Cómo quedó». **P3-15** se cerró en `feat/edu-tests` (2026-08-31): ya existe `npm run test:edu`. **P2-6** se cerró en `fix/edu-volumen` (2026-09-01), con los números del instituto de demo delante: **17 082 → 3 680 filas leídas, −78 %**. **No queda ninguno abierto.** |

> 🔴 **ACTUALIZACIÓN 2026-08-31 — LA OLA DE CIERRE.** Además de los P2/P3,
> probar el producto en producción con los tres roles encontró un hueco que
> esta auditoría no listó: **el P0-2 entrando por otra puerta**. El arreglo
> del PR #141 engancha la cita a su caso al AGENDAR, al REAGENDAR y al
> TRASPASAR — pero el orden NORMAL del producto es el contrario: primero se
> agenda y el caso se abre cuando el paciente llega. Cuando el caso nacía
> DESPUÉS de la cita, ninguno de los tres momentos volvía a mirarla y la
> fila se quedaba con `caseId: null` para siempre — no contaba para la
> etapa SESSION del gate de la Ola 4 y, al traspasar, no se iba con el
> alumno entrante. Cerrado en `createEduCase` (src/lib/edu/casos.ts):
> abrir un caso engancha las citas sueltas de ese paciente con ese alumno
> — con la MISMA función que usa el traspaso (`eduAttachLooseAppointments`)
> y la misma regla de siempre (solo si el caso recién abierto es el ÚNICO
> vivo del par; el TAMIZAJE fuera). Las filas históricas las repara
> `sql/edu-cierre.sql` (sección 2). Prueba: `edu-cierre.test.ts`.

Los hallazgos NO se borran: se marcan. Cada uno lleva abajo, al final de su
sección, un bloque **«Cómo quedó»** con lo que se hizo y lo que
deliberadamente no.

Prueba nueva: `src/lib/edu/__tests__/edu-auditoria.test.ts` (15 pruebas).
Comprueba lo puro **y lee los archivos** para verificar que la llamada al
helper está puesta — porque, como dice el cierre de esta auditoría, ninguno
de los cuatro habría puesto roja la suite: lo que fallaba no era un `where`,
era quién lo llamaba.

---

## Resumen en una pantalla

| Gravedad | Cuántos | Qué son |
|---|---|---|
| 🔴 **P0** ✅ | **2** | Un endpoint sin recorte que le enseña a un alumno las calificaciones y los pacientes de sus compañeros · el alumno que entrega un caso NO pierde la llave del paciente — **los dos arreglados** (ver arriba) |
| 🟠 **P1** ✅ | **2** | Reagendar deja la cita colgada del caso de OTRO alumno · el padrón completo viaja al navegador de quien no debe verlo — **los dos arreglados** (ver arriba) |
| 🟡 **P2** | **10** | Un dato que se captura y no filtra nada, el historial entero en una consulta, el "segundo candado" del dinero que no existe, la pantalla de permisos que nunca se construyó, `mustChangePassword` que nadie lee, doble cobro por doble petición, las horas de acreditación que se autorreportan, la IA sin freno, el alumno firmando su propia nota, la fecha de firma calculada en el navegador |
| ⚪ **P3** ✅ | **4** | Las pruebas sin script, el buscador sin índice, dos consultas sin tope, código muerto — **los cuatro cerrados**: tres en la ola de cierre y P3-15 en `feat/edu-tests` |

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

## 🔴 P0 — se explota hoy · ✅ LOS DOS ARREGLADOS

| id | ruta:línea | qué pasa | estado |
|---|---|---|---|
| **P0-1** | `src/lib/edu/rubricas.ts:600-616` | `GET /api/instituto/calificaciones?alumno=` devuelve las calificaciones **de cualquier alumno del instituto**, con los nombres y folios de sus pacientes | ✅ |
| **P0-2** | `src/lib/edu/visibility.ts:344-362` + `src/components/edu/clinica/agenda-screen.tsx:473-486` | El alumno que entrega un caso **conserva** el expediente del paciente. La mitad invisible de la Ola 6 no funciona en la práctica | ✅ |

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

#### ✅ Cómo quedó

Se tomó la primera opción: **resolver al alumno dentro del alcance**, y no
borrar la rama `?alumno=`. Borrarla habría cerrado esta puerta y dejado la
regla sin dueño — la siguiente pantalla que necesite las calificaciones de
un alumno la habría vuelto a abrir igual de rota.

`listEduStudentGrades` (`rubricas.ts`) ahora pide `eduVisibility(ctx,
"cases")`, corta en seco si el alcance es "none" (caja), busca al alumno con
`eduStudentScopeWhere` + el id de fuera y lee las calificaciones del alumno
**ya resuelto**. Un id que no le toca a quien pregunta se ve exactamente
igual que uno que no existe: lista vacía.

La función ganó un cuarto parámetro `now` (opcional) y `getEduBitacora` le
pasa el suyo, para que la bitácora y su recorte no discrepen sobre una
asignación cerrada entre una consulta y la otra. En esa ruta el alumno se
resuelve dos veces —`getEduBitacora` ya lo había hecho— y se paga a gusto:
un `findFirst` por id a cambio de que ninguna llamada futura pueda
olvidarse del recorte.

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

#### ✅ Cómo quedó

Se cerró por los **tres** lados, porque el dato y el `where` se protegen
mutuamente:

1. **La cita se engancha sola** (`agenda.ts`, `resolveAppointmentCaseId`).
   Al agendar y al reagendar, si el cliente no manda `caseId` se busca el
   caso VIVO de ese paciente con ese alumno y se engancha. Con cero (todavía
   no hay caso) o con dos (dos especialidades) se deja suelta: adivinar
   entre dos casos mueve una sesión al expediente equivocado.
2. **El traspaso engancha las que ya estaban sueltas** (`traspasos.ts`).
   Antes de mover las futuras, todas las citas sin caso del saliente con ese
   paciente pasan a colgar del caso que acaba de quedar `TRANSFERRED`. Como
   ese paso va ANTES, las que además son futuras se van con el alumno nuevo
   sin escribir una condición más — que era el otro daño del mismo hueco.
3. **Y el `where` no depende de que los datos estén bien**
   (`visibility.ts`). La rama de citas lleva ahora
   `cases: { none: { …, status: "TRANSFERRED" } }`: una cita suelta no abre
   la ficha de un paciente al que ya le entregué un caso. Es lo que protege
   a las filas de los traspasos que ocurrieron **antes** de este arreglo,
   sin depender del `.sql`.

**No se hizo el selector de caso en el modal de la agenda**, y es una
decisión, no un olvido: quien agenda es CAJA, y *caja no ve casos* — es la
línea del contrato del vertical. Un desplegable de casos abiertos le pondría
en el navegador la especialidad y el procedimiento de cada paciente, que es
exactamente lo que el alcance le niega. Resolverlo en el servidor además no
se puede olvidar.

**Tampoco se estrechó `{ caseId: null }` a `type: "TAMIZAJE"`**, que era la
opción 2 propuesta, y conviene decir por qué: el modal de alta propone
**TRATAMIENTO** por defecto, así que la primerísima cita de un paciente
—la que se agenda antes de que exista ningún caso— casi nunca es de tipo
TAMIZAJE. Estrecharlo así habría dejado al alumno sin poder abrir la ficha
del paciente que tiene enfrente, que es justo lo que esa rama existe para
evitar. El descarte por "paciente entregado" cierra el agujero sin cerrar
esa puerta.

**Las filas viejas**: `sql/edu-fix-auditoria.sql` (idempotente, sin DDL, **no
aplicado**) engancha las citas sueltas históricas a su caso vivo o, si el
par ya se traspasó, al caso transferido.

**Falso negativo conocido y aceptado**: si a un alumno le vuelven a agendar
al paciente que entregó **sin** abrirle un caso nuevo, no verá su ficha
hasta que se le abra. Falla del lado cerrado y se resuelve abriendo el caso
—que es lo que hay que hacer de todos modos—. Para un DOCENTE, el descarte
no distingue *cuál* de sus alumnos entregó el caso: Prisma no correlaciona
dos `some` hermanos sobre relaciones distintas.

**Lo que NO cambia** (la asimetría deliberada de la Ola 6): la lista de
CASOS del saliente conserva el transferido (es su historia académica) y sus
CITAS PASADAS siguen siendo suyas (ocurrieron, y son su registro de
asistencia y sus horas clínicas). Lo que se cierra es el expediente vivo del
paciente.

---

## 🟠 P1 — rompe un flujo · ✅ LOS DOS ARREGLADOS

| id | ruta:línea | qué pasa | estado |
|---|---|---|---|
| **P1-3** | `src/lib/edu/agenda.ts:644-664, 718` | Reagendar cambia el alumno de la cita y deja el `caseId` del alumno anterior | ✅ |
| **P1-4** | `(panel)/agenda/page.tsx:89,124` · `(panel)/docentes/page.tsx:49,67` | El padrón completo viaja al navegador de quien, por alcance, no debe ver ni una fila | ✅ |

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

#### ✅ Cómo quedó

**No** con un `throw`, y esa fue la única decisión de fondo: mover una cita a
otro alumno es lo que hace caja cuando alguien falta, y rebotarla dejaría sin
salida a la única persona que puede resolverlo un martes a las nueve. Se
**resuelve**: el `caseId` pasa a ser el del alumno nuevo (su caso vivo con
ese paciente, si tiene uno) o se suelta. Lo hace la misma función que usa el
alta, `resolveAppointmentCaseId`, así que las dos escrituras defienden la
invariante con la misma línea. El predicado puro vive en
`agenda-core.ts` (`eduCaseFitsAppointment`) y se puede probar sin base de
datos.

Un detalle que se pagó caro razonar: la comparación es contra el alumno
**resultante** (`studentId !== current.studentId`), no contra la presencia de
`input.studentId`. La pantalla de reagendar manda el alumno **siempre**,
también cuando no lo cambia, y volver a derivar en cada movimiento habría
soltado el caso de una cita cuyo caso ya se cerró (`COMPLETED`) — es decir,
habría reescrito el pasado por mover una hora.

Si el cliente manda `caseId` explícitamente, se valida contra el mismo
paciente y el mismo alumno, igual que en el POST. Las filas ya corruptas las
repara `sql/edu-fix-auditoria.sql` (sección 3).

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

#### ✅ Cómo quedó

Las dos cosas propuestas, con un matiz y una tercera:

- **Agenda**: `listEduStudentOptions` va detrás del mismo
  `canManage ? … : Promise.resolve([])` que sus dos vecinas. Son tres.
- **Docentes**: el recorte no se escribe a mano con un
  `if (role !== "DIRECCION")` sino que se le pide a **`eduPadronScope`**, el
  helper que ya decide esto para el padrón. Un `if` suelto es una segunda
  regla que el día que aparezca un rol nuevo dirá algo distinto de la
  primera; y además, con `eduPadronScope` un ALUMNO o una CAJA con
  `docentes.view` por override reciben **cero filas** de verdad, en vez de
  depender de que su id no aparezca como supervisor de nadie.
- **Y `GET /api/instituto/docentes?detalle=1`** (que la auditoría no lista
  porque leyó pantallas) tenía la MISMA fuga, llamando a la misma función:
  arreglar solo la pantalla habría sido cerrar la puerta dejando la ventana
  abierta. Lleva el mismo recorte.

El **conteo agregado** (`listEduTeachers`) no se toca: "cuántos alumnos lleva
cada quien hoy" es para lo que existe la pantalla, y es un número, no una
identidad. Como consecuencia, un docente puede ver "3" en un colega y una
lista vacía al desplegarla; la nota de la pantalla lo dice ahora con esas
palabras en vez de pedirle que recargue.

**Lo que NO se arregló y es la misma familia**: `/instituto/pacientes`
(`page.tsx:76`) también manda `listEduStudentOptions` completo, y el ALUMNO
sí tiene `pacientes.view`. Ahí el padrón alimenta un filtro **visible** ("¿lo
trajo algún alumno?"), así que recortarlo no es mover una línea: es decidir
qué ve un alumno en ese desplegable. Queda anotado como pendiente en vez de
resuelto a medias.

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

#### ✅ Cómo quedó (ola de cierre)

Se APLICA el rango, con la decisión escrita y en la dirección que no rompe
nada hecho: **el rango es *cuándo se exige*, no qué casos cuentan.**

- La EXPECTATIVA del semáforo se calcula contra el semestre ACTUAL del
  alumno (`eduRequirementExpectedRaw`, `evaluacion-core.ts`): antes de
  `semesterFrom` se esperan **0** (un alumno de 1º deja de salir ATRASADO
  por un requisito de 5º), después de `semesterTo` se espera el total, y
  dentro del rango crece semestre a semestre. `eduAtrasoVerdict` suma ahora
  la expectativa POR requisito (sin rangos, la cuenta da exactamente lo
  mismo que antes).
- **Un caso hecho ANTES del rango sigue contando**, y es deliberado: el
  semestre en que se abrió un caso no se registra en ningún sitio
  (`EduStudent.semester` es el actual), y además invalidar trabajo ya hecho
  y calificado obligaría a repetir procedimientos en pacientes reales — la
  falla en la dirección cara. La pantalla de requisitos ahora dice «Se
  exige de 3º a 5º» (no «3º – 5º» a secas) y la captura explica qué decide
  el rango, para que nadie vuelva a leerlo como un filtro de casos.
- Con `semesterFrom` y sin `semesterTo` («3º – fin»), el fin es la duración
  de la especialidad, que el módulo puro no conoce: desde 3º es exigible y
  el ritmo lo sigue marcando el ciclo de la generación.

Pruebas puras en `edu-cierre.test.ts` (expectativa antes/dentro/después del
rango, y que el semáforo deja de regañar a 1º).

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

#### ⏳ Cómo quedó (ola de cierre): FUERA, a propósito

Es uno de los dos que la ola de cierre NO arregló, y el motivo merece
quedar escrito para que nadie lo "arregle" mal después: **un `take` a secas
aquí no acota — FALSIFICA.** Las tres consultas alimentan las horas
clínicas y el avance que la escuela enseña en una acreditación; un tope
global truncaría las filas de ALGÚN alumno al azar y sus horas saldrían
menores sin ninguna señal. Eso es peor que el costo actual, que está
acotado por otro lado (máximo 300 alumnos por pantalla, selects mínimos, y
la primera escuela todavía no llega a dos generaciones). El arreglo real es
el que la cabecera de `evaluacion.ts` ya planea — un filtro por GENERACIÓN
en la pantalla, con su semántica de producto (¿cuál es el default? ¿las
cerradas cuentan?) — y esa decisión no se toma de pasada en una ola de
cierre. Sigue pendiente.

#### ✅ Cómo quedó de verdad (rama `fix/edu-volumen`, 2026-09-01)

Se cerró **como esta auditoría pedía**: filtrando por GENERACIÓN, no con un
`take`. Las tres consultas siguen sin tope — dentro de la generación que se
mira, cada estudiante se cuenta COMPLETO, y por eso las horas de una
acreditación siguen siendo verdad. Lo que se acota es el conjunto de
PERSONAS, y la pantalla lo dice con todas sus letras.

**Las decisiones de producto que faltaban, contestadas:**

| Pregunta | Respuesta | Por qué |
|---|---|---|
| ¿Cuál es la generación por defecto? | **La última que ya arrancó** (`eduVigenteCohort`, `evaluacion-core.ts`) | Con una especialidad de tres años hay varias generaciones en vuelo a la vez, así que «vigente = en curso» serían todas y no acotaría nada. «La vigente» es de la que la escuela habla |
| ¿Las cerradas cuentan? | **Sí, cuando se piden** — `?generacion=todas`, un `<option>` del selector | Una acreditación las pide. Lo que cambia es que se PIDEN, en vez de caerse en ellas por abrir la pantalla |
| ¿Una generación o una por especialidad? | **Por NOMBRE**, o sea las tres especialidades a la vez | `EduCohort` es único por (instituto, especialidad, nombre): «2026-A» de Endodoncia y de Ortodoncia son la misma generación. Para una sola especialidad ya existe su filtro |
| ¿Y el alumno y el docente? | **El default NO se les aplica** | Sus alcances ya acotan (una fila y ~10). Con el default puesto, un alumno de la generación anterior abriría SU pantalla de avance y vería cero filas |
| ¿Y el tablero de Dirección, que reusa el mismo loader? | **Intacto** | El default vive en la PÁGINA, no en `listEduEvaluacion`. Meterlo dentro habría cambiado los atrasados de Dirección por debajo, sin que nadie lo pidiera ni lo viera — la misma clase de recorte callado que este arreglo vino a quitar |

**Lo medido**, con `npm run seed:edu-demo -- --medir` (120 estudiantes, 2
generaciones, 18 meses, Postgres 16 en la misma máquina):

| | filas leídas | ms | filas al navegador |
|---|---:|---:|---:|
| Antes (y hoy: `?generacion=todas`) | **17 082** | 185 | 120 |
| **Ahora, al abrir la pantalla** (vigente 2026-A) | **3 680** | **39** | 60 |
| | **−78 %** | **−79 %** | |

Desglose del ahorro: 16 364 → 3 315 citas COMPLETADAS, 400 → 200 casos,
183 → 90 calificaciones. Un docente sigue pagando 10 filas: su alcance ya
lo salvaba y nada cambió para él.

**La ventana de citas.** Además del filtro, la consulta de horas se acota
ahora por generación: `startsAt >= min(arranque de su generación, su fecha
de ingreso)` — la ANTERIOR de las dos, que es la única cota que no puede
perder una hora real (cubre al transferido desde una generación previa y al
que se inscribió antes de que abriera el ciclo). No hay cota superior a
propósito: una cita COMPLETADA con fecha futura es un dato mal capturado, y
esconderla haría bajar las horas sin que nadie pudiera ir a arreglarla. En
el instituto de demo esta cota no quita ni una fila (nadie tiene citas
anteriores a su generación); su valor es el techo — la consulta deja de
crecer con la historia — y darle al índice un RANGO sobre el que trabajar.

**El índice que faltaba** (`sql/edu-volumen.sql`, idempotente, NO bloqueante
para el deploy). La auditoría señaló que `edu_appointments_student_idx` no
lleva `status`. Comprobado con `EXPLAIN ANALYZE` sobre el instituto de demo:

- sin el índice nuevo: `Filter: status = COMPLETED` — **Rows Removed by
  Filter: 25** por estudiante, sobre 55 útiles (un 31 % de lectura tirada);
- con `edu_appointments_student_status_idx (institutionId, studentId,
  status, startsAt)`: todo pasa a **Index Cond**, sin filtro posterior.

No va en `prisma/schema.prisma` porque es un archivo compartido con el
dental y esta rama no lo toca — mismo trato que los índices trigram del
vertical (`sql/edu-ola-1b.sql`). El .sql lo dice y es idempotente.

**Pruebas** (`edu-evaluacion.test.ts`, 16 nuevas): la elección de la
vigente con sus casos raros (ninguna arrancada, todas terminadas, una
inactiva, empate de fechas), la ventana que no puede perder una hora, y
cuatro candados de fuente — entre ellos **que no haya aparecido un `take`**
sobre casos, citas ni calificaciones, que es justo lo que esta sección
prohibió.

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

#### ✅ Cómo quedó (ola de cierre) — con un matiz que la auditoría no vio

El candado se puso donde hay PRECIOS: `listEduFeeSchedules` y
`getEduTarifario` (que es la tabla completa, celda por celda). El repro de
esta auditoría —un ALUMNO con `tarifarios.view` encendido viendo
`/instituto/tarifarios`— ya rebota con 403.

**Pero no fueron "las cuatro", y no es un recorte del arreglo:**

- `listEduProcedures` NO lleva el candado, deliberadamente. Es el CATÁLOGO
  (clave, nombre, categoría, duración — sin un solo precio; `pricedIn` es
  un conteo) y lo lee un flujo CLÍNICO: la pantalla de casos lo carga para
  que un DOCENTE con `casos.assign` clasifique el procedimiento del caso —
  la propia página lo documenta ("abrir los nombres del catálogo no es
  abrir el dinero"). Cerrarlo con "charges" habría roto la clasificación de
  casos para todos los docentes.
- `listEduProcedureOptions` no se candó: **se RETIRÓ.** No tenía un solo
  llamador (la caja arma su desplegable con `getEduTarifaDePaciente`, que
  ya trae el precio resuelto y su candado) — y una lectura muerta sin
  candado es la puerta que la siguiente pantalla usa sin pasar por él.

Prueba: `edu-cierre.test.ts` verifica el candado en las dos lecturas con
precios (y en `getEduTarifaDePaciente`) y que la muerta ya no existe.

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

#### ✅ Cómo quedó (ola de cierre)

Se CONSTRUYÓ, con los dos helpers que llevaban ocho olas esperando: el
botón «Permisos» de cada fila de `/instituto/equipo` abre un editor por
grupos (`EDU_PERMISSION_GROUPS`) y el PATCH de `/api/instituto/equipo/[id]`
acepta `permissionsOverride`, que pasa SIEMPRE por
`sanitizeEduPermissionKeys` antes de guardarse
(`setEduTeamMemberPermissions`, `equipo.ts`). Con esto, todas las
mitigaciones del catálogo que hablaban de "encenderlo por override desde la
pantalla de permisos" dejaron de ser teóricas.

Las reglas que la pantalla trajo consigo, porque el mecanismo las exige:

- **Nadie edita sus propios permisos** (misma familia que "nadie se da de
  baja a sí mismo") — y con una consecuencia estructural: quien edita
  conserva siempre su `equipo.manage`, así que el instituto no puede
  quedarse sin administrador por una tarde de casillas.
- Una lista que quede VACÍA tras sanear REBOTA en vez de guardarse: por la
  semántica del override (vacío = default del rol), "sin ninguna casilla"
  no existe como estado, y guardarla diría "le quité todo" cuando en
  realidad le devolvió todo. Para cerrar el panel se da de baja.
- Marcar EXACTAMENTE el default se guarda como «restaurar el rol» (override
  vacío): un override idéntico al rol solo serviría para que la persona no
  reciba las keys que su rol gane en olas futuras. Y la fila lo DICE
  («Permisos personalizados») cuando alguien no usa el default.

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

#### ✅ Cómo quedó (ola de cierre)

Las dos piezas, más el camino voluntario:

- `(panel)/layout.tsx` redirige a `/instituto/cambiar-contrasena` a quien
  traiga la marca, en cada render y con la base en la mano. La pantalla
  vive FUERA del grupo (panel) —hermana del login— para que el redirect no
  pueda ser un bucle (el dental lo resuelve comparando pathname; aquí lo
  resuelve la ubicación).
- `POST /api/instituto/auth/cambiar-contrasena` cambia la contraseña de LA
  SESIÓN (nada del body salvo la contraseña), con el mismo criterio de
  fuerza del resto de DaleControl (`scorePassword`, importado, no
  reescrito), el tope de 72 de bcrypt, la comprobación best-effort de "es
  la misma de antes", y el orden Auth PRIMERO / Prisma después. La marca se
  levanta en TODAS las filas edu de esa cuenta (la contraseña es de la
  cuenta, no del instituto); la fila del dental no se toca.
- Y el menú ganó «Cambiar contraseña» (pie del sidebar): cambiarla sin
  estar obligado era la otra mitad de lo que faltaba.

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

#### ✅ Cómo quedó (ola de cierre)

Exactamente el arreglo propuesto, con la carrera cerrada por la base:

- `EduCharge.idempotencyKey` (opcional) + índice único
  `(institutionId, idempotencyKey)` (`sql/edu-cierre.sql`, sección 1 — el
  DDL va ANTES del deploy). `createEduCharge` devuelve el cobro existente
  con `duplicado: true` cuando la clave ya está; si dos POST simultáneos
  llegan a la vez, el índice rebota al segundo y se le devuelve el del
  primero. La pantalla de caja genera una clave por apertura del diálogo,
  estable entre reintentos.
- **Y el paréntesis del hallazgo también:** el tope de `addEduPayment` se
  reclama ahora DENTRO de la transacción con un `updateMany` condicional +
  `decrement` (que toma el candado de la fila y serializa dos pagos
  simultáneos), y el recálculo desde los pagos reales reescribe después las
  columnas con la verdad. `cancelEduCharge` quedó igual de condicionado
  (`paidCents: 0` en el `where`): un pago que entre a media cancelación ya
  no puede dejar un cobro CANCELADO con dinero dentro.

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

#### ✅ Cómo quedó (ola de cierre) — con una corrección a la propuesta

La "una línea" propuesta (`startsAt > now` a secas) habría roto el
mostrador real: el paciente que llega una hora ANTES de su cita se registra
antes de `startsAt`, y eso es lo legítimo de todos los días. El predicado
que quedó (`eduClinicalStatusTooEarly`, agenda-core, puro y probado) frena
los estados CLÍNICOS solo cuando la cita empieza a **más de 24 horas** —
deja pasar llegar temprano y el desfase entre sedes en husos distintos, y
para lo que la auditoría señaló: la cita del mes que viene marcada
COMPLETED hoy, fabricando horas de acreditación de una sesión que no
existió. Cancelar y "no llegó" no pasan por el freno: cancelar el futuro es
exactamente para lo que existe cancelar. El marcado en bitácora de "sellos
puestos por el propio alumno" queda como estaba: opcional, si una escuela
lo pide.

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

#### ✅ Cómo quedó (ola de cierre — y media la había cerrado la Ola 8)

La mitad "cuota por instituto" la resolvió la **Ola 8** después de esta
auditoría: los dos endpoints pasan por `requireEduIaCupo` (cupo mensual del
contrato, 402 al agotarse) y cada gasto queda en `EduAiUsage` con su costo
real. Lo que seguía abierto era el freno POR SESIÓN — sin él, una sola
cuenta en bucle se comía el cupo del MES de toda la escuela (y el cupo
agotado apaga la IA de todos). La ola de cierre lo puso en los dos
endpoints con `rateLimitKey` por `eduUserId` (dictado 10/min, análisis
5/min): por sesión y no por IP, porque la clínica entera sale por la misma
IP y un tope por IP frenaría al piso completo por culpa de uno. Es el
limitador en memoria del repo (por instancia serverless): suficiente como
freno de bucle — el candado del dinero sigue siendo el cupo.

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

#### ✅ Cómo quedó (ola de cierre)

La revisión consciente se hizo y la decisión se REVIRTIÓ: la key se partió.
`expediente.write` escribe, ENTREGA (ENVIADA) y devuelve;
`expediente.sign` — nueva, default de DOCENTE y DIRECCIÓN, nunca del
ALUMNO — es la única que cierra una nota como FIRMADA. La puerta vive en
`updateEduRecord` (no solo en el endpoint, que la resuelve y la pasa como
`canSign` — el mismo reparto que `canManage` en la agenda), la pantalla le
ofrece al alumno «Entregar» donde antes le ofrecía «Firmar», y con esto
ENVIADA deja de ser decorativo: es el paso por el que la nota LLEGA al
docente. Tres decisiones de borde, tomadas y escritas:

- **Quien tiene sign firma también su PROPIA nota** (el docente que escribe
  y cierra en un solo acto es el flujo normal de un profesional): la
  separación es por responsabilidad, no por autoría — igual que
  `recetas.issue`.
- **Las notas que un alumno ya firmó antes del cambio quedan como están**:
  una FIRMADA no se reabre ni se invalida (NOM-004). Lo que cambia es lo
  que se puede firmar desde hoy.
- El backfill de overrides va en `sql/edu-cierre.sql` (sección 3) y va VIVO
  —no comentado como en olas anteriores— porque no correrlo no es "quedarse
  como antes": un docente con override que incluía `expediente.write` PODÍA
  firmar, y sin backfill dejaría de poder en silencio.

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

#### ✅ Cómo quedó (ola de cierre)

Exactamente eso: `EduConsentPublicView` ganó `signedLabel`,
`getEduConsentPublic` lo formatea con el MISMO `stampLabel` del panel y la
zona del instituto (el `select` público ganó `institution.timezone`), y el
componente pinta la etiqueta en sus dos sitios (el aviso «Firmado el …» y
la lista de firmas). `toLocaleString` desapareció del componente — la
prueba de `edu-cierre.test.ts` lo vigila para que no vuelva. `signedAt`
(ISO) se conserva en la vista como dato, que es lo que un dato es; lo que
ya no existe es un navegador decidiendo cómo se lee la fecha de un
documento legal.

---

## ⚪ P3 — cosmético / deuda

| id | ruta:línea | qué pasa |
|---|---|---|
| **P3-15** ✅ | `package.json` | Los 16 archivos de prueba del vertical no tienen ningún script `test:edu*`. Ninguna gate los corre — **cerrado**: `npm run test:edu` (los archivos ya son 28) |
| **P3-16** | `search.ts:155` · `padron-core.ts:328-336` · `caja.ts:248-255` | El buscador usa `contains` (`LIKE '%…%'`) sobre `searchIndex`, y ninguno de los tres modelos tiene índice en esa columna |
| **P3-17** | `traspasos.ts:397` · `tarifas.ts:1191` | Dos entradas sin tope: `listEduTransferableCases` sin `take`, y el array `precios` de `setEduProcedurePrices` sin límite de longitud |
| **P3-18** | `rubricas.ts:814-854` | `mapEduCurrentGrades` no tiene un solo llamador |

**P3-15.** Se corren a mano y **pasan las 516** (ver el cierre). Sin script,
nadie las va a correr: el gate del repo es el build, y el build no las toca.
Bastan tres líneas en `package.json` (`test:edu`, `test:edu-dinero`,
`test:edu-clinica`, o una sola con los 16 archivos).

> ✅ **CERRADO** (rama `feat/edu-tests`, 2026-08-31). Ver «Cómo quedó P3-15»
> abajo. La receta de este párrafo —«una sola con los 16 archivos»— resultó
> ser justo lo que NO había que hacer: una lista fija se pudre en la primera
> ola nueva y el hallazgo vuelve. Los 16 de la auditoría ya son 28.

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

#### Cómo quedaron los cuatro (ola de cierre)

- **P3-15 · ✅ cerrado después, en `feat/edu-tests` (2026-08-31).** La ola de
  cierre lo dejó fuera porque los scripts viven en `package.json`, que NO es
  un archivo del vertical. Eso era cierto y sigue siéndolo: por eso se cerró
  en una rama aparte, declarando el archivo compartido —
  `EDU_GUARD_SHARED="package.json,ORQUESTA.md" node scripts/edu-guard.cjs`,
  exit 0 — en vez de colarlo en una ola del instituto. Ver «Cómo quedó
  P3-15» abajo.
- **P3-16 · ✅** `sql/edu-cierre.sql` (sección 4) crea los tres índices GIN
  de trigramas sobre `searchIndex` (pacientes, alumnos y equipo), que es lo
  que un `contains` con comodín inicial puede usar. Viven SOLO en el .sql y
  no en el schema, a propósito: expresar `gin_trgm_ops` en Prisma exigiría
  encender el preview de extensiones para TODO el repo — tocar la config
  del dental por un índice del instituto. La diferencia queda documentada
  en el propio .sql.
- **P3-17 · ✅** `listEduTransferableCases` ganó su `take`
  (`EDU_CLINICA_MAX_ROWS`), y `setEduProcedurePrices` rebota tanto una
  lista más larga que `EDU_MAX_FEE_SCHEDULES` como el mismo
  `feeScheduleId` repetido (quedarse con "el último" en silencio guardaría
  uno de los dos precios al azar).
- **P3-18 · ✅** `mapEduCurrentGrades` se retiró — y `listEduProcedureOptions`
  (encontrada igual de muerta al cablear el P2-7) con ella. Ninguna tenía
  un llamador, y la primera además aceptaba `institutionId` suelto en vez
  del contexto: justo la firma que la regla de oro del vertical prohíbe.

#### ✅ Cómo quedó P3-15 (rama `feat/edu-tests`, 2026-08-31)

**El script.** Dos renglones en `package.json` (más su `//` de comentario,
como los demás casos raros del repo):

```json
"test:edu": "node scripts/edu-tests.cjs"
```

**Cómo se descubre la lista.** No se lista nada a mano. `scripts/edu-tests.cjs`
lee el disco: barre **en profundidad** las cuatro raíces que
`scripts/edu-guard.cjs` llama «propias del vertical» —`src/lib/edu`,
`src/components/edu`, `src/app/instituto`, `src/app/api/instituto`— y se
queda con todo `*.test.ts(x)`. Hoy eso da los **28** archivos de
`src/lib/edu/__tests__/`; la ola que ponga su prueba al lado de su
componente queda cubierta sin tocar el runner. Una lista fija —el patrón de
`test:billing`— era justo lo que hacía volver este hallazgo en la primera
ola nueva; los «16 archivos» de la auditoría ya eran 28 al cerrarlo.

**Por qué un runner y no un glob.** Porque el glob de tres palabras miente,
y de las dos maneras se comprobaron en node v24.13.1:

1. `tsx --test "…/*.test.ts"` con un patrón que **no encuentra nada** imprime
   `tests 0 / fail 0` y sale con **código 0**. El día que alguien mueva la
   carpeta, la gate deja de probar el vertical y sigue en verde.
2. `--test` lee los **corchetes** de la ruta como patrón: un archivo bajo
   `(panel)/[id]/` se salta **en silencio**, otra vez con exit 0 — la misma
   trampa que ya documentan `test:landing` y `test:campo-edicion`. El runner
   los corre sin `--test`, uno por uno (mismo rodeo, exit code intacto).

El runner tapa los dos: **cero archivos descubiertos → exit 1** con el motivo
escrito, porque una gate que pasa porque no corrió nada es peor que no tener
gate.

**Qué se probó** (las dos direcciones, no solo la verde):

| prueba | resultado |
|---|---|
| `npm run test:edu` | **28 archivos · 929 pruebas · 0 fallos · exit 0** |
| Una aserción rota a propósito (`edu-visibility.test.ts:219`) | **exit 1**, `929 tests / 928 pass / 1 fail`, con el nombre de la prueba, el archivo y la línea. Revertida con `git checkout --` |
| El runner corrido donde no hay ninguna raíz | **exit 1**: «no se descubrió NI UN archivo de prueba» |
| `npm run build` completo, sin pipes | **exit 0** |
| `EDU_GUARD_SHARED="package.json,ORQUESTA.md" node scripts/edu-guard.cjs` | **exit 0** |

**Sobre la guardia.** El motivo por el que la ola de cierre lo dejó fuera era
correcto: `package.json` no es del vertical. Por eso esto no viajó dentro de
una ola del instituto sino en su propia rama, declarando el archivo como
compartido. `scripts/edu-tests.cjs` sí es propio y se agregó a `OWN_FILES`
de `scripts/edu-guard.cjs`, como pide el aviso de ese archivo.

Con una corrección que hubo que hacerle a la guardia y conviene dejar
escrita: `package.json` **no estaba en `SHARED_FILES`**, así que no caía en
«compartido sin declarar» sino directamente en **PROHIBIDO** — y declararlo
en `EDU_GUARD_SHARED` no servía de nada, porque el guard solo consulta lo
declarado para los archivos que ya están en esa lista. O sea: hasta ahora
**no existía manera de tocar `package.json` desde el vertical**, ni siquiera
diciéndolo en voz alta. Eso es lo que hacía a P3-15 irresoluble, más que el
guard en sí. Ahora `package.json` es COMPARTIDO, no propio: sigue siendo un
fallo tocarlo **sin declararlo** —verificado: `EDU_GUARD_SHARED="ORQUESTA.md"`
con este cambio en el árbol sale **exit 1**—, pero ya se puede declarar. La
guardia no se aflojó; se le puso la puerta que le faltaba.

---

## Qué arreglar primero

1. ✅ **P0-1** — ~~dos líneas en `rubricas.ts:609` (meter el alcance) o borrar la
   rama `?alumno=` del route. Es el arreglo más barato y el más grave.~~
   **Hecho** (se metió el alcance; la rama `?alumno=` se conservó).
2. ✅ **P1-4** — ~~un `canManage ?` en `agenda/page.tsx:89` y pasar
   `ctx.eduUserId` en `docentes/page.tsx:49`. Corta la fuente de ids de P0-1 y
   cierra dos fugas del padrón por su cuenta.~~ **Hecho**, con `eduPadronScope`
   en vez de un `if` a mano, y también en el route `?detalle=1`.
3. ✅ **P0-2** — ~~el más caro de los cuatro, porque toca UI (selector de caso en
   la agenda) + `traspasos.ts` + posiblemente `visibility.ts`. Hacerlo
   completo: de paso desbloquea la etapa `SESSION` del gate de la Ola 4.~~
   **Hecho** sin tocar la UI: la cita se engancha en el SERVIDOR (caja no
   puede ver casos), el traspaso engancha las sueltas y el `where` deja de
   depender de que los datos estén bien. La etapa `SESSION` queda desbloqueada
   para las citas nuevas.
4. ✅ **P1-3** — ~~una decisión y tres líneas en `updateEduAppointment`.~~
   **Hecho**: se resuelve el caso en vez de rebotar el cambio de alumno.
5. ✅ **P2-7** — ~~cuatro líneas, cierra la promesa que el catálogo ya hace por
   escrito.~~ **Hecho** en las lecturas con PRECIOS; el catálogo de
   procedimientos queda abierto a los flujos clínicos a propósito (ver su
   «Cómo quedó»).
6. ✅ **P2-9 + P2-8** — ~~la pantalla de contraseña y la de permisos.~~
   **Hechas las dos**: el vertical ya se administra solo — la contraseña
   temporal caduca en el primer render del panel y los overrides se
   escriben desde /instituto/equipo, saneados.
7. ✅ **P2-5** — ~~decidir: aplicar el semestre o quitarlo de la pantalla.~~
   **Decidido y aplicado**: el rango es CUÁNDO se exige (expectativa del
   semáforo), no qué casos cuentan.
8. ✅ **P2-11 + P2-10** — **hechos**: el freno de 24 h a los estados
   clínicos del futuro, y la clave de idempotencia del cobro (más el tope
   del pago reclamado dentro de la transacción).
9. ✅ **P3-15** — ~~los scripts de prueba. Sigue pendiente: `package.json`
   está fuera de los archivos del vertical y la guardia lo rebota — es un
   cambio de repo, no de una ola del instituto.~~ **Hecho** exactamente así:
   un cambio de repo en su propia rama (`feat/edu-tests`), con
   `package.json` declarado como compartido ante la guardia.
   `npm run test:edu` → **28 archivos, 929 pruebas, 0 fallos.**
10. Del resto: ✅ **P2-12, P2-13, P2-14, P3-16, P3-17 y P3-18** cayeron en
    la ola de cierre (cada uno con su «Cómo quedó»). ✅ **P2-6** se cerró
    después, en `fix/edu-volumen` — y se cerró **como esta auditoría pidió**:
    con un filtro por generación, no con un `take`. Ver su sección.

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
