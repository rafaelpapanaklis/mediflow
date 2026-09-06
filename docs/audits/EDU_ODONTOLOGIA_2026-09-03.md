# Cómo volver el panel de instituto más odontológico y mejor panel universitario

**Rama:** `docs/edu-odontologia` (basada en `origin/main`, HEAD `b171fa9c`)
**Fecha:** 2026-09-03. Revisado con una pasada adversarial el 2026-09-04.
**Tipo:** investigación. **Cero cambios de código.** El único archivo que nace en esta rama es este.

**Alcance leído:** `src/app/instituto/**` (45 `page.tsx` — 41 bajo `(panel)` y 4 fuera — más 2 `layout.tsx`),
`src/app/api/instituto/**` (99 `route.ts`), `src/components/edu/**` (67 archivos), `src/lib/edu/**`
(65 módulos más 36 pruebas en `src/lib/edu/__tests__/`, que corren con `npm run test:edu`), y los
**44 modelos `Edu*`** y **23 enums `Edu*`** de `prisma/schema.prisma`. El panel dental se leyó en solo
lectura para medir la brecha.

> **Corrección de un dato del encargo.** El encargo dice «34 pantallas bajo
> `src/app/instituto/(panel)/**`». Son **41** `page.tsx` (más 2 `layout.tsx`). Comprobado con
> `find "src/app/instituto/(panel)" -name page.tsx | wc -l` → 41. Las 41 están en §2.

> **Convención de citas.** Las rutas son repo-relativas y completas. Cuando abrevio dentro de una tabla,
> `pacientes/[id]/…` significa `src/app/instituto/(panel)/pacientes/[id]/…` y `mi-dia-screen.tsx` significa
> `src/components/edu/clinica/mi-dia-screen.tsx`. Lo que es conocimiento de dominio y **no** hallazgo del
> repo va marcado **[dominio]**; lo que es opinión mía, **[corazonada]**.

> **Este informe pasó por una pasada adversarial** de nueve agentes que verificaron 261 citas abriendo el
> archivo y corrieron los greps declarados. Encontraron 118 defectos y están todos corregidos aquí. Las
> correcciones que cambiaron una conclusión están marcadas con **⟳** en el texto.

---

## 1. Resumen ejecutivo

El panel ya está bien construido y ya se siente de escuela **en la superficie**: dice «estudiante»,
«especialidad» y «valoración», y no queda ni un «alumno» en texto renderizado — comprobado con
`grep -rnoE ">[^<>{}]*[Aa]lumn[a-zóé]*[^<>{}]*<"` sobre `src/app/instituto/**` y `src/components/edu/**`
→ **0 aciertos**. El gate de autorización del docente, el aislamiento por `institutionId` y el doble
candado permiso+alcance son mejores que los del panel dental.

Lo que no se siente odontológico es lo de **debajo del texto**. De los 44 modelos `Edu*`, exactamente
**uno** guarda una pieza dental: `EduOdontogramEntry.tooth` (`prisma/schema.prisma:13453`). Ni el caso,
ni la nota, ni el estudio, ni el cobro, ni el consentimiento, ni el requisito de graduación saben en qué
diente pasó nada (`grep -n "tooth" prisma/schema.prisma` → 32 líneas; dentro del rango `Edu` solo `:13453`
y sus dos índices `:13474-13475`). Un caso guarda **un** `procedureId` «principal»
(`prisma/schema.prisma:13148`) y el avance académico cuenta **casos**, no actos: un caso con tres
endodoncias cuenta 1 igual que uno con una (`src/lib/edu/evaluacion-core.ts:335-347` y `:453`). El número
que una escuela enseña en una acreditación está mal contado en los dos sentidos.

Las tres palancas de mayor rendimiento, en orden:

1. **El acto clínico por pieza** (ODO-01). Una tabla que diga «a este paciente, en esta sesión, este
   estudiante hizo ESTE procedimiento en ESTA pieza». Desbloquea sola los requisitos odontológicos, el
   cobro por diente, el reporte por procedimiento y la autorización que nombra la pieza.
2. **El catálogo de procedimientos deja de ser una lista de precios** (ODO-03). `EduProcedure` tiene 10
   campos escalares y ninguno clínico: sin especialidad (`programId`), sin piezas aplicables, sin código
   **clínico** ni clave SAT propia, sin descripción (`prisma/schema.prisma:13628-13667`). ⟳ *Sí tiene* un
   `code` corto por instituto (`:13636`, único en `:13663`); lo que falta es el resto.
3. **Cerrar la cadena del piso clínico** (ODO-17, ODO-18, ODO-22). La nota nunca se ata a la cita aunque
   la columna existe; `/mi-dia` no enlaza a la ficha; y la columna «Cobrado por especialidad» del tablero
   de Dirección da **$0 siempre** porque ninguna pantalla escribe el `caseId` del cobro.

---

## 2. Inventario de pantallas

41 pantallas del panel. `Genérico` = qué se lee como software médico neutro y no como clínica dental
universitaria. `Fuera` = si alguien tiene que salir del panel (o de la pantalla) para terminar su trabajo.

### 2.1 Operación clínica (9 pantallas)

| Ruta | Quién la ve | Genérico | Falta | Fuera |
|---|---|---|---|---|
| `/instituto/inicio` | los 4 roles; el tablero solo `direccion.panel` (`permissions.ts:828`) | Sus 3 cifras son pacientes, dinero y autorizaciones (`direccion.ts:1362,1389,1409`): ni una académica | Bandeja del día del docente y avance del estudiante; hoy el docente lee su propio correo (`inicio/page.tsx:193-203`). ⟳ Aquí se pinta también el **medidor de almacenamiento** del instituto (`inicio/page.tsx:177`) — ver §2.6 | Sí para docente y estudiante |
| `/instituto/mi-dia` («Mi agenda») | DOCENTE y ALUMNO (alcance recortado, `layout.tsx:105-106`) | La tarjeta no dice **qué** se va a hacer: `EduAppointmentRow` no tiene procedimiento ni pieza (`agenda-core.ts:825-861`) | Enlace al expediente: el archivo no importa `next/link` (grep sobre `mi-dia-screen.tsx` → 0) | **Sí** — callejón sin salida |
| `/instituto/agenda` | DIRECCION y CAJA; redirige a `/mi-dia` a todo alcance recortado (`agenda/page.tsx:85-87`) | Se agenda sin decir a qué: el único campo abierto es «Notas», 2 renglones (`agenda-modales.tsx:317-328`) | Carga del estudiante y confirmación del paciente | Sí: al reagendar cancela el recordatorio y manda a la ficha (`agenda-modales.tsx:769-773`) |
| `/instituto/agenda/tamizaje` («Valoración») | `casos.assign`: DIRECCION y DOCENTE | La valoración **no valora, asigna**: 4 selectores y un textarea (`tamizaje-screen.tsx:225-336`); grep de `complej\|urgencia\|riesgo` sobre ese archivo → 0 | Complejidad, urgencia, procedimiento propuesto, y el avance del estudiante al repartir | Sí |
| `/instituto/pacientes` | los 4 roles (`pacientes.view`) | «Casos: 2 abiertos» sin especialidad ni estudiante; `EduPatientRow` no los trae (`pacientes-core.ts:194-216`) | Filtro «sin caso asignado»; no hay export — `grep -i "csv\|descargar\|buildEdu.*Csv"` sobre `pacientes-screen.tsx` → 0, frente a `casos-core.ts:359` (`buildEduCasosCsv`) que sí existe | Sí, a Excel |
| `/instituto/clinica` (en vivo) | DIRECCION y DOCENTE, lista blanca (`visibility.ts:226,262-275`) | El sillón solo sabe libre/próxima/ocupado (`clinica-viva-core.ts:161-168`); grep de `firma` → 0 | El reloj de «esperando firma» existe… en el tablero de Dirección (`direccion-core.ts:108-115,700-738`), que el docente no ve | Sí, a `/autorizaciones` |
| `/instituto/clinica/plano` | `clinica.edit`, solo DIRECCION | Catálogo del consultorio privado tal cual: `getCatalogForClinic("DENTAL")` (`plano-editor.tsx:139`) sobre `src/lib/floor-plan/elements-dental.ts:236-911` | Aula, cubículo docente, laboratorio, preclínico; zonas por especialidad | No para dibujar |
| `/instituto/sillones` | DIRECCION, DOCENTE, CAJA | El sillón es una caja con nombre y horario: sin equipamiento, sin especialidad, **sin bitácora de mantenimiento ni de esterilización** (`agenda-core.ts:788-806`; `model EduChair`, `prisma/schema.prisma:13023`) | Ocupación real; aviso de choque al recortar horario; ver ODO-35 | Sí, a la agenda |
| `/instituto/sedes` | solo DIRECCION | Es una sucursal: dirección, teléfono, huso (`sedes-screen.tsx:107-133`) | «Quién entra» pinta todas las cuentas sin buscador ni lote (`sedes-screen.tsx:483-620`). ⟳ Y la sede es una **dimensión**, no una pantalla — ver §2.6 y ODO-34 | Sí |

### 2.2 Ficha del paciente (11 pantallas + el marco)

| Ruta | Quién la ve | Genérico | Falta | Fuera |
|---|---|---|---|---|
| `pacientes/[id]/layout.tsx` (marco, no es pantalla) | `pacientes.view`, los 4 roles | El encabezado no dice **quién** trata al paciente ni de qué especialidad (`layout.tsx:237-250`) | «Ver expediente completo / imprimir»: sobre `src/app/instituto/(panel)/pacientes/**` y `src/components/edu/expediente/`, `grep "window.print\|/pdf"` → 1 acierto y es el visor (`estudio-viewer.tsx:156`) | Sí |
| `pacientes/[id]` (Resumen) | idem, bloques por alcance | Los avisos son `<p>` sin botón (`pacientes/[id]/page.tsx:60-62`) | KPI de escuela: sesiones del caso, requisito que cubre, calificación | Sí para actuar |
| `pacientes/[id]/datos` | `pacientes.view`; editar antecedentes con `pacientes.manage` O `expediente.write` | Sin domicilio, CURP ni ocupación (`prisma/schema.prisma:12916-12946`) | Interrogatorio estructurado, signos vitales, ASA; tutor legal se reteclea en cada carta (`consentimientos-screen.tsx:513`) | Sí, a la lista |
| `pacientes/[id]/agenda` | `agenda.view` + alcance | Renglón de consultorio: hora, sillón, estado. Falta **qué** se hará | Histórico de inasistencia; tope de 50 sin paginar (`pacientes/[id]/agenda/page.tsx:156-160`) | Sí |
| `pacientes/[id]/casos` | `casos.view`; CAJA fuera por doble candado | «Terminado» (`types.ts:297`) no distingue clínicamente terminado de **acreditado** | El plan de tratamiento no se ve: se firma una puerta PLAN sin documento; la calificación no aparece | Sí, a `/evaluacion` |
| `pacientes/[id]/expediente` | `expediente.view` + `eduClinicalScope` (`expediente-core.ts:51`) | SOAP de medicina general: `EDU_SOAP_FIELDS` son 4 textos (`expediente-core.ts:84-100`); sin pieza ni CIE-10 | El banner promete «Filtra por caso» y **no hay filtro**: el loader lo acepta (`expediente.ts:217,231-232`), la página lo llama sin opciones (`pacientes/[id]/expediente/page.tsx:61`) | Sí |
| `pacientes/[id]/odontograma` | `odontograma.view` + alcance de `cases` | Lo **menos** genérico del panel: importa el dibujo del dental sin copiarlo | Odontograma de PLAN; historial real (hoy es el estado presente reordenado, `odontograma-screen.tsx:409-461`); no se imprime | Sí, a captura de pantalla |
| `pacientes/[id]/estudios` | `estudios.view` + alcance | Explorador de archivos: sin filtro por tipo ni por caso, y sin pieza. ⟳ El `kind` **sí existe** (`prisma/schema.prisma:13498`, enum en `:13341-13352`); lo que no hay es filtro | Comparar dos estudios; serie fotográfica; revisión del docente. Paradoja: la IA sí devuelve `pieza {h.tooth}` (`analisis-ia.tsx:213`) y el estudio no la tiene | Sí |
| `pacientes/[id]/consentimientos` | `consentimientos.view`, la única del expediente que ve CAJA | Catálogo del consultorio privado (`src/lib/consent/templates.ts:36-145`); la carta no nombra la pieza | **El texto firmado no se puede releer**: `EduConsentRow` no trae `content` (`consentimientos-core.ts:406-455`) y `publicPath` se anula al firmar (`consentimientos.ts:218`) → ODO-36 | **Sí, el caso más claro** |
| `pacientes/[id]/whatsapp` | `consentimientos.view` O `caja.view` (`layout.tsx:196-201`) | Canal de salida, no conversación; el catálogo es de consultorio: carta y recibo | Mandar la receta expedida (el PDF existe); recordatorio manual | Sí |
| `pacientes/[id]/recetas` | `recetas.view` + alcance | El medicamento es `<input>` libre (`recetas-screen.tsx:518-528`); sobre `src/lib/edu/receta*`, `src/components/edu/recetas/` y las rutas de instituto, `grep "alerg\|interaccion\|qr\|verifyUrl"` → 0 | El chip rojo «Alergia: penicilina» está en el **mismo** encabezado (`layout.tsx:266-284`) y el editor deja teclear amoxicilina | Sí, a `/autorizaciones` |
| `pacientes/[id]/pagos` | `caja.view` + alcance de dinero | Reutiliza la tabla global: conserva la columna «Paciente» dentro de la ficha de esa persona (`planes-screen.tsx:376`) | **No está en las pestañas**: grep `pagos` en `layout.tsx` → 0; el propio archivo lo admite (`pacientes/[id]/pagos/page.tsx:22-27`) | Sí |

### 2.3 Académico (11 pantallas)

| Ruta | Quién la ve | Genérico | Falta | Fuera |
|---|---|---|---|---|
| `/instituto/casos` | `casos.view` (3 roles) | Ni una columna dental: `procedureId` existe y ni la fila ni el CSV lo llevan (`casos-core.ts:268-297` y `:359-374`) | Filtro por procedimiento; fecha de última actividad (un caso 3 meses parado sale verde, `casos-core.ts:124`) | Sí para actuar |
| `/instituto/autorizaciones` | `autorizaciones.view` (3 roles) | Se firma texto libre: la tarjeta de un PLAN pinta 4 campos SOAP (`autorizaciones.ts:264-273`). El placeholder de rechazo delata el hueco: «el diente 26 no tiene indicación…» (`bandeja-screen.tsx:391`) | Pieza y procedimiento en el resumen; miniatura de la radiografía; **badge de pendientes** (grep `badge\|count` en `edu-shell.tsx` → 0) | Sí: nadie avisa |
| `/instituto/evaluacion` | `evaluacion.view` (3 roles) | Tablero de cumplimiento neutro. **No sale el docente supervisor**: `EduEvaluacionRow` no lo trae (`evaluacion-core.ts:1256-1278`) | Export de la lista, aunque el propio texto dice que «es la vista que se exporta para una acreditación» (`evaluacion-screen.tsx:306`); vista por requisito | **Sí, a Excel** |
| `/instituto/evaluacion/[id]` (bitácora) | idem; alumno ajeno → 404 | Sabe de odontología a medias: muestra procedimiento y categoría, nunca la pieza (`bitacora-screen.tsx:298-307`) | Descriptores por nivel en la rúbrica; requisitos que no sean casos; sello/firma para entregarla | A medias |
| `/instituto/rubricas` | solo DIRECCION (`rubricas.manage`) | Formulario de pesos genérico: criterio = nombre+descripción+peso (`prisma/schema.prisma:14447-14455`) | Descriptores por nivel; criterio eliminatorio; duplicar una rúbrica | Sí: se reteclea desde Word |
| `/instituto/requisitos` | solo DIRECCION | Solo cuenta **casos** (`prisma/schema.prisma:14606-14612`); tres formas y ninguna dental | Horas, seminarios, presentaciones; versión del plan; cobertura por generación | Sí |
| `/instituto/procedimientos` | `tarifarios.view` (DIRECCION, CAJA) | Catálogo de servicios de cualquier negocio: clave, nombre, categoría libre, minutos (`prisma/schema.prisma:13628-13667`) | Especialidad, «requiere pieza», dificultad; alta masiva | Sí para decidir el contenido |
| `/instituto/padron` («Estudiantes») | DIRECCION y DOCENTE | Lista de personas de cualquier escuela; sin teléfono aunque `EduUser` lo guarda (`prisma/schema.prisma:12498`) | Enlace a la bitácora (el único `Link` va a `/equipo`, `padron-screen.tsx:472`); columna «cómo va»; export | Sí |
| `/instituto/padron/estructura` | solo DIRECCION | CRUD que serviría para una escuela de idiomas | Coordinador de especialidad, cupo, marcar la generación sin fechas | **No** |
| `/instituto/docentes` | DIRECCION y DOCENTE | Directorio de personal: no sale la **cédula** aunque el modelo la guarda (`prisma/schema.prisma:12598`) | Firmas pendientes y tiempo de firma; asignar desde aquí | Sí, rebota a `/padron` |
| `/instituto/equipo` | solo DIRECCION (`equipo.manage`) | Administración de usuarios de cualquier SaaS | Cédula y especialidad al alta; reenviar contraseña; inscribir en el mismo acto | **Sí**: entra pegado de Excel y sale por portapapeles (`equipo-core.ts:407-420`) |

### 2.4 Dirección, dinero y configuración (10 pantallas)

| Ruta | Quién la ve | Genérico | Falta | Fuera |
|---|---|---|---|---|
| `/instituto/direccion` | solo DIRECCION + alcance «all» en 4 recursos (`visibility.ts:1110-1114`) | «Cobrado por especialidad» se calcula por `c.case?.programId` (`direccion.ts:879-880`) y **ninguna pantalla escribe el `caseId` del cobro** → siempre $0. ⟳ El servidor **sí** lo sabe escribir (`caja.ts:554,571-574,607`); es la UI la que no lo ofrece | Desglose por procedimiento; filtro por **generación** (sus 4 filtros son periodo/desde/hasta/especialidad, `direccion-core.ts:171-176`). ⟳ Y aquí se pinta el **precio del TB extra**, cableado (§2.6) | No para consultar |
| `/instituto/caja` | DIRECCION y CAJA | Sin columna de estudiante, de caso, de pieza **ni de fecha** (`chargedAt` viaja y no se pinta, `dinero-core.ts:546`) | Imprimir el recibo (grep `window.print` → 0); selector de lista para la regla MANUAL, que hoy **no puede dispararse** (`tarifas.ts:289-296`, `caja.ts:575`) | Sí, a la ficha para mandar el recibo |
| `/instituto/caja/corte` | DIRECCION y CAJA | Corte de cualquier comercio: método, neto, diferencia | Imprimir/exportar (grep → 0); el turno es del **instituto**, no de la sede (`caja/page.tsx:80-82`) | Sí |
| `/instituto/caja/planes` | DIRECCION y CAJA | Cobranza a meses idéntica a la de una mueblería | Teléfono y aviso (grep `telefono\|whatsapp` → 0); filtro «solo vencidas» | Sí |
| `/instituto/caja/planes/[id]/recibo` | idem | Pagaré de financiera: no dice **por qué** se paga (`plan-recibo.tsx:113-116`) | Conceptos del cobro; el estudiante y su especialidad | Parcial |
| `/instituto/tarifarios` | ver: DIRECCION y CAJA; editar: DIRECCION | La agrupación es texto libre y **no** está ligada a `EduProgram` (`prisma/schema.prisma:13637-13640`) | Quién cambió un precio (no hay `updatedByUserId`; grep `model EduAudit` → 0); vigencia; vista imprimible | Sí |
| `/instituto/facturacion` | DIRECCION y CAJA | Una sola clave SAT para todo el instituto (`facturacion-core.ts:391-406`) | Filtro por fechas: `EduInvoiceFilters` solo tiene `q` y `status` (`facturacion-core.ts:583-588`) → no se puede cerrar el mes | **Sí** |
| `/instituto/facturacion/datos-fiscales` | solo DIRECCION | Pantalla fiscal de cualquier empresa | Quién cambió PRUEBAS→EN VIVO (el dato se guarda, `prisma/schema.prisma:15431`, y no se pinta); serie por sede | Sí, al portal del SAT |
| `/instituto/whatsapp` | solo DIRECCION | Los 3 avisos son de consultorio: cita, consentimiento, recibo (`whatsapp-core.ts:39`) | **Ninguno al estudiante ni al docente**; el cron no está dado de alta (`src/app/api/instituto/cron/recordatorios/route.ts:16-19`; grep `instituto` en `vercel.json` → 0) | Sí, dos veces |
| `/instituto/ia` | solo DIRECCION | Mide personas y dólares: la única desagregación es el **rol** (`ia-screen.tsx:172-176`) | Cupo por estudiante o por especialidad — ⟳ con la restricción de `ia-cupo.ts` (§2.6); corte por especialidad; export | Sí |

