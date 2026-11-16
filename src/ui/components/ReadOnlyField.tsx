import React from 'react';

interface ReadOnlyFieldProps {
    label: string;
    value: React.ReactNode;
    emptyLabel?: string;
    className?: string;
}

/**
 * Vista de solo lectura para un campo (IMPL-3 gap #3, revisión historia por historia) —
 * reemplaza el `InputField`/`select` deshabilitado por una presentación limpia de
 * etiqueta + valor, para el perfil de empleado visto por un rol sin `can_edit`
 * (Aprobador de Planilla). No es un campo de formulario: no tiene `onChange`.
 */
export const ReadOnlyField: React.FC<ReadOnlyFieldProps> = ({ label, value, emptyLabel = '—', className = '' }) => (
    <div className={`flex flex-col gap-1.5 ${className}`}>
        <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">{label}</label>
        <div className="min-h-[42px] flex items-center bg-surface border border-transparent rounded-lg px-4 py-2.5 text-sm font-medium text-heading">
            {value !== '' && value !== null && value !== undefined
                ? value
                : <span className="text-text-secondary/40 italic">{emptyLabel}</span>}
        </div>
    </div>
);
