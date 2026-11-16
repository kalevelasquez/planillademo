/**
 * phoneUtils.ts
 * ─────────────────────────────────────────────────────────────────
 * Helpers para la estandarización del teléfono salvadoreño (+503).
 *
 * Contrato de formatos:
 *   DB  raw  →  "503XXXXXXXX"   (11 dígitos, sin signo, sin guion, sin espacios)
 *   UI  input →  "XXXX-XXXX"    (8 dígitos con guion, sin prefijo — lo muestra el InputField)
 *   UI  display → "+503 XXXX-XXXX" (formato legible para tablas y cards)
 */

/**
 * formatPhoneForDB
 * Convierte el valor del input (XXXX-XXXX) al formato de almacenamiento (503XXXXXXXX).
 * Devuelve null si el valor está vacío o incompleto (< 8 dígitos).
 *
 * @example
 *   formatPhoneForDB("7777-7777")  → "50377777777"
 *   formatPhoneForDB("1234")       → null  (incompleto, no guardar)
 *   formatPhoneForDB("")           → null
 */
export function formatPhoneForDB(inputValue: string): string | null {
    // Extraer solo dígitos del valor que viene del input enmascarado
    const digits = inputValue.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    return `503${digits}`;
}

/**
 * formatPhoneForDisplay
 * Convierte el valor crudo de la DB (503XXXXXXXX) al formato visual (+503 XXXX-XXXX).
 * Si el valor no tiene el formato esperado, lo devuelve sin modificar.
 *
 * @example
 *   formatPhoneForDisplay("50377777777")   → "+503 7777-7777"
 *   formatPhoneForDisplay(null)            → "-"
 *   formatPhoneForDisplay("77777777")      → "77777777"  (formato legacy, sin prefijo 503)
 */
export function formatPhoneForDisplay(rawPhone: string | null | undefined): string {
    if (!rawPhone) return '-';

    // Formato estándar: 503 + 8 dígitos = 11 dígitos totales
    const match = rawPhone.match(/^503(\d{4})(\d{4})$/);
    if (match) return `+503 ${match[1]}-${match[2]}`;

    // Formato legacy (XXXX-XXXX o raw 8 dígitos sin prefijo 503)
    const digitsOnly = rawPhone.replace(/\D/g, '');
    if (digitsOnly.length === 8) {
        return `+503 ${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4)}`;
    }

    // Formato desconocido — mostrar tal cual
    return rawPhone;
}

/**
 * formatPhoneForInput
 * Convierte el valor crudo de la DB (503XXXXXXXX) al formato que espera 
 * el InputField con mask="phone" → "XXXX-XXXX" (sin prefijo, con guion).
 * Usar al momento de cargar datos en el modal de edición.
 *
 * @example
 *   formatPhoneForInput("50377777777")  → "7777-7777"
 *   formatPhoneForInput(null)           → ""
 */
export function formatPhoneForInput(rawPhone: string | null | undefined): string {
    if (!rawPhone) return '';

    const match = rawPhone.match(/^503(\d{4})(\d{4})$/);
    if (match) return `${match[1]}-${match[2]}`;

    // Formato legacy: XXXX-XXXX ya con guion
    const digitsOnly = rawPhone.replace(/\D/g, '');
    if (digitsOnly.length === 8) {
        return `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4)}`;
    }

    return '';
}
