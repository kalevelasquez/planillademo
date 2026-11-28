export type FieldError = 'required' | 'email' | 'passwordMin' | null;

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateRequired = (value: string): FieldError => (value.trim() === '' ? 'required' : null);

export const validateEmail = (value: string): FieldError => {
    if (value.trim() === '') return 'required';
    return EMAIL_RE.test(value.trim()) ? null : 'email';
};

export const validateNewPassword = (value: string): FieldError => {
    if (value === '') return 'required';
    return value.length < MIN_PASSWORD_LENGTH ? 'passwordMin' : null;
};
