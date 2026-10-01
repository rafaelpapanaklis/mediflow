/**
 * BASE FALSA MULTI-CLÍNICA — ws1-t10 (prueba automática de aislamiento).
 *
 * Un Prisma en memoria que se arma SOLO a partir del esquema real
 * (`Prisma.dmmf`): cada modelo del esquema tiene una fila por «dueño de fila»:
 *
 *   A = la clínica de la sesión (la que hace la petición)
 *   C = una SEDE HERMANA de A: mismo dueño (mismo supabaseId), otra clínica
 *   B = una clínica AJENA, de otro dueño
 *   G = global (modelos que no cuelgan de ninguna clínica: catálogos, planes…)
 *
 * Todos los ids de la clínica B son la MISMA cadena (`idB`) en todas las tablas
 * (cada tabla tiene su propia fila `idB`), y lo mismo `idA`, `idC`, `idG`. Así
 * una petición con `…/idB` o `{ patientId: "idB" }` apunta a la fila de B de
 * CUALQUIER tabla que el handler consulte, sin saber de qué modelo es el id.
 *
 * Lo que hace de «detector»: cada lectura/escritura que el handler hace sobre
 * una fila cuyo dueño no está en `permitidos` se APUNTA como fuga (`fugas`).
 * Los datos de cada fila llevan una marca (`§B§Modelo.campo`) para detectar
 * también lo que sale en la respuesta HTTP.
 *
 * No es un Prisma completo: soporta lo que el panel usa (where con AND/OR/NOT,
 * filtros escalares, filtros por relación, include/select anidados, orderBy,
 * take/skip, count/aggregate/groupBy, create/update/delete/upsert y las
 * variantes Many). Lo que no entiende lo dice en voz alta (`noSoportado`) en
 * vez de adivinar. SQL crudo no se puede verificar: se cuenta (`crudo`).
 */
import { Prisma } from "@prisma/client";

export type Dueno = "A" | "B" | "C" | "G";
export const ID: Record<Dueno, string> = { A: "idA", B: "idB", C: "idC", G: "idG" };
export const SUPABASE_DE: Record<"A" | "B" | "C", string> = { A: "sup-dueno-1", B: "sup-dueno-2", C: "sup-dueno-1" };
export const MARCA: Record<Dueno, string> = { A: "§A§", B: "§B§", C: "§C§", G: "§G§" };

interface Campo {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  isList: boolean;
  isRequired: boolean;
  isId: boolean;
  hasDefaultValue: boolean;
  relationName?: string;
  relationFromFields?: readonly string[];
  relationToFields?: readonly string[];
}
interface Modelo {
  name: string;
  fields: readonly Campo[];
  primaryKey: { fields: readonly string[] } | null;
  uniqueFields: readonly (readonly string[])[];
}

const DATAMODEL = (Prisma as any).dmmf.datamodel as { models: Modelo[]; enums: { name: string; values: { name: string }[] }[] };
export const MODELOS: Modelo[] = DATAMODEL.models;
const POR_NOMBRE = new Map(MODELOS.map((m) => [m.name, m]));
const ENUMS = new Map(DATAMODEL.enums.map((e) => [e.name, e.values.map((v) => v.name)]));
const lcfirst = (s: string) => s[0].toLowerCase() + s.slice(1);
const POR_DELEGADO = new Map(MODELOS.map((m) => [lcfirst(m.name), m]));

export interface Fuga {
  tipo: "lectura" | "escritura" | "alta";
  modelo: string;
  operacion: string;
  dueno: Dueno;
}

/** Qué modelos cuelgan de una clínica (directo con clinicId o por una relación). */
export const MODELOS_DE_CLINICA: Set<string> = (() => {
  const set = new Set<string>(["Clinic"]);
  for (const m of MODELOS) {
    if (m.fields.some((f) => f.name === "clinicId" && f.kind === "scalar")) set.add(m.name);
  }
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const m of MODELOS) {
      if (set.has(m.name)) continue;
      if (m.fields.some((f) => f.kind === "object" && f.relationFromFields?.length && set.has(f.type))) {
        set.add(m.name);
        cambio = true;
      }
    }
  }
  return set;
})();

