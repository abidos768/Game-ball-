import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';

// Self-hosted font. Loading from the Google Fonts CDN silently fails on
// Android because the app ships without the INTERNET permission.
import '@fontsource-variable/outfit';

import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
