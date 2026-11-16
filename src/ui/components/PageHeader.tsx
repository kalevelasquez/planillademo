import React from 'react';
import type { ElementType } from 'react';
import { IconBox, type IconBoxVariant } from './IconBox';

export interface PageHeaderProps {
    icon: ElementType;
    title: string;
    description?: string;
    className?: string;
    variant?: IconBoxVariant;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
    icon: Icon,
    title,
    description,
    className = '',
    variant = 'primary'
}) => {
    return (
        <div className={`flex items-center gap-5 border-b border-border pb-8 mb-2 ${className}`}>
            <IconBox icon={Icon} size="lg" variant={variant} className="shadow-sm border border-white/10" />

            <div className="flex flex-col gap-0.5">
                <h1 className="text-2xl md:text-3xl font-display font-bold text-heading tracking-tight leading-tight">
                    {title}
                </h1>
                {description && (
                    <p className="text-sm md:text-base text-text-secondary leading-normal max-w-2xl">
                        {description}
                    </p>
                )}
            </div>
        </div>
    );
};