type Fila = Record<string, any>;
const FECHA = new Date("2026-06-15T12:00:00.000Z");

/** Valores que NO conviene dejar al azar del primer valor del enum. */
const FIJOS: Record<string, any> = {
  "User.role": "SUPER_ADMIN",
  "User.isActive": true,
  "User.permissionsOverride": [],
  "User.totpEnabled": false,
  "Clinic.subscriptionStatus": "active",
  "Clinic.category": "DENTAL",
  "Clinic.timezone": "America/Mexico_City",
  "Clinic.require2fa": false,
  "Clinic.defaultSlotMinutes": 30,
  "Clinic.agendaDayStart": 8,
  "Clinic.agendaDayEnd": 20,
  "Clinic.locale": "es",
  "Clinic.country": "MX",
  "Patient.deletedAt": null,
  "Patient.status": "ACTIVE",
  "Appointment.status": "SCHEDULED",
};

function valorEscalar(m: Modelo, f: Campo, d: Dueno): any {
  const clave = `${m.name}.${f.name}`;
  if (clave in FIJOS) return FIJOS[clave];
  if (f.isList) return [];
  if (!f.isRequired) return null;
  if (f.kind === "enum") return ENUMS.get(f.type)?.[0] ?? null;
  switch (f.type) {
    case "String": return `${MARCA[d]}${clave}`;
    case "Int": case "Float": case "BigInt": return 1;
    case "Decimal": return new Prisma.Decimal(1);
    case "Boolean": return false;
    case "DateTime": return FECHA;
    case "Json": return {};
    case "Bytes": return Buffer.from("x");
    default: return null;
  }
}

export interface OpcionesBase {
  /** Dueños cuyas filas se pueden LEER sin que cuente como fuga (siempre incluye A y G). */
  permitidos?: Dueno[];
  /** Dueños cuyas filas se pueden ESCRIBIR / a los que se puede atar una fila nueva. Por defecto solo A y G. */
  permitidosEscritura?: Dueno[];
  /**
   * De quién es la clínica C. `mismo` (por defecto) = sede hermana: el mismo
   * dueño que A. `otro` = una tercera clínica de OTRO dueño: sirve para probar
   * que una excepción de «sedes del mismo dueño» no se abre a cualquiera.
   */
  duenoDeC?: "mismo" | "otro";
}

export class BaseFalsa {
  tablas = new Map<string, { fila: Fila; dueno: Dueno }[]>();
  fugas: Fuga[] = [];
  noSoportado: string[] = [];
  crudo = 0;
  consultas = 0;
  /** Cuántas consultas devolvieron al menos una fila de A (el handler llegó a la base). */
  permitidos: Set<Dueno>;
  permitidosEscritura: Set<Dueno>;
  private duenoDeC: "mismo" | "otro";
  private contadorIds = 0;
  /**
   * La resolución de la SESIÓN lee las filas `User` del dueño (una por sede) y
   * su clínica: eso es «mis sedes», no una fuga. Solo se tolera esa consulta
   * (`where.supabaseId` = el dueño de A) y solo para las filas de su sede
   * hermana C; las de B (otro dueño) siguen siendo fuga.
   */
  private tolerarSedesDelDueno = false;

  constructor(opciones: OpcionesBase = {}) {
    this.permitidos = new Set<Dueno>(["A", "G", ...(opciones.permitidos ?? [])]);
    this.permitidosEscritura = new Set<Dueno>(["A", "G", ...(opciones.permitidosEscritura ?? [])]);
    this.duenoDeC = opciones.duenoDeC ?? "mismo";
    this.sembrar();
  }

  // ── Siembra ─────────────────────────────────────────────────────────────
  private sembrar() {
    for (const m of MODELOS) this.tablas.set(m.name, []);
    const duenos: Dueno[] = ["A", "C", "B"];
    for (const m of MODELOS) {
      if (MODELOS_DE_CLINICA.has(m.name)) for (const d of duenos) this.insertar(m, d);
      else this.insertar(m, "G");
    }
  }

