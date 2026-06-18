import { ReactNode, forwardRef, ButtonHTMLAttributes } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    title: string;
    children: ReactNode;
    variant?: 'ghost' | 'subtle' | 'accent';
    size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({
    title,
    children,
    variant = 'ghost',
    size = 'sm',
    disabled = false,
    className = '',
    id,
    ...props
}, ref) => {
    const baseClasses = 'inline-flex items-center justify-center rounded-lg transition-all duration-150 select-none';

    const sizeClasses = {
        sm: 'w-8 h-8',
        md: 'w-9 h-9',
    };

    const variantClasses = {
        ghost: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
        subtle: 'text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:bg-[var(--bg-active)]',
        accent: 'text-white bg-[var(--accent-blue)] hover:brightness-110 active:brightness-90',
    };

    return (
        <button
            ref={ref}
            id={id}
            title={title}
            disabled={disabled}
            data-no-drag
            className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
});
IconButton.displayName = 'IconButton';
