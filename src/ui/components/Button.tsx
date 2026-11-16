import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'info' | 'warning' | 'success' | 'outline-primary' | 'outline-secondary' | 'outline-danger' | 'outline-warning' | 'outline-info' | 'outline-success';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
    loadingMessage?: string; // Nuevo: Mensaje sobre el botón (ej: "Subiendo...")
    progress?: number;       // Nuevo: 0-100 para barra de progreso
}

export const Button: React.FC<ButtonProps> = ({
    children,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    loadingMessage,
    progress,
    className = '',
    disabled,
    ...props
}) => {
    const baseStyles = 'inline-flex items-center justify-center font-semibold rounded-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 relative overflow-hidden';

    const variants = {
        primary: 'bg-primary text-white hover:bg-primary-dark shadow-sm border border-transparent',
        secondary: 'bg-heading text-white hover:bg-[#122255] shadow-sm border border-transparent',
        info: 'bg-info text-white hover:bg-blue-700 shadow-sm border border-transparent',
        success: 'bg-success text-white hover:bg-success-dark shadow-sm border border-transparent',
        warning: 'bg-warning text-heading hover:bg-amber-500 shadow-sm border border-transparent',
        danger: 'bg-error text-white hover:bg-red-700 shadow-sm border border-transparent',
        'outline-primary': 'bg-transparent border-2 border-primary text-primary hover:bg-primary-light',
        'outline-secondary': 'bg-transparent border-2 border-heading text-heading hover:bg-heading/10',
        'outline-danger': 'bg-transparent border-2 border-error text-error hover:bg-error-light',
        'outline-warning': 'bg-transparent border-2 border-warning text-amber-700 hover:bg-warning-light',
        'outline-info': 'bg-transparent border-2 border-info text-info hover:bg-info-light',
        'outline-success': 'bg-transparent border-2 border-success text-success hover:bg-success-light',
        ghost: 'bg-transparent text-text-secondary hover:bg-surface border border-transparent',
    };

    const sizes = {
        sm: 'px-sm py-xs text-caption',
        md: 'px-md py-sm text-body',
        lg: 'px-lg py-md text-h3',
    };

    return (
        <span translate="no" className={`flex flex-col items-center ${className.includes('w-full') ? 'w-full' : ''}`}>
            {isLoading && loadingMessage && (
                <span className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1 animate-pulse h-4 overflow-visible whitespace-nowrap block">
                    {loadingMessage}
                </span>
            )}
            <button
                className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
                disabled={disabled || isLoading}
                {...props}
            >
                {/* Barra de progreso sutil en el borde superior */}
                {progress !== undefined && progress > 0 && (
                    <div
                        className="absolute top-0 left-0 h-[3px] bg-white/40 z-20 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                )}

                {isLoading ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-current notranslate" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>{props.title || 'Cargando...'}</span>
                    </>
                ) : (
                    <span className="inline-flex items-center gap-2">{children}</span>
                )}
            </button>
        </span>
    );
};