  private insertar(m: Modelo, d: Dueno) {
    const fila: Fila = {};
    for (const f of m.fields) {
      if (f.kind === "object") continue;
      fila[f.name] = valorEscalar(m, f, d);
    }
    // El id propio y las llaves foráneas apuntan a la fila del MISMO dueño.
    for (const f of m.fields) {
      if (f.kind === "scalar" && (f.isId || f.name === "id") && f.type === "String") fila[f.name] = ID[d];
    }
    for (const f of m.fields) {
      if (f.kind !== "object" || !f.relationFromFields?.length) continue;
      const destino = MODELOS_DE_CLINICA.has(f.type) ? d : "G";
      const destinoId = f.type === "Clinic" ? ID[d === "G" ? "A" : d] : ID[destino as Dueno];
      f.relationFromFields.forEach((ff, i) => {
        const tf = f.relationToFields?.[i] ?? "id";
        fila[ff] = tf === "id" ? destinoId : fila[ff];
      });
    }
    if ("clinicId" in fila && d !== "G") fila.clinicId = ID[d];
    for (const f of m.fields) {
      if (f.kind === "scalar" && f.isId && f.type === "Int") fila[f.name] = { A: 1, B: 2, C: 3, G: 4 }[d];
    }
    if (m.name === "User") {
      fila.supabaseId = d === "C" && this.duenoDeC === "otro" ? "sup-dueno-3" : SUPABASE_DE[d as "A" | "B" | "C"];
      fila.createdAt = new Date(FECHA.getTime() + (d === "A" ? 0 : d === "C" ? 1000 : 2000));
      fila.email = `${d.toLowerCase()}@prueba.test`;
    }
    this.tablas.get(m.name)!.push({ fila, dueno: d });
  }

  // ── Evaluación de where ─────────────────────────────────────────────────
  private relacionados(m: Modelo, fila: Fila, f: Campo): { fila: Fila; dueno: Dueno }[] {
    const destino = POR_NOMBRE.get(f.type)!;
    const tabla = this.tablas.get(destino.name)!;
    if (f.relationFromFields?.length) {
      return tabla.filter((r) => f.relationToFields!.every((tf, i) => r.fila[tf] === fila[f.relationFromFields![i]]));
    }
    const vuelta = destino.fields.find((x) => x.relationName === f.relationName && x.name !== f.name)
      ?? destino.fields.find((x) => x.relationName === f.relationName);
    if (vuelta?.relationFromFields?.length) {
      return tabla.filter((r) => vuelta.relationFromFields!.every((ff, i) => r.fila[ff] === fila[vuelta.relationToFields![i]]));
    }
    // Muchos-a-muchos implícito: se aproxima con las filas del mismo dueño.
    const dueno = this.duenoDe(m, fila);
    return tabla.filter((r) => r.dueno === dueno);
  }

  private duenoDe(m: Modelo, fila: Fila): Dueno {
    const e = this.tablas.get(m.name)!.find((r) => r.fila === fila);
    return e?.dueno ?? "G";
  }

  private cumpleEscalar(valor: any, filtro: any): boolean {
    const igual = (a: any, b: any) =>
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b || (a == null && b == null);
    if (filtro === null || typeof filtro !== "object" || filtro instanceof Date || filtro instanceof Prisma.Decimal || Buffer.isBuffer(filtro)) {
      return igual(valor, filtro);
    }
    return Object.entries(filtro).every(([op, v]: [string, any]) => {
      switch (op) {
        case "equals": return igual(valor, v);
        case "not": return typeof v === "object" && v !== null && !(v instanceof Date) ? !this.cumpleEscalar(valor, v) : !igual(valor, v);
        case "in": return (v as any[]).some((x) => igual(valor, x));
        case "notIn": return !(v as any[]).some((x) => igual(valor, x));
        case "lt": return valor != null && valor < v;
        case "lte": return valor != null && valor <= v;
        case "gt": return valor != null && valor > v;
        case "gte": return valor != null && valor >= v;
        case "contains": return typeof valor === "string" && valor.toLowerCase().includes(String(v).toLowerCase());
        case "startsWith": return typeof valor === "string" && valor.toLowerCase().startsWith(String(v).toLowerCase());
        case "endsWith": return typeof valor === "string" && valor.toLowerCase().endsWith(String(v).toLowerCase());
        case "mode": return true;
        case "has": return Array.isArray(valor) && valor.includes(v);
        case "hasSome": return Array.isArray(valor) && (v as any[]).some((x) => valor.includes(x));
        case "hasEvery": return Array.isArray(valor) && (v as any[]).every((x) => valor.includes(x));
        case "isEmpty": return Array.isArray(valor) && (valor.length === 0) === v;
        case "path": case "string_contains": case "array_contains": case "string_starts_with": return true;
        default:
          this.noSoportado.push(`filtro escalar «${op}»`);
          return true;
      }
    });
  }

