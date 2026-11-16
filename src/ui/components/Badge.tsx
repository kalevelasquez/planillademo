import React from 'react';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'accent' | 'delivered' | 'primary';

export interface BadgeProps {
    variant: BadgeVariant;
    label: string;
    dot?: boolean;
    className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
    info: 'bg-info/10 text-info',
    accent: 'bg-accent-purple/10 text-accent-purple',
    delivered: 'bg-[#02B446] text-white shadow-sm',
    primary: 'bg-primary/10 text-primary'
};

const dotColors: Record<BadgeVariant, string> = {
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    info: 'bg-info',
    accent: 'bg-accent-purple',
    delivered: 'bg-white',
    primary: 'bg-primary'
};

export const Badge: React.FC<BadgeProps> = ({ variant, label, dot = false, className = '' }) => {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide rounded-full ${variantStyles[variant]} ${className}`}>
            {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`}></span>}
            <span translate="yes">{label}</span>
        </span>
    );
};
