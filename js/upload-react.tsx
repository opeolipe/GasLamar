import { createRoot } from "react-dom/client";
import Upload from "../pages/Upload";

const root = document.getElementById("upload-root");
if (root) createRoot(root).render(<Upload />);
