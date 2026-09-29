// Un tope de consultas en vuelo a la vez (ws1-t10). El pooler de Supabase se
// satura con demasiadas consultas juntas (CLAUDE.md: menos de 7 por
// `Promise.all`), pero partir una carga en tandas hace que cada tanda espere a
// la más lenta de la anterior. Con un tope, TODO arranca en cuanto puede: se
// piden las tareas en el orden en que se necesitan y solo `limite` corren a la
// vez; en cuanto una termina entra la siguiente.
//
// Las tareas que se pasan aquí NO deben esperar a otra tarea del mismo tope
// (se quedarían con el hueco ocupado): las dependencias se encadenan FUERA,
// con `.then(() => correr(...))`.

export type Correr = <T>(tarea: () => Promise<T>) => Promise<T>;

export function limitarConcurrencia(limite: number): Correr {
  const tope = Math.max(1, Math.floor(limite) || 1);
  let enVuelo = 0;
  const cola: Array<() => void> = [];

  const siguiente = () => {
    enVuelo -= 1;
    const proxima = cola.shift();
    if (proxima) proxima();
  };

  return <T,>(tarea: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolver, rechazar) => {
      const arrancar = () => {
        enVuelo += 1;
        let promesa: Promise<T>;
        try {
          promesa = Promise.resolve(tarea());
        } catch (e) {
          promesa = Promise.reject(e);
        }
        promesa.then(resolver, rechazar).finally(siguiente);
      };
      if (enVuelo < tope) arrancar();
      else cola.push(arrancar);
    });
}
