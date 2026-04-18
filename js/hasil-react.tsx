import { createRoot } from "react-dom/client";
import Result from "../pages/Result";

const root = document.getElementById("result-root");
if (root) createRoot(root).render(<Result />);
