import { createRoot } from 'react-dom/client';
import Download from '@/pages/Download';

const root = document.getElementById('download-root');
if (root) createRoot(root).render(<Download />);
