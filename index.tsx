import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Register PWA Service Worker with auto-update
registerSW({
  immediate: true,
  onRegisteredSW(swUrl) {
    console.log('PWA Service Worker registered:', swUrl);
  },
  onOfflineReady() {
    console.log('Remix Lore is ready to work offline.');
  },
});

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);