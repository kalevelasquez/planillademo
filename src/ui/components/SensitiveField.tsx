import React, { useState } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { auditService } from '../../services/auditService';
import { InputField } from './InputField';

interface SensitiveFieldProps {
    label: string;
    value: string;
    resourceId: string;
    fieldName: string;
    visibleChars?: number;
    emptyLabel?: string;
    className?: string;
    /** Si se define, al revelar el campo se vuelve editable (InputField) en vez de solo lectura. */
    onChange?: (value: string) => void;
    mask?: 'dui' | 'phone' | 'currency';
    error?: string;
    required?: boolean;
}

/**
 * Campo enmascarado para datos sensibles (DUI, NIT, número de cuenta — US-EMP-01 CA2).
 * Oculto por defecto; revelar dispara una acción 'REVEAL' auditada (log_custom_audit)
 * la primera vez que se revela dentro de esta instancia del componente. Si se pasa
 * `onChange`, al revelar el campo pasa a ser editable.
 */
export const SensitiveField: React.FC<SensitiveFieldProps> = ({
    label,
    value,
    resourceId,
    fieldName,
    visibleChars = 2,
    emptyLabel = 'Sin registrar',
    className = '',
    onChange,
    mask,
    error,
    required,
}) => {
    const [revealed, setRevealed] = useState(false);
    const [hasAudited, setHasAudited] = useState(false);

    const handleToggle = () => {
        const next = !revealed;
        setRevealed(next);
        if (next && !hasAudited) {
            setHasAudited(true);
            auditService.logAction('REVEAL', 'planilla_empleados', resourceId, { field: fieldName });
        }
    };

    const errorMessage = error && (
        <div className="flex items-center gap-1 mt-1 ml-1 animate-in fade-in slide-in-from-top-1">
            <AlertCircle size={12} className="text-error" />
            <span className="text-[11px] text-error font-medium">{error}</span>
        </div>
    );

    if (revealed && onChange) {
        return (
            <div className={`flex flex-col gap-1.5 ${className}`}>
                <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">{label}{required && <span className="text-error"> *</span>}</label>
                    <button type="button" onClick={handleToggle} className="text-text-secondary hover:text-primary transition-colors mr-1" title="Ocultar">
                        <EyeOff size={16} />
                    </button>
                </div>
                <InputField value={value} onChange={(e) => onChange(e.target.value)} mask={mask} required={required} />
                {errorMessage}
            </div>
        );
    }

    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">{label}{required && <span className="text-error"> *</span>}</label>
            <div className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-4 py-2.5 shadow-sm">
                <span className="font-mono text-sm text-heading truncate">
                    {value
                        ? (revealed ? value : maskValue(value, visibleChars))
                        : <span className="text-text-secondary/40 italic font-sans">{emptyLabel}</span>}
                </span>
                {value && (
                    <button
                        type="button"
                        onClick={handleToggle}
                        className="text-text-secondary hover:text-primary transition-colors shrink-0"
                        title={revealed ? 'Ocultar' : 'Revelar'}
                    >
                        {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                )}
            </div>
            {errorMessage}
        </div>
    );
};

export function maskValue(value: string, visibleChars: number = 2): string {
    if (value.length <= visibleChars) return '•'.repeat(value.length);
    const hidden = value.slice(0, -visibleChars).replace(/[0-9A-Za-z]/g, '•');
    return `${hidden}${value.slice(-visibleChars)}`;
}
