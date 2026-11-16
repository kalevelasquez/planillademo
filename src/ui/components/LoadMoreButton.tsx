import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from './Button';

export interface LoadMoreButtonProps {
    onClick: () => void;
    isLoading?: boolean;
    label?: string;
    loadingLabel?: string;
    className?: string;
}

export const LoadMoreButton: React.FC<LoadMoreButtonProps> = ({
    onClick,
    isLoading = false,
    label = 'Cargar Más',
    loadingLabel = 'Cargando...',
    className = ''
}) => {
    return (
        <div className={`w-full flex justify-center border-t border-border/60 bg-surface/10 sm:bg-transparent p-4 ${className}`}>
            <Button
                variant="secondary"
                onClick={onClick}
                disabled={isLoading}
                className="group w-full sm:w-[300px] flex items-center justify-center gap-2 h-[42px] shadow-sm bg-white hover:bg-heading transition-colors"
            >
                {isLoading && <Loader2 className="animate-spin w-4 h-4 text-text-secondary group-hover:text-white" />}
                <span className="font-semibold text-heading group-hover:text-white transition-colors text-[13px]">{isLoading ? loadingLabel : label}</span>
            </Button>
        </div>
    );
};
