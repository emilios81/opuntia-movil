
'use client';

import { useEffect } from 'react';

export function PWARegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // En GitHub Pages la app vive en /<repo>/: el service worker se registra
    // con ese prefijo, y su alcance no puede ser más amplio que su propia ruta.
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

    const register = () => {
      navigator.serviceWorker
        .register(`${base}/sw.js`, { scope: `${base}/` })
        .then((reg) => {
          console.log('OpuntiaColor: Motor Offline activado con éxito');
          // Forzar actualización si hay cambios
          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('Nueva versión disponible, por favor reinicie la app.');
                }
              };
            }
          };
        })
        .catch((err) => {
          console.error('OpuntiaColor: Error al activar motor Offline', err);
        });
    };

    // Este efecto suele correr DESPUÉS del evento load, así que engancharse a
    // 'load' a ciegas dejaba el service worker sin registrar y la app sin
    // modo offline. Si la página ya cargó, se registra en el acto.
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
