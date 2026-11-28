import React, { useId } from 'react';

interface TextFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: 'text' | 'email' | 'password' | 'tel';
    autoComplete?: string;
    error?: string | null;
    hint?: string;
    disabled?: boolean;
}

const INPUT =
    'h-12 w-full rounded-md border border-border bg-surface-paper px-md text-base text-text outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-secondary aria-[invalid=true]:border-error disabled:opacity-60';

/** Campo de texto accesible (label + error + hint). Presentacional. */
export const TextField: React.FC<TextFieldProps> = ({
    label,
    value,
    onChange,
    type = 'text',
    autoComplete,
    error,
    hint,
    disabled,
}) => {
    const id = useId();
    const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-semibold">
                {label}
            </label>
            <input
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoComplete={autoComplete}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                className={INPUT}
            />
            {hint && (
                <p id={`${id}-hint`} className="text-xs text-text-secondary">
                    {hint}
                </p>
            )}
            {error && (
                <p id={`${id}-err`} className="text-sm font-medium text-error-dark">
                    {error}
                </p>
            )}
        </div>
    );
};
