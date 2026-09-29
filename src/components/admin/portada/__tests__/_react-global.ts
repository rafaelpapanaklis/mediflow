// tsx compila el JSX de los .tsx en modo clásico (`React.createElement`): estos
// tests necesitan `React` en el global ANTES de cargar el componente. Se importa
// primero, por su efecto.
import * as React from "react";

(globalThis as unknown as { React: typeof React }).React = React;
