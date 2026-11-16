import React from 'react';
import type { ElementType } from 'react';

export type IconBoxVariant = 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'info';
export type IconBoxSize = 'sm' | 'md' | 'lg';

export interface IconBoxProps {
    icon: ElementType;
    variant?: IconBoxVariant;
    size?: IconBoxSize;
    className?: string;
}

const variantStyles: Record<IconBoxVariant, string> = {
    primary: 'bg-primary/10 text-primary dark:bg-primary/20',
    secondary: 'bg-heading/10 text-heading dark:bg-heading/20',
    accent: 'bg-accent-purple/10 text-accent-purple dark:bg-accent-purple/20',
    success: 'bg-success/10 text-success dark:bg-success/20',
    warning: 'bg-warning/10 text-warning dark:bg-warning/20',
    error: 'bg-error/10 text-error dark:bg-error/20',
    info: 'bg-info/10 text-info dark:bg-info/20'
};

const sizeStyles: Record<IconBoxSize, { container: string; icon: number }> = {
    sm: { container: 'w-9 h-9', icon: 18 },
    md: { container: 'w-12 h-12', icon: 24 },
    lg: { container: 'w-16 h-16', icon: 32 }
};

export const IconBox: React.FC<IconBoxProps> = ({
    icon: Icon,
    variant = 'primary',
    size = 'md',
    className = ''
}) => {
    return (
        <div className={`flex items-center justify-center shrink-0 rounded-xl ${sizeStyles[size].container} ${variantStyles[variant]} ${className}`}>
            <Icon size={sizeStyles[size].icon} />
        </div>
    );
};
