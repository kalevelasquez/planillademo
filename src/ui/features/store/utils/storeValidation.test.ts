import { describe, it, expect } from 'vitest';
import { validateRequired, validateEmail, validateNewPassword } from './storeValidation';

describe('storeValidation', () => {
    it('validateRequired: vacio o solo espacios es required; texto es valido', () => {
        expect(validateRequired('')).toBe('required');
        expect(validateRequired('   ')).toBe('required');
        expect(validateRequired('Ana')).toBeNull();
    });

    it('validateEmail: vacio => required, malformado => email, valido => null', () => {
        expect(validateEmail('')).toBe('required');
        expect(validateEmail('ana')).toBe('email');
        expect(validateEmail('ana@x')).toBe('email');
        expect(validateEmail('a b@x.com')).toBe('email');
        expect(validateEmail(' ana@x.com ')).toBeNull();
    });

    it('validateNewPassword: minimo 8 caracteres', () => {
        expect(validateNewPassword('')).toBe('required');
        expect(validateNewPassword('1234567')).toBe('passwordMin');
        expect(validateNewPassword('12345678')).toBeNull();
    });
});
