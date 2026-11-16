import React from 'react';
import { Pencil, Trash2, RefreshCw, Send, Eye, CheckCircle2, X, Copy } from 'lucide-react';

export type ActionType = 'edit' | 'delete' | 'reactivate' | 'resend' | 'view' | 'finalize' | 'cancel' | 'duplicate';

export interface TableActionItem {
    type: ActionType;
    onClick: () => void;
    disabled?: boolean;
}

export interface TableActionsProps {
    visibleActions: TableActionItem[];
    className?: string;
}

const ACTION_CONFIG: Record<ActionType, {
    icon: React.ElementType;
    colorClass: string;
    hoverClass: string;
    tooltipBg: string;
    label: string;
}> = {
    edit: { icon: Pencil, colorClass: 'text-info', hoverClass: 'hover:bg-info/10 hover:text-info', tooltipBg: 'bg-info', label: 'Editar' },
    delete: { icon: Trash2, colorClass: 'text-error', hoverClass: 'hover:bg-error/10 hover:text-error', tooltipBg: 'bg-error', label: 'Eliminar' },
    reactivate: { icon: RefreshCw, colorClass: 'text-success', hoverClass: 'hover:bg-success/10 hover:text-success', tooltipBg: 'bg-success', label: 'Reactivar' },
    resend: { icon: Send, colorClass: 'text-accent-purple', hoverClass: 'hover:bg-purple-50 hover:text-accent-purple', tooltipBg: 'bg-accent-purple', label: 'Reenviar' },
    view: { icon: Eye, colorClass: 'text-heading', hoverClass: 'hover:bg-surface hover:text-heading', tooltipBg: 'bg-heading', label: 'Ver Detalles' },
    finalize: { icon: CheckCircle2, colorClass: 'text-success', hoverClass: 'hover:bg-success/10 hover:text-success', tooltipBg: 'bg-success', label: 'Finalizar Pedido' },
    cancel: { icon: X, colorClass: 'text-error', hoverClass: 'hover:bg-error/10 hover:text-error', tooltipBg: 'bg-error', label: 'Cancelar Pedido' },
    duplicate: { icon: Copy, colorClass: 'text-primary', hoverClass: 'hover:bg-primary/10 hover:text-primary', tooltipBg: 'bg-primary', label: 'Duplicar' },
};

export const TableActions: React.FC<TableActionsProps> = ({ visibleActions, className = '' }) => {
    if (!visibleActions || visibleActions.length === 0) return null;

    return (
        <div translate="no" className={`inline-flex items-center justify-center gap-0.5 ${className}`}>
            {visibleActions.map((action, index) => {
                const config = ACTION_CONFIG[action.type];
                const Icon = config.icon;

                return (
                    <button
                        key={`${action.type}-${index}`}
                        translate="no"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!action.disabled) action.onClick();
                        }}
                        disabled={action.disabled}
                        aria-label={config.label}
                        className={`
                            group relative flex items-center justify-center
                            w-8 h-8 rounded-md outline-none
                            transition-all duration-150
                            focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary/40
                            ${action.disabled
                                ? 'text-text-secondary/30 cursor-not-allowed opacity-50'
                                : `${config.colorClass} ${config.hoverClass} cursor-pointer active:scale-90`
                            }
                        `}
                    >
                        <Icon size={16} strokeWidth={2.5} className="flex-shrink-0 transition-colors duration-150" />

                        {/* ── Tooltip ── */}
                        {!action.disabled && (
                            <div
                                className={`
                                    pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                                    px-2 py-1 rounded text-white text-[10px] font-semibold whitespace-nowrap
                                    z-30 shadow-md
                                    opacity-0 translate-y-1
                                    group-hover:opacity-100 group-hover:translate-y-0
                                    transition-all duration-150
                                    ${config.tooltipBg}
                                `}
                            >
                                {config.label}
                                {/* Flecha */}
                                <div className={`absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent ${config.tooltipBg.replace('bg-', 'border-t-')}`} />
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
};
