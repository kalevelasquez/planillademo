import React from 'react';
import { STORE_CAPTCHA_ENABLED } from '../../../../config/env';

interface CaptchaSlotProps {
    /** Por defecto lo decide `VITE_STORE_CAPTCHA_ENABLED`. */
    enabled?: boolean;
    /** Recibira el token del proveedor cuando se integre uno (v1: nunca se llama). */
    onToken?: (token: string) => void;
}

/**
 * Punto de enganche del captcha en login/registro. En v1 es un NO-OP: no hay proveedor integrado,
 * asi que ni encendido inyecta un widget. Cuando se elija proveedor, se monta aqui y se pasa el
 * token a `signInStoreCustomer` / `signUpStoreCustomer` (`captchaToken`, ya soportado).
 */
export const CaptchaSlot: React.FC<CaptchaSlotProps> = ({ enabled = STORE_CAPTCHA_ENABLED }) => {
    void enabled;
    return null;
};
