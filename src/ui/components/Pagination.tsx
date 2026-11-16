import React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

export interface PaginationProps {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    onPageChange,
    className = ''
}) => {
    // Cálculo seguro de los ítems a mostrar
    const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    const getVisiblePages = (current: number, total: number) => {
        if (total <= 7) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }

        if (current <= 4) {
            return [1, 2, 3, 4, 5, '...', total];
        }

        if (current >= total - 3) {
            return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        }

        return [1, '...', current - 1, current, current + 1, '...', total];
    };

    const visiblePages = getVisiblePages(currentPage, totalPages);

    // Clases comunes para los botones interactivos (números y flechas)
    const baseButtonClass = "flex items-center justify-center min-w-[32px] h-8 px-2 rounded-md text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-heading/40 outline-none";
    const inactiveClass = "text-text-secondary bg-transparent hover:bg-surface hover:text-heading disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent";
    const activeClass = "bg-heading text-white shadow-sm hover:bg-heading/90";

    return (
        <div className={`flex flex-col sm:flex-row items-center justify-between gap-4 w-full ${className}`}>
            {/* Desktop Texto */}
            <div className="hidden sm:block text-sm text-text-secondary">
                Mostrando <span className="font-medium text-heading">{startItem}-{endItem}</span> de <span className="font-medium text-heading">{totalItems}</span> registros
            </div>

            {/* Controles */}
            <div className="flex items-center justify-between w-full sm:w-auto gap-4">
                {/* Texto en móvil */}
                <div className="sm:hidden text-sm text-text-secondary">
                    Página <span className="font-medium text-heading">{currentPage}</span> de {totalPages}
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onPageChange(currentPage - 1)}
                        disabled={currentPage === 1 || totalPages === 0}
                        className={`${baseButtonClass} ${inactiveClass}`}
                        aria-label="Anterior"
                    >
                        <ChevronLeft size={18} />
                    </button>

                    {/* Botones de Páginas (Solo Desktop) */}
                    <div className="hidden sm:flex items-center gap-1 mx-2">
                        {visiblePages.map((page, index) => {
                            if (page === '...') {
                                return (
                                    <div key={`ellipsis-${index}`} className="flex items-center justify-center min-w-[32px] h-8 text-text-secondary/50">
                                        <MoreHorizontal size={16} />
                                    </div>
                                );
                            }

                            return (
                                <button
                                    key={`page-${page}`}
                                    onClick={() => onPageChange(page as number)}
                                    className={`${baseButtonClass} ${currentPage === page ? activeClass : inactiveClass}`}
                                >
                                    {page}
                                </button>
                            );
                        })}
                    </div>

                    <button
                        onClick={() => onPageChange(currentPage + 1)}
                        disabled={currentPage === totalPages || totalPages === 0}
                        className={`${baseButtonClass} ${inactiveClass}`}
                        aria-label="Siguiente"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
