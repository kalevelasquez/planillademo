/**
 * Diccionarios de traducción para el módulo de Auditoría.
 * Implementación compatible con i18next para centralización de textos.
 */
import i18n from '../../../../config/i18n';

/**
 * Retorna la etiqueta traducida o el valor original si no existe traducción.
 */
export const getAuditLabel = (key: string): string => {
    return i18n.t(`audit.labels.${key}` as any, { defaultValue: key });
};

/**
 * Colores semánticos para las acciones
 */
export const AUDIT_COLORS: Record<string, string> = {
    'CREATE': 'bg-green-50 text-green-700 border-green-200',
    'UPDATE': 'bg-blue-50 text-blue-700 border-blue-200',
    'DELETE': 'bg-red-50 text-red-700 border-red-200',
    'LOGIN': 'bg-purple-100 text-purple-700 border-purple-200',
    'LOGIN_FAILED': 'bg-amber-100 text-amber-700 border-amber-200',
    'LOGOUT': 'bg-slate-100 text-slate-700 border-slate-200',
    'PASSWORD_CHANGE': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'MFA_ENABLED': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'MFA_DISABLED': 'bg-rose-100 text-rose-700 border-rose-200',
    'MFA_CHANGE': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'EXPORT': 'bg-orange-100 text-orange-700 border-orange-200',
    'DEFAULT': 'bg-surface text-text-secondary border-border'
};
