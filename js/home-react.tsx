import { createRoot } from "react-dom/client";
import Home from "../pages/Home";

const root = document.getElementById("root");
if (root) createRoot(root).render(<Home />);
