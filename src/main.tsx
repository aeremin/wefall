import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import SetupNotice from './components/SetupNotice';

const root = createRoot(document.getElementById('root')!);

const firebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID,
);

if (firebaseConfigured) {
  import('./App').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  });
} else {
  root.render(<SetupNotice />);
}
