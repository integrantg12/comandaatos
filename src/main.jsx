import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

/* Endereço com ?p=CÓDIGO  → página do cliente (acompanhamento).
   Qualquer outro endereço → app da equipe (pede login). */
const params = new URLSearchParams(window.location.search);
const codigo = params.get("p");
const ehCliente = codigo !== null || window.location.pathname.startsWith("/acompanhar");

const Acompanhar = lazy(() => import("./Acompanhar.jsx"));
const App = lazy(() => import("./App.jsx"));

createRoot(document.getElementById("root")).render(
  <Suspense fallback={null}>
    {ehCliente ? <Acompanhar codigoInicial={codigo || ""} /> : <App />}
  </Suspense>
);