### 2.5 Patrones que se repiten en las 41

- **La pieza dental no existe fuera del odontograma.** Verificado modelo por modelo: `EduRecord`
  (`prisma/schema.prisma:13370-13417`), `EduCase` (`:13111-13200`), `EduStudy` (`:13490-13532`) y
  `EduChargeItem` (`:13855-13886`) no tienen diente. `grep -n "tooth" prisma/schema.prisma` → 32 líneas;
  dentro del rango `Edu` solo `:13453` y sus dos índices.
- **Las tarjetas del día son callejones sin salida.** `mi-dia-screen.tsx` y `tamizaje-screen.tsx` pintan
  con `cursor:default` y no importan `next/link` (grep → 0). Solo el popup del plano ofrece «Abrir ficha»
  (`plano-screen.tsx:678-684`).
- **Lo que se puede mirar no se puede entregar.** Solo dos pantallas imprimen: `window.print()` aparece
  exactamente en `direccion-screen.tsx:447` y `plan-recibo.tsx:65`. El expediente, el odontograma, el
  consentimiento firmado, el corte de caja y el tarifario no tienen salida en papel.
- **El panel no avisa de nada.** Sin badge en el sidebar (`edu-shell.tsx`, grep → 0), sin contador en
  Inicio, y los tres únicos WhatsApp van al **paciente**. El docente se entera de sus firmas abriendo la
  bandeja; el estudiante, preguntando. Ese hueco convierte el WhatsApp personal en parte del producto.
- **El doble candado es sólido y uniforme** — permiso con `hasEduPermission` + `EduDenied`, alcance con
  `eduVisibility`, y el endpoint vuelve a exigir con `eduApiGuard`. No encontré ninguna pantalla sin su
  comprobación. **No lo rompas al añadir nada.**
- **Diez de once pantallas académicas son la misma tabla** `edu-rowhead`/`edu-row` con seis columnas
  genéricas. La única que se parece a la herramienta de un piso clínico es la bandeja de autorizaciones
  (grep `edu-rowhead` → 0 solo en `bandeja-screen.tsx`).

### 2.6 ⟳ Cuatro cosas que el panel tiene y este informe casi se deja fuera

La pasada adversarial encontró cuatro superficies vivas que el barrido inicial no nombró. Las cuatro
tienen consecuencias sobre las propuestas.

- **La cuota de almacenamiento del instituto: 5 TB por instituto, compartidos entre todas sus sedes.**
  `EDU_ALM_INCLUIDO_BYTES = 5 * EDU_BYTES_POR_TB` (`src/lib/edu/almacenamiento-core.ts:49`); el corte es
  duro y vive en `/sign`, no en `/confirm` (`almacenamiento.ts:37`); el medidor se pinta en **dos** de las
  41 pantallas (`inicio/page.tsx:177` y `direccion/page.tsx:109`). Son 679 líneas en dos módulos que este
  informe no citaba. **Consecuencia:** ODO-04 (una foto del odontograma por cita y por autorización),
  ODO-08 y ODO-12 (serie fotográfica por etapa y por pieza) multiplican objetos guardados contra ese techo.
- **⛔ Un precio cableado en la UI, contra la regla (d) de la casa.** El precio del TB extra es una
  constante de TypeScript —`export const EDU_ALM_TB_EXTRA_MXN = 400;`
  (`almacenamiento-core.ts:52-60`)— formateada en `eduAlmPrecioLabel` (`:326-328`) y **renderizada** en
  `src/components/edu/direccion/almacenamiento-card.tsx:100` y en
  `src/app/admin/institutos/institutos-client.tsx:72,287,297`. Es un precio escrito a mano que se pinta en
  el tablero de Dirección del instituto → ODO-37.
- **La sede es una dimensión, no una pantalla.** El selector vive en el chrome (`edu-shell.tsx:38,265,357`)
  y se ve en las 41 pantallas, pero solo recorta **cinco** cosas — sillón, cita, cobro, plano y clínica en
  vivo — y el punto único lo dice por escrito (`visibility.ts:835-839`). `campusId` aparece en 15 de los 65
  módulos y **no** en `pacientes.ts`, `casos.ts`, `expediente.ts`, `evaluacion.ts`, `padron.ts`,
  `autorizaciones.ts`, `recetas.ts`, `consentimientos.ts`, `rubricas.ts`, `facturacion.ts` ni
  `traspasos.ts`. En 36 de las 41 pantallas el selector dice «Campus Sur» y los datos son los de toda la
  escuela → ODO-34.
- **El cupo de IA tiene una regla que ninguna propuesta puede saltarse.** `src/lib/edu/ia-cupo.ts` (776
  líneas) declara en su cabecera que **lo que incluye el contrato (`monthlyUsdCents`) NO se edita desde el
  panel con ningún permiso**, y `updateEduAiQuota` lo rechaza con mensaje en vez de ignorarlo. Un sub-cupo
  por estudiante o por especialidad solo puede ser un **reparto** de lo ya contratado → ODO-38.

---

## 3. Vocabulario

### 3.1 El resultado en una línea, con el barrido honesto

**El vocabulario prohibido ya no llega a la pantalla.** La prueba, corregida ⟳ tras la pasada adversarial,
porque el barrido original estaba mal contado y mal acotado:

- Sobre `src/app/instituto/**` y `src/components/edu/**`, la regex de literales
  `"[^"]*[Aa]lumn[a-z]*[^"]*"|'[^']*[Aa]lumn[a-z]*[^']*'` devuelve **31** aciertos (no 11): **7** son
  comentarios, **24** son identificadores técnicos — ids de `htmlFor`, clases CSS `edu-*` y las tres
  claves de drill-down del panel de Dirección (`direccion-screen.tsx:985,1119,1133`), que **no** son
  comentarios y sí viajan en tiempo de ejecución.
- La prueba que de verdad sostiene la frase es otra:
  `grep -rnoE ">[^<>{}]*[Aa]lumn[a-zóé]*[^<>{}]*<"` sobre esos dos árboles → **0 aciertos**. No hay
  «alumno» en texto JSX renderizado.
- El mismo barrido extendido a `src/lib/edu/**` —donde viven **todas** las etiquetas visibles del panel,
  porque las pantallas las importan de ahí— también sale limpio: los aciertos son comentarios o claves
  (`permissions.ts:44`, `types.ts:1017`, `equipo-core.ts:128`, `dinero-core.ts:285`).
- ⚠️ **Pero `src/app/api/instituto/**` no estaba barrido, y ahí sí queda.** Cuatro cadenas en español, en
  tiempo de ejecución, dos de ellas devueltas al navegador como cuerpo de error:
  `api/instituto/evaluacion/route.ts:33` («Ese alumno no es de este instituto.», 404),
  `api/instituto/evaluacion/[id]/export/route.ts:35` (la misma),
  `api/instituto/traspasos/route.ts:23` («Dime de qué alumno (?alumno=).», 400) y
  `api/instituto/calificaciones/route.ts:37` («…o de qué alumno (?alumno=).», 400).
- El único resto en texto puro de UI sigue siendo `types.ts:213` («Pausó la **residencia**»).

Existe un guardián de vocabulario, pero **solo cubre la landing pública**: `EDU_LANDING_VOCABULARIO`
(`src/lib/edu/marketing.ts:708-712`) con las tres reglas exactas del producto, consumido por
`src/lib/edu/__tests__/edu-landing.test.ts:210` y `:225`. Nada impide que la próxima ola meta «alumno» en
un `<h1>` del panel.

### 3.2 Casi gratis — texto, con tres avisos que el barrido inicial no dio

Las tablas de `LABELS`/`DESCRIPTIONS` de `src/lib/edu/types.ts` mapean claves de enum de Prisma a texto
español. Cambiar la **clave** es siempre una migración de Postgres. Cambiar el **texto** es casi siempre
gratis, pero ⟳ **no siempre**, y estos tres avisos valen para toda la tabla:

1. **Varias tablas de etiquetas se escriben dentro de los CSV que exporta el producto.**
   `EDU_CASE_STATUS_LABELS` va dentro de `eduCsvRow` (`casos-core.ts:388`), la cabecera «Estado» de ese
   mismo CSV está en `casos-core.ts:372`, `evaluacion.ts:899` escribe `["Estado", page.statusLabel]` y
   `EDU_DIR_SILLON_LABELS` va al CSV del panel de dirección (`direccion-core.ts:1044`). Renombrar toca
   pantalla **y** archivo descargable que la escuela archiva.
2. **Cada rótulo de columna existe dos veces en el mismo archivo.** El `.edu-rowhead` está
   `aria-hidden="true"` (es la rejilla de escritorio) y cada fila repite el texto en un
   `<span className="edu-cell__label">`, que es lo único que se lee en móvil y con lector de pantalla.
   La incoherencia ya existe hoy: `evaluacion-screen.tsx:354` dice «Horas» y su gemelo `:403` ya dice
   «Horas clínicas». **Renombra siempre el par.** Gemelos verificados: `procedimientos-screen.tsx:108,113`
   · `requisitos-screen.tsx:150,160,165` · `rubricas-screen.tsx:143,149,164` ·
   `evaluacion-screen.tsx:377,403,408` · `ia-screen.tsx:262,268,317,324,328`.
3. **Los rótulos más largos no caben.** Las columnas tienen ancho fijo en `src/app/instituto/edu-theme.css`:
   `.edu-table--procedimientos` (`:2636-2638`), `.edu-table--requisitos` (`:3717-3719`),
   `.edu-table--evaluacion` (`:3705-3707`), `.edu-table--iaprecios` (`:5079-5081`). Alargar un rótulo pide
   ajustar `--edu-cols` en el mismo commit.

| Actual | Propuesto | Dónde | Nota |
|---|---|---|---|
| «Pausó la **residencia**» | «Pausó su especialidad» | `types.ts:213` | Único resto en texto visible; el archivo lo veta en `:171` y `:214` ya dice «Terminó la especialidad» |
| Casos | Casos **clínicos** | `types.ts:1014` | ⟳ **No es gratis**: `src/lib/edu/__tests__/edu-casos.test.ts:529` hace `assert.match(src, /casos: "Casos"/)` sobre el fuente de `types.ts`. Barre el resto de `assert.match(src, …)` antes de tocar cualquier literal |
| Expediente | Historia clínica / Notas clínicas | `pacientes/[id]/layout.tsx:168` | El grupo de permisos ya es «Expediente clínico» (`permissions.ts:405`) |
| Estudios | Estudios **de imagen** | `pacientes/[id]/layout.tsx:177` | El permiso ya lo desambigua (`permissions.ts:140`) |
| Procedimientos | **Catálogo de** procedimientos | `types.ts:1033` | ⛔ **No** a «Tratamientos»: `TRATAMIENTO` ya es el tipo de cita visible (`types.ts:335`) |
| Equipo | Cuentas del instituto | `types.ts:1034` | En una clínica «equipo» es el equipamiento — el plano tiene un grupo literal «Equipo Dental» (`src/lib/floor-plan/elements.ts:16`) |
| Requisitos | Requisitos **del plan de estudios** | `types.ts:1037` | El permiso ya lo dice completo (`permissions.ts:218`) |
| Evaluación | Evaluación **académica** | `types.ts:1035` | El grupo de permisos ya se llama así (`permissions.ts:472`) |
| Tarifarios | Listas de precios | `types.ts:1032` | La pantalla ya usa «Listas de precios» dentro (`tarifarios-screen.tsx:108`) |
| Categoría | **Área clínica** | `procedimientos-screen.tsx:88` + gemelo `:108` | Es el eje con el que se miden los requisitos |
| Duración | Duración **en el sillón** | `procedimientos-screen.tsx:89` + gemelo `:113` | El formulario ya lo dice (`:291`); choca con semestres (`estructura-screen.tsx:112`) y días (`recetas-screen.tsx:582`). **+ `--edu-cols`** |
| Análisis (SOAP) | Análisis — impresión diagnóstica | `caso-acciones.tsx:504` | Los otros tres campos sí llevan glosa (`:480,:492,:516`) |
| **⟳ «Se exige»** | **«Semestres en que se espera»** | `requisitos-screen.tsx:132` + gemelo `:165` | ⛔ **El borrador proponía «Obligatorio para titularse» y era FALSO**: esa columna pinta el **rango de semestres**, no la obligatoriedad (`requisitos-screen.tsx:165-172`; `prisma/schema.prisma:14590-14593`: «no filtran a qué alumnos les aplica: dicen PARA CUÁNDO se espera»). No existe hoy una columna de obligatoriedad; si se quiere, es una columna nueva y entonces es ODO-02 |
| **⟳ «Qué cuenta»** | «Qué cuenta como cumplido (procedimiento, área o cualquier caso)» | `requisitos-screen.tsx:130` + gemelo `:150` | Soporta **tres** modos (`evaluacion-core.ts:342-347`); «Qué procedimiento cuenta» mal-rotula dos de los tres |
| **⟳ «Cuántos»** | **«Cantidad exigida»** | `requisitos-screen.tsx:131` + gemelo `:160` | ⛔ No «Casos exigidos»: ODO-02 hace que ese número deje de ser casos. El rótulo se compone con la unidad del requisito |
| Para / Escala / Usada en | Especialidad a la que aplica / Escala de calificación / Casos calificados con ella | `rubricas-screen.tsx:127-130` + gemelos `:143,149,164` | «Para» es una preposición suelta |
| Cómo va / Horas / Promedio | Semáforo / Horas **clínicas** / Promedio de calificaciones | `evaluacion-screen.tsx:352-355` + gemelos `:377,403,408` | `:403` ya dice «Horas clínicas»: el gemelo ya diverge |
| Entrada / Salida (IA) | Tokens de entrada / de salida | `ia-screen.tsx:243-244` + gemelos `:262,268` | En un panel con caja se leen como movimientos de dinero |
| Función / Sobre qué / Consumo | Herramienta de IA / Paciente o estudio / Consumo | `ia-screen.tsx:298-300` + gemelos `:317,324,328` | Rótulos de log |
| Dirección (campo de sede) | Calle y número | `sedes-screen.tsx:354` | Choca con el rol «Dirección» (`types.ts:161`) y el menú (`:1001`) |
| Contacto | Teléfono y correo | `pacientes-screen.tsx:229` | Choca con «Contacto de emergencia» de los antecedentes |
| Lo trajo | Estudiante que lo refirió | `pacientes-screen.tsx:158` | El permiso ya lo dice bien (`permissions.ts:58`) |
| «Aquí no hay nada que mostrarte» | Nombra la entidad | **12** pantallas: `autorizaciones/page.tsx:65`, `caja/page.tsx:61`, `caja/corte/page.tsx:48`, `caja/planes/page.tsx:62`, `caja/planes/[id]/recibo/page.tsx:51`, `evaluacion/page.tsx:64`, `evaluacion/[id]/page.tsx:60`, `facturacion/page.tsx:61`, `facturacion/datos-fiscales/page.tsx:51`, `ia/page.tsx:64`, `pacientes/[id]/pagos/page.tsx:46`, `pacientes/[id]/recetas/page.tsx:48` | El producto ya lo hace bien en **12** («Aquí no hay citas que mostrarte», `agenda/page.tsx:96`) |
| ESPERA y ESPERA_LARGA con la **misma** etiqueta | «Esperando docente» / «Esperando docente hace rato» | `direccion-core.ts:560-561` | Los dos estados existen para distinguirse (`:566-570`) y en pantalla se leen igual. ⚠️ Esta tabla va al CSV (`:1044`) |
| **⟳ 8 formas de «sin docente»** (no 4) | «Sin docente titular» | `agenda-modales.tsx:302,469,644` · `tamizaje-screen.tsx:310` · `paciente-acciones.tsx:395` · `casos-screen.tsx:341` **y `casos-core.ts:383` (celda de CSV)** · `mi-dia-screen.tsx:136` · `plano-screen.tsx:670` · `direccion-screen.tsx:605,680` · `padron-screen.tsx:330` · `pacientes/[id]/page.tsx:133` · `direccion-core.ts:924,1191` | Dirección cree que son ocho problemas distintos |
| 5 nombres para la relación docente↔estudiante | «Docente titular» (vigente) y «Docente de la cita» | `agenda-modales.tsx:294` · `tamizaje-screen.tsx:302` · `padron-screen.tsx:281,818` | Son **dos** conceptos tras cinco nombres; el tablero lo explica por escrito (`direccion-screen.tsx:631,636-637`) |
| **⟳ «Estado» en 15-16 archivos** (no 9) | Cualificar por entidad | `casos-screen.tsx:312` · `pacientes-screen.tsx:230` · `caja-screen.tsx:343` · `padron-screen.tsx:280` · `agenda-modales.tsx` · `plan-recibo.tsx:143` · `planes-screen.tsx:268,380,507` · `direccion-screen.tsx:759,813` · `equipo-screen.tsx:414,454` · `bitacora-screen.tsx:280,310` · `facturacion-screen.tsx:235,277` · `ia-screen.tsx:433` · `estructura-screen.tsx:115` · `docentes-screen.tsx` · `pacientes/[id]/datos/page.tsx` · y `sedes-screen.tsx:382` (= entidad federativa) | 29 apariciones en 15-16 archivos. **Renombrar 4 de 16 empeora**: decide los 16 o marca la fila como no cerrada |
| «Dar de alta» = crear | «Registrar» / «Agregar» | `equipo-screen.tsx:732` · `sedes-screen.tsx:302` · `sillones-screen.tsx:273` · `permissions.ts:49,62,168,241` | ⛔ En un producto clínico «dar de alta» no se pisa: `types.ts:245` y `:619` ya la usan para terminar el tratamiento |
| **⟳ Comentario desactualizado** | Actualizarlo | `src/app/instituto/(panel)/padron/page.tsx:24-27` | Dice que la pantalla «se LEE "Alumnos"» y hoy se lee «Estudiantes» (`types.ts:1022`, fijado por `edu-cierre.test.ts:165`). Es el único «Alumnos» que queda en el vertical, y está en el archivo que documenta la decisión |

**Choques de palabra que valen más que media tabla:**

- **«En tratamiento» es la etiqueta visible de tres enums distintos** — paciente (`types.ts:244`), caso
  (`:295`) y cita (`:374`). En la misma ficha, tres columnas dicen lo mismo y significan tres cosas.
- **«Alta»** significa crear en ≥8 rótulos y terminar el tratamiento en dos (`types.ts:245,619`).
- **⟳ «Sesión» es un choque a tres bandas**, no a dos: la etapa de autorización (`types.ts:618`), la
  descripción del tipo de cita («Sesión de trabajo en el sillón», `types.ts:341`) y la sesión de acceso
  (`edu-shell.tsx:332`).
- **«Plan»** es el plan de tratamiento (`types.ts:616`) y el plan de pagos (`plan-recibo.tsx:104`).

### 3.3 Toca datos, ruta o clave — mide antes de cambiar

