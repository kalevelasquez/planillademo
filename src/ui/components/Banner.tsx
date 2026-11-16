import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

export type BannerVariant = 'success' | 'warning' | 'error' | 'info';

export interface BannerProps {
    variant: BannerVariant;
    title: string;
    description?: string;
    action?: React.ReactNode;
    icon?: React.ReactNode;
    className?: string;
}

const variantStyles: Record<BannerVariant, { container: string; iconContainer: string; iconColor: string; icon: React.ElementType; border: string }> = {
    success: {
        container: 'bg-success/5 border-success/20',
        iconContainer: 'bg-success/10',
        iconColor: 'text-success',
        border: 'border-l-success',
        icon: CheckCircle2
    },
    warning: {
        container: 'bg-warning/5 border-warning/20',
        iconContainer: 'bg-warning/10',
        iconColor: 'text-warning-dark',
        border: 'border-l-warning',
        icon: AlertTriangle
    },
    error: {
        container: 'bg-error/5 border-error/20',
        iconContainer: 'bg-error/10',
        iconColor: 'text-error',
        border: 'border-l-error',
        icon: XCircle
    },
    info: {
        container: 'bg-info/5 border-info/20',
        iconContainer: 'bg-info/10',
        iconColor: 'text-info',
        border: 'border-l-info',
        icon: Info
    }
};

export const Banner: React.FC<BannerProps> = ({
    variant,
    title,
    description,
    action,
    icon,
    className = ''
}) => {
    const styles = variantStyles[variant];
    const Icon = styles.icon;

    return (
        <div className={`relative w-full rounded-md shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-y-3 md:gap-y-0 bg-white border border-l-4 p-md md:px-lg md:py-md animate-in fade-in duration-300 ${styles.container} ${styles.border} ${className}`}>
            <div className="flex items-start md:items-center gap-sm md:gap-md overflow-hidden min-w-0 flex-1">
                <div className="shrink-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border border-white/50 ${styles.iconContainer} ${styles.iconColor}`}>
                        {icon || <Icon size={20} />}
                    </div>
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-bold text-body text-heading leading-tight">
                        {title}
                    </span>
                    {description && (
                        <span className="text-caption text-text-secondary leading-tight mt-1">
                            {description}
                        </span>
                    )}
                </div>
            </div>
            {action && (
                <div className="shrink-0 md:ml-md flex justify-end md:justify-start">
                    {action}
                </div>
            )}
        </div>
    );
};
