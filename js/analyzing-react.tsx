import { createRoot } from "react-dom/client";
import Analyzing from "../pages/Analyzing";

const root = document.getElementById("analyzing-root");
if (root) createRoot(root).render(<Analyzing />);
