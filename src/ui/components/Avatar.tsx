import React from 'react';

interface AvatarProps {
    nombre: string;
    fotoUrl?: string | null;
    size?: number;
    className?: string;
}

function iniciales(nombre: string): string {
    return nombre.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

/** Avatar con foto (si existe) y fallback de iniciales — no había ningún componente de avatar
 * reusable en el proyecto real todavía (US-DESC-00/IMPL-57 CA3 lo necesita para agrupar por
 * empleado en el panel consolidado de Descuentos). */
export const Avatar: React.FC<AvatarProps> = ({ nombre, fotoUrl, size = 24, className = '' }) => {
    if (fotoUrl) {
        return (
            <img
                src={fotoUrl}
                alt={nombre}
                style={{ width: size, height: size }}
                className={`rounded-full object-cover shrink-0 ${className}`}
            />
        );
    }
    return (
        <div
            style={{ width: size, height: size }}
            className={`rounded-full bg-primary/10 flex items-center justify-center shrink-0 ${className}`}
        >
            <span className="font-bold text-primary" style={{ fontSize: size * 0.4 }}>{iniciales(nombre)}</span>
        </div>
    );
};
