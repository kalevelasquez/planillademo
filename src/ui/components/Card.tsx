import React, { type ReactNode } from 'react';

interface CardProps {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({ children, className = '', onClick }) => {
    const baseStyles = 'bg-white rounded-lg shadow-sm border border-border overflow-hidden';

    return (
        <div
            className={`${baseStyles} ${className} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
            onClick={onClick}
        >
            {children}
        </div>
    );
};
