export type ToastVariant = 'error' | 'warning' | 'success' | 'info';

export interface ToastPayload {
  title: string;
  message: string;
  code?: string;
  variant?: ToastVariant;
}

export function emitToast(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent<ToastPayload>('riviamigo:toast', { detail: payload }));
}

export function emitAuthError(title: string, message: string) {
  emitToast({ title, message, variant: 'error' });
}