  cumple(m: Modelo, fila: Fila, where: any): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (v === undefined) return true;
      if (k === "AND") return (Array.isArray(v) ? v : [v]).every((w) => this.cumple(m, fila, w));
      if (k === "OR") return Array.isArray(v) ? (v.length === 0 ? false : v.some((w) => this.cumple(m, fila, w))) : this.cumple(m, fila, v);
      if (k === "NOT") return !(Array.isArray(v) ? v : [v]).some((w) => this.cumple(m, fila, w));
      const campo = m.fields.find((f) => f.name === k);
      if (campo?.kind === "object") {
        const destino = POR_NOMBRE.get(campo.type)!;
        const rel = this.relacionados(m, fila, campo);
        if (campo.isList) {
          if (v === null || typeof v !== "object") return true;
          return Object.entries(v).every(([q, w]: [string, any]) => {
            if (q === "some") return rel.some((r) => this.cumple(destino, r.fila, w));
            if (q === "every") return rel.every((r) => this.cumple(destino, r.fila, w));
            if (q === "none") return !rel.some((r) => this.cumple(destino, r.fila, w));
            this.noSoportado.push(`filtro de lista «${q}»`);
            return true;
          });
        }
        if (v === null) return rel.length === 0;
        if ("is" in v || "isNot" in v) {
          const okIs = "is" in v ? (v.is === null ? rel.length === 0 : rel.some((r) => this.cumple(destino, r.fila, v.is))) : true;
          const okNot = "isNot" in v ? (v.isNot === null ? rel.length > 0 : !rel.some((r) => this.cumple(destino, r.fila, v.isNot))) : true;
          return okIs && okNot;
        }
        return rel.some((r) => this.cumple(destino, r.fila, v));
      }
      if (!campo) {
        // Llave única compuesta: { supabaseId_clinicId: { supabaseId, clinicId } }.
        const compuesta = [m.primaryKey?.fields, ...m.uniqueFields].find((fs) => fs && fs.join("_") === k);
        if (compuesta && v && typeof v === "object") return compuesta.every((c) => this.cumpleEscalar(fila[c], v[c]));
        this.noSoportado.push(`campo desconocido ${m.name}.${k}`);
        return true;
      }
      return this.cumpleEscalar(fila[k], v);
    });
  }

  // ── Lecturas ────────────────────────────────────────────────────────────
  private modelo(delegado: string): Modelo {
    const m = POR_DELEGADO.get(delegado);
    if (!m) throw new Error(`modelo desconocido: ${delegado}`);
    return m;
  }

  private anotar(tipo: Fuga["tipo"], m: Modelo, operacion: string, dueno: Dueno) {
    if ((tipo === "lectura" ? this.permitidos : this.permitidosEscritura).has(dueno)) return;
    if (this.tolerarSedesDelDueno && dueno === "C" && tipo === "lectura" && this.duenoDeC === "mismo") return;
    this.fugas.push({ tipo, modelo: m.name, operacion, dueno });
  }

  private ordenar(m: Modelo, filas: { fila: Fila; dueno: Dueno }[], orderBy: any) {
    const criterios = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o: any) => Object.entries(o));
    if (criterios.length === 0) return filas;
    return [...filas].sort((a, b) => {
      for (const [campo, dir] of criterios as [string, any][]) {
        const sentido = (typeof dir === "string" ? dir : dir?.sort) === "desc" ? -1 : 1;
        const x = a.fila[campo], y = b.fila[campo];
        if (x == null && y == null) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        if (x < y) return -sentido;
        if (x > y) return sentido;
      }
      return 0;
    });
  }

  /** Aplica select/include a una fila ya elegida. `leer` = lo que cuenta como lectura. */
  private proyectar(m: Modelo, e: { fila: Fila; dueno: Dueno }, args: any, operacion: string): any {
    const sel = args?.select, inc = args?.include;
    const salida: Fila = {};
    if (!sel) for (const [k, v] of Object.entries(e.fila)) salida[k] = clonar(v);
    else for (const [k, v] of Object.entries(sel)) {
      const f = m.fields.find((x) => x.name === k);
      if (k === "_count") continue;
      if (f && f.kind !== "object" && v) salida[k] = clonar(e.fila[k]);
    }
    const pedidos: [string, any][] = [...Object.entries(inc ?? {}), ...Object.entries(sel ?? {})];
    for (const [k, v] of pedidos) {
      if (!v) continue;
      if (k === "_count") {
        const cuenta: Fila = {};
        const s = (v as any).select ?? {};
        for (const rel of Object.keys(s)) {
          const f = m.fields.find((x) => x.name === rel);
          if (f?.kind === "object") cuenta[rel] = this.relacionados(m, e.fila, f).filter((r) => this.cumple(POR_NOMBRE.get(f.type)!, r.fila, s[rel]?.where)).length;
        }
        salida._count = cuenta;
        continue;
      }
      const f = m.fields.find((x) => x.name === k);
      if (!f || f.kind !== "object") continue;
      const destino = POR_NOMBRE.get(f.type)!;
      const sub = v === true ? {} : v;
      let rel = this.relacionados(m, e.fila, f).filter((r) => this.cumple(destino, r.fila, sub.where));
      rel = this.ordenar(destino, rel, sub.orderBy);
      if (sub.skip) rel = rel.slice(sub.skip);
      if (sub.take != null) rel = sub.take < 0 ? rel.slice(sub.take) : rel.slice(0, sub.take);
      for (const r of rel) this.anotar("lectura", destino, `${operacion}+${k}`, r.dueno);
      const proy = rel.map((r) => this.proyectar(destino, r, sub, operacion));
      salida[k] = f.isList ? proy : (proy[0] ?? null);
    }
    return salida;
  }

  private buscar(m: Modelo, args: any, operacion: string, opciones: { uno?: boolean } = {}) {
    this.consultas++;
    let filas = this.tablas.get(m.name)!.filter((e) => this.cumple(m, e.fila, args?.where));
    filas = this.ordenar(m, filas, args?.orderBy);
    if (args?.cursor) {
      const i = filas.findIndex((e) => this.cumple(m, e.fila, args.cursor));
      filas = i >= 0 ? filas.slice(i) : [];
    }
    if (args?.skip) filas = filas.slice(args.skip);
    if (args?.take != null) filas = args.take < 0 ? filas.slice(args.take) : filas.slice(0, args.take);
    if (opciones.uno) filas = filas.slice(0, 1);
    for (const e of filas) this.anotar("lectura", m, operacion, e.dueno);
    return filas;
  }

  // ── Escrituras ──────────────────────────────────────────────────────────
  private aplicarDatos(m: Modelo, fila: Fila, data: any, operacion: string) {
    for (const [k, v] of Object.entries(data ?? {}) as [string, any][]) {
      if (v === undefined) continue;
      const f = m.fields.find((x) => x.name === k);
      if (!f) { this.noSoportado.push(`campo desconocido en data ${m.name}.${k}`); continue; }
      if (f.kind === "object") { this.relacionEnData(m, fila, f, v, operacion); continue; }
      if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof Prisma.Decimal) && !Array.isArray(v) && f.type !== "Json") {
        if ("set" in v) fila[k] = v.set;
        else if ("increment" in v) fila[k] = Number(fila[k] ?? 0) + Number(v.increment);
        else if ("decrement" in v) fila[k] = Number(fila[k] ?? 0) - Number(v.decrement);
        else if ("multiply" in v) fila[k] = Number(fila[k] ?? 0) * Number(v.multiply);
        else if ("push" in v) fila[k] = [...(fila[k] ?? []), ...(Array.isArray(v.push) ? v.push : [v.push])];
        else fila[k] = v;
      } else fila[k] = v;
      // Una llave foránea (o clinicId) escrita a mano que apunta a otro dueño es
      // una fuga. Un texto libre que repite el id (p. ej. `entityId` de la
      // bitácora) NO ata nada: no cuenta.
      if (typeof v === "string" && (k === "clinicId" || m.fields.some((x) => x.kind === "object" && x.relationFromFields?.includes(k)))) {
        this.revisarId(m, v, operacion);
      }
    }
  }

  private revisarId(m: Modelo, id: string, operacion: string) {
    for (const d of ["A", "B", "C"] as Dueno[]) {
      if (id === ID[d] && !this.permitidosEscritura.has(d)) this.fugas.push({ tipo: "alta", modelo: m.name, operacion: `${operacion} (apunta a ${ID[d]})`, dueno: d });
    }
  }

  private relacionEnData(m: Modelo, fila: Fila, f: Campo, v: any, operacion: string) {
    const destino = POR_NOMBRE.get(f.type)!;
    const conectar = (w: any) => {
      const cand = this.tablas.get(destino.name)!.filter((e) => this.cumple(destino, e.fila, w)).slice(0, 1);
      for (const e of cand) {
        if (!this.permitidosEscritura.has(e.dueno)) this.fugas.push({ tipo: "alta", modelo: m.name, operacion: `${operacion} (connect a ${destino.name} de ${e.dueno})`, dueno: e.dueno });
        if (f.relationFromFields?.length) f.relationFromFields.forEach((ff, i) => { fila[ff] = e.fila[f.relationToFields![i]]; });
      }
    };
    for (const [q, w] of Object.entries(v) as [string, any][]) {
      if (q === "connect") (Array.isArray(w) ? w : [w]).forEach(conectar);
      else if (q === "connectOrCreate") (Array.isArray(w) ? w : [w]).forEach((x) => conectar(x.where));
      else if (q === "create" || q === "createMany") {/* hijos nuevos: nacen del dueño A */}
      else if (q === "disconnect" || q === "set" || q === "update" || q === "upsert" || q === "delete" || q === "deleteMany" || q === "updateMany") {/* sin efecto en la base falsa */}
      else this.noSoportado.push(`relación en data «${q}»`);
    }
  }

  private crear(m: Modelo, data: any, operacion: string) {
    const fila: Fila = {};
    for (const f of m.fields) if (f.kind !== "object") fila[f.name] = valorEscalar(m, f, "A");
    for (const f of m.fields) if (f.kind === "scalar" && (f.isId || f.name === "id") && f.type === "String") fila[f.name] = `idN${++this.contadorIds}`;
    for (const f of m.fields) if (f.kind === "scalar" && f.hasDefaultValue && f.type === "String" && f.name !== "id" && f.isRequired === false) fila[f.name] = null;
    this.aplicarDatos(m, fila, data, operacion);
    if ("clinicId" in fila && (data?.clinicId === undefined) && MODELOS_DE_CLINICA.has(m.name)) fila.clinicId = ID.A;
    // El dueño de la fila nueva es la clínica a la que se la ATÓ el handler.
    const clin = typeof fila.clinicId === "string" ? fila.clinicId : ID.A;
    const dueno = (Object.entries(ID).find(([, v]) => v === clin)?.[0] as Dueno | undefined) ?? "A";
    if (!this.permitidosEscritura.has(dueno)) this.fugas.push({ tipo: "alta", modelo: m.name, operacion: `${operacion} (clinicId=${clin})`, dueno });
    this.tablas.get(m.name)!.push({ fila, dueno });
    return { fila, dueno };
  }

  private noEncontrado(m: Modelo, operacion: string) {
    return new Prisma.PrismaClientKnownRequestError(`${m.name}.${operacion}: registro no encontrado (base falsa)`, {
      code: "P2025",
      clientVersion: "fake",
    });
  }

  // ── Operaciones por delegado ────────────────────────────────────────────
  private delegado(nombre: string) {
    const m = this.modelo(nombre);
    const salida = (e: { fila: Fila; dueno: Dueno }, args: any, op: string) => this.proyectar(m, e, args, op);
    const base: Record<string, (args?: any) => Promise<any>> = {};
    const ops: Record<string, (args?: any) => Promise<any>> = {
      findUnique: async (a) => { const e = this.buscar(m, a, "findUnique", { uno: true })[0]; return e ? salida(e, a, "findUnique") : null; },
      findUniqueOrThrow: async (a) => { const e = this.buscar(m, a, "findUniqueOrThrow", { uno: true })[0]; if (!e) throw this.noEncontrado(m, "findUniqueOrThrow"); return salida(e, a, "findUniqueOrThrow"); },
      findFirst: async (a) => { const e = this.buscar(m, a, "findFirst", { uno: true })[0]; return e ? salida(e, a, "findFirst") : null; },
      findFirstOrThrow: async (a) => { const e = this.buscar(m, a, "findFirstOrThrow", { uno: true })[0]; if (!e) throw this.noEncontrado(m, "findFirstOrThrow"); return salida(e, a, "findFirstOrThrow"); },
      findMany: async (a) => this.buscar(m, a, "findMany").map((e) => salida(e, a, "findMany")),
      count: async (a) => {
        const n = this.tablas.get(m.name)!.filter((e) => this.cumple(m, e.fila, a?.where));
        this.consultas++;
        for (const e of n) this.anotar("lectura", m, "count", e.dueno);
        if (a?.select && typeof a.select === "object") return Object.fromEntries(Object.keys(a.select).map((k) => [k, n.length]));
        return n.length;
      },
      aggregate: async (a) => {
        const filas = this.buscar(m, a, "aggregate");
        const out: Fila = {};
        for (const agg of ["_count", "_sum", "_avg", "_min", "_max"]) {
          if (!a?.[agg]) continue;
          out[agg] = {};
          for (const campo of Object.keys(a[agg])) {
            const xs = filas.map((e) => e.fila[campo]).filter((x) => x != null).map((x) => (x instanceof Prisma.Decimal ? x.toNumber() : x));
            out[agg][campo] = agg === "_count" ? (campo === "_all" ? filas.length : xs.length)
              : xs.length === 0 ? null
              : agg === "_sum" ? xs.reduce((s: number, x: number) => s + x, 0)
              : agg === "_avg" ? xs.reduce((s: number, x: number) => s + x, 0) / xs.length
              : agg === "_min" ? xs.reduce((s: any, x: any) => (x < s ? x : s)) : xs.reduce((s: any, x: any) => (x > s ? x : s));
          }
        }
        return out;
      },
      groupBy: async (a) => {
        const filas = this.buscar(m, a, "groupBy");
        const por: string[] = Array.isArray(a.by) ? a.by : [a.by];
        const grupos = new Map<string, typeof filas>();
        for (const e of filas) {
          const k = JSON.stringify(por.map((c) => e.fila[c]));
          grupos.set(k, [...(grupos.get(k) ?? []), e]);
        }
        return [...grupos.values()].map((es) => {
          const g: Fila = Object.fromEntries(por.map((c) => [c, es[0].fila[c]]));
          for (const agg of ["_count", "_sum", "_avg", "_min", "_max"]) {
            if (!a[agg]) continue;
            g[agg] = {};
            for (const campo of a[agg] === true ? ["_all"] : Object.keys(a[agg])) {
              const xs = es.map((e) => e.fila[campo]).filter((x) => x != null).map((x) => (x instanceof Prisma.Decimal ? x.toNumber() : x));
              g[agg][campo] = agg === "_count" ? (campo === "_all" ? es.length : xs.length) : xs.length ? (agg === "_sum" ? xs.reduce((s: number, x: number) => s + x, 0) : agg === "_avg" ? xs.reduce((s: number, x: number) => s + x, 0) / xs.length : agg === "_min" ? Math.min(...xs) : Math.max(...xs)) : null;
            }
          }
          return g;
        });
      },
      create: async (a) => { this.consultas++; const e = this.crear(m, a?.data, "create"); return salida(e, a, "create"); },
      createMany: async (a) => {
        this.consultas++;
        const datos = Array.isArray(a?.data) ? a.data : [a?.data];
        for (const d of datos) this.crear(m, d, "createMany");
        return { count: datos.length };
      },
      createManyAndReturn: async (a) => {
        this.consultas++;
        const datos = Array.isArray(a?.data) ? a.data : [a?.data];
        return datos.map((d: any) => salida(this.crear(m, d, "createManyAndReturn"), a, "createManyAndReturn"));
      },
      update: async (a) => {
        this.consultas++;
        const e = this.tablas.get(m.name)!.find((x) => this.cumple(m, x.fila, a?.where));
        if (!e) throw this.noEncontrado(m, "update");
        this.anotar("escritura", m, "update", e.dueno);
        this.aplicarDatos(m, e.fila, a.data, "update");
        return salida(e, a, "update");
      },
      updateMany: async (a) => {
        this.consultas++;
        const es = this.tablas.get(m.name)!.filter((x) => this.cumple(m, x.fila, a?.where));
        for (const e of es) { this.anotar("escritura", m, "updateMany", e.dueno); this.aplicarDatos(m, e.fila, a.data, "updateMany"); }
        return { count: es.length };
      },
      delete: async (a) => {
        this.consultas++;
        const t = this.tablas.get(m.name)!;
        const i = t.findIndex((x) => this.cumple(m, x.fila, a?.where));
        if (i < 0) throw this.noEncontrado(m, "delete");
        this.anotar("escritura", m, "delete", t[i].dueno);
        const [e] = t.splice(i, 1);
        return salida(e, a, "delete");
      },
      deleteMany: async (a) => {
        this.consultas++;
        const t = this.tablas.get(m.name)!;
        const es = t.filter((x) => this.cumple(m, x.fila, a?.where));
        for (const e of es) this.anotar("escritura", m, "deleteMany", e.dueno);
        this.tablas.set(m.name, t.filter((x) => !es.includes(x)));
        return { count: es.length };
      },
      upsert: async (a) => {
        this.consultas++;
        const e = this.tablas.get(m.name)!.find((x) => this.cumple(m, x.fila, a?.where));
        if (e) { this.anotar("escritura", m, "upsert", e.dueno); this.aplicarDatos(m, e.fila, a.update, "upsert"); return salida(e, a, "upsert"); }
        return salida(this.crear(m, a.create, "upsert"), a, "upsert");
      },
    };
    // Cada operación corre ENTERA en un solo turno síncrono (sin esperas
    // internas), así que la bandera de la sesión no se mezcla con otra petición.
    for (const [nombreOp, fn] of Object.entries(ops)) {
      base[nombreOp] = (args?: any) => {
        this.tolerarSedesDelDueno = m.name === "User" && args?.where?.supabaseId === SUPABASE_DE.A;
        try {
          return fn(args);
        } finally {
          this.tolerarSedesDelDueno = false;
        }
      };
    }
    return base;
  }

  /** El objeto que se pone en el lugar de `prisma`. */
  cliente(): any {
    const delegados = new Map<string, any>();
    const crudo = (..._a: any[]) => { this.crudo++; return Promise.resolve([]); };
    const crudoN = (..._a: any[]) => { this.crudo++; return Promise.resolve(0); };
    const cli: any = new Proxy({}, {
      get: (_t, prop: string) => {
        if (prop === "then") return undefined;
        if (prop === "$transaction") {
          return async (arg: any) => (typeof arg === "function" ? arg(cli) : Promise.all(arg));
        }
        if (prop === "$queryRaw" || prop === "$queryRawUnsafe") return crudo;
        if (prop === "$executeRaw" || prop === "$executeRawUnsafe") return crudoN;
        if (prop === "$connect" || prop === "$disconnect") return async () => undefined;
        if (prop === "$extends" || prop === "$use" || prop === "$on") return () => cli;
        if (!POR_DELEGADO.has(prop)) return undefined;
        if (!delegados.has(prop)) delegados.set(prop, this.delegado(prop));
        return delegados.get(prop);
      },
    });
    return cli;
  }
}

function clonar<T>(v: T): T {
  if (v instanceof Date) return new Date(v.getTime()) as any;
  if (v instanceof Prisma.Decimal || Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) return v.map(clonar) as any;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as any).map(([k, x]) => [k, clonar(x)])) as any;
  return v;
}

/** Los nombres de campo `…Id` del esquema: sirven para armar cuerpos y consultas de ataque. */
export const CAMPOS_ID: string[] = (() => {
  const set = new Set<string>(["id"]);
  for (const m of MODELOS) for (const f of m.fields) if (f.kind === "scalar" && f.type === "String" && /Id$/.test(f.name)) set.add(f.name);
  return [...set].sort();
})();
