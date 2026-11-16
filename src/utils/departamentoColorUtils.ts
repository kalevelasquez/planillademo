import type { ColorKey } from '../services/departamentosService';

// Mismos 7 combos Tailwind que usaba el hash de EmpleadosListView antes del catálogo real
// (IMPL-2 gap #2) — se mantiene la paleta para no cambiar los colores que los usuarios ya
// asocian a cada departamento existente.
export const DEPARTAMENTO_COLOR_CLASSES: Record<ColorKey, string> = {
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    primary: 'bg-primary-light text-primary',
    purple: 'bg-purple-50 text-purple-600',
    pink: 'bg-pink-50 text-pink-600',
    secondary: 'bg-secondary-light text-secondary-dark',
    teal: 'bg-teal-50 text-teal-600',
};

export const DEPARTAMENTO_COLOR_KEYS = Object.keys(DEPARTAMENTO_COLOR_CLASSES) as ColorKey[];

export function getColorClasses(colorKey: ColorKey | undefined): string {
    if (!colorKey) return 'bg-surface text-text-secondary';
    return DEPARTAMENTO_COLOR_CLASSES[colorKey] ?? 'bg-surface text-text-secondary';
}