| Superficie | Coste real | Recomendación |
|---|---|---|
| `?alumno=` en **Casos** (`casos-core.ts:225,242`) | **Bajo.** Query-param; rompe enlaces guardados y el `href` de exportar CSV. ⟳ Y hay que tocar además los **cuatro endpoints** que lo leen y que el borrador no listaba: `api/instituto/casos/route.ts:25`, `api/instituto/calificaciones/route.ts:32`, `api/instituto/evaluacion/route.ts:29`, `api/instituto/traspasos/route.ts:21` | **Cámbialo**: escribe `estudiante`, lee las dos (`sp.estudiante ?? sp.alumno`) en los cinco sitios. Es el único resto de «alumno» que una persona lee y **no** está congelado |
| `?alumno=` y `?programa=` en **Agenda** (`agenda-rejilla.ts:826-827,841-842,859-860`) | **Alto.** Congeladas a propósito (`agenda-rejilla.ts:814-819`: hay enlaces en los correos de la escuela) y fijadas una por una por `__tests__/edu-agenda-rejilla.test.ts:1154-1159` | **No renombres.** A lo sumo acepta sinónimos **al leer** |
| `?programa=` vs `?especialidad=` | Medio. Padrón y Agenda leen `programa` (`padron-core.ts:218`, `agenda-core.ts:735`, `api/instituto/casos/route.ts:24`); Casos, Evaluación y Dirección leen `especialidad` (`casos-core.ts:224`, `evaluacion/page.tsx:89`, `direccion-core.ts:222`) | El mismo filtro tiene dos nombres. Unifica **leyendo las dos** |
| Ruta `/instituto/agenda/tamizaje` + `POST /api/instituto/tamizaje` | Medio. Toca ruta de pantalla y de API; no toca el enum ni ningún dato. ⟳ Y **rompe `npm run test:edu`**: `src/lib/edu/marketing.ts:202` cita `src/app/api/instituto/tamizaje/route.ts` en `verifiedIn`, y `edu-landing.test.ts:131` comprueba con `existsSync` que el archivo exista. Un redirect de Next no lo arregla: se comprueba el fichero en disco | Renombra a `/valoracion` **con redirect y actualizando `marketing.ts:202`**, o déjalo |
| Ruta `/instituto/padron` | Medio. Decisión ya tomada y escrita (`types.ts:1015-1021`) | Se queda. Actualiza el comentario de `padron/page.tsx:24-27` (§3.2) |
| Claves `padron.view` / `padron.manage` | **⟳ Alto, y el borrador describía el riesgo AL REVÉS.** Se pintan literalmente (`equipo-screen.tsx:681`, `edu-denied.tsx:30`). `getEduEffectivePermissions` filtra las claves desconocidas y, **si el override se queda vacío, cae al default del rol** (`permissions.ts:983-991`). O sea: una cuenta de DIRECCION restringida a mano a `["padron.view"]` **recupera TODOS los defaults de DIRECCION** — `equipo.manage`, `caja.*`, `direccion.panel` — en silencio. Es **escalada de privilegios**, no denegación | Si se hace: SQL de migración de overrides **antes** del deploy, más los asserts de las rutas, más un test que falle si un override no vacío se vacía al filtrar. Un solo override sin migrar ya es una cuenta elevada |
| Keys del detalle de Dirección: `cobrado-alumno`, `pacientes-sin-alumno`, `alumnos-sin-docente`, `tamizajes` | **Bajo.** Viajan en un `fetch` interno `?que=` (`direccion-screen.tsx:214`), nunca en la barra de direcciones. Los títulos ya dicen «estudiante» y «Valoraciones» (`direccion-core.ts:911,918,923,924`) | Cámbialas |
| Enum `EduRole.ALUMNO` | **Muy alto.** `ALTER TYPE` de Postgres. (El literal aparece ~124 veces en `src`, 17 fuera de tests y 7 son comparaciones reales.) Beneficio visible: **cero** — `EDU_ROLE_LABELS` ya devuelve «Estudiante» (`types.ts:163`) | **No se toca.** Decisión escrita en `types.ts:172-174` |
| `EduProgram` / `programId` / `programName` | **Muy alto.** >300 apariciones solo en `src/lib/edu/*.ts` (318 hoy) | **No se toca.** Decisión escrita en `types.ts:1023-1027` |

**⚠️ Tres trampas que un barrido de vocabulario por regex tocaría, y no debe:**

1. **`EduConsentSlot = "alumno"`** (`consentimientos-core.ts:536`; su hermano
   `EduConsentContrafirmante` está en `:399`) se mete literalmente en la ruta del PNG de la contrafirma:
   `${institutionId}/consentimientos/${consentId}/${slot}.png` (`:556`). Renombrarlo deja **huérfanas las
   firmas de consentimientos ya firmados** — documentos legales — y la columna seguiría apuntando a
   `.../alumno.png`. Es el string que parece más barato y es el más caro.
2. **`ALIAS_DE_ROL: alumno/alumna/residente → ALUMNO`** (`equipo-core.ts:147-150`) es tolerancia de
   **entrada** para importar equipo desde una hoja de cálculo. Quitarlo rompe importaciones reales.
   Igual con `EDU_DICTADO_HINT` (`ia-core.ts:727-732`): «residente» ahí es lo que la gente **dice**.
3. **⟳ `EDU_SEVERIDAD_LABELS`** (`ia-core.ts:775-787`) tiene la forma exacta de una tabla de etiquetas,
   pero sus **claves no son un enum de Prisma**: son el string crudo que devolvió el modelo de IA y que
   **ya está guardado** en `EduStudyAnalysis.severity` y dentro del Json `findings` (`ia.ts:611-614,647,651`).
   Los alias en español (`alta`/`media`/`baja`) existen porque hay filas viejas con esos valores. Tocar una
   clave deja los análisis históricos como «Sin clasificar» (`:789-791`), y el mapeo está **duplicado a
   mano** en `eduSeveridadTag` (`:795-800`): arreglado en un sitio y no en el otro, pierde el color en
   silencio.

Y dos familias más que un regex rompe **sin error**: los pares `htmlFor`/`id` con vocabulario dentro
(`agenda-modales.tsx:188/192,618/622` · `agenda-screen.tsx:717/721` · `casos-screen.tsx:153/157` ·
`tamizaje-screen.tsx:248/252,271/275` · `paciente-acciones.tsx:271/275,507/511,527/531` ·
`padron-screen.tsx:165/169,506/510,738/742` · `estructura-screen.tsx:510/514`) — cambiar media mitad
desasocia el rótulo del campo y solo lo nota un lector de pantalla; y las clases del tema
(`edu-theme.css:4723,4893,4906,4918,4926,4932,4940`, más `.edu-slot--tamizaje` y
`.edu-ag__cita--tamizaje`) — tocarlas en el `.tsx` sin tocar el CSS deja la pantalla sin estilo.

### 3.4 Lo que ya es dental y funciona — no lo toques

Valoración / Valoración inicial (`types.ts:334,340`) · Estudiante (`:163,1022`) · Especialidad y
generación (`:1028`) · Matrícula, con placeholder `ENDO-2026-01` (`padron-screen.tsx:563`) · Odontograma
(`layout.tsx:174`, `permissions.ts:138-139`) · Sillón y «En el sillón» (`types.ts:373`) · Radiografía /
Tomografía / Fotografía / Modelo 3D con glosas reales («CBCT: la carpeta de cortes DICOM…», `:478-483`) ·
Antecedentes, alergias con placeholder «penicilina, látex, lidocaína» (`antecedentes-card.tsx`) · Nota
clínica Borrador→Enviada→Firmada (`types.ts:420-424`) · SOAP con glosa (`caso-acciones.tsx:480-516`) ·
Carta de consentimiento, contrafirmar, revocar · Receta con cédula profesional · Plan / Procedimiento /
Sesión / Alta como etapas de autorización (`types.ts:615-621`) · Bitácora académica · Rúbrica con
placeholders reales («Aislamiento», `rubricas-screen.tsx:474`; «Dique colocado antes de abrir, sin
filtraciones», `:510`) · Clínica en vivo · Egresado / Baja temporal (`types.ts:203-208`).

### 3.5 [dominio] El vocabulario que todavía no aparece

Conocimiento de dominio sobre posgrados odontológicos en México, **no verificado contra el repo**.
Pares que el producto aún no usa: órgano dentario (OD) para la pieza · superficie
mesial/distal/oclusal/incisal/vestibular/lingual-palatino · cuadrante, sextante, arcada, hemiarcada ·
**cuota de recuperación** en vez de precio o tarifa · beca / condonación en vez de descuento · **aval del
docente** (después del acto) distinto de **autorización** (antes) · turno clínico como unidad real, no la
cita de 30 minutos · profilaxis ≠ raspado y alisado radicular (se cotiza por cuadrante y cuenta como
requisito distinto) · exodoncia simple ≠ quirúrgica · tercer molar retenido/incluido · provisional ≠ caso
terminado · «terminado, pendiente de control» como tercer estado · alta clínica ≠ abandono del paciente ·
egresado ≠ titulado ≠ certificado por consejo · interconsulta (interna) ≠ referencia y contrarreferencia
(hacia fuera) · ASA I-VI como riesgo médico.

---

## 4. Brechas odontológicas

**Nivel de reutilización:** *puro* = solo props y callbacks, se importa tal cual · *parametrizable* = una
prop de endpoints sustituye N literales (precedente: `DicomSetViewer` recibió `endpoints?` en `:106` con
fallback dental en `:349-350`, y está declarado en `scripts/edu-guard.cjs:132`) · *no reutilizable* =
habría que reescribir la capa de datos.

