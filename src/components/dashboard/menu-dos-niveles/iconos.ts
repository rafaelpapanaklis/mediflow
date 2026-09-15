// Íconos que TRAE `src/fonts/material-symbols-rounded-menu.woff2`.
//
// Esa fuente es un recorte de Material Symbols Rounded con solo estos nombres.
// Es de ligaduras: el texto "home" se dibuja como el ícono. Un nombre que NO
// esté aquí se vería como la palabra escrita, así que el test de estructura
// exige que todo ícono que use el menú esté en esta lista.
//
// Para añadir uno: agrégalo aquí (en orden alfabético), vuelve a descargar la
// fuente con esta URL —los nombres separados por comas, en este mismo orden— y
// guarda el `.woff2` que enlaza el CSS que devuelve:
//
//   https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20,400,0..1,0&icon_names=<NOMBRES>&display=block
//
// (pedida con un User-Agent de Chrome, que es el que recibe woff2).

export const ICONOS_EN_FUENTE = [
  "add", "add_business", "anchor", "apps", "arrow_back", "assignment", "auto_awesome",
  "bolt", "calendar_month", "chair", "chat", "chevron_right", "child_care", "close",
  "compare", "credit_card", "dark_mode", "dentistry", "fitness_center", "footprint",
  "forum", "group", "groups", "history", "home", "inventory_2", "language",
  "left_panel_close", "left_panel_open", "light_mode", "local_shipping", "lock", "logout",
  "map", "menu", "monitor_heart", "monitoring", "person", "point_of_sale", "redeem",
  "reviews", "savings", "science", "search", "sentiment_satisfied", "settings",
  "shopping_cart", "smart_toy", "storefront", "summarize", "support_agent", "tv",
  "unfold_more",
] as const;
