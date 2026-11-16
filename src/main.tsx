import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ToastProvider } from './context/ToastContext'

import "@fontsource/dm-sans/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";

import './config/i18n'
import './ui/styles/index.css'

import { ErrorBoundary } from './ui/components/ErrorBoundary'

import { Logger } from './utils/logger'

/**
 * CA3: Global Error Handler (US-NFR-02)
 * Captura excepciones de JS y promesas no manejadas que ocurren fuera del ciclo de renderizado.
 */
window.addEventListener('error', (event) => {
  Logger.error('Global Uncaught Exception', { message: event.message }, event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  Logger.error('Global Unhandled Promise Rejection', {}, event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

