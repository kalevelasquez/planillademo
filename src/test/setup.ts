import '@testing-library/jest-dom/vitest';
// i18n bundlea sus recursos de forma síncrona (ver src/config/i18n.ts) — importarlo acá
// hace que useTranslation() devuelva el texto real en los tests, no la key cruda.
import '../config/i18n';

import { afterEach } from 'vitest';

// Node >= 25 expone un `localStorage` experimental que, sin `--localstorage-file`, pisa el de
// jsdom y queda sin metodos (`removeItem` undefined). Si pasa, se reemplaza por un Storage en
// memoria para que el codigo que usa localStorage (AdminApp, clientes Supabase) sea testeable.
if (typeof window !== 'undefined' && typeof window.localStorage?.removeItem !== 'function') {
    const store = new Map<string, string>();
    const memoryStorage: Storage = {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k) => (store.has(k) ? store.get(k)! : null),
        key: (i) => Array.from(store.keys())[i] ?? null,
        removeItem: (k) => { store.delete(k); },
        setItem: (k, v) => { store.set(k, String(v)); },
    };
    Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
}
import { cleanup } from '@testing-library/react';

// Sin `globals: true` en vitest, @testing-library/react no detecta un afterEach global
// para desmontar automáticamente entre tests — sin esto, cada render() se acumula sobre
// el DOM del test anterior en vez de reemplazarlo.
afterEach(() => {
    cleanup();
});
