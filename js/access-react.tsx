import { createRoot } from 'react-dom/client';
import Access from '@/pages/Access';

const root = document.getElementById('access-root');
if (root) createRoot(root).render(<Access />);
