import React, { useId } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
    startIcon?: React.ReactNode;
    options: SelectOption[];
    placeholder?: string;
}

export const SelectField: React.FC<SelectFieldProps> = ({
    label,
    error,
    startIcon,
    options,
    placeholder = 'Seleccione una opción',
    className = '',
    id,
    disabled = false,
    value,
    ...props
}) => {
    const generatedId = useId();
    // Generate an ID if one is not provided, making it unique and safely tying the label to the select
    const selectId = id || generatedId;
    const hasValue = value !== undefined && value !== null && value !== '';

    return (
        <div className={`flex flex-col gap-1.5 w-full ${className}`}>
            {/* Label */}
            {label && (
                <label
                    htmlFor={selectId}
                    className={`text-[11px] font-bold tracking-wide uppercase px-1
                        ${error ? 'text-error animate-pulse' : disabled ? 'text-text-secondary/50' : 'text-text-secondary'}
                    `}
                >
                    {label}
                </label>
            )}

            <div className="relative group">
                {/* Icon Left */}
                {startIcon && (
                    <div className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center transition-colors 
                        ${error ? 'text-error' : disabled ? 'text-text-secondary/50' : hasValue ? 'text-primary' : 'text-text-secondary group-focus-within:text-primary'}`}
                    >
                        {startIcon}
                    </div>
                )}

                <select
                    id={selectId}
                    disabled={disabled}
                    value={value}
                    className={`
                        w-full px-4 py-2.5 rounded-lg text-sm font-medium text-heading
                        transition-all duration-200 ease-in-out outline-none shadow-sm appearance-none cursor-pointer
                        bg-white border
                        
                        /* Padding if startIcon */
                        ${startIcon ? 'pl-10' : ''}
                        pr-10
                        
                        /* State / Value */
                        ${error
                            ? 'border-error text-error focus:ring-4 focus:ring-error/10 focus:border-error bg-error/5'
                            : hasValue
                                ? 'border-primary focus:border-primary focus:ring-4 focus:ring-primary/10 hover:border-primary/80'
                                : 'border-gray-200 focus:border-primary focus:ring-4 focus:ring-primary/10 hover:border-gray-300'
                        }
                        
                        /* Disabled State */
                        disabled:bg-gray-50 disabled:border-transparent disabled:text-text-secondary/50 disabled:cursor-not-allowed disabled:shadow-none
                        
                        /* Placeholder style when no value selected */
                        ${!hasValue ? 'text-text-secondary/60' : ''}
                    `}
                    {...props}
                >
                    {placeholder && (
                        <option value="" disabled hidden className="text-text-secondary">
                            {placeholder}
                        </option>
                    )}
                    {options.map((option) => (
                        <option key={option.value} value={option.value} className="text-heading">
                            {option.label}
                        </option>
                    ))}
                </select>

                {/* Custom Chevron Right */}
                <div className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center transition-colors
                    ${error ? 'text-error' : disabled ? 'text-text-secondary/30' : 'text-text-secondary group-focus-within:text-primary'}
                `}>
                    <ChevronDown size={18} />
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="flex items-center gap-1 mt-1 ml-1 animate-in fade-in slide-in-from-top-1">
                    <AlertCircle size={12} className="text-error" />
                    <span className="text-[11px] text-error font-medium">{error}</span>
                </div>
            )}
        </div>
    );
};
