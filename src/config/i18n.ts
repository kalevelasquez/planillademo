import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import commonES from '../../public/locales/es/common.json';
import commonEN from '../../public/locales/en/common.json';

i18n
    .use(initReactI18next)
    .init({
        fallbackLng: 'es',
        lng: 'es',
        debug: import.meta.env.DEV,

        // Inicialización síncrona: recursos bundleados, sin HTTP fetch.
        // Sin esto React renderiza antes del evento "ready" y muestra keys crudas.
        initImmediate: false,

        interpolation: {
            escapeValue: false,
        },

        resources: {
            es: { common: commonES },
            en: { common: commonEN },
        },

        ns: ['common'],
        defaultNS: 'common',
    });

export default i18n;
