import React from 'react';
import { FilterX } from 'lucide-react';

export interface FilterBarProps {
    children: React.ReactNode;
    onReset?: () => void;
    className?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({ children, onReset, className = '' }) => {
    return (
        <div className={`bg-surface/50 border-b border-border p-4 rounded-xl ${className}`}>
            <div className="flex flex-col md:flex-row md:items-end gap-4">
                <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {children}
                </div>
                {onReset && (
                    <button
                        onClick={onReset}
                        title="Limpiar Filtros"
                        className="flex items-center justify-center gap-2 h-[42px] px-3 lg:px-4 text-[13px] font-semibold text-text-secondary hover:text-heading hover:bg-white rounded-lg border border-border/50 hover:border-border transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-heading/20"
                    >
                        <FilterX size={16} strokeWidth={2.5} />
                        <span className="md:hidden lg:inline">Limpiar</span>
                    </button>
                )}
            </div>
        </div>
    );
};
