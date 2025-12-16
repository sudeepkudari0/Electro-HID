import './StatusIndicator.css';

interface StatusIndicatorProps {
    isActive: boolean;
    label: string;
}

export function StatusIndicator({ isActive, label }: StatusIndicatorProps) {
    return (
        <span className={`status-indicator ${isActive ? 'status-indicator--active' : ''}`}>
            <span className="status-indicator__dot" />
            {label}
        </span>
    );
}
