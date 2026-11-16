import React, { useState, useRef, useEffect } from 'react';
import type { ElementType } from 'react';
import { InputField } from './InputField';
import { MoreHorizontal, List, LayoutGrid } from 'lucide-react';

export interface ActionToolbarProps {
    searchPlaceholder?: string;
    searchValue: string;
    onSearchChange: (val: string) => void;
    theme?: 'primary' | 'secondary';
    viewMode?: 'table' | 'grid';
    onViewModeChange?: (mode: 'table' | 'grid') => void;
    actions?: {
        label: string;
        icon: ElementType;
        onClick: () => void;
    }[];
    className?: string;
}

export const ActionToolbar: React.FC<ActionToolbarProps> = ({
    searchPlaceholder = 'Buscar...',
    searchValue,
    onSearchChange,
    theme = 'secondary',
    viewMode,
    onViewModeChange,
    actions = [],
    className = ''
}) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const mobileMenuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
                setIsMobileMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Cast actions to avoid TS undefined union errors despite default value
    const safeActions = actions as NonNullable<ActionToolbarProps['actions']>;

    // Theme colors
    const themeStyles = {
        primary: 'bg-primary text-white border-primary-dark/20 hover:bg-primary-dark active:bg-primary-dark focus:bg-primary-dark',
        secondary: 'bg-heading text-white border-heading/20 hover:bg-heading/90 active:bg-heading focus:bg-info focus:border-info'
    };

    const activeThemeClass = themeStyles[theme];

    // Helper to render desktop buttons
    const renderDesktopButton = (action: NonNullable<ActionToolbarProps['actions']>[0], index: number, total: number) => {
        const Icon = action.icon;
        const isFirst = index === 0;
        const isLast = index === total - 1;

        return (
            <button
                key={index}
                onClick={action.onClick}
                className={`
                    relative inline-flex items-center justify-center gap-2 h-[42px] px-4 
                    text-[13px] font-semibold transition-all shrink-0
                    focus:outline-none focus:z-10
                    ${activeThemeClass}
                    border-y border-transparent
                    ${isFirst ? 'rounded-l-lg border-l border-l-white/10' : ''}
                    ${isLast ? 'rounded-r-lg border-r border-r-white/10' : ''}
                    ${!isFirst ? 'before:content-[""] before:absolute before:left-0 before:top-1/4 before:h-1/2 before:w-[1px] before:bg-white/20' : ''}
                `}
            >
                <Icon size={16} />
                <span className="whitespace-nowrap">{action.label}</span>
            </button>
        );
    };

    return (
        <div className={`flex flex-col sm:flex-row items-center justify-between gap-4 w-full ${className}`}>
            <div className="flex w-full sm:w-auto items-center gap-2 flex-1">
                <div className="w-full sm:w-[320px]">
                    <InputField
                        isSearch
                        placeholder={searchPlaceholder}
                        value={searchValue}
                        onChange={(e) => onSearchChange(e.target.value)}
                        onClear={searchValue ? () => onSearchChange('') : undefined}
                    />
                </div>
                {/* View Mode Toggle */}
                {viewMode && onViewModeChange && (
                    <div className="flex border border-border rounded-lg bg-surface shrink-0 h-[42px] overflow-hidden shadow-sm md:ml-4">
                        <button
                            onClick={() => onViewModeChange('table')}
                            className={`flex items-center justify-center px-3 transition-colors focus:outline-none ${viewMode === 'table' ? 'bg-primary text-white' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                        >
                            <List size={18} />
                        </button>
                        <button
                            onClick={() => onViewModeChange('grid')}
                            className={`flex items-center justify-center px-3 transition-colors focus:outline-none border-l border-border/50 ${viewMode === 'grid' ? 'bg-primary text-white' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                        >
                            <LayoutGrid size={18} />
                        </button>
                    </div>
                )}
            </div>

            {safeActions.length > 0 && (
                <>
                    {/* Desktop View */}
                    <div className="hidden sm:flex items-center w-auto shrink-0 justify-end">
                        <div className="flex min-w-max">
                            {safeActions.map((action, index) => renderDesktopButton(action, index, safeActions.length))}
                        </div>
                    </div>

                    {/* Mobile View */}
                    <div className="flex sm:hidden w-full" ref={mobileMenuRef}>
                        {safeActions.length <= 2 ? (
                            <div className="flex w-full">
                                {safeActions.map((action, index) => {
                                    const Icon = action.icon;
                                    const isFirst = index === 0;
                                    const isLast = index === safeActions.length - 1;

                                    return (
                                        <button
                                            key={index}
                                            onClick={action.onClick}
                                            className={`
                                                flex-1 relative inline-flex items-center justify-center gap-2 h-[42px] px-4 
                                                text-[13px] font-semibold transition-all
                                                focus:outline-none focus:z-10
                                                ${activeThemeClass}
                                                border-y border-transparent
                                                ${isFirst ? 'rounded-l-lg border-l border-l-white/10' : ''}
                                                ${isLast ? 'rounded-r-lg border-r border-r-white/10' : ''}
                                                ${!isFirst ? 'before:content-[""] before:absolute before:left-0 before:top-1/4 before:h-1/2 before:w-[1px] before:bg-white/20' : ''}
                                            `}
                                        >
                                            <Icon size={16} />
                                            <span className="whitespace-nowrap">{action.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex w-full relative">
                                <button
                                    onClick={() => {
                                        safeActions[0].onClick();
                                        setIsMobileMenuOpen(false);
                                    }}
                                    className={`
                                        flex-1 relative inline-flex items-center justify-center gap-2 h-[42px] px-4 
                                        text-[13px] font-semibold transition-all rounded-l-lg border-y border-l border-l-white/10 border-y-transparent
                                        focus:outline-none focus:z-10
                                        ${activeThemeClass}
                                    `}
                                >
                                    {React.createElement(safeActions[0].icon, { size: 16 })}
                                    <span className="whitespace-nowrap">{safeActions[0].label}</span>
                                </button>

                                <button
                                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                                    className={`
                                        relative inline-flex items-center justify-center px-4 h-[42px]
                                        transition-all rounded-r-lg border-y border-r border-r-white/10 border-y-transparent
                                        focus:outline-none focus:z-10
                                        ${activeThemeClass}
                                        before:content-[""] before:absolute before:left-0 before:top-1/4 before:h-1/2 before:w-[1px] before:bg-white/20
                                    `}
                                >
                                    <MoreHorizontal size={20} />
                                </button>

                                {isMobileMenuOpen && (
                                    <div className="absolute top-full right-0 mt-2 w-56 bg-white shadow-xl rounded-xl border border-border py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                                        {safeActions.slice(1).map((action, index) => {
                                            const Icon = action.icon;
                                            return (
                                                <button
                                                    key={index}
                                                    onClick={() => {
                                                        action.onClick();
                                                        setIsMobileMenuOpen(false);
                                                    }}
                                                    className="w-full flex items-center gap-3 px-4 py-3 text-[14px] text-text hover:bg-surface transition-colors focus:bg-surface focus:outline-none text-left"
                                                >
                                                    <Icon size={18} className="text-text-secondary" />
                                                    <span className="font-medium">{action.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