| Módulo | Instituto | Qué falta | Reuso | Acoplamiento a romper | Esfuerzo |
|---|---|---|---|---|---|
| Odontograma (dibujo, 45 hallazgos, FDI) | **SÍ** | Nada. Es el precedente vivo | **puro** | Ninguno: `odontograma-screen.tsx:43-56` importa 6 piezas y `odontograma-core.ts:31` el catálogo; los dos archivos acoplados (`App.tsx`, `adapter.ts:10`) **no** se importan | hecho |
| Expediente SOAP | **SÍ** | Nada estructural; el vertical va por delante con `eduClinicalScope` (`expediente-core.ts:51`) y corrección por nota nueva (`prisma/schema.prisma:13404`) | puro | — | hecho |
| Consentimientos | **SÍ** | Nada como emisión. ⟳ Sí falta **releer la carta firmada** (ODO-36). Va por delante: dos contrafirmas y el bloque «quién te va a atender» (`consentimientos-core.ts:32-45`) | puro | Solo `uploadSignature` queda fuera (bucket del dental) | hecho / ODO-36 |
| Visores CBCT / DICOM / 3D | **SÍ** | Solo la **miniatura**: los no-imagen se pintan con icono genérico (`estudios-screen.tsx:196-211`) | puro / parametrizable | ⟳ `Model3DThumbnail.tsx:240-248` recibe props limpias y acopla **tres** módulos del dental, no uno: `useT` (`:19`), `@/lib/dicom-cache` (`:20`) y `@/lib/thumb-cache` (`:21`). Los dos últimos son puros de navegador (thumb-cache sin imports) y no estorban | bajo |
| **Periodontograma** (rejilla 6×32, BoP, O'Leary, estadificación 2017, riesgo de Berna) | **NO** | Modelo `EduPeriodontalRecord`, endpoint de upsert por sitio y contenedor. La rejilla y toda la aritmética se importan | **puro** | `PeriodontogramGrid.tsx:25-43` es props+callbacks; su árbol (Grid → ToothColumn → SiteCell/ToothCenter + reducer, más `schemas`/`site-helpers`/`periodontogram-math` y `use-debounced-callback`) no toca `src/app/actions/periodontics`, ni `canAccessModule`, ni fetch, ni `useT`, ni prisma en runtime. Matiz: `site-helpers.ts:3` → `./types`, que es `import type { Prisma }` — type-only, se borra en build. ⚠️ **Pero vive dentro de `src/components/specialties/periodontics/` y su único consumidor hoy es `PeriodonticsTab.tsx:132`, la pestaña vetada** → §10 pregunta 3 | medio |
| Historial del odontograma (snapshot + diff) | **NO** | Modelo, escritura al completar la cita y el mapeo hallazgo→procedimiento | **⟳ copiable, no importable** | La **función** `diffSnapshots` (`src/lib/odontogram/snapshot.ts:75`) es pura, pero su **módulo** abre con `import "server-only"` (`:1`) y `import { prisma }` (`:2`): importarlo desde edu tumba la build. Se copia. ⚠️ Y del mismo archivo **no** se copia nada más: `DENTAL_CATALOG_SEED:111` trae precios de clínica privada, y `CONDITION_TREATMENT_CODE:122-130` mapea a códigos globales (`ODO_RESINA`, `ODO_ENDODONCIA`) que en el instituto **no existen** — allí el catálogo es `EduProcedure.code`, la clave que cada escuela usa en sus papeles (`prisma/schema.prisma:13634-13637`) | medio |
| Diagnóstico codificado CIE-10 | **NO** | Una columna en `edu_records` (§6.1 hueco 3) y un buscador | parametrizable | `Cie10Code` **no tiene `clinicId`** (`prisma/schema.prisma:1866-1875`): catálogo global de la SSA, sin fuga de tenant. El hook `use-coded-diagnoses.ts` trae 5 rutas literales (`:45,54,64,101,119`) → prop `endpoints` + declararlo compartido. ⚠️ ⟳ **El buscador es otro archivo**: `src/components/dashboard/clinical/cie10-selector.tsx:69` pega contra `/api/catalogs/cie10`, cerrada con `getCurrentUser()` del **dental** (`route.ts:14`). Lo barato es una ruta propia bajo `/api/instituto/` (prefijo propio, cero guardia) y un selector propio | bajo-medio |
| Cuestionario de salud estructurado | **PARCIAL** | El cuestionario y su caducidad. Hoy son 3 listas de texto separadas por comas | **puro** (el módulo) / **⟳ no** el esquema | `src/lib/health-questionnaire.ts` tiene **cero imports**: `PADECIMIENTOS:35-52` (16 ítems, con bifosfonatos y anticoagulantes), `RISK_FLAG_LABELS:80-96` (10 banderas), `computeRiskFlags:104-119`, `STALE_AFTER_MONTHS:16`, `HEALTH_QUESTIONNAIRE_VERSION:13`. ⚠️ El **modelo** del dental no se calca: no tiene relaciones Prisma «para NO editar esos modelos y evitar colisiones» y su SQL trae una **RLS deny-all** (`prisma/schema.prisma:7822-7832`) | medio |
| Alertas clínicas calculadas | **PARCIAL** | Solo las banderas derivadas. El instituto va **por delante**: sus chips viven en el **layout** de la ficha (`layout.tsx:266-285`) y distinguen «sin registrar» de «no refiere» | puro | Va pegado al cuestionario | bajo |
| Plantillas de nota SOAP e indicaciones | **NO** | Un selector sobre los cuatro textarea | **puro** | `src/lib/clinical/soap-templates.ts` e `indication-templates.ts` tienen **cero imports**. ⚠️ El que **no** sirve es `src/components/clinical-shared/EvolutionTemplatePicker.tsx:7` (server action). ⛔ No confundir con `src/components/specialties/implants/EvolutionTemplatePicker.tsx`, homónimo y fuera de alcance | bajo |
| Fotografía clínica y comparador antes/después | **NO** | Etapa (pre/durante/post/control), pieza FDI y el comparador | **puro** (4 de 6) | ⟳ `src/components/clinical-shared/photos/{PhotoCompare,PhotoCompareSlider,PhotoTimeline,PhotoLightbox}.tsx` se importan tal cual, pero **no «solo importan tipos»**: traen el valor `STAGE_LABELS` y `PhotoTimeline.tsx:6` importa `ClinicalPhotoStage` de `@prisma/client`. ⚠️ Y el DTO que consumen exige `module: ClinicalModule` y `photoType: ClinicalPhotoType` (`src/lib/clinical-shared/photos/types.ts:7-20`), **dos enums del dental**; `ClinicalModule` son las 5 especialidades vetadas + `general` (`prisma/schema.prisma:6725-6734`). Los 2 que no sirven importan server actions (`ClinicalPhotoGallery.tsx:13-16`, `PhotoUploader.tsx:11`). ⛔ Homónimos fuera de alcance en `specialties/{implants,orthodontics}/` | medio |
| Recetas | **PARCIAL** | (a) catálogo de medicamentos — texto libre **a propósito** (`prisma/schema.prisma:15753-15758`); (b) el **chequeo de contraindicaciones**; (c) QR de verificación | puro (plantillas) / no reutilizable (chequeo) | ⟳ El chequeo del dental **no se importa ni se extrae**: `SYSTEM_PROMPT` (`api/prescriptions/check-contraindications/route.ts:29`) y `CHECK_TOOL` (`:41`) viven dentro de una ruta **prohibida** para el guardia, y «extraerlos» significaría editarla. Se **copia** a `src/lib/edu/`. Y ahí no hay ninguna tabla de cruces fármaco↔alergia: solo un prompt y un veredicto `["OK","PRECAUCION","CONTRAINDICADO"]` (`:59-61`) | medio |
| Análisis de imagen con IA — modos | **PARCIAL** | Una columna `measurements Json?` en `EduStudyAnalysis` y el selector de modo. Hoy edu llama solo `getModeConfig("GENERAL")` (`ia.ts:511`) | **puro** | Ya se importa sin adaptador (`ia.ts:60`) | bajo |
| Seguimiento por pieza | **NO** | La columna que convierte el odontograma en historial y el historial en evidencia académica | no reutilizable | Es esquema, no componente. Ver §6 | bajo (schema) / medio (UI) |
| Plan de tratamiento y presupuesto | **NO** | El documento que se le presenta al paciente antes de empezar. El gate que decide sobre él (`EduCaseApproval`) **ya existe**; le falta el documento | puro (el cálculo) / no reutilizable (la pantalla) | `src/lib/quotes/compute.ts` es puro (solo `import type`). `src/components/quotes/quotes-tab.tsx` tiene **14 literales de ruta en 13 líneas** más `useT` y `useConfirm`: parametrizarlo cuesta lo mismo que escribirlo | alto |
| Confirmación de cita por el paciente | **PARCIAL** | `EduAppointmentStatus` no tiene `CONFIRMED` ni `confirmToken` (`prisma/schema.prisma:12890-12898`) | no reutilizable | Se copia el **patrón**, no el código: token aleatorio + rate limit — y el vertical ya lo tiene funcionando en la firma pública del consentimiento (`instituto/consentimiento/[token]/page.tsx`) | medio |
| IA clínica de apoyo a la consulta | **NO** | El apoyo que lee odontograma + antecedentes + notas previas. Edu tiene exactamente dos funciones de IA: `["DICTADO","ANALISIS"]` (`types.ts:1106`) | parametrizable (panel) / no reutilizable (contexto) | `ai-consult-panel.tsx` tiene 3 literales (`:39` `useT`, `:57` fetch, `:169` Link). `consult-context.ts:1` es `"server-only"` y lee tablas del dental: se reescribe conservando la **forma** del texto | medio |
| Laboratorio propio (órdenes de trabajo) | **NO** | Todo el módulo. Hoy vive en un cuaderno; lo único que existe es un texto libre en un renglón de cobro (`caja-screen.tsx:1054`) | no reutilizable | `LabPartner` (`prisma/schema.prisma:7007`) y `LabOrder` (`:7032`) cuelgan de `clinicId` y su UI vive dentro de las pestañas de especialidad, que exigen módulo del marketplace | alto |
| Referencia y contrarreferencia | **NO** | La carta hacia **afuera** | no reutilizable | ⟳ Dentro de la escuela el equivalente es el **traspaso**: su mecanismo de **escritura** está bien resuelto (`prisma/schema.prisma:13158-13166`), pero **la lectura no** — ver §5.1 eslabón 11 y ODO-20 | bajo, prioridad baja |

### 4.1 Piezas del dental que ya se importan (la prueba de que son puras)

`odontogram-v2/{OdoDefs,Odontogram,Palette,Legend,DetailPanel,data,types}` + su CSS · `lib/consent/templates.ts` ·
`lib/consent/signature.ts` · `lib/xray/analysis-modes.ts` · `patient-3d/{DiagnosticDisclaimer,Model3DViewer,cbct-lite-shared}` ·
`clinic-3d/world-types` · `floor-plan/{iso-canvas,floor-chrome}` · `ui/signature-pad.tsx`.

### 4.2 Lo que el guardia ya permite tocar

`scripts/edu-guard.cjs:127-150` lista los archivos del dental que el vertical puede **modificar**:
`prisma/schema.prisma` (`:128`), `src/middleware.ts` (`:129`), `ORQUESTA.md` (`:130`), `package.json`
(`:131`), `DicomSetViewer.tsx` (`:132`), `Clinic3DClient.tsx` (`:133`), `live-layer.ts` (`:134`),
`Clinic3DHud.tsx` (`:135`), `src/app/sitemap.ts` (`:142`) y `src/app/admin/admin-nav.tsx` (`:149`).
**`EDU_GUARD_SHARED` solo indulta lo que ya está en esa lista** (bucle de clasificación en `:209-215`);
todo lo demás sale como **PROHIBIDO** con exit 1 y sin ofrecer la línea de declaración. Los cuatro
componentes que recibieron una prop opcional son el precedente a repetir, con default = comportamiento
dental idéntico (`scripts/edu-guard.cjs:96-126`).

`docs/audits/EDU_*.md` es ruta **propia** del vertical (`matchesOwnPattern` en `scripts/edu-guard.cjs:75-86`),
así que este informe pasa el guardia sin declarar nada.
---

## 5. Brechas como panel universitario

### 5.1 La cadena clínico-operativa: dónde se rompe

| Eslabón | ¿Cubierto? | Dónde se rompe |
|---|---|---|
| 1 · Ingreso del paciente | Sí | No se rompe. Nace `NEW` con folio y con quién marcó su origen |
| 2 · Antecedentes | Sí | Los chips viven en el layout de la ficha… y **no llegan al sillón**: `/mi-dia` no los pinta ni enlaza (grep `Link` sobre `mi-dia-screen.tsx` → 0) |
| 3 · Cita de valoración | Sí | No se rompe: la cita de TAMIZAJE nace sin caso a propósito (`agenda.ts:755`) |
| 4 · Valoración → asignación | **Parcial** | Dos roturas. (a) **Navegación**: el único enlace vive en `/instituto/agenda` (`agenda/page.tsx:149-153`), que **redirige a `/mi-dia`** a todo alcance recortado (`:86`) — o sea al DOCENTE, que es justo quien trae `casos.assign`. (b) **Contenido**: no valora, asigna |
| 5 · Plan de tratamiento | **Parcial** | El plan no es un objeto: es una nota SOAP y lo que lo convierte en plan es elegir la etapa PLAN al mandarla a firma (`autorizaciones-core.ts:90-98`) |
| 6 · Autorización del docente | **Sí — la pieza mejor construida** | El gate solo cierra **dos** puertas: `{IN_TREATMENT:"PLAN", COMPLETED:"DISCHARGE"}` (`autorizaciones-core.ts:429-434`). PROCEDURE y SESSION se piden y se firman pero **no bloquean nada**. Y `signatureUrl` existe (`prisma/schema.prisma:14109`), el endpoint la acepta (`api/instituto/autorizaciones/[id]/route.ts:49`) y **ninguna pantalla la manda** (grep en `src/components/edu/` → 0) |
| 7 · Consentimiento | Sí como documento, **no** como eslabón | No gatea nada: un caso pasa a IN_TREATMENT sin una sola carta firmada (grep `Consent` en `casos.ts`, `autorizaciones*.ts`, `agenda.ts` → 0) |
| 8 · Ejecución en el sillón | **Parcial** | Se registra **cuándo** y no **quién**: `eduAppointmentStamps` devuelve solo tres fechas (`agenda-core.ts:560-580`) y el vertical no tiene AuditLog (`grep -rn "AuditLog" src/lib/edu` → 1 acierto y es un comentario sobre el AuditLog **del dental**, `autorizaciones-core.ts:62`). El `supervisorUserId` es un plan editable sin historial (`agenda.ts:891-908`) |
| 9 · Nota firmada | Sí en la regla, parcial en el flujo | La regla NOM-004 está bien puesta. Lo roto es el enganche: `EduRecord.appointmentId` existe con índice (`prisma/schema.prisma:13380`), el POST lo acepta (`expediente.ts:399-412`) y **ninguna pantalla lo llena** — ni «Nota nueva» (`expediente-screen.tsx:563-570`) ni «Registrar sesión» (`caso-acciones.tsx:127-131`) |
| 10 · Cobro | **No como continuación** | `EduCharge` no tiene `appointmentId` (grep en `caja.ts` → 0) y quien ejecutó el acto no puede iniciarlo: DOCENTE y ALUMNO no traen `caja.charge`. Caja reteclea sin ver el caso |
| 11 · Traspaso | Parcial | El mecanismo de **escritura** es correcto (cierra TRANSFERRED, abre uno nuevo, mueve citas futuras, corta el acceso del saliente). Lo roto es la **lectura**: `transferredFromCaseId` nunca amplía el alcance clínico, así que el estudiante que **recibe** el caso ve **cero** notas de lo que ya se le hizo. El propio schema promete lo contrario: «Este enlace es lo que permite leer la historia completa desde el caso nuevo» (`prisma/schema.prisma:13158-13160`) |

**Preguntas concretas, contestadas:**

- **¿La supervisión deja rastro de quién estuvo en el sillón?** **No.** Hay tres rastros parciales
  (`EduSupervisorAssignment` = titularidad administrativa; `EduCase.supervisorUserId` = titular al abrir;
  `EduAppointment.supervisorUserId` = docente **planeado**, editable, sin historial) y ninguno es
  presencia. El propio producto lo escribe en el panel: «No es presencia física: el producto no la
  registra» (`direccion-screen.tsx:631`; la redacción hermana está en `direccion-core.ts:20-21`).
- **¿Qué se firma y qué se hashea?** El **texto canónico** con la versión `edu-approval/v1` dentro,
  normalizado CRLF→LF + NFC + trim, sha256 hex (`autorizaciones-core.ts:286-345`,
  `autorizaciones-hash.ts:35`). El hash se **recalcula al firmar** sobre lo que el docente tiene delante
  (`autorizaciones.ts:1012-1033`); si el contenido cambia, la autorización pasa sola a EXPIRED
  (`prisma/schema.prisma:14051-14052`). Cubre nota, cita y receta. **Nunca cubre el odontograma.**
- **¿Un paciente puede tener varios estudiantes a la vez?** Sí en el modelo (un caso por especialidad,
  `prisma/schema.prisma:13096-13103`), **no** como interconsulta: no hay forma de pedir opinión, ni de ver
  los casos hermanos. La pantalla lo dice con todas sus letras (`pacientes/[id]/casos/page.tsx:135-149`).
  Comparten odontograma, estudios y antecedentes **sin saberlo**.
- **¿La nota se puede editar después de firmada?** No. FIRMADA rebota todo, incluso para dirección; la
  corrección es una nota nueva con `correctsId` (`expediente.ts:484-489`, `types.ts:439-446`). Dos columnas
  separadas de autoría: `authorUserId` (quién tecleó) y `signedByUserId` (quién firmó).

### 5.2 La cadena académica: dónde se rompe

- **El requisito solo sabe contar CASOS.** Tres formas: un `procedureId` concreto, una `category` de texto
  libre, o cualquier caso de la especialidad (`requisitos-screen.tsx:418-427`; predicado en
  `evaluacion-core.ts:335-347`, conteo en `:453`). ⚠️ ⟳ Y hay una regla más que cualquier propuesta tiene
  que preservar: `eduCaseCountsFor` **descarta el caso antes de mirar el procedimiento** si su estado es
  `TRANSFERRED` o `ABANDONED` (`evaluacion-core.ts:338`) — un caso traspasado no cuenta para nadie, ni para
  el saliente ni para el entrante. «Tantas endodoncias de molar» **no** se puede: el diente no entra.
  «Tantos cuadrantes de raspado» **no**: la unidad es el caso, y un caso con cuatro cuadrantes vale
  **uno** — la cantidad existe en el dinero (`EduChargeItem.quantity`, `prisma/schema.prisma:13861`) y el
  contador académico **nunca la mira**.
- ⟳ **La fragilidad de la `category` no es la que decía el borrador.** La comparación **sí** normaliza
  espacios y mayúsculas: `caso.procedureCategory.trim().toLowerCase() === req.category.trim().toLowerCase()`
  (`evaluacion-core.ts:343-345`). Un espacio de más no rompe nada. Lo que **sí** rompe: la coincidencia es
  por **texto**, así que un acento o una palabra distinta («Endodoncía», «Endodoncia clínica») desacopla en
  silencio; y renombrar la categoría en el catálogo deja **huérfanos todos los requisitos que la citaban**,
  porque `EduRequirement.category` es una copia de texto y **no una FK** (`prisma/schema.prisma:14610`).
- **La rúbrica es texto genérico configurable**, y el motor está bien resuelto: pesos validados al guardar,
  escala y criterios congelados en cada calificación, hasta 20 criterios. Lo que falta es el **contenido**:
  el producto no trae ni un criterio odontológico. Los únicos que existen en el repo («Aislamiento — dique
  colocado antes de abrir, sin filtraciones», «Conformación», «Obturación») están en **SQL comentado**
  (`sql/edu-ola-6.sql:743-750`), y el seed de demo siembra cuatro genéricos
  (`scripts/edu-seed-demo.ts:953-957`).
- **El catálogo arranca vacío.** El `INSERT` de procedimientos está entero comentado
  (`sql/edu-ola-5.sql:808-821`) y el único catálogo odontológico real del repo (16 procedimientos) vive en
  el sembrador del instituto de **demo** (`scripts/edu-seed-demo.ts:219-236`).
- **Dirección no puede preguntar por una generación.** Sus cuatro filtros son periodo/desde/hasta/
  especialidad (`direccion-core.ts:171-176,197-209`) y llama al loader **sin** generación
  (`direccion.ts:760-766`) — aunque `EduEvaluacionFilters` **sí** la acepta (`evaluacion-core.ts:1303-1329`).
- ⟳ **Ni por una sede.** Lo académico no cuelga de la sede a propósito, pero el selector de sede se pinta
  en las 41 pantallas y solo recorta cinco cosas (`visibility.ts:835-839`): un director con dos campus no
  puede preguntar «¿cómo va el campus sur?» en padrón, evaluación, requisitos, casos, expediente ni
  facturación, y la pantalla no le dice que el selector no aplica ahí → ODO-34.
- **Del docente solo se sabe a cuánta gente supervisa hoy** (`padron.ts:269-274`). Ninguna consulta agrupa
  por `gradedById` — `edu_case_grades` **no tiene índice** por esa columna (`prisma/schema.prisma:14545-14547`).
- **Marcar «Egresado» no comprueba nada.** `padron.ts:684-687` deriva `graduatedAt` y no hay una sola
  llamada a `eduAtrasoVerdict` alrededor.
- **La bitácora no es un documento.** Pantalla y CSV de cinco bloques (`evaluacion.ts:890-1013`), sin folio,
  sin sello, sin firma, y explícitamente sin PDF (`api/instituto/evaluacion/[id]/export/route.ts:16-19`).
  `grep -rniE "kardex|boleta"` sobre `src`, `prisma` y `sql` → **0**.
- ⟳ **Y el dinero del estudiante no existe.** Todo el dinero del vertical cuelga del **paciente**: los seis
  modelos (`EduCharge:13746`, `EduChargeItem:13855`, `EduPayment:13895`, `EduCashSession:13942`,
  `EduInvoice:15510`, `EduPaymentPlan:15852`). Del estudiante no cuelga un peso: `colegiatur` → 0,
  `tuition` → 0, `condonaci` → 0, y los 5 aciertos de `beca` describen el método de pago del **paciente**
  (`facturacion-core.ts:334`, `types.ts:566`). La segunda pregunta diaria de una dirección de posgrado —
  «¿quién debe?»— no se puede contestar → §10 pregunta 9.
- **Lo que sí está muy bien y hay que preservar:** el avance **no se guarda, se cuenta** al preguntar
  (`evaluacion-core.ts:28-33`); `hechos` va topado por requisito (`:923`); el semáforo devuelve `null`
  **con motivo** cuando faltan fechas (`:943-955`); las horas clínicas salen de tres fuentes en cascada con
  tope de 8 h por cita (`:543-591`); la calificación la calcula siempre el servidor en enteros ×100 y nadie
  se califica a sí mismo (`rubricas.ts:700-706,801`).

### 5.3 Las dos deudas del encargo, verificadas

- **La variación de «Cobrado» en centavos: CONFIRMADO, y el arreglo ya está escrito.** La tarjeta usa
  `eduDirVariacion(cobradoCents, cobradoPrevCents)` junto a `value: eduMoney(cobradoCents)`
  (`direccion.ts:1107-1115`), y esa función devuelve los dos números **crudos**
  (`direccion-core.ts:387-405`): bajo un «$3,920.00» aparece «+12 % (350000 → 392000)». Existe
  `eduDirVariacionEn(actual, anterior, "dinero")` (`direccion-core.ts:1386-1407`) y su **único** llamador es
  el armador de series del Inicio (`:1483`). El CSV arrastra el mismo error: la columna «Periodo anterior»
  escribe `c.raw - c.variacion.delta` (`:1056-1069`) mientras «Valor» ya va formateada. Síntoma extra: la
  pantalla decide si algo es dinero **comparando el texto de la etiqueta** (`direccion-screen.tsx:1273`).
- **Las consultas de Dirección: ⟳ el código dice 14, el conteo a mano da 15.** Las citas son exactas:
  grupo 1 = 6 promesas (`direccion.ts:615`), grupo 2 = 6 (`:690`), grupo 3 = 2 (`:760`) y un `await` suelto
  (`:838`) — 6+6+2+1 = **15**, en 4 tandas secuenciales; el comentario del código dice «catorce»
  (`direccion/page.tsx:41-45`). Y hay más: `listEduEvaluacion` añade 5 consultas propias
  (`evaluacion.ts:491,559-578`), así que el panel son ~20 viajes en 5 tandas, y la página encadena antes
  tres awaits más (`direccion/page.tsx:52,74,90,93` — el `:94` **es** el panel, no otra carga).
  **Dos de las tandas no dependen de nada anterior**: `listasConReglaDeAlumno` solo necesita el
  `institutionId` (`direccion.ts:1930-1936`) y `listEduEvaluacion` solo `ctx/programId/now`.
  Los **231 ms** no tienen fuente en el repo (`grep -rn "231" src sql docs --exclude-dir=audits` → 0); lo
  cito como dato del encargo, no verificado aquí.

---

## 6. Modelo de datos

**44 modelos `Edu*`** (`grep -c "^model Edu" prisma/schema.prisma` → 44; el encargo decía ~45) y 23 enums.
De los 44, **exactamente uno** tiene pieza dental.

### 6.1 Los huecos, con su costo

| # | Hueco | Modelo | Qué se vuelve imposible | Costo |
|---|---|---|---|---|
| 1 | **No existe el acto clínico por pieza** | `EduCase` (`:13148` guarda **un** `procedureId` «principal»), `EduAppointment` (no tiene `procedureId`) | «¿Qué piezas se trataron en este caso?» · «¿Cuántas endodoncias lleva el estudiante X?» — hoy se cuentan **casos** (`evaluacion-core.ts:341`) | **Tabla nueva** `edu_case_procedures`. Relleno **parcial y honesto**: el `tooth` no se puede rellenar; el relleno solo copia el `procedureId` del caso con `tooth NULL`. ⚠️ Y la fila de un caso `TRANSFERRED`/`ABANDONED` **no cuenta** (`evaluacion-core.ts:338`) |
| 2 | **El requisito no puede pedir una pieza ni un grupo dentario** | `EduRequirement` (`:14594-14634`); `EduCountableCase` tiene 5 campos y ninguno anatómico (`evaluacion-core.ts:302-309`) | «Tres endodoncias unirradiculares y cinco multirradiculares» — el schema lo pone de ejemplo en `:14597` como si fuera capturable, y solo puede ser el **nombre** del requisito | Columnas nullables + el hueco 1. **Sin relleno**: `NULL` = «cualquiera» = hoy |
| 3 | **Sin diagnóstico codificado** | `EduRecord.diagnostico` es `VarChar(500)` libre (`:13389`); `condition` del odontograma es un id de **dibujo** (`:13457`) | «¿Cuántas pulpitis irreversibles vio la escuela?» · cualquier reporte epidemiológico. `grep -rni "cie10\|cie9\|cieCode"` sobre el vertical → **0** | ⟳ **Elige un diseño y uno solo** (el borrador daba dos): **columna** `cie10Code` nullable en `edu_records` con FK a la tabla **global** `cie10_codes` (`:1866-1875`, sin `clinicId`) — es lo que recomiendo, un diagnóstico por nota. Si se quiere **varios por nota**, es tabla puente con `institutionId` NOT NULL e índice `(institutionId, recordId)`, y ⚠️ el modelo del dental **no es el molde**: `MedicalRecordDiagnosis` (`:2797-2817`) no tiene tenant («multi-tenant via relation»). ⚠️ `cie10_codes` puede estar **vacía** (seed por `src/app/api/admin/seed-cie10/route.ts`) |
| 4 | **El odontograma no tiene versionado** | `EduOdontogramEntry` (`:13447-13477`): sin `deletedAt`, sin `version`, sin bitácora | «¿Cómo estaba la boca al abrir el caso?» · «¿la trató o la borró?» · «¿qué odontograma tenía delante el docente al firmar?» | **Tabla nueva ×2**: bitácora append-only + foto inmutable. ⟳ Del dental se copia la **forma**, no el esquema: `OdontogramSnapshot` (`:1485-1498`) **no tiene tenant** (se aísla por `patientId → Patient.clinicId`) y su `appointmentId` es **`@unique`** (`:1488`), lo que impide varias fotos por cita. La tabla edu lleva `institutionId` NOT NULL con relación en cascada, `@@index([institutionId, patientId, snapshotAt])`, `appointmentId` **sin** `@unique` y `approvalId` nullable |
| 5 | **El catálogo no es odontológico** | `EduProcedure` (`:13628-13667`): 10 campos escalares, ninguno clínico. ⟳ **Sí tiene `code`** (`:13636`, único por instituto en `:13663`); no tiene `programId`, ni piezas aplicables, ni `cieCode`, ni clave SAT propia, ni descripción | El tarifario por especialidad depende de un texto libre; renombrar la categoría deja huérfanos los requisitos que la citaban (`:14610`, copia de texto sin FK). Fiscalmente todo se timbra con la misma clave (`facturacion-core.ts:397-406`) | Columnas nullables. El único punto con decisión humana es `programId`: se captura a mano, y la `category` sigue funcionando igual |
| 6 | **El cobro no sabe qué pieza cobró** | `EduChargeItem` (`:13855-13886`). Contraste: `QuoteItem.toothFdi` del dental (`:7914`) | «El paciente pagó dos obturaciones, ¿cuáles?» · conciliar lo cobrado con el odontograma | Columna nullable. `NULL` = la verdad de todos los cobros anteriores |
| 7 | **Los estudios no se etiquetan por pieza** | `EduStudy` (`:13490-13532`). El dental sí: `PatientFile.toothNumber` (`:2168`), `ClinicalPhoto.toothFdi` (`:6888`) | «Enséñame las periapicales del 36 antes y después» · dosis acumulada por pieza | Columna nullable. **Sin relleno**: el nombre del archivo no es fuente |
| 8 | **El consentimiento no nombra la pieza** | `EduConsent` (`:14261-14265`) | «¿Para qué pieza firmó el paciente?» · comparar pieza consentida contra pieza tratada. Es el hueco de mayor riesgo legal del vertical | Columnas nullables. ⚠️ Si la pieza entra al documento impreso tiene que entrar al **texto canónico** y **subir la versión**, o dos cartas con piezas distintas dan el mismo `contentHash`. Las cartas firmadas **no se tocan** |
| 9 | **La pieza del análisis de IA está sepultada en un Json** | `EduStudyAnalysis`: `severity` y `confidence` **sí** se derivaron a columnas «para filtrar sin abrir el JSON» (`:14199-14201`); la pieza no | El estudio de concordancia IA/estudiante · filtrar por pieza sin parsear cada fila | Columna derivada `teeth INTEGER[]` + índice GIN. **Único hueco con relleno real y automático** |
| 10 | **No hay unidad periodontal** | ninguno. `grep -niE "quadrant\|sextant\|cuadrante\|sextante\|arcada"` sobre el schema → 5 líneas, todas del dental o falsos positivos de «marcada» (una de ellas, `:14332`, cae en el rango Edu y es «marcada») | Índices periodontales por sextante | **Cero tablas** para cuadrante y arcada: se **derivan** del FDI (`odontogram-v2/data.ts:15-40`; en SQL `floor(tooth/10)`). Para sextante, una función pura — y `src/lib/periodontics/sextants.ts` es importable (su único import es `import type`) |
| 11 | **La autorización no congela ni la pieza ni el odontograma** | `EduCaseApproval` (`:14079-14147`); el snapshot canónico son tres tipos, no cuatro (`autorizaciones-core.ts:254-257`) | «El docente autorizó una extracción, ¿de qué pieza?» · el estado EXPIRED existe para que «mando A, firman A, edito a B» no cuele (`:14051-14052`) — pero **si el alumno cambia de pieza el hash no cambia** | **Cero columnas** para la pieza si se cierra el hueco 1: `targetType` es un discriminador de texto **sin FK** (`:14082-14085`). ⚠️ Cambiar el texto canónico cambia **todos** los hashes: sube la versión dentro del texto o cada autorización viva pasa a EXPIRED |

### 6.2 Versionado del odontograma: qué se pierde exactamente

No existe ni snapshot, ni bitácora, ni soft-delete, ni AuditLog (ningún modelo `Edu*` contiene Snapshot,
History, Version o Event; `grep -rn "AuditLog" src/lib/edu` → 1 acierto, y es un comentario sobre el
AuditLog **del dental**, `autorizaciones-core.ts:62`). Las tres operaciones destruyen hacia atrás:

1. **Remarcar** un hallazgo ya marcado hace `update: { recordedById, recordedAt }` (`odontograma.ts:200`).
   El comentario lo justifica bien — pero el efecto secundario es que se **pisa quién lo marcó
   originalmente**, que es literalmente lo que se evalúa en un posgrado.
2. **Quitar** un hallazgo es `deleteMany` (`odontograma.ts:215-217`). Borrado duro, sin `deletedAt`.
3. **Vaciar la nota** de un diente, `deleteMany` otra vez (`:259-262`).

Y **el «historial» de la pantalla no es un historial**: `HistorialDeHallazgos`
(`odontograma-screen.tsx:409-461`) toma las mismas filas actuales y las ordena por `recordedAt` (`:419`).
La pantalla es honesta a medias — avisa «Así estaba al abrir la pantalla» (`:431-433`) — pero el
encabezado afirma «el dibujo enseña el ESTADO; esta lista enseña la HISTORIA» (`:405-406`), y eso no es
cierto: una fila borrada no aparece.

> ⚠️ **La landing vende la historia que no hay.** `src/lib/edu/marketing.ts:327` promete «el odontograma
> del paciente, diente por diente y cara por cara, **con el historial** de lo que se le fue haciendo a lo
> largo de los semestres y de los estudiantes que lo atendieron», con
> `verifiedIn: ["src/lib/edu/odontograma.ts", "src/lib/edu/odontograma-core.ts"]` (`:328`). Los dos
> archivos citados como verificación son exactamente los que hacen el borrado duro. **O se construye el
> historial (ODO-04) o se corrige el texto de la landing.**

El resto del vertical **sí** respeta la regla: `EduRecord` se corrige con nota nueva (`:13401-13404`),
`EduCaseGrade` igual (`:14476-14482`), y una devolución es **otra fila**, nunca un pago borrado ni un monto
negativo (`:13890-13891`, con `isRefund` en `:13904`). El odontograma es la **única** pieza del expediente
que se edita destructivamente.

### 6.3 El catálogo de procedimientos: veredicto

Está bien diseñado para lo que se construyó (cobrar y contar casos) y es insuficiente para lo que un
posgrado necesita. Cerrarlo **no requiere tabla nueva**: son columnas nullables sobre `edu_procedures` más
dos FK. La `category` es texto libre **a propósito** (`:13637-13640`) y esa decisión se respeta: `programId`
se **añade al lado**, igual que el schema ya hizo con `feeScheduleId` + `feeScheduleLabel` (`:13757-13758`).

> **⟳ Regla de tenant que cumple todo el SQL de este informe, corregida.** El borrador decía
> «`institutionId` primero en **todo** índice nuevo» y eso no describe al schema: en el rango `Edu` hay al
> menos nueve índices y uniques que no empiezan por él, varios a propósito (`@@unique([feeScheduleId,
> procedureId])`, `@@index([targetType, targetId])`, `@@unique([rubricId, name])`, `@@unique([userId,
> campusId])`, `@@unique([planId, number])`…). La regla dura, la que no se negocia, es:
> **`institutionId` NOT NULL en toda tabla nueva, con relación a `EduInstitution` en cascada**; e
> `institutionId` **primero en todo índice de LISTADO**. Los uniques que cuelgan de un padre ya
> tenant-scoped no lo llevan — aplicarla al pie de la letra a `edu_case_procedures` estropearía la
> unicidad natural `(caseId, procedureId, tooth, surface)`, y un GIN sobre un array no puede llevarlo
> delante sin `btree_gin`. La doctrina está escrita en `prisma/schema.prisma:14640-14647` y en
> `src/lib/edu/visibility.ts:59-62`. Y la trampa que nombra sigue en pie: en Prisma un
> `institutionId: undefined` **borra el filtro** y devuelve las filas de todos los institutos.

---

## 7. Propuestas priorizadas

**38 propuestas.** Formato: **qué es** · **por qué importa para una escuela** · superficies · esfuerzo ·
¿SQL? · origen (import del dental / prop nueva / código propio) · riesgo · qué se rompe si sale mal.

### Cimiento: la pieza dental

**ODO-01 · El acto clínico por pieza**
Una tabla que registre «a este paciente, en esta sesión, este estudiante hizo **este** procedimiento en
**esta** pieza», en vez de un solo procedimiento «principal» por caso.
*Por qué:* es el hueco estructural del vertical. Sin él, el avance que la escuela enseña en una
acreditación está mal contado en los dos sentidos.
· Superficies: `prisma/schema.prisma` (tabla `edu_case_procedures`), `sql/edu-*.sql` nuevo,
`src/lib/edu/{casos.ts,expediente.ts,evaluacion.ts,evaluacion-core.ts}`,
`src/components/edu/{casos/caso-acciones.tsx,evaluacion/caso-procedimiento.tsx}`,
`src/app/api/instituto/casos/`. · **L** · **SQL: sí** · código propio ·
*Riesgo:* medio-alto. El relleno **no puede** inventar la pieza histórica. ⟳ **Invariante obligatoria:** la
fila de un caso `TRANSFERRED` o `ABANDONED` **no cuenta** para nadie — la regla vive hoy en
`evaluacion-core.ts:338` y hay que reimplementarla sobre la tabla nueva, o el avance de una generación
**sube solo** el día del deploy en cuanto haya un traspaso. El test de no-regresión compara el avance
antes/después sobre un instituto con al menos un traspaso. · *Si sale mal:* el conteo de requisitos cambia
bajo los pies de una generación en curso.

**ODO-02 · Requisitos en unidades odontológicas**
El requisito gana una **unidad** y un filtro por grupo dentario, arcada y dentición; el contador suma
unidades en vez de contar filas.
*Por qué:* un plan de posgrado dice «12 cuadrantes de raspado» y «tres endodoncias unirradiculares», no
«12 casos». · Superficies: `prisma/schema.prisma` (`edu_requirements`), `sql/` nuevo,
`src/lib/edu/{evaluacion-core.ts:289-347 y :447-496, evaluacion.ts:395-421}`,
`src/components/edu/evaluacion/requisitos-screen.tsx:414-479`, `src/app/api/instituto/requisitos/`. ·
**M** · **SQL: sí** · código propio ·
⟳ **La unidad NO es un enum de Postgres.** Es `unitKind VARCHAR` nullable (`NULL` = CASO = hoy) validada
contra un **catálogo por instituto** (`edu_requirement_units`: clave, rótulo, si pide
pieza/cuadrante/sextante/superficie, si se cuenta por sesión o por hora), sembrado con las unidades
odontológicas habituales y editable desde `/instituto/requisitos`. Motivos: (a) el propio informe documenta
que a Requisitos le faltan **horas, seminarios y presentaciones**, y ninguna cabe en un enum de cuatro
valores; (b) faltarían **sextante** y **superficie**, que son la unidad de cobro y de conteo de periodoncia
y operatoria; (c) ampliar un enum `Edu` es un `ALTER TYPE ... ADD VALUE` — precedente real: `MODELO_3D`
(`prisma/schema.prisma:13347-13351`) — en la tabla que decide graduaciones; (d) el propio schema ya eligió
texto sobre catálogo cerrado por esta razón (`:13637-13640`).
*Riesgo:* de **producto** más que técnico: cambia el número que un estudiante ve. El default tiene que dar
**exactamente** lo mismo que hoy. · *Si sale mal:* la escuela ve el avance moverse solo. Depende de ODO-01.

**ODO-03 · El catálogo de procedimientos se vuelve odontológico**
Columnas nullables sobre `edu_procedures`: especialidad (`programId`), qué pide el procedimiento (`scope`),
grupos dentarios aplicables, código clínico CIE-9, clave SAT propia y descripción.
*Por qué:* ⟳ **no** porque «un espacio de más rompa el plan» —la comparación normaliza espacios y
mayúsculas (`evaluacion-core.ts:343-345`)— sino porque la coincidencia es por **texto**: un acento o una
palabra distinta («Endodoncía», «Endodoncia clínica») desacopla en silencio, y **renombrar la categoría
deja huérfanos todos los requisitos que la citaban**, porque `EduRequirement.category` es una copia de
texto sin FK (`prisma/schema.prisma:14610`). Y fiscalmente toda endodoncia, ortodoncia y radiografía se
timbran con la misma clave (`facturacion-core.ts:397-406`, fallback duro a `85121600`). · Superficies:
`prisma/schema.prisma:13628-13667`, `sql/` nuevo, `src/lib/edu/{tarifas.ts:766-852, facturacion-core.ts}`,
`src/components/edu/dinero/procedimientos-screen.tsx`. · **M** · **SQL: sí** · import del dental **solo del
catálogo global** `cie9_codes` (`prisma/schema.prisma:2789-2798`, sin `clinicId`; semilla en
`src/lib/seeds/cie9-essentials.ts:20-43`) + código propio ·
⟳ **`scope` habla el mismo idioma que ODO-02**: en vez de un enum de seis valores que se come sextante,
hemiarcada, conducto y sitio, es `VARCHAR` validado contra el **mismo catálogo de unidades del instituto**,
para que «lo que pide el procedimiento» y «en qué unidad cuenta el requisito» no sean dos listas que
alguien tenga que mantener sincronizadas.
*Riesgo:* bajo. `cie9_codes` puede estar **vacía** (`src/app/api/admin/seed-cie9/route.ts`): el campo tiene
que degradar a «sin catálogo», no romper el alta. · *Si sale mal:* nada — todo nullable.

**ODO-04 · Versionado del odontograma: bitácora y foto**
Una bitácora append-only (marcó/quitó, quién, cuándo) y una foto inmutable del odontograma, colgada de la
cita **y de la autorización**.
*Por qué:* hoy quitar un hallazgo lo **borra** y remarcarlo **pisa** la autoría. No se puede distinguir «lo
trató» de «lo borró», ni comparar antes/después. Y la landing ya promete ese historial. · Superficies:
`prisma/schema.prisma` (2 tablas), `sql/` nuevo, `src/lib/edu/{odontograma.ts,odontograma-core.ts}`,
`src/app/api/instituto/pacientes/[id]/odontograma/route.ts`,
`src/components/edu/expediente/odontograma-screen.tsx:409-461`. · **M** · **SQL: sí** (con foto inicial
`reason='MIGRACION'`) · **copia del patrón del dental, no import** ·
⟳ **Se copia la FORMA, no el esquema.** `OdontogramSnapshot` (`:1485-1498`) **no tiene tenant** y su
`appointmentId` es `@unique` (`:1488`), lo que impediría varias fotos por cita — y un caso tiene varias
autorizaciones que pueden caer sobre la misma. La tabla edu lleva `institutionId` NOT NULL con relación en
cascada, `@@index([institutionId, patientId, snapshotAt])`, `appointmentId` **sin** `@unique` y `approvalId`
nullable. ⟳ Y de `snapshot.ts` **no se copia nada más**: `DENTAL_CATALOG_SEED:111` trae precios de clínica
privada y `CONDITION_TREATMENT_CODE:122-130` mapea a códigos globales que en el instituto no existen — el
mapeo hallazgo→procedimiento vive en filas del instituto (`edu_finding_procedure_map`), editable y **vacío
por defecto**: sin mapeo, el hallazgo simplemente no propone procedimiento.
⚠️ **Consumo:** cada foto es un `entries Json`; contra el techo de 5 TB por instituto (§2.6) conviene
fotografiar en los hitos (apertura, autorización, alta), no en cada cita.
*Riesgo:* medio. La historia pasada **no existe** y no se inventa. · *Si sale mal:* el encabezado del
historial seguiría mintiendo — que es el estado de hoy.

**ODO-05 · La autorización nombra la pieza y ancla el odontograma**
`EduCaseProcedure` entra como cuarto tipo de snapshot canónico, con `tooth` y `surfaces`; y la firma guarda
a qué foto del odontograma miró el docente.
*Por qué:* el candado antifraude tiene un hueco **del tamaño de la unidad de trabajo de la odontología**.
· Superficies: `src/lib/edu/{autorizaciones-core.ts:254-345, autorizaciones.ts}`, `prisma/schema.prisma`
(`odontogramSnapshotId` nullable), `sql/` nuevo, `src/components/edu/autorizaciones/bandeja-screen.tsx`. ·
**M** · **SQL: sí** · código propio ·
*Riesgo:* **alto y concreto**. Cambiar el texto canónico cambia **todos** los hashes: hay que subir la
versión que va **dentro** del texto, o **cada autorización viva pasa a EXPIRED de golpe**. · *Si sale mal:*
la escuela se queda una mañana sin poder firmar nada. Depende de ODO-01 y ODO-04.

**ODO-06 · Diagnóstico codificado (CIE-10) al lado del texto libre**
Una columna `cie10Code` nullable en `edu_records` con FK a la tabla **global** `cie10_codes`, y un buscador.
*Por qué:* «¿cuántas pulpitis irreversibles vio la escuela este semestre?» hoy exige leer 4.000 caracteres
por nota. · Superficies: `prisma/schema.prisma:13389`, `sql/` nuevo,
`src/lib/edu/{expediente.ts,expediente-core.ts}`, `src/components/edu/expediente/expediente-screen.tsx`,
⟳ **y una ruta propia `/api/instituto/catalogos/cie10` + selector propio**. · **M** · **SQL: sí** ·
import del dental: `Cie10Code` **no tiene `clinicId`** (`:1866-1875`). El hook `use-coded-diagnoses.ts` se
parametriza con una prop `endpoints` para sus 5 rutas (`:45,54,64,101,119`) — mismo remedio que
`DicomSetViewer`, **y hay que declararlo compartido** en `scripts/edu-guard.cjs`. ⟳ **Pero el buscador es
otro archivo**: `src/components/dashboard/clinical/cie10-selector.tsx:69` pega contra `/api/catalogs/cie10`,
cerrada con `getCurrentUser()` del **dental** (`route.ts:14`) — no funciona con sesión de instituto. Lo
barato es la ruta propia (prefijo propio, cero guardia) y un selector propio.
*Riesgo:* bajo. ⚠️ `cie10_codes` puede estar **vacía** (`src/app/api/admin/seed-cie10/route.ts`): con el
catálogo vacío una FK no «degrada», simplemente no se puede escribir nunca — pinta «catálogo no sembrado»,
no una lista vacía. · *Si sale mal:* el texto libre sigue ahí intacto.

**ODO-07 · La pieza en el consentimiento**
`toothFdi` y `arch` nullable en `edu_consents`, y la pieza dentro de la carta.
*Por qué:* «Extracción» sin decir de qué pieza, en una clínica donde el operador es un estudiante y la
carta lleva tres firmas, es el documento que no protege a nadie el día del error de lado. · Superficies:
`prisma/schema.prisma:14261-14265`, `sql/` nuevo, `src/lib/edu/consentimientos-core.ts`,
`src/components/edu/expediente/consentimientos-screen.tsx`. · **S** · **SQL: sí** · código propio ·
*Riesgo:* **alto si se hace a medias**. Si la pieza entra al documento impreso **tiene que entrar al texto
canónico y subir la versión que va dentro del texto**, o dos cartas con piezas distintas dan el mismo
`contentHash`. Las cartas **ya firmadas no se tocan nunca** (`:14266-14268`). · *Si sale mal:* la firma
deja de anclar el documento.

**ODO-08 · La pieza en el estudio, y las piezas del análisis de IA**
`toothFdi` nullable en `edu_studies`, y una columna derivada `teeth INTEGER[]` en `edu_study_analyses`.
*Por qué:* «enséñame las periapicales del 36 antes y después» es la operación de una escuela de
endodoncia. Y la IA **ya devuelve** la pieza (`ia-core.ts:913`) sin que se pueda consultar. · Superficies:
`prisma/schema.prisma:13490,14199-14216`, `sql/` nuevo, `src/lib/edu/{estudios.ts,ia-core.ts}`,
`src/components/edu/expediente/estudios-screen.tsx`. · **S** · **SQL: sí** · código propio ·
*Riesgo:* bajo. El relleno de `teeth` es el **único** automático y honesto del informe. El de `edu_studies`
**no se rellena**. · *Si sale mal:* nada; todo nullable.

**ODO-09 · La pieza en el renglón del cobro**
`toothFdi`, `surfaces` y un enganche opcional al acto clínico en `edu_charge_items`.
*Por qué:* «Resina ×3» no dice en qué dientes, y cruzar lo cobrado con el odontograma es el control interno
más básico de una clínica escolar. · Superficies: `prisma/schema.prisma:13855-13886`, `sql/` nuevo,
`src/lib/edu/{caja.ts,dinero-core.ts}`, `src/components/edu/dinero/caja-screen.tsx`. · **S** ·
**SQL: sí** · código propio · *Riesgo:* bajo y aislado: el precio congelado, el antifraude
(`clientPriceCents`, `:13875`) y el invariante subtotal − descuento = total no se tocan. · *Si sale mal:*
nada.

**ODO-23 · Plantillas de arranque: catálogo y rúbricas odontológicas**
Un botón «Empezar desde una plantilla» que **instancia filas editables** del instituto por los endpoints
que ya existen.
*Por qué:* una escuela nueva abre `/instituto/procedimientos` y `/instituto/rubricas` y encuentra dos
pantallas en blanco. El contenido **ya está escrito y comentado** en el repo (`sql/edu-ola-6.sql:743-750`,
`scripts/edu-seed-demo.ts:219-236`). · Superficies: nuevo `src/lib/edu/plantillas.ts` (módulo puro),
`src/components/edu/dinero/procedimientos-screen.tsx`,
`src/components/edu/evaluacion/rubricas-screen.tsx:114-122`, reuso de `tarifas.ts:818-852` y
`rubricas.ts:284`. · **M** · **SQL: no** · código propio ·
⟳ **Cuatro reglas, no dos.** (1) De la plantilla cruzan **solo** clave, nombre, agrupación y duración: los
**precios NO** — la fuente del seed de demo trae `publico`/`alumno` por renglón
(`scripts/edu-seed-demo.ts:220-236`) y `createEduProcedure` ni siquiera acepta precio (`tarifas.ts:818-852`),
porque el precio es de la **lista** (`prisma/schema.prisma:13623-13627`). (2) La plantilla **no crea
especialidades**: pregunta a cuál de las del instituto engancha cada bloque — `resolveRubricTargets` exige
que el `programId` sea suyo (`rubricas.ts:226-250`). (3) Se pinta como propuesta **editable antes de
escribir**: eso es lo que separa «plantilla» de «producto a la medida de una escuela». (4) Al escribir,
salta claves y nombres de rúbrica ya usados (409 en `rubricas.ts:270-276`) en vez de reventar, y los pesos
pasan `eduRubricWeightCheck`.
*Riesgo:* bajo si se instancia **siempre** como filas del instituto y nunca como catálogo global de solo
lectura. · *Si sale mal:* un botón que crea una rúbrica que no se puede guardar.

### El piso clínico: cerrar la cadena

**ODO-17 · La nota clínica se ata a la sesión que documenta**
Un selector de cita en el formulario de nota. La columna, el índice y la validación del servidor **ya
existen** (`prisma/schema.prisma:13380`, `expediente.ts:366-411`).
*Por qué:* sin ella no se puede contestar «¿qué se escribió de la sesión del martes?» ni detectar sesiones
COMPLETED sin nota. · Superficies: `src/components/edu/expediente/expediente-screen.tsx:563-570`,
`src/components/edu/casos/caso-acciones.tsx:127-131`, `src/lib/edu/expediente.ts:254`. · **S** ·
**SQL: no** · código propio · *Riesgo:* bajo. ⚠️ Son **dos** caminos de escritura: si tocas solo uno, la
mitad de las notas siguen naciendo huérfanas. · *Si sale mal:* el indicador mide mal.

**ODO-18 · `/mi-dia` deja de ser un callejón sin salida**
La tarjeta del día enlaza al expediente, muestra las alertas médicas y deja cerrar la sesión escribiendo la
nota en el mismo gesto.
*Por qué:* «un alumno a punto de infiltrar anestesia tiene que ver *Alergia: lidocaína* esté donde esté» —
y `/mi-dia` es justo donde está esa persona. · Superficies:
`src/components/edu/clinica/mi-dia-screen.tsx`, `src/lib/edu/{agenda.ts,agenda-core.ts:838-861}`,
`src/lib/edu/pacientes-core.ts:367` (`eduAntecedentesChips`, **sin tocar**). · **S** · **SQL: no** ·
código propio que reusa el módulo puro existente · *Riesgo:* bajo. No abre nada nuevo, pero hay que
respetar «sin antecedentes registrados» ≠ «no refiere», y no pintar el enlace a quien no tiene
`expediente.write`. · *Si sale mal:* se colapsa el tri-estado y un paciente sin historia parece un paciente
sin alergias. Habilita ODO-17.

**ODO-19 · Sellar quién mueve cada estado de la cita**
`checkedInById` / `startedById` / `completedById` en `EduAppointment`, y un acto explícito de confirmación
de supervisión (`supervisedByUserId`, `supervisedAt`) que no se puede reescribir.
*Por qué:* la escuela puede decir a qué hora se sentó el paciente y **no quién lo apuntó**. · Superficies:
`prisma/schema.prisma`, `sql/` nuevo, `src/lib/edu/{agenda-core.ts:560, agenda.ts:1041}`,
`src/app/api/instituto/agenda/[id]/estado/route.ts`, nuevo `.../agenda/[id]/supervision/route.ts`,
`src/lib/edu/direccion.ts:494-512`. · **M** · **SQL: sí** · código propio ·
*Riesgo:* medio. Columna nueva = lectura rota si el `.sql` no se aplica **antes** del deploy.
`eduAppointmentStamps` es puro y lo consume también la rejilla: cambiar su firma toca sus pruebas. Y de
producto: la confirmación debe ser constancia **opcional y visible**, nunca bloqueo. · *Si sale mal:* la
agenda deja de pintar.

**ODO-20 · Herencia de lectura del caso traspasado**
Que quien **recibe** un caso pueda leer, en solo lectura, las notas del caso que recibió.
*Por qué:* es riesgo clínico: hoy el estudiante que hereda a un paciente a mitad de tratamiento ve **cero**
notas de lo que ya se le hizo. El schema promete lo contrario (`prisma/schema.prisma:13158-13160`). ·
Superficies: `src/lib/edu/visibility.ts`, `src/lib/edu/{expediente.ts:213, autorizaciones.ts:665,
recetas.ts}`, `src/components/edu/expediente/expediente-screen.tsx`. · **⟳ L** (no M) · **SQL: no** ·
código propio ·
⟳ **La pasada adversarial reescribió esta propuesta entera. Seis condiciones, no dos:**
1. **Función NUEVA, no ampliar la existente.** `eduCaseScopeWhere` tiene ~25 llamadas y **al menos siete
   son puertas de ESCRITURA** (`autorizaciones.ts:811`, `expediente.ts:312` y `:467`, `recetas.ts:402` y
   `:468`, `caja.ts:455`, `ia.ts:183`). Si el ensanche vive dentro de ella, el que hereda —y el que
   entregó— pueden **escribir** sobre casos ajenos. El helper es `eduCaseReadScopeWhere` y
   `eduCaseScopeWhere` **se queda intacta**; «punto único» significa mismo archivo, no misma función. El
   informe de implementación tiene que enumerar por línea los loaders de **lectura** que la adoptan.
2. **La cadena solo arranca de un caso VIVO.** `eduCaseScopeWhere` **conserva a propósito** los casos
   TRANSFERRED (`visibility.ts:557-562`), así que «mis casos + sus ancestros» le devuelve al estudiante
   **saliente** el caso del que él mismo heredó. Y hay una ruta que entrega expediente por `caseId`
   **sin pasar por la puerta del paciente**: `GET /api/instituto/autorizaciones?caso=<id>`
   (`api/instituto/autorizaciones/route.ts:34-42` → `autorizaciones.ts:665-690`), y lo mismo
   `listEduCaseRecetas` (`recetas.ts:348-360`). El helper debe exigir `status: { not: "TRANSFERRED" }`
   sobre el caso **propio** desde el que se sube la cadena.
3. **Acotar a `scope.kind === "own"`.** El traspaso **no conserva al docente**: el caso nuevo toma el
   supervisor vigente del alumno destino (`traspasos.ts:311-317`). Sin esta guarda, D2 acaba leyendo las
   notas, recetas y firmas de los alumnos de D1 — contra «Nada de otros docentes» (`visibility.ts:18-19`)
   y contra el precedente P1-4 que este mismo informe invoca en ODO-31.
4. **`institutionId` repetido DENTRO de la relación.** Nada en la base impide un `transferredFromCaseId`
   cruzado entre institutos: la auto-relación no lo restringe (`prisma/schema.prisma:13198`). Doctrina
   explícita en `visibility.ts:302-304` y `:856-862`.
5. **Decidir cuántos saltos.** Prisma **no hace cierre transitivo** en un `where`: un solo salto pierde al
   abuelo, y en un posgrado de tres años con rotación anual la cadena de tres eslabones es el caso
   **normal** — o sea, el estudiante de tercero seguiría sin leer lo de primero, que es justo el riesgo que
   esta propuesta dice cerrar. La alternativa (CTE recursivo) sale del `where` de Prisma y pierde la red
   del tenant; el bucle choca con la regla de <7 consultas por `Promise.all`. Si es transitivo: tope de
   profundidad, guarda anticiclo (nada impide A→B→A) e `institutionId` a mano.
6. Las dos guardas del borrador —«mismo paciente», «misma especialidad»— son **no-ops**: `traspasarUno` ya
   las garantiza (`traspasos.ts:277,314-317`). Y el índice citado no lleva tenant:
   `@@index([transferredFromCaseId])` está en `prisma/schema.prisma:13217`, no en `:13215`.
*Riesgo:* **ALTO**. `visibility.ts` es el punto único del vertical. **Pide `revisor` + `refutador`.** ·
*Si sale mal:* un estudiante lee el expediente de un paciente que ya no le toca, y no se nota.

**ODO-21 · Que la valoración valore**
La valoración captura complejidad, urgencia y procedimiento propuesto, y al asignar muestra el **avance**
del estudiante; y el botón de Valoración deja de ser inalcanzable para el docente.
*Por qué:* hoy quien valora elige estudiante a ojo. Peor: el DOCENTE trae `casos.assign` por default, la
pantalla exige esa key, y el **único** enlace vive en `/instituto/agenda`, que redirige al docente a
`/mi-dia` **antes** de pintarlo (`agenda/page.tsx:86,149-153`). · Superficies: `prisma/schema.prisma`,
`sql/` nuevo, `src/lib/edu/casos.ts:737`, `src/components/edu/clinica/tamizaje-screen.tsx`,
`src/app/api/instituto/tamizaje/route.ts`, `src/app/instituto/(panel)/agenda/page.tsx:86,149`,
`src/lib/edu/evaluacion.ts`. · **L** (la parte del enlace, sola, es **S** y vale por sí misma) ·
**SQL: sí** · código propio ·
⟳ **La configurabilidad no queda a decidir: complejidad y urgencia son DOS catálogos por instituto**
(`edu_screening_scales`: clave, rótulo, orden, color), sembrados con una escala de arranque editable y
borrable. Ni enum de Postgres ni constante en `types.ts`. La valoración guarda el **id de la fila del
catálogo**, no una cadena. Es la misma decisión que la casa ya tomó con `scaleMin`/`scaleMax` de las
rúbricas (`prisma/schema.prisma:14408-14410`) y con la `category` libre del catálogo (`:13637-13640`).
Lo que sí es de Rafael es **cuál es la escala sembrada**, no si es configurable.
*Riesgo:* medio. · *Si sale mal:* una escala que no es la de la escuela y que nadie llena.

**ODO-22 · El pase del sillón a la caja**
⟳ **Partida en dos, porque el riesgo del borrador estaba mal identificado.**
*Por qué:* «Cobrado por especialidad» del tablero da **$0 siempre** (`direccion.ts:879-880`), todo cae en
«Cobrado que no se puede atribuir» (`direccion-screen.tsx:829-847`), y el aviso que ofrece la salida
—«colgarle el caso al cobro desde la ficha»— apunta a un flujo **inexistente**:
`PATCH /api/instituto/caja/cobros/[id]` solo cancela (`cobros/[id]/route.ts:30-36`).

- **(a) ⟳ El arreglo del $0 es S, no L.** El servidor **ya sabe** escribir el `caseId`
  (`caja.ts:554,571-574,607`); lo que falta es un campo de caso en el alta de cobro **para DIRECCION**.
  Superficies: `src/components/edu/dinero/caja-screen.tsx`. **S** · **SQL: no** · código propio.
- **(b) El pase como entidad: L, y con un choque que el borrador no vio.** No es «caja ve expediente»
  —eso ya está cerrado: `resolverCaso` descarta el `caseId` de caja **en silencio** (`caja.ts:432-462`)—.
  El choque real es una **intersección vacía**: escribir un cobro exige `charges`=all (lista blanca
  DIRECCION+CAJA, `visibility.ts:113,170-172`) y elegir un caso exige `cases`≠none (CAJA=none, `:183`).
  La intersección es **DIRECCION sola**: quien está en el sillón no puede crear el cobro, y quien está en
  el mostrador no puede elegir el caso. El «pase» es una entidad **tercera** con su `institutionId` y su
  regla de alcance, o no existe. Superficies: `prisma/schema.prisma`, `sql/` nuevo, `src/lib/edu/caja.ts:476`,
  `src/components/edu/{dinero/caja-screen.tsx,clinica/mi-dia-screen.tsx}`. **L** · **SQL: sí**.

⟳ **Dos invariantes obligatorias para (b):**
- **El pase viaja como `{procedureId, quantity, toothFdi?}`, nunca como descripción libre ni con precio.**
  Una línea **sin** `procedureId` es «línea libre» y es la única puerta por la que el cliente fija el precio
  (`tarifas.ts:523-541`, frente a `:546-560` donde lo pone el servidor) — y además no cuenta para ningún
  requisito. Si el sillón no sabe qué procedimiento fue, el pase se queda en borrador.
- **Del cobro salen ids, nunca contenido de caso.** `eduChargeScopeWhere` devuelve `{institutionId}` a
  secas para CAJA, sin guarda anidada sobre `case` ni `appointment` (`visibility.ts:653-663`). Hoy no hay
  fuga porque `CHARGE_SELECT` toma solo `caseId: true` (`caja.ts:113-117`); en cuanto la pantalla pinte
  «cita de las 10:00 · estudiante · caso» con un `select` anidado, CAJA lee identidad por una relación que
  ningún `where` cierra.
*Riesgo:* alto para (b), mínimo para (a). · *Si sale mal:* caja lee expediente por la puerta de atrás.

**ODO-14 · La receta cruza las alergias del paciente**
Al teclear un medicamento, avisar si choca con las alergias, los padecimientos o la edad de la ficha.
*Por qué:* el paciente lleva «Alergia: penicilina» en un chip rojo **en el encabezado de esa misma
pantalla** (`layout.tsx:266-284`) y el editor deja teclear amoxicilina sin decir nada. En una escuela ese
no es un lujo: es el control que justifica el gate. · Superficies:
`src/components/edu/recetas/recetas-screen.tsx`, `src/lib/edu/recetas-core.ts`,
`src/app/instituto/(panel)/pacientes/[id]/recetas/page.tsx`. · **S** el aviso por lista; **M** el chequeo
con IA · **SQL: no** (el chequeo IA sí pide dar de alta una tercera `EduAiFeature`) · código propio ·
⟳ **Dos correcciones.** (1) El chequeo del dental **no se «extrae»**: `SYSTEM_PROMPT` y `CHECK_TOOL` viven
dentro de `src/app/api/prescriptions/check-contraindications/route.ts:29,41`, que es un archivo
**PROHIBIDO** para `edu-guard` y no está en `SHARED_FILES` — editarlo para sacarlos, y crear un
`src/lib/**` nuevo, son las dos cosas que el guardia para con exit 1. Se **copia** a `src/lib/edu/`, igual
que ODO-04 copia el patrón del snapshot. (2) Ahí **no hay tabla de cruces**: solo un prompt y un veredicto
`["OK","PRECAUCION","CONTRAINDICADO"]` (`:59-61`). La lista de cruces vive en un módulo **puro y
versionado** del repo — farmacología, **no** política de escuela: no es catálogo por instituto y no se
edita desde el panel, o una escuela puede borrarse sola una contraindicación. Reusa el mismo vocabulario de
veredicto para que las dos vías no se contradigan.
*Riesgo:* bajo el aviso. · *Si sale mal:* un falso negativo se lee como «el sistema dijo que sí»: es ayuda
visible e incompleta, nunca bloqueo silencioso.

**ODO-11 · Cuestionario de salud estructurado y banderas calculadas**
Importar el catálogo de padecimientos y `computeRiskFlags` del dental, con caducidad de la historia.
*Por qué:* hoy los antecedentes son tres listas de texto separadas por comas: nadie puede preguntar «¿qué
pacientes toman anticoagulantes?» ni «¿cuántas historias están vencidas?». · Superficies:
`prisma/schema.prisma`, `sql/` nuevo, `src/components/edu/expediente/antecedentes-card.tsx`,
`src/app/api/instituto/pacientes/[id]/antecedentes/route.ts`. · **M** · **SQL: sí** ·
**import del dental — puro**: `src/lib/health-questionnaire.ts` tiene **cero imports**. ·
⟳ **Se importa el MÓDULO, no se calca el ESQUEMA, y la escuela puede añadir lo suyo.**
(1) El modelo del dental no tiene relaciones Prisma «para NO editar esos modelos y evitar colisiones» y su
SQL trae una **RLS deny-all** (`prisma/schema.prisma:7822-7832`): eso es evitación de conflictos de merge,
no un principio a replicar. El modelo edu lleva `institutionId` NOT NULL, relación a `EduInstitution` en
cascada e índice `(institutionId, patientId, filledAt)`.
(2) El catálogo base viaja **versionado** (`HEALTH_QUESTIONNAIRE_VERSION`, `:13`) porque es anamnesis
clínica; pero el instituto puede **añadir** sus propias preguntas y banderas en una tabla editable
(`edu_questionnaire_items`, con `institutionId`) — `answers` ya es un mapa, así que caben sin migración.
(3) Los **12 meses** de caducidad (`STALE_AFTER_MONTHS:16`) son una columna del instituto con ese default,
nunca la constante leída directo.
*Riesgo:* bajo. ⚠️ **Preserva el tri-estado** («sin antecedentes registrados» ≠ «no refiere»,
`antecedentes-card.tsx:24-28`), que el dental **no** tiene. · *Si sale mal:* una tarea pendiente se lee como
un dato negativo.

**ODO-10 · Periodontograma del instituto**
Importar la rejilla 6×32 del dental tal cual y darle su propio modelo y su propio endpoint.
*Por qué:* un posgrado de periodoncia sin periodontograma no es un posgrado de periodoncia. · Superficies:
`prisma/schema.prisma` (`EduPeriodontalRecord` con `sites Json` de 192 sitios), `sql/` nuevo,
`src/lib/edu/` módulo nuevo, `src/app/api/instituto/periodontograma/` nuevo,
`src/components/edu/expediente/` contenedor nuevo, `src/app/instituto/edu-theme.css`. · **L** ·
**SQL: sí** · **import del dental — puro**: el árbol de `PeriodontogramGrid` no toca
`src/app/actions/periodontics`, ni `canAccessModule`, ni fetch, ni `useT`, ni prisma en runtime.
⟳ **⚠️ Dos avisos que el borrador no daba, y una pregunta abierta:**
- **La trampa del CSS estaba al revés.** `SiteCell.tsx` pinta **todo inline** (`:48-61`) y
  `className="perio-cell"` (`:47`) es el único `className` del subárbol y **no tiene consumidor**: la
  rejilla nunca sale sin estilo, y una regla `.perio-cell{}` en `edu-theme.css` sería **inerte** contra
  estilos inline. Lo que de verdad hay que dar son los tokens `--success-soft`, `--warning-soft`,
  `--danger-soft`, `--bg-elev`, `--brand`, `--border` y `--text-1` sobre el contenedor (`:26-38`), o los
  **fallbacks oscuros del dental** ganan sobre el tema del instituto.
- **No copies `src/components/clinical/dental/periodontogram-visual.tsx`**: es la versión muerta (0
  consumidores, `useT` en `:51` y `:230`).
- ⚠️ **El componente vive dentro de `src/components/specialties/periodontics/` y su único consumidor hoy es
  `PeriodonticsTab.tsx:132`, la pestaña vetada.** Técnicamente no arrastra nada del módulo — lo verifiqué
  hoja por hoja — pero montar un periodontograma propio (modelo + endpoint + módulo + contenedor, esfuerzo
  L) **puede leerse como «la versión ligera de la pestaña de periodoncia»**, que está prohibida. **Esa
  lectura no la decido yo → §10 pregunta 3.**
*Riesgo:* medio, y bloqueado por esa pregunta. · *Si sale mal:* una rejilla con los colores del dental
sobre el tema del instituto.

**ODO-12 · Serie fotográfica y comparador antes/después**
Etapa (pre/durante/post/control), pieza y comparador lado a lado con deslizador.
*Por qué:* «enséñame el antes y el después de tu caso» es literalmente cómo se evalúa un caso clínico. ·
Superficies: `prisma/schema.prisma` (`EduStudy`: `stage`, y `toothFdi` de ODO-08), `sql/` nuevo,
`src/components/edu/expediente/{estudios-screen.tsx,estudio-viewer.tsx}`. · **M** · **SQL: sí** ·
**import del dental — puro para 4 de 6**:
`src/components/clinical-shared/photos/{PhotoCompare,PhotoCompareSlider,PhotoTimeline,PhotoLightbox}.tsx`.
⛔ **No confundir con las copias homónimas de `src/components/specialties/{implants,orthodontics}/`**, que
están fuera de alcance. ⟳ **Tres correcciones:** (1) no «solo importan tipos»: traen el valor `STAGE_LABELS`
y `PhotoTimeline.tsx:6` importa `ClinicalPhotoStage` de `@prisma/client`. (2) El DTO que consumen exige
`module: ClinicalModule` y `photoType: ClinicalPhotoType` (`src/lib/clinical-shared/photos/types.ts:7-20`),
dos enums del dental; `ClinicalModule` son las 5 especialidades vetadas + `general`
(`prisma/schema.prisma:6725-6734`) → **el instituto escribe SIEMPRE `module: "general"`**, nunca una clave
de especialidad; o escribe su propio DTO. (3) Las cuatro etapas no se eligen: son las que ya esperan los
componentes. Si una escuela necesita más, van como catálogo aparte, **no** ampliando el enum del dental.
⚠️ **Consumo:** una serie de 4 etapas × N piezas por caso, contra 5 TB por instituto compartidos entre
sedes (§2.6). Decide si se guarda a resolución completa o derivada → §10 pregunta 8.
*Riesgo:* bajo-medio. · *Si sale mal:* etapas que nadie llena, o el techo de almacenamiento.

**ODO-13 · Plantillas de nota SOAP e indicaciones**
Un selector de plantilla sobre los cuatro textarea.
*Por qué:* en una escuela vale **más** que en una clínica: la plantilla es el andamio con el que se enseña
a redactar, y hoy el estudiante arranca de cuatro cajas vacías. · Superficies:
`src/components/edu/expediente/expediente-screen.tsx`. · **S** · **SQL: no** ·
**import del dental — puro**: `src/lib/clinical/soap-templates.ts:30` (con atajos ⇧1-9) e
`src/lib/clinical/indication-templates.ts:23` tienen **cero imports**. ⛔ El que **no** sirve es
`src/components/clinical-shared/EvolutionTemplatePicker.tsx:7` (server action); no confundir con el
homónimo de `src/components/specialties/implants/`. · *Riesgo:* mínimo. · *Si sale mal:* nada; es aditivo.

### Palabras y papeles

**ODO-15 · Vocabulario que casi no cuesta**
Los renombres de §3.2 y los cuatro choques de palabra.
*Por qué:* es el cambio con mejor relación impacto/esfuerzo y el único que se nota el primer día. ·
Superficies: `src/lib/edu/types.ts`, `src/lib/edu/direccion-core.ts:560-561`, los rótulos de ~15
componentes **y sus gemelos `edu-cell__label`**, y `src/app/instituto/edu-theme.css` (`--edu-cols`). ·
**S** · **SQL: no** · código propio ·
⟳ *Riesgo:* **más alto de lo que parecía**. Es un cambio de texto, **no un `sed`**: hay etiquetas que van
dentro de CSV exportados, rótulos duplicados en el gemelo móvil, columnas de ancho fijo y al menos un test
que lee el fuente (`edu-casos.test.ts:529`). Ver los tres avisos y las tres trampas de §3.2-§3.3. ·
*Si sale mal:* un `sed` mal apuntado toca `EduConsentSlot` y deja huérfanas firmas de consentimientos, o
`EDU_SEVERIDAD_LABELS` y deja los análisis históricos «Sin clasificar».

**ODO-16 · Vocabulario que sí cuesta: los query-params y la ruta**
`?alumno=` → `?estudiante=` leyendo las dos; `?programa=` → `?especialidad=` leyendo las dos;
`/agenda/tamizaje` → `/agenda/valoracion` con redirect; keys internas del detalle de Dirección; **y las
cuatro cadenas de error en español de los route handlers** (§3.1).
· Superficies: `src/lib/edu/{casos-core.ts:225,242, padron-core.ts:218, agenda-core.ts:735-736,
direccion-core.ts:884,891,896,897, direccion.ts:1098,1559,1567,1659,1777,1815}`, ⟳ **más los cuatro
endpoints que leen `?alumno=`** (`api/instituto/{casos/route.ts:25, calificaciones/route.ts:32,
evaluacion/route.ts:29, traspasos/route.ts:21}`) y `api/instituto/casos/route.ts:24` para `?programa=`,
`src/app/instituto/(panel)/agenda/tamizaje/` → `valoracion/`, `src/app/api/instituto/tamizaje/`,
⟳ **y `src/lib/edu/marketing.ts:202`**. · **M** · **SQL: no** ·
⛔ **salvo** si se renombran `padron.view`/`padron.manage`, que **sí** exige SQL de migración de
`EduUser.permissionsOverride` — y ⟳ el riesgo ahí es **escalada de privilegios**, no denegación (§3.3). ·
código propio · *Riesgo:* medio. ⛔ **Las claves de la agenda están congeladas** (`agenda-rejilla.ts:814-819`,
fijadas por `edu-agenda-rejilla.test.ts:1154-1159`): no se renombran. ⚠️ Mover la ruta de API rompe
`npm run test:edu` por `marketing.ts:202` + `edu-landing.test.ts:131` (`existsSync`), y un redirect no lo
arregla. · *Si sale mal:* un enlace guardado que no lleva a ninguna parte; o una cuenta restringida que
recupera el default de su rol.

**ODO-24 · La rúbrica evalúa competencia clínica**
Descriptores por nivel en cada criterio y criterio eliminatorio.
*Por qué:* hoy «Aislamiento: 7» no dice qué es un 7, y la escuela lo resuelve escribiendo prosa en el
comentario. · Superficies: `prisma/schema.prisma:14447-14467`, `sql/` nuevo,
`src/lib/edu/{rubricas.ts,evaluacion-core.ts:128-170}`,
`src/components/edu/evaluacion/rubricas-screen.tsx`. · **M** · **SQL: sí** · código propio ·
⟳ **Los descriptores son FILAS, no columnas.** `edu_rubric_criterion_levels` (criterioId, valor, texto),
N por criterio, con el valor dentro del `scaleMin..scaleMax` **de su rúbrica** — nunca una escalera de
cuatro columnas: la escala es configurable de 0 a 1000 (`prisma/schema.prisma:14408-14410`,
`rubricas.ts:263-266`) y una rúbrica de 0-10 no cuadra con una de 0-100. El «eliminatorio» es un booleano
por criterio, y **tanto la bandera como el umbral se copian congelados** a `EduCaseGradeItem` al calificar,
igual que ya se congelan `rubricName`/`scaleMin`/`scaleMax` (`:14476-14490`).
*Riesgo:* medio. Cambia el cálculo de la nota final, que hoy resuelve el servidor con una sola división. ·
*Si sale mal:* calificaciones que no cuadran con lo que el docente creyó poner. Las ya puestas están
congeladas y no se tocan.

**ODO-25 · «¿Va bien esta generación?», contestado en una pantalla**
`?generacion=` en los filtros de Dirección con las **mismas tres formas** que ya usa Evaluación, y un bloque
agregado con avance, promedio, horas y los tres requisitos con más deuda del grupo.
*Por qué:* es la pregunta literal de un director y hoy exige dos pantallas. · Superficies:
`src/lib/edu/direccion-core.ts:171-209` (**el punto único de lectura de la URL**), `direccion.ts:760-766` y
`:963-996`, `src/components/edu/direccion/direccion-screen.tsx:724-862`,
`src/app/api/instituto/direccion/{route,export,detalle}/route.ts`. · **M** · **SQL: no** (el loader ya
acepta el filtro, `evaluacion-core.ts:1303-1329`) · código propio ·
*Riesgo:* bajo-medio, y la trampa está escrita en el código: **el default de producto vive en la página, no
en el loader**. Y si Dirección arranca filtrada, la pantalla tiene que **decirlo**. · *Si sale mal:* el
director cuenta los atrasados de una generación creyendo que son los de la escuela.

**ODO-26 · Lo que se mira se puede entregar**
Bitácora académica imprimible con fecha de corte, expediente y odontograma imprimibles, recibo de cobro,
corte de caja **y ⟳ el tarifario** imprimibles.
*Por qué:* el expediente académico existe como pantalla y como CSV, y las dos son buenas para sumar y malas
para **entregar**. · Superficies: `src/components/edu/evaluacion/bitacora-screen.tsx`,
`src/app/instituto/edu-theme.css:5000` y `:6034` (los bloques `@media print` **ya existen**),
`src/components/edu/dinero/{caja-screen.tsx,corte-screen.tsx,tarifarios-screen.tsx}`,
`src/components/edu/expediente/odontograma-screen.tsx`. · **M** · **SQL: no** ·
import del dental para el motor si se elige PDF (`@react-pdf/renderer`, **ya usado dentro del vertical** en
`src/lib/edu/receta-pdf.tsx:21`) + código propio · *Riesgo:* bajo técnicamente; el cuidado es de producto:
un PDF generado aparte sería una **tercera** versión del mismo dato. Tiene que salir de `getEduBitacora`,
con el mismo alcance y el mismo `generatedLabel`, y **decir en el papel que es un corte a una fecha**. ·
*Si sale mal:* dos papeles del mismo estudiante con números distintos.

**ODO-27 · El panel avisa**
Badge de pendientes en el sidebar, avisos al **estudiante** y al **docente**, y dar de alta el cron de
recordatorios.
*Por qué:* los tres únicos WhatsApp van al paciente (`whatsapp-core.ts:39`), no hay contador en ningún sitio
(grep en `edu-shell.tsx` → 0), y **el cron no está registrado**: su propio archivo lo advierte
(`src/app/api/instituto/cron/recordatorios/route.ts:16-19`) y `grep "instituto" vercel.json` → **0**. ·
Superficies: `src/components/edu/edu-shell.tsx`, `src/lib/edu/{whatsapp-core.ts,autorizaciones.ts}`,
`src/app/instituto/(panel)/layout.tsx`, ⟳ **y `vercel.json`, que para el guardia es un archivo
PROHIBIDO** — no está en `SHARED_FILES` y sale con exit 1 sin ofrecer la línea de declaración; el propio
código del vertical lo dice (`cron/recordatorios/route.ts:16`) → §10 pregunta 7. · **M** · **SQL: no** ·
código propio · *Riesgo:* medio. Cada plantilla nueva de WhatsApp es un trámite con Meta
(`whatsapp-core.ts:88-97`) y cambiar el orden de las `{{n}}` entrega el mensaje con los datos revueltos.
**Empieza por el badge**, que no depende de Meta ni del guardia. · *Si sale mal:* mensajes con los datos
revueltos, o un contador que pide una consulta más por carga de página.

**ODO-28 · Las dos deudas de Dirección**
La variación de «Cobrado» en pesos (llamando a `eduDirVariacionEn`, que **ya existe**), la unidad en el dato
en vez de `label.startsWith("cobrado")`, y las cuatro tandas encadenadas convertidas en tres.
*Por qué:* el director lee «+12 % (350000 → 392000)» debajo de un «$3,920.00», y el CSV de una acreditación
mezcla pesos formateados con centavos crudos en la **misma fila**. · Superficies:
`src/lib/edu/direccion.ts:1107-1115` y `:760-766,838`, `direccion-core.ts:673,1056-1069`,
`src/components/edu/direccion/direccion-screen.tsx:1273`, `src/lib/edu/__tests__/edu-direccion.test.ts`. ·
**S** · **SQL: no** · código propio · *Riesgo:* bajo. `eduDirVariacionEn` también reescribe el caso «antes
no entró nada»: fija los dos mensajes en el test antes de tocar. Mover consultas **dentro** de una carga no
viola la nota de `direccion/page.tsx:41-45`; fusionar las dos cargas sí, y no se propone. · *Si sale mal:*
el detalle clicable deja de cuadrar con la tarjeta.

**ODO-29 · Marcar «Egresado» comprueba el plan**
No bloquear: calcular el avance y, si hay requisitos incumplidos, **exigir un motivo escrito** que quede
guardado.
*Por qué:* hoy graduar es cambiar un `<select>` (`padron.ts:684-687`) y ése es el número que revisa un
comité. El patrón ya existe: revocar un consentimiento (`consentimientos.ts:505-512`) y anular una receta
(`recetas.ts:695-699`). · Superficies: `src/lib/edu/padron.ts:638-687`, `prisma/schema.prisma:12722`
(`model EduStudent`, **columna nueva** `graduationNote` — hoy `grep -n graduationNote` → 0), `sql/` nuevo,
`src/components/edu/padron/padron-screen.tsx`. · **M** · **SQL: sí** · código propio ·
*Riesgo:* medio, con dos trampas: (1) el avance se **cuenta** al preguntar — acótalo al estudiante, no
llames a `listEduEvaluacion`; (2) si a la generación le faltan fechas el semáforo devuelve `null`, y eso
**no** puede convertirse en «no puedes graduar a nadie». · *Si sale mal:* la escuela no puede egresar a
nadie en junio.

**ODO-31 · La ficha del docente existe de verdad**
Cédula y especialidad en el alta, y las métricas históricas: cuántos casos calificó, con qué promedio y con
qué dispersión, cuántas autorizaciones firmó y en cuánto tiempo.
*Por qué:* del docente solo se sabe a cuánta gente supervisa **hoy** (`padron.ts:269-274`). La cédula es el
caso testigo de «dato clínico capturado en el peor momento»: existe (`prisma/schema.prisma:12598`), no se
pide al alta (grep en `equipo-screen.tsx` → 0), no se muestra en Docentes (`padron-core.ts:521-529`) y se
captura por primera vez **con el docente de pie firmando una receta** (`bandeja-screen.tsx:336-372`). ·
Superficies: nuevo `src/lib/edu/docentes-metricas.ts`,
`src/app/instituto/(panel)/docentes/page.tsx:66-91`, `src/components/edu/padron/docentes-screen.tsx`,
`src/components/edu/equipo/equipo-screen.tsx`, `prisma/schema.prisma` (índice). · **M** ·
**SQL: sí** — `edu_case_grades` **no tiene índice por `gradedById`** (`:14545-14547`) ·
código propio · *Riesgo:* medio y **no técnico**: medir a las personas cambia cómo se comportan. Enséñalo
con la dispersión y el volumen al lado, o solo para DIRECCION. Y respeta el precedente P1-4: **un docente
no puede ver por nombre a los alumnos de otro**. · *Si sale mal:* una fuga de nombres entre docentes, que
ya se arregló una vez.

**ODO-32 · Las pantallas cumplen lo que prometen**
El filtro por caso del expediente (el banner lo anuncia y **no existe**), buscador y filtro por tipo en
estudios, filtro por fechas en Facturación, columna de fecha en Caja y en los envíos de WhatsApp.
*Por qué:* el banner dice «Filtra por caso para ver las notas viejas» (`expediente-screen.tsx:206`), el
loader **acepta** `options.caseId` (`expediente.ts:217,231-232`) y la página lo llama sin opciones
(`pacientes/[id]/expediente/page.tsx:61`). Sin rango de fechas en Facturación
(`facturacion-core.ts:583-588`) no se puede cerrar un mes fiscal. · Superficies:
`src/app/instituto/(panel)/pacientes/[id]/expediente/page.tsx`,
`src/components/edu/expediente/{expediente-screen.tsx,estudios-screen.tsx}`,
`src/lib/edu/facturacion-core.ts`, `src/components/edu/{facturacion/facturacion-screen.tsx,
dinero/caja-screen.tsx,whatsapp/whatsapp-screen.tsx}`. · **S** · **SQL: no** · código propio ·
*Riesgo:* mínimo; los datos ya viajan en las filas (`dinero-core.ts:546`, `facturacion-core.ts:666-667`,
`whatsapp-core.ts:753`), y el `kind` del estudio ya existe (`prisma/schema.prisma:13498`). · *Si sale mal:*
nada.

### ⟳ Cinco propuestas nuevas que salieron de la pasada adversarial

**ODO-34 · La sede es una dimensión, no una pantalla**
O el selector de sede se atenúa (con su motivo) en las 36 pantallas que no lo respetan, o `?sede=` entra en
el punto único de lectura de la URL junto a `?generacion=` de ODO-25.
*Por qué:* el selector se pinta en las 41 pantallas (`edu-shell.tsx:38,265,357`) y solo recorta cinco cosas
—sillón, cita, cobro, plano y clínica en vivo— por decisión escrita (`visibility.ts:835-839`). En padrón,
evaluación, requisitos, casos, expediente y facturación dice «Campus Sur» y los datos son los de toda la
escuela. Un director con dos campus no puede preguntar «¿cómo va el campus sur?» y **nada se lo dice**. ·
Superficies: `src/components/edu/edu-shell.tsx`, `src/lib/edu/direccion-core.ts:171-209`,
`src/lib/edu/campus-core.ts`. · **M** · **SQL: no** · código propio ·
*Riesgo:* bajo-medio. Lo académico **no cuelga de la sede a propósito** (`prisma/schema.prisma:14655-14663`:
un estudiante rota entre sedes y su padrón es uno solo), así que «¿qué sede gradúa mejor?» no es contestable
ni en principio: la pantalla tiene que **decirlo**, no dejar la columna en blanco. · *Si sale mal:* alguien
lee cifras de toda la escuela creyendo que son de un campus — que es exactamente lo que pasa hoy.

**ODO-35 · Bitácora de esterilización e incidentes**
Ciclos de autoclave con su indicador biológico/químico y su responsable, registro de incidentes
(punzocortante, exposición), y un `packageId` opcional en el acto clínico que ate paquete → paciente.
*Por qué:* una clínica escolar con decenas de estudiantes compartiendo instrumental no tiene **nada**:
`esteriliz` → 0, `autoclave` → 0, `RPBI` → 0, `bioseguridad` → 0, `punzocort` → 0, `incidente` → 0,
`mantenimiento` → 0 en todo el vertical. `EduChair` (`prisma/schema.prisma:13023`) es nombre + sede +
horario. Es lo primero que pide una verificación sanitaria, y el panel ya **califica** la asepsia
(«Aislamiento — dique colocado antes de abrir», `sql/edu-ola-6.sql:743-750`) sin poder **registrar** el
ciclo con el que se trabajó. · Superficies: `prisma/schema.prisma` (2 tablas nuevas), `sql/` nuevo,
`src/lib/edu/` módulo nuevo, `src/app/api/instituto/` rutas nuevas, pantalla nueva bajo
`/instituto/sillones` o propia. · **M** · **SQL: sí** · código propio (**el dental tampoco lo tiene**: no
hay nada que importar) · *Riesgo:* bajo técnicamente; de producto, que se convierta en captura que nadie
llena — por eso el ciclo se registra una vez por carga, no por paciente, y el enlace paquete→paciente es
opcional. · *Si sale mal:* una bitácora vacía que da falsa seguridad.

**ODO-36 · El consentimiento firmado se puede releer**
Devolver el `content` de la carta en estado FIRMADA con el mismo alcance que ya rige la fila, más su
`@media print`.
*Por qué:* es el hallazgo que este informe marca como **el caso más claro** de toda la ficha y el borrador
lo dejó sin propuesta. `EduConsentRow` no incluye `content` (`consentimientos-core.ts:406-455`) y
`publicPath` se anula en cuanto deja de estar PENDIENTE (`consentimientos.ts:218`): firmada la carta, ni el
texto ni la liga. Para un documento NOM-004 eso es lo contrario de lo que la pantalla existe para
garantizar — y el propio layout justifica el permiso de caja diciendo que «la carta se imprime y se entrega
en el mostrador» (`pacientes/[id]/layout.tsx:180-182`). · Superficies:
`src/lib/edu/{consentimientos-core.ts,consentimientos.ts}`,
`src/components/edu/expediente/consentimientos-screen.tsx`, `src/app/instituto/edu-theme.css`. · **S** ·
**SQL: no** · código propio · *Riesgo:* bajo. Si el texto pesa demasiado para la fila, la alternativa es un
endpoint `/api/instituto/consentimientos/[id]/documento` que lo sirva bajo el mismo alcance, como
`storage.ts` ya hace con los estudios. ⚠️ Lectura, nunca escritura: el `content` y su `contentHash` son el
documento. · *Si sale mal:* nada, es solo lectura.

**ODO-37 · El precio del TB extra sale del código**
`EDU_ALM_TB_EXTRA_MXN = 400` es una constante de TypeScript que se **pinta** en el tablero de Dirección del
instituto y en `/admin`.
*Por qué:* es la regla (d) de la casa incumplida hoy, en una de las 41 pantallas inventariadas. ·
Superficies: `src/lib/edu/almacenamiento-core.ts:52-60` y `:326-328`,
`src/components/edu/direccion/almacenamiento-card.tsx:100`,
`src/app/admin/institutos/institutos-client.tsx:72,287,297`, y la tabla de configuración de planes o una
columna del contrato del instituto junto a `storageQuotaBytes`. · **S** · **SQL: sí** (una columna o una
fila de configuración) · código propio · ⚠️ `src/app/admin/institutos/**` es ruta **propia** del vertical
(`scripts/edu-guard.cjs`, `OWN_PREFIXES`), así que esto no toca el dental. · *Riesgo:* mínimo. ·
*Si sale mal:* el precio se pinta vacío mientras no se siembre la fila — degrada a «consultar», no a `$0`.

**ODO-38 · Sub-cupo de IA por estudiante o por especialidad**
Repartir lo que ya incluye el contrato entre estudiantes o especialidades, con techo agregado.
*Por qué:* con 120 estudiantes el director ve 120 renglones que dicen «Estudiante» (`ia-screen.tsx:172-176`)
y no sabe si el cupo se lo comió Endodoncia o Prótesis; y un alumno subiendo tomografías apaga el micrófono
de los otros 119. · Superficies: `src/lib/edu/ia-cupo.ts`, `src/components/edu/ia/ia-screen.tsx`,
`prisma/schema.prisma`, `sql/` nuevo. · **M** · **SQL: sí** · código propio ·
⚠️ **Restricción que no se negocia:** `ia-cupo.ts` (776 líneas) declara que **lo que incluye el contrato
(`monthlyUsdCents`) NO se edita desde el panel con ningún permiso**, y `updateEduAiQuota` lo **rechaza** con
mensaje en vez de ignorarlo, porque la cuenta de API la paga DaleControl. El sub-cupo es un **reparto**
(suma ≤ `monthlyUsdCents`), nunca un campo que suba el techo, y se escribe al lado de esa función
respetando su rechazo. · *Riesgo:* medio de producto: un sub-cupo mal repartido apaga a alguien a mitad de
mes; hace falta que el reparto sea visible y que sobre un remanente común. · *Si sale mal:* alguien intenta
subir el techo por la puerta de atrás y el vertical deja de ser vendible como está contratado.

### Techo (evaluar, no arrancar aquí)

**ODO-30 · Interconsulta explícita entre especialidades** · **L** · **SQL: sí** · código propio ·
La señora con endodoncia y ortodoncia es el caso normal de un posgrado, y hoy los dos estudiantes trabajan
a ciegas (`pacientes/[id]/casos/page.tsx:135-149`).
⟳ *Riesgo:* **ALTO, y la guarda que prometía el borrador es inalcanzable tal como estaba escrita.** «Jamás
todos los casos del paciente» no se puede cumplir con la arquitectura de hoy: abrir la ficha pasa por
`eduPatientScopeWhere` (`expediente.ts:188-191`), y ampliarlo abre de golpe **nueve superficies que se
recortan por paciente y no por caso** — estudios (`estudios.ts:589`), consentimientos
(`consentimientos.ts:153,553`), pacientes (`pacientes.ts:264,666`), whatsapp
(`whatsapp.ts:1046,1064,1146`), caja (`caja.ts:525`), facturación (`facturacion.ts:577`), IA
(`ia.ts:377`), resumen (`resumen.ts:275`) y el odontograma, que cuelga del paciente por diseño. El
interconsultante de endodoncia acabaría descargando la tomografía que pidió el caso de periodoncia de un
tercer estudiante. Separar «abrir la ficha» de «ver el expediente del caso» es un **recurso nuevo** de
visibilidad, justo lo que `visibility.ts` rehúsa añadir tres veces (`:80-102`, `:726-733`, `:1023-1029`).
Faltan además dos piezas obligatorias: **vigencia** (`startsAt`/`endsAt` con el mismo predicado que
`eduCurrentAssignmentWhere`, o el estudiante que se graduó en julio sigue leyendo al paciente en diciembre,
`visibility.ts:47-51,313-327,795-805`) y **decidir si la concesión sube al docente titular** del
interconsultante — si no sube, el docente no puede firmar lo que no ve; si sube por «supervised», se abre a
todos sus alumnos. Obligatorio `revisor` + `refutador`.

**ODO-33 · Requisitos contra el odontograma** · **L** · **SQL: sí** · import del dental (el catálogo
`COND_BY_ID` **ya se importa**, `odontograma-core.ts:31`) ·
En vez de teclear unidades, el requisito se cumple con los hallazgos ya marcados. *Riesgo:* **ALTO**: el
odontograma cuelga del **paciente**, no del caso ni del estudiante (`prisma/schema.prisma:13449-13452`), y
`recordedById` dice quién **marcó** el hallazgo, que no siempre es quien hizo el tratamiento. Atribuir
piezas al estudiante equivocado infla el avance de uno y vacía el de otro, y el fallo se ve exactamente
igual que «funciona». ⟳ Y del archivo del dental **no se copia el mapeo**: `CONDITION_TREATMENT_CODE`
(`src/lib/odontogram/snapshot.ts:122-130`) apunta a códigos globales que en el instituto no existen.
**Si la regla de atribución no se puede defender en voz alta delante de un comité, esta propuesta no se
hace y ODO-02 es la correcta** → §10 pregunta 4.

---

## 8. Ranking y olas

### 8.1 Top 10 por impacto sobre esfuerzo

| # | ID | Por qué está aquí | Esfuerzo |
|---|---|---|---|
| 1 | **ODO-17** | La columna, el índice y la validación ya existen: falta un selector. Desbloquea el indicador «sesiones sin nota» | S |
| 2 | **ODO-18** | Una tarjeta que enlaza y unos chips ya calculados. Es donde está la persona con el paciente sentado | S |
| 3 | **ODO-28** | El arreglo ya está escrito y desconectado. Evita que un CSV de acreditación salga con centavos crudos | S |
| 4 | **ODO-15** | ⟳ Baja del primer puesto: sigue siendo el cambio más visible, pero cuesta más de lo que parecía (CSV, gemelos, anchos, un test que lee el fuente) | S |
| 5 | **ODO-01** | El hueco estructural. Nada de lo odontológico se puede construir sin él | L |
| 6 | **ODO-03** | De una columna de texto libre cuelga toda la evaluación, y renombrarla deja huérfanos los requisitos | M |
| 7 | **ODO-02** | Convierte «12 casos» en «12 cuadrantes». Es lo que hace que el panel hable como una escuela | M |
| 8 | **ODO-36** | ⟳ **Nueva y barata.** El hallazgo que este informe llama «el caso más claro» y que el borrador dejó sin propuesta | S |
| 9 | **ODO-23** | Sin catálogo ni rúbrica el vertical no arranca, y el contenido ya está escrito y comentado en el repo | M |
| 10 | **ODO-32** | Cuatro pantallas prometen algo que no existe. Barato y quita desconfianza | S |

Justo debajo, y ninguna es descartable: **ODO-22(a)** (⟳ el $0 de Dirección con un campo, **S**), **ODO-04**
(la landing ya vende ese historial), **ODO-37** (⟳ un precio cableado, **S**), **ODO-06**, **ODO-09**,
**ODO-25**, **ODO-13**, **ODO-14**, y **ODO-21 parcial** (solo el enlace a Valoración para el docente, **S**,
que arregla que el rol que debe valorar no pueda llegar a la pantalla).

### 8.2 Cinco olas — las 38 propuestas, ninguna huérfana

⟳ El borrador repartía 26 de 33 y dejaba siete sin ola. Aquí están las 38.

| Ola | Propuestas | Superficie principal | ¿SQL? |
|---|---|---|---|
| **1 · La pieza** | ODO-01, 02, 03, 06, 07, 08, 09, 23 | `prisma/schema.prisma` (**tablas nuevas**), `sql/`, `src/lib/edu/{casos,tarifas,caja,dinero-core,estudios,expediente,expediente-core,evaluacion,evaluacion-core,consentimientos-core,facturacion-core,ia-core}.ts`, `src/components/edu/{dinero/procedimientos-screen,dinero/caja-screen,evaluacion/requisitos-screen,evaluacion/rubricas-screen,expediente/estudios-screen,expediente/consentimientos-screen}.tsx` | sí |
| **2 · El piso clínico** | ODO-04, 05, 11, 14, 17, 18, 19, 20, 21, 22 | `src/lib/edu/{agenda,agenda-core,clinica-viva*,odontograma*,autorizaciones*,visibility,recetas*,pacientes-core}.ts`, `src/components/edu/{clinica/*,expediente/expediente-screen,expediente/odontograma-screen,expediente/antecedentes-card,casos/caso-acciones,autorizaciones/bandeja-screen,recetas/recetas-screen}.tsx`, **columnas** en `prisma/schema.prisma` | sí |
| **3 · Palabras y papeles** | ODO-13, 15, 16, 25, 26, 27, 28, 32, 34, 36, 37 | `src/lib/edu/{types,direccion,direccion-core,whatsapp-core,facturacion-core,casos-core,padron-core,campus-core,almacenamiento-core,marketing}.ts`, `src/components/edu/{direccion/*,evaluacion/bitacora-screen,evaluacion/evaluacion-screen,dinero/corte-screen,dinero/tarifarios-screen,whatsapp/whatsapp-screen,expediente/consentimientos-screen,edu-shell}.tsx`, `src/app/instituto/edu-theme.css`, `vercel.json` | ODO-37 sí; el resto no |
| **4 · La evaluación y el docente** | ODO-24, 29, 31, 38 | `src/lib/edu/{rubricas,evaluacion-core,padron,ia-cupo}.ts`, `src/components/edu/{evaluacion/rubricas-screen,padron/*,equipo/equipo-screen,ia/ia-screen}.tsx`, **columnas e índices** en `prisma/schema.prisma` | sí |
| **5 · El expediente visual y la bitácora sanitaria** | ODO-10, 12, 35 | módulos y rutas nuevas, `src/components/edu/expediente/estudios-screen.tsx`, `src/app/instituto/edu-theme.css`, **tablas y columnas** en `prisma/schema.prisma` | sí |
| **Techo** | ODO-30, 33 | no se arrancan sin decisión previa (§10) | — |

⟳ **Corrección importante:** el borrador decía que la Ola 1 es «la única que toca `prisma/schema.prisma`»
y se contradecía cuatro líneas después. La verdad: **la Ola 1 es la única que crea TABLAS; las olas 2, 4 y 5
añaden COLUMNAS e ÍNDICES y también tienen que declarar `EDU_GUARD_SHARED="prisma/schema.prisma"`.**

**Qué puede correr en paralelo y qué no:**

- **Ola 1 y Ola 3, sí — pero hay CINCO roces, no dos, y hay que repartirlos por escrito antes de arrancar:**
  1. `src/components/edu/dinero/caja-screen.tsx` (77 KB) — lo tocan **las tres** primeras olas (ODO-09 en la
     1, ODO-22 en la 2, ODO-26 y ODO-32 en la 3). **Asígnalo a la Ola 1**: ya lo abre para la pieza, que
     añada ahí mismo el `@media print` y la columna de fecha.
  2. `src/components/edu/expediente/estudios-screen.tsx` — Ola 1 (ODO-08) y Ola 3 (ODO-32) y Ola 5 (ODO-12).
     **Asígnalo a la Ola 1.**
  3. `src/lib/edu/types.ts` — es la superficie principal de ODO-15 (Ola 3), pero ODO-02 y ODO-03 (Ola 1)
     crean valores nuevos, y **toda etiqueta visible de un enum `Edu` vive ahí** (21 tablas `EDU_*_LABELS`
     entre `:160` y `:1262`). **Regla:** la Ola 1 entrega los valores nuevos **sin** sus `*_LABELS`, y la
     Ola 3 los rotula al integrar.
  4. `src/lib/edu/facturacion-core.ts` — Ola 1 le añade la clave SAT por procedimiento, Ola 3 el filtro por
     fechas. Funciones distintas, mismo archivo: **asígnalo a la Ola 1.**
  5. `src/lib/edu/casos-core.ts` — Ola 3 le cambia el query-param; la Ola 1 no lo toca si ODO-01 escribe en
     `casos.ts`. **Asígnalo a la Ola 3.**
- **Ola 2, con ninguna.** Toca `prisma/schema.prisma`; toca `expediente-screen.tsx` y
  `odontograma-screen.tsx`, que la Ola 3 necesita (ODO-13, ODO-32) y la Ola 2 también (ODO-17, ODO-04); y
  ⟳ toca dos archivos de datos que el borrador no declaraba: **`agenda-core.ts`** (ODO-19 en `:560`,
  ODO-16 en `:735-736`) y **`direccion.ts`** (ODO-19 en `:494-512`; ODO-25, ODO-28 y ODO-16 desde la Ola 3).
- **⟳ Orden recomendado:** Ola 3 y Ola 1 arrancan a la vez → **se integran las dos** → arranca la Ola 2 →
  después, en paralelo, Olas 4 y 5 (no comparten archivos entre sí; la 4 vive en evaluación/padrón/IA y la
  5 en expediente visual y sillones). El borrador ponía la Ola 2 a solaparse con la 3, y ahí es donde
  chocaban `agenda-core.ts` y `direccion.ts`.
- **Regla de operación:** cada `.sql` se entrega en bloque copy-paste y se aplica **antes** del deploy que
  lo necesita. Una columna nueva sin su `.sql` aplicado es una lectura rota, y ya pasó dos veces en este
  vertical (`searchIndex` de la Ola 1B y los antecedentes de la ola de Casos).

---

## 9. Fuera de alcance

- **Las 5 pestañas de especialidad del panel dental** (periodoncia, endodoncia, implantes, ortodoncia,
  odontopediatría): decisión de producto cerrada. ⟳ **Corrección de la evidencia:** `HIDDEN_SPECIALTY_IDS`
  está en `src/components/dashboard/patient-detail/patient-nav-items.ts:108-113` y tiene **cuatro** ids
  (`pediatria`, `periodoncia`, `endodoncia`, `ortodoncia`) — **implantes no está**: se empuja en `:149`
  como chip `disabled: true, disabledReason: "Próximamente"` y sobrevive al filtro de `:180`. O sea que
  **cuatro de las cinco** están ocultas en el dental. Sus server actions exigen módulo del marketplace
  activo (`src/app/actions/periodontics/_helpers.ts:35-39`). ⚠️ ODO-10 **no es esto** técnicamente, pero
  la lectura de producto la decide Rafael → §10 pregunta 3.
- **Marketplace de laboratorios**: `/dashboard/ordenes-laboratorio` y los modelos `DentalLab*`
  (`prisma/schema.prisma:816-1080`). No confundir con `LabPartner` (`:7007`) y `LabOrder` (`:7032`), que
  son la orden de trabajo de la propia clínica y sí son una brecha real — reportada, no propuesta.
- **Proveedores e insumos** (`src/components/proveedores/*`, `src/lib/suppliers/*`).
- **Modo `PERIIMPLANT_BONE_LOSS`** del análisis radiográfico (`src/lib/xray/analysis-modes.ts:200`).
- **Firma electrónica avanzada (FIEL)**: `src/lib/signature/envelope.ts:16-24` exige
  `SIGNATURE_MASTER_KEY` y `fiel.ts` resuelve contra `DoctorSignatureCert`, que cuelga del `User` del
  dental. Lo barato (hash + IP + user-agent) **ya está escrito dentro del vertical**.
- **Renombrar `EduRole.ALUMNO`, `EduProgram`, `EduAppointmentType.TAMIZAJE` o la ruta `/instituto/padron`**:
  decisiones tomadas y documentadas (`types.ts:172-174`, `:1015-1027`).
- **Parametrizar `src/components/quotes/quotes-tab.tsx`**: 14 literales de ruta en 13 líneas más `useT` y
  `useConfirm` — cuesta lo mismo que escribir la pantalla propia.
- **Mejorar los nombres del catálogo del plano** («Silla Espera», «Banca 3P», «Pared Horiz.»,
  `src/lib/floor-plan/elements-dental.ts:563-709`): son texto del panel dental y el dental no se edita.
- **Copiar `src/components/clinical/dental/periodontogram-visual.tsx`**: versión muerta, 0 consumidores,
  usa `useT` dos veces (`:51`, `:230`).
- **Los homónimos de `src/components/specialties/{implants,orthodontics}/`** de `ClinicalPhotoGallery`,
  `PhotoCompareSlider` y `EvolutionTemplatePicker`: ODO-12 y ODO-13 usan **solo** las copias de
  `clinical-shared/`.
- **`CDT` como codificación de procedimientos**: [dominio] es propietario, de licencia anual y diseñado
  para aseguradoras estadounidenses. Por eso ODO-03 propone CIE-9 y catálogo propio.
- **Prometer ISO 27001, CFDI con validez fiscal o infraestructura AWS**: no se dice en ningún entregable.
  El panel ya sella «timbrado EN PRUEBAS» cuando toca (`facturacion-screen.tsx:857`).

---

## 10. A confirmar con Rafael

Solo lo que **no** se puede resolver leyendo el código. ⟳ Diez preguntas: se cayó la del borrador sobre la
configurabilidad de la escala de valoración (la casa ya tiene esa respuesta y ahora está dentro de ODO-21) y
entraron cuatro nuevas.

1. **La landing promete un historial del odontograma que no existe** (`marketing.ts:327-328`). O se
   construye ODO-04, o se corrige el texto. Es lo único de este informe que hoy es una afirmación falsa de
   cara a un cliente, y la decisión es tuya, no técnica.
2. **¿Se renombran las claves `padron.view` / `padron.manage`?** ⟳ El riesgo es peor de lo que parecía y
   está al revés: `getEduEffectivePermissions` filtra las claves desconocidas y **si el override se queda
   vacío cae al default del rol** (`permissions.ts:983-991`). Una cuenta de DIRECCION restringida a mano a
   `["padron.view"]` **recuperaría todos los defaults de DIRECCION** —`equipo.manage`, `caja.*`,
   `direccion.panel`— en silencio. Es **escalada de privilegios**. Si se hace, el SQL de migración va antes
   del deploy y un solo override sin migrar ya es una cuenta elevada.
3. **⟳ ¿Montar un periodontograma propio en el instituto cuenta como «la versión ligera de la pestaña de
   periodoncia» que está vetada?** Técnicamente ODO-10 no arrastra nada del módulo ni de su gating —lo
   verifiqué hoja por hoja—, pero el componente vive dentro de `src/components/specialties/periodontics/`,
   su único consumidor hoy es la pestaña prohibida (`PeriodonticsTab.tsx:132`), y la propuesta es esfuerzo
   L con modelo + endpoint + módulo + contenedor. Esa lectura es de producto, no mía.
4. **¿Cuál es la regla de atribución de una pieza a un estudiante?** (bloquea ODO-33 y condiciona ODO-01).
   El odontograma cuelga del **paciente**; `recordedById` dice quién marcó, no quién trató. Las opciones son
   «el caso abierto de ese paciente en esa fecha» o «lo declara el estudiante y lo avala el docente». La
   segunda es defendible ante un comité; la primera adivina.
5. **¿El relleno de `edu_case_procedures` copia el `procedureId` histórico con `tooth NULL`, o la tabla
   nace vacía?** Copiarlo conserva el conteo actual; dejarla vacía pone el avance de todos en cero el día
   del deploy. No hay opción automática correcta.
6. **¿La confirmación de supervisión (ODO-19) es constancia opcional o requisito?** Si se pide para todo,
   la escuela la desconecta el primer mes — como la Ola 4 previó con la ruta de urgencia.
7. **¿`vercel.json` se puede tocar para dar de alta el cron del instituto (ODO-27)?** ⟳ No es un archivo
   «compartido»: para el guardia es **PROHIBIDO** — no está en `SHARED_FILES` y sale con exit 1 sin ofrecer
   la línea de declaración; el propio vertical lo dice (`api/instituto/cron/recordatorios/route.ts:16`).
   O se añade a `SHARED_FILES` en el mismo commit, o el cron lo registra alguien fuera del vertical.
8. **⟳ ¿La serie fotográfica de ODO-12 se guarda a resolución completa o derivada?** El instituto tiene
   **5 TB incluidos, compartidos entre todas sus sedes** (`almacenamiento-core.ts:12,49`) y el corte de
   subida es duro (`almacenamiento.ts:37`). Cuatro etapas × N piezas × M casos contra ese techo es una
   decisión de producto, no técnica. ODO-04 (fotos del odontograma) suma al mismo bote.
9. **⟳ ¿El dinero del estudiante entra en el panel?** Hoy los seis modelos de dinero cuelgan del
   **paciente** y del estudiante no cuelga un peso: `colegiatur` → 0, `tuition` → 0, `condonaci` → 0. La
   segunda pregunta diaria de una dirección de posgrado —«¿quién debe?»— no se puede contestar. O se
   propone (reusando `EduPaymentPlan`/`EduInstallment`, que ya resuelven mensualidades y vencimientos, con
   `studentId` en vez de `patientId`), o se escribe en §9 que «la colegiatura vive en el sistema escolar de
   la universidad y el panel no la toca». Las dos son respuestas legítimas; hoy no está ni dentro ni fuera.
10. **¿Cuántas de estas escuelas existen hoy y con qué tamaño?** Varias propuestas cambian de prioridad si
    el instituto real tiene 20 estudiantes o 200 (el modal «Quién entra» sin buscador, el tope de 300 filas
    de `EDU_CLINICA_MAX_ROWS` en `agenda-core.ts:57`, las ~20 consultas de Dirección, el reparto de IA de
    ODO-38). El código no lo dice.

**Dos datos del encargo que no pude verificar y no debes usar sin confirmarlos:**

- **«12 errores `tsc` solo en pruebas»**: no lo comprobé — esta rama no compila nada, es una investigación
  en solo lectura. Recuerda que `tsconfig.json` incluye `**/*.ts`, así que un tipo roto en un test tumba
  `next build`.
- **«Dirección resuelve en 231 ms»**: no hay ninguna medición de 231 ms en el repo. Las **consultas** sí
  están confirmadas (el código dice 14, el conteo a mano da 15 en 4 tandas, más ~5 de `listEduEvaluacion`).
  Si el número vino de una medición tuya, vale la pena guardarlo donde el vertical guarda las suyas
  (`docs/audits/EDU_AUDIT.md:571-575` documenta así la de Evaluación).
