import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredRole?: string | string[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
    const { profile, isLoading } = useAuthStore();
    const location = useLocation();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary"></div>
            </div>
        );
    }

    if (!profile) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // Si tiene un cambio de contraseña pendiente, forzarlo (a menos que ya esté en esa ruta)
    if (profile.needs_password_change && location.pathname !== '/force-password-change') {
        return <Navigate to="/force-password-change" replace />;
    }

    // Verificación de roles (Opcional)
    if (requiredRole) {
        const userRoles = Array.from(new Set([
            ...(Array.isArray(profile?.roles) ? profile.roles : (profile?.roles ? [profile.roles] : [])),
            ...(Array.isArray(profile?.role) ? profile.role : (profile?.role ? [profile.role] : []))
        ].map(r => String(r).toLowerCase().trim()).filter(Boolean)));

        const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        const hasPermission = roles.some(role => userRoles.includes(role.toLowerCase()));

        if (!hasPermission) {
            return <Navigate to="/" replace />;
        }
    }

    return <>{children}</>;
};
