import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Toaster = () => (<SonnerToaster position="bottom-right" theme="dark" toastOptions={{
        classNames: {
            toast: 'group toast bg-surface-1 border border-border text-fg shadow-2xl rounded-xl',
            title: 'text-sm font-medium text-fg',
            description: 'text-xs text-fg-muted',
            actionButton: 'bg-primary text-white',
            cancelButton: 'bg-surface-2 text-fg-muted',
        },
    }} icons={{
        success: <CheckCircle2 className="size-4 text-success"/>,
        error: <AlertCircle className="size-4 text-danger"/>,
        warning: <AlertTriangle className="size-4 text-warning"/>,
        info: <Info className="size-4 text-accent"/>,
        close: <X className="size-3.5"/>,
    }} closeButton richColors={false}/>);
export const toast = {
    show: (message, opts) => {
        const tone = opts?.tone ?? 'default';
        const fn = tone === 'success'
            ? sonnerToast.success
            : tone === 'error'
                ? sonnerToast.error
                : tone === 'warning'
                    ? sonnerToast.warning
                    : tone === 'info'
                        ? sonnerToast.info
                        : sonnerToast;
        return fn(message, {
            description: opts?.description,
            duration: opts?.duration,
            className: cn('bg-surface-1 border border-border'),
        });
    },
    success: (msg, opts) => sonnerToast.success(msg, { description: opts?.description }),
    error: (msg, opts) => sonnerToast.error(msg, { description: opts?.description }),
    warning: (msg, opts) => sonnerToast.warning(msg, { description: opts?.description }),
    info: (msg, opts) => sonnerToast.info(msg, { description: opts?.description }),
    dismiss: (id) => sonnerToast.dismiss(id),
    promise: sonnerToast.promise,
};
//# sourceMappingURL=Toast.js.map