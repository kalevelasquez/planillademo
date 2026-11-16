import '@testing-library/jest-dom/vitest';
// i18n bundlea sus recursos de forma síncrona (ver src/config/i18n.ts) — importarlo acá
// hace que useTranslation() devuelva el texto real en los tests, no la key cruda.
import '../config/i18n';

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Sin `globals: true` en vitest, @testing-library/react no detecta un afterEach global
// para desmontar automáticamente entre tests — sin esto, cada render() se acumula sobre
// el DOM del test anterior en vez de reemplazarlo.
afterEach(() => {
    cleanup();
});
