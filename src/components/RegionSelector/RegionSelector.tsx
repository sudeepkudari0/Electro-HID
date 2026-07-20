import React, { useRef, useState, useCallback, useEffect } from 'react';

interface RegionSelectorProps {
    onCapture: (croppedImageData: string) => void;
    onCancel: () => void;
    screenshotData: string; // full-screen base64 image
}

interface SelectionRect {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({ onCapture, onCancel, screenshotData }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selection, setSelection] = useState<SelectionRect | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);

    // Disable click-through while region selector is active (full-screen overlay)
    // On Linux, click-through is not used so skip this entirely
    useEffect(() => {
        const isLinux = window.electronAPI?.platform === 'linux';
        if (isLinux) return;
        window.electronAPI?.setIgnoreMouseEvents(false);
        return () => {
            window.electronAPI?.setIgnoreMouseEvents(true);
        };
    }, []);

    // Load the screenshot into memory
    useEffect(() => {
        const img = new Image();
        img.onload = () => {
            imgRef.current = img;
            drawCanvas();
        };
        img.src = `data:image/png;base64,${screenshotData}`;
    }, [screenshotData]);

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img) return;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw the screenshot scaled to window
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Darken everything
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // If there's a selection, clear the selected region to show original brightness
        if (selection) {
            const x = Math.min(selection.startX, selection.endX);
            const y = Math.min(selection.startY, selection.endY);
            const w = Math.abs(selection.endX - selection.startX);
            const h = Math.abs(selection.endY - selection.startY);

            if (w > 5 && h > 5) {
                // Clear the dark overlay in the selected region
                ctx.clearRect(x, y, w, h);
                // Redraw the image portion
                const scaleX = img.width / canvas.width;
                const scaleY = img.height / canvas.height;
                ctx.drawImage(img, x * scaleX, y * scaleY, w * scaleX, h * scaleY, x, y, w, h);

                // Draw selection border
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x, y, w, h);

                // Draw size indicator
                ctx.fillStyle = '#3b82f6';
                ctx.fillRect(x, y - 24, 100, 20);
                ctx.fillStyle = '#fff';
                ctx.font = '12px monospace';
                ctx.fillText(`${Math.round(w)}×${Math.round(h)}`, x + 4, y - 8);
            }
        }
    }, [selection]);

    useEffect(() => {
        drawCanvas();
    }, [drawCanvas]);

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsSelecting(true);
        setSelection({
            startX: e.clientX,
            startY: e.clientY,
            endX: e.clientX,
            endY: e.clientY,
        });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isSelecting || !selection) return;
        setSelection(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
    };

    const handleMouseUp = () => {
        setIsSelecting(false);
    };

    const handleConfirm = () => {
        if (!selection || !imgRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const img = imgRef.current;
        const scaleX = img.width / canvas.width;
        const scaleY = img.height / canvas.height;

        const x = Math.min(selection.startX, selection.endX) * scaleX;
        const y = Math.min(selection.startY, selection.endY) * scaleY;
        const w = Math.abs(selection.endX - selection.startX) * scaleX;
        const h = Math.abs(selection.endY - selection.startY) * scaleY;

        if (w < 10 || h < 10) {
            onCancel();
            return;
        }

        // Create a crop canvas
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = w;
        cropCanvas.height = h;
        const cropCtx = cropCanvas.getContext('2d');
        if (!cropCtx) return;

        cropCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

        // Convert to base64 (strip the data:image/png;base64, prefix)
        const dataUrl = cropCanvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        onCapture(base64);
    };

    // Keyboard handling
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && selection) handleConfirm();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selection]);

    const hasValidSelection = selection && 
        Math.abs(selection.endX - selection.startX) > 10 && 
        Math.abs(selection.endY - selection.startY) > 10;

    return (
        <div className="fixed inset-0 z-[9999] cursor-crosshair" style={{ pointerEvents: 'auto' }}>
            <canvas
                ref={canvasRef}
                className="absolute inset-0"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
            />

            {/* Instructions */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-sm border border-zinc-700">
                Drag to select region • <kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-xs">Enter</kbd> to confirm • <kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-xs">Esc</kbd> to cancel
            </div>

            {/* Confirm/Cancel buttons */}
            {hasValidSelection && !isSelecting && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3">
                    <button
                        onClick={handleConfirm}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        Analyze Region
                    </button>
                    <button
                        onClick={onCancel}
                        className="bg-zinc-700 hover:bg-zinc-600 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
};
