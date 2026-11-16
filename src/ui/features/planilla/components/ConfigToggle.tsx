import React from 'react';

interface ConfigToggleProps {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
    size?: 'sm' | 'md';
    label?: string;
}

/**
 * Switch tipo iOS (fidelidad al DEMO) — reemplaza el patrón de "pill" de texto
 * (Activo/Inactivo clickeable) repetido en los catálogos de Configuración de Planilla.
 */
export const ConfigToggle: React.FC<ConfigToggleProps> = ({ checked, onChange, disabled, size = 'md', label }) => (
    <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        aria-label={label}
        aria-pressed={checked}
        className={`relative inline-flex shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50
            ${size === 'md' ? 'h-6 w-11' : 'h-5 w-9'}
            ${checked ? 'bg-primary' : 'bg-border'}`}
    >
        <span
            className={`pointer-events-none inline-block rounded-full bg-white shadow-sm transform transition-transform duration-200
                ${size === 'md' ? 'h-5 w-5' : 'h-4 w-4'}
                ${checked ? (size === 'md' ? 'translate-x-5' : 'translate-x-4') : 'translate-x-0'}`}
        />
    </button>
);
