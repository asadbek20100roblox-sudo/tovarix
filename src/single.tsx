import { createRoot } from 'react-dom/client';
import { DemoWorkspace } from './DemoWorkspace';
import './style.css';

createRoot(document.getElementById('root')!).render(<DemoWorkspace standalone />);
