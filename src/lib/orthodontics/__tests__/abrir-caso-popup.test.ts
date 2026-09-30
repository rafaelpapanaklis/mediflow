/**
 * «Abrir caso» en popup con el plan de pago incluido (ws1-t10, 29-sep-2026).
 * Lo que no se puede probar con funciones puras se prueba en el código: que sea una
 * VENTANA centrada (no un cajón), a pantalla completa en el teléfono, con las cinco
 * secciones en orden, que el cobro se arme al abrir el caso, que sin permiso no se pida
 * y que el botón grande esté donde toca. Las reglas del dinero: plan-al-abrir.test.ts,
 * crear-plan-del-caso.test.ts y crearPlanDelCaso.test.ts.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/abrir-caso-popup.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINEA_DEL_BOTON_ABRIR_CASO } from "../../../components/specialties/orthodontics/redesign/casos-migrados-texto";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const REDISENO = "components/specialties/orthodontics/redesign";
const CAJON = sinComentarios(leer(`${REDISENO}/drawers/DrawerNewCase.tsx`));
const CSS = leer(`${REDISENO}/alta-caso.module.css`);
const TAB = sinComentarios(leer(`${REDISENO}/OrthodonticsPatientTab.tsx`));

test("es una VENTANA centrada, no un cajón pegado a la derecha", () => {
  assert.match(CAJON, /<div className=\{alta\.marco\}>/);
  assert.match(CAJON, /className=\{`\$\{alta\.ventana\}/);
  assert.match(CAJON, /role="dialog"\s+aria-modal="true"\s+aria-labelledby="new-case-title"/);
  assert.doesNotMatch(CAJON, /<aside/);
  assert.doesNotMatch(CAJON, /orto\.cajon\b|orto\.cajonAncho|cajonPieReparto/, "ya no usa las clases del cajón lateral");
  // Sigue cerrando con el velo y con Escape (el mismo hook de foco de los demás cajones), y el foco entra al diálogo.
  assert.match(CAJON, /<div className=\{orto\.velo\} onClick=\{\(\) => cerrarRef\.current\(\)\} aria-hidden \/>/);
  assert.match(CAJON, /useCajon<HTMLDivElement>\(\(\) => cerrarRef\.current\(\)\)/);
  assert.match(CAJON, /tabIndex=\{-1\}/);
  // Centrada: el marco reparte al centro y solo la ventana recibe clics (el resto cae en el velo).
  assert.match(CSS, /\.marco \{[^}]*align-items: center;[^}]*justify-content: center;[^}]*pointer-events: none;/);
  assert.match(CSS, /\.ventana \{[^}]*max-width: 920px;[^}]*pointer-events: auto;/);
  // Por encima del velo (60) y de Sabina (58), por debajo de su panel.
  assert.match(CSS, /\.marco \{[^}]*z-index: 61;/);
});

test("en el teléfono es PANTALLA COMPLETA, de una columna, con los botones del pie a todo el ancho", () => {
  const movil = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}\n?$/.exec(CSS)?.[1] ?? "";
  assert.ok(movil.length > 0, "hay un bloque para el teléfono");
  assert.match(movil, /\.ventana \{[^}]*height: 100dvh;[^}]*max-height: none;[^}]*border-radius: 0;/);
  assert.match(movil, /\.marco \{[^}]*padding: 0;/);
  assert.match(movil, /\.cuadricula,\s*\.cuadricula3 \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(movil, /\.pieBotones > \* \{[^}]*flex: 1 1 0;/);
  // El cuerpo es lo que se desplaza; cabeza y pie se quedan.
  assert.match(CSS, /\.cuerpo \{[^}]*overflow-y: auto;/);
});

test("mismos tokens del panel, claro y oscuro: ni un color escrito a mano", () => {
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(CSS, /\brgba?\(/);
  assert.doesNotMatch(CSS, /prefers-color-scheme/, "el tema lo cambian los tokens, no esta hoja");
  for (const token of ["--pr-tarjeta", "--pr-borde", "--pr-texto", "--pr-activo-suave", "--orto-violeta"]) assert.match(CSS, new RegExp(token));
  // Campos, botones y rótulos son los del módulo.
  assert.match(CAJON, /className=\{orto\.campo\}/);
  assert.match(CAJON, /const inputCls =\s*orto\.entrada;/);
  assert.match(CAJON, /<Btn\s+variant="primary"\s+size="md"/);
});

test("una ventana de DOS pasos con las secciones en orden: Datos del caso · Diagnóstico → Técnica y doctor · Plan (CamposDelPlan) · Retención · Cobro", () => {
  // ws1-t12 (decisión de Rafael): «Abrir caso» = Diagnóstico → Plan de tratamiento (con el cobro dentro).
  const orden = ['titulo="Datos del caso"', 'titulo="Diagnóstico ortodóntico"', 'titulo="Técnica y doctor"', "<CamposDelPlan", 'titulo="Plan de retención"', 'titulo="Cobro"'];
  const posiciones = orden.map((t) => CAJON.indexOf(t));
  posiciones.forEach((p, i) => assert.ok(p > 0, `falta ${orden[i]}`));
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, "en ese orden");
  assert.equal((CAJON.match(/<Seccion\b/g) ?? []).length, 5);
  // Los dos pasos y su navegación.
  assert.match(CAJON, /const \[paso, setPaso\] = useState<PasoDeLaVentana>\(\s*needsDiagnosis \? \(props\.pasoInicial \?\? "diagnostico"\) : editarDx \? \(props\.pasoInicial \?\? "plan"\) : "plan",\s*\);/);
  assert.match(CAJON, /Siguiente: plan de tratamiento/);
  // Un solo formulario para crear y para editar: el modo `editar` parte del caso y guarda con `onEditar`.
  assert.match(CAJON, /props\.modo === "editar"/);
  assert.match(CAJON, /props\.onEditar\?\.\(/);
});

test("el plan de pago se arma AQUÍ: enganche, número de pagos (propuesto = duración), primer pago y vista previa", () => {
  assert.match(CAJON, /label="Enganche \(opcional\)"/);
  assert.match(CAJON, /label="Número de pagos"/);
  assert.match(CAJON, /label="Fecha del primer pago"/);
  assert.match(CAJON, /label="Costo total"/);
  assert.match(CAJON, /pagosPropuestos\(duration\)/, "propuesto = duración estimada en meses");
  assert.match(CAJON, /setPagosTocados\(true\)/, "editable: si lo tocan, deja de seguir a la duración");
  assert.match(CAJON, /const vistaPrevia = vistaPreviaDelPlan\(estadoPlan\);/);
  assert.match(CAJON, /<PlanVistaPrevia texto=\{vistaPrevia\} \/>/);
  // «Pago por control»: el precio de la colocación, del catálogo y editable.
  assert.match(CAJON, /label="Precio de la colocación \(MXN\)"/);
  assert.match(CAJON, /res\.data\.precioColocacion/);
});

test("«Lo armo después»: casilla apagada por defecto; con ella (o sin costo) no se manda ninguna factura", () => {
  assert.match(CAJON, /const \[despues, setDespues\] = useState\(false\);/);
  assert.match(CAJON, /Lo armo después/);
  assert.match(CAJON, /const seCreaLaFactura = hayQueCrearLaFactura\(estadoDelPlan\);/);
  assert.match(CAJON, /const planDePago = planDePagoAlAbrir\(\{ \.\.\.estadoDelPlan, enObservacion: inObservation \}\);/);
  assert.match(CAJON, /await props\.onConfirm\(\{ diagnosis, plan, planDePago \}\);/);
});

test("sin permiso de cobro la sección se oculta y dice «Recepción armará el plan de pago»", () => {
  assert.match(CAJON, /!puedeCobrar \? \(\s*<div className=\{alta\.pendiente\} role="status">[\s\S]*?Recepción armará el plan de pago\./);
  assert.match(CAJON, /const \[puedeCobrar, setPuedeCobrar\] = useState\(false\);/, "hasta saberlo, se asume que NO");
  assert.match(CAJON, /setPuedeCobrar\(res\.data\.puedeCobrar\);/);
  const opciones = leer("app/actions/orthodontics/getCaseIntakeOptions.ts");
  assert.match(opciones, /const puedeCobrar = hasPermission\(\{ role: ctx\.role as never, permissionsOverride: ctx\.permissionsOverride \}, "billing\.create"\);/);
  assert.match(opciones, /precioDeColocacionDelCatalogo\(ctx\.clinicId\)/, "el catálogo de la clínica de la SESIÓN");
});

test("un paciente en observación sigue sin plan de pago (no hay caso con plan): se guarda solo el diagnóstico", () => {
  assert.match(CAJON, /if \(inObservation\) \{[\s\S]*?await props\.onConfirm\(\{ diagnosis: dxListo\.payload, plan: null, planDePago: null \}\);/);
});

test("el paso 1 monta el PasoDiagnostico de ws1-t8 (el mismo de «Editar diagnóstico»): un solo formulario, en modo abrir o editar", () => {
  assert.match(CAJON, /import \{ PasoDiagnostico \} from "\.\.\/diagnostico\/PasoDiagnostico";/);
  assert.match(CAJON, /<PasoDiagnostico\s+valor=\{dx\}/);
  assert.match(CAJON, /modo=\{editarDx \? "editar" : "abrir"\}/);
  // Ya no queda una copia de los campos del diagnóstico dentro de la ventana.
  assert.doesNotMatch(CAJON, /label="Angle derecha"|label="Overjet \(mm\)"|label="Resumen clínico/);
  // Se valida ANTES de pasar al plan y el error lleva a la sección donde está.
  assert.match(CAJON, /const dxListo = diagnosticoParaEnviar\(\);\s*if \(dxListo\.ok === false\) \{[\s\S]*?setSeccionDx\(dxListo\.seccion\);/);
  // Editar: los dos pasos se abren, el de Diagnóstico guarda con updateDiagnosis y la ventana la abre «Editar» del resumen.
  assert.match(CAJON, /await updateDiagnosis\(\{ diagnosisId: props\.existingDiagnosisId, \.\.\.peticionDx \}\)/);
  assert.match(CAJON, /useDiagnosticoCompleto\(editarDx \? props\.existingDiagnosisId : null\)/);
  const cliente = sinComentarios(leer(`${REDISENO}/OrthodonticsRedesignClient.tsx`));
  assert.match(cliente, /pasoInicial=\{drawer\?\.kind === "edit-diagnosis" \? "diagnostico" : "plan"\}/);
});

test("editar: UN solo «Guardar cambios» guarda los dos pasos JUNTOS (nada se pierde al saltar de paso) y cerrar con cambios pregunta", () => {
  const g = CAJON.slice(CAJON.indexOf("const guardarCambios = async"), CAJON.indexOf("const submit = async"));
  assert.ok(g.length > 200);
  // Se valida todo ANTES de escribir; con el plan de por medio, el diagnóstico VA con el plan (una transacción en el servidor).
  const validaDx = g.indexOf('peticionDelDiagnostico(dx, "editar")');
  const validaPlan = g.indexOf("!canSubmit");
  const conPlan = g.indexOf("await enviarPlanEditado(peticionDx)");
  const soloDx = g.indexOf("await updateDiagnosis(");
  assert.ok(validaDx > 0 && validaPlan > validaDx && conPlan > validaPlan && soloDx > conPlan);
  assert.match(g, /const quierePlan = paso === "plan" \|\| planTocado;/);
  assert.match(CAJON, /const dxTocado = editarDx && dxInicial !== null && JSON\.stringify\(dx\) !== dxInicial;/);
  assert.match(CAJON, /diagnostico: peticionDx && props\.existingDiagnosisId \? \{ diagnosisId: props\.existingDiagnosisId, peticion: peticionDx \} : null/);
  // Los dos pasos guardan por la misma función.
  assert.match(CAJON, /if \(editarDx\) \{\s*await guardarCambios\(\);\s*return;\s*\}/);
  assert.match(CAJON, /Hay cambios sin guardar\. ¿Cerrar sin guardar\?/);
  assert.match(CAJON, /"Guardar cambios"/);
  // Quien recibe el envío usa la acción única cuando viene el diagnóstico.
  const tab = sinComentarios(leer(`${REDISENO}/OrthodonticsPatientTab.tsx`));
  assert.match(tab, /if \(p\.diagnostico\) \{[\s\S]*?await guardarDiagnosticoYPlan\(\{ \.\.\.datosDelPlan, diagnosisId: p\.diagnostico\.diagnosisId, diagnostico: p\.diagnostico\.peticion \}\)/);
});

test("guardarDiagnosticoYPlan: valida los dos sin escribir, escribe en UNA transacción y deja cada movimiento", () => {
  const a = sinComentarios(leer("app/actions/orthodontics/guardarDiagnosticoYPlan.ts"));
  assert.match(a, /^"use server";/m);
  assert.match(a, /getOrthoActionContext\(\)/, "permiso de escritura y clínica de la sesión");
  const prepPlan = a.indexOf("prepararGuardadoDelPlan(ctx, o)");
  const prepDx = a.indexOf("prepararGuardadoDelDiagnostico(ctx,");
  const escribe = a.indexOf("aplicarPlanDetalle({");
  assert.ok(prepPlan > 0 && prepDx > prepPlan && escribe > prepDx, "primero se valida todo, después se escribe");
  assert.match(a, /diagnosisId !== caso\.diagnosisId\) return fail\("Diagnóstico no encontrado"\)/, "el diagnóstico tiene que ser el del caso");
  assert.match(a, /dxPrep\.preparado\.patientId !== caso\.patientId/);
  assert.match(a, /enLaTransaccion: dx\s*\?\s*async \(tx\) => \{\s*resultadoDx = await ejecutarGuardadoDelDiagnostico\(dx, tx\);/);
  // El movimiento del diagnóstico se registra DESPUÉS de confirmar la transacción.
  assert.ok(a.indexOf("await movimientoDelDiagnostico(guardadoDx)") > escribe);
  const lib = sinComentarios(leer("lib/orthodontics/plan-detalle-guardar.ts"));
  assert.match(lib, /if \(args\.enLaTransaccion\) await args\.enLaTransaccion\(tx\);/);
  // «Editar plan» solo y el guardado único validan con la MISMA función.
  assert.match(sinComentarios(leer("app/actions/orthodontics/guardarPlanDeTratamiento.ts")), /prepararGuardadoDelPlan\(ctx, input\)/);
});

test("al abrir el caso, el diagnóstico completo se guarda enseguida con el mismo servidor de «Editar diagnóstico»; si falla, el caso sigue abierto y se dice", () => {
  const crear = TAB.indexOf("await createDiagnosis(");
  const detalle = TAB.indexOf("await updateDiagnosis({ diagnosisId, ...payload.diagnosis.detalle, ...pasoDelAlta })");
  const plan = TAB.indexOf("await createTreatmentPlan(");
  assert.ok(crear > 0 && detalle > crear && plan > detalle, "diagnóstico → su detalle → plan");
  assert.match(TAB, /El diagnóstico se creó, pero el detalle no se guardó/);
});

test("al confirmar: primero se abre el caso y DESPUÉS se crea su factura; si falla, el caso queda abierto y se dice cómo reintentar", () => {
  const abrir = TAB.indexOf("await createTreatmentPlan(");
  const cobrar = TAB.indexOf("await crearPlanDelCaso(");
  assert.ok(abrir > 0 && cobrar > abrir, "la factura se crea con el id del caso recién abierto");
  assert.match(TAB, /crearPlanDelCaso\(\{\s*treatmentPlanId: res\.data\.id,\s*\.\.\.payload\.planDePago,\s*aperturaDelCaso:/);
  assert.match(TAB, /if \(payload\.planDePago\) \{/, "sin planDePago (después / sin permiso) no se llama");
  assert.match(TAB, /El caso se abrió, pero el plan de pago no se pudo crear: \$\{cobro\.error\} Reinténtalo en Cobro, con «Abrir plan de pago»\./);
  // Sigue existiendo el camino de «Abrir plan de pago» para quien lo dejó «después».
  assert.match(leer(`${REDISENO}/sections/SectionFinance.tsx`), /Abrir plan de pago/);
  // Los tres sitios que abren el popup pasan por la misma función y el mismo tipo.
  for (const f of ["OrtodonciaSinCaso.tsx", "OrthodonticsRedesignClient.tsx"]) assert.match(leer(`${REDISENO}/${f}`), /DrawerNewCaseSubmit/);
  assert.match(TAB, /const crearCaso = async \(payload: DrawerNewCaseSubmit\)(: Promise<boolean>)? =>/);
});

test("la acción: exige billing.create ANTES de tocar nada, saca la clínica de la sesión y no recibe paciente ni clínica", () => {
  const a = sinComentarios(leer("app/actions/orthodontics/cobro/crearPlanDelCaso.ts"));
  assert.match(a, /^"use server";/m);
  assert.deepEqual([...a.matchAll(/^export (?!async function)(\w+)/gm)].map((m) => m[1]), [], "un archivo «use server» solo exporta funciones async");
  assert.ok(a.indexOf('getOrthoBillingActionContext("billing.create")') > 0);
  assert.ok(a.indexOf('getOrthoBillingActionContext("billing.create")') < a.indexOf("prisma."), "el permiso va antes de cualquier consulta");
  assert.ok(a.indexOf('getOrthoBillingActionContext("billing.create")') < a.indexOf("crearPlanDelCasoCore("));
  assert.match(a, /const clinicId = ctx\.clinicId;\s*if \(!clinicId\) return fail/);
  assert.match(a, /args: \{\s*treatmentPlanId: string;\s*aperturaDelCaso\?: \{ diagnostico\?: boolean; detalleDelPlan\?: boolean \};\s*\} & PlanDePagoAlAbrir/, "solo el id del caso, dos banderas y las condiciones: nada de clínica ni paciente");
  assert.doesNotMatch(a, /args\.clinicId|args\.patientId/);
  // Toda consulta lleva la clínica de la sesión.
  assert.doesNotMatch(a, /clinicId: undefined/);
  // La factura se liga con la misma acción de siempre (duplicadas, dos pestañas, bitácora).
  assert.match(a, /abrirPlanDePago\(\{ treatmentPlanId: caso\.id, invoiceId \}\)/);
});

test("la factura sale con la misma aritmética y el mismo borrador que «Abrir plan de pago»", () => {
  const n = sinComentarios(leer("lib/orthodontics/cobro/crear-plan-del-caso.ts"));
  assert.match(n, /borradorInicialDelCaso\(caso, esPorControl, precioColocacion\)/);
  assert.match(n, /computeInvoiceTotal\(items, 0, taxRate, taxIncluded\)/);
  assert.match(n, /condicionesDelPlan\(plan, total\)/);
});

test("el botón «Abrir caso de ortodoncia»: icono, título y UNA línea de qué pasa, en la ficha sin caso y en el estado vacío de la cabecera", () => {
  const boton = leer(`${REDISENO}/BotonAbrirCaso.tsx`);
  assert.match(boton, /<FolderPlus/);
  assert.match(boton, /\{LINEA_DEL_BOTON_ABRIR_CASO\}/);
  assert.match(boton, /<ArrowRight/);
  assert.equal(LINEA_DEL_BOTON_ABRIR_CASO, "Diagnóstico, datos del caso y plan de pago, en una sola ventana.");
  assert.ok(!LINEA_DEL_BOTON_ABRIR_CASO.includes("\n") && LINEA_DEL_BOTON_ABRIR_CASO.split(".").length === 2, "una sola oración");
  assert.match(sinComentarios(leer(`${REDISENO}/OrtodonciaSinCaso.tsx`)), /<BotonAbrirCaso\s+className="mt-2"\s+etiqueta=\{etiquetaAbrirCaso\(nMigrados\)\}/);
  assert.match(sinComentarios(leer(`${REDISENO}/sections/SectionHero.tsx`)), /<BotonAbrirCaso className="mt-2" etiqueta="Abrir caso de ortodoncia" onClick=\{onStart\} \/>/);
  // Se ve como botón principal y en el teléfono ocupa el ancho.
  assert.match(CSS, /\.cta \{[^}]*background: var\(--pr-activo\);[^}]*color: var\(--pr-activo-texto\);/);
  assert.match(CSS, /@media \(max-width: 640px\) \{[\s\S]*\.cta \{\s*width: 100%;/);
});
