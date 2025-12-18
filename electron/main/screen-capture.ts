import { desktopCapturer, screen } from 'electron';

/**
 * Captures the primary screen as a base64-encoded PNG
 * @param sourceId - Optional source ID to capture specific window/screen
 * @returns Base64 encoded image data (without data URI prefix)
 */
export async function captureScreen(sourceId?: string): Promise<string> {
    try {
        console.log('[ScreenCapture] Starting capture, sourceId:', sourceId);

        // Get available sources
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: screen.getPrimaryDisplay().workAreaSize,
        });

        console.log('[ScreenCapture] Found sources:', sources.length, sources.map(s => ({ id: s.id, name: s.name })));

        // Select source
        let targetSource;
        if (sourceId) {
            targetSource = sources.find(source => source.id === sourceId);
            console.log('[ScreenCapture] Looking for sourceId:', sourceId, 'Found:', !!targetSource);
        } else {
            // Default to primary screen
            targetSource = sources.find(source => source.id.startsWith('screen:0'));
            if (!targetSource && sources.length > 0) {
                targetSource = sources[0];
            }
            console.log('[ScreenCapture] Using default source:', targetSource?.id);
        }

        if (!targetSource) {
            throw new Error('No screen source available for capture');
        }

        console.log('[ScreenCapture] Capturing from:', targetSource.name);

        // Get the thumbnail (screenshot)
        const thumbnail = targetSource.thumbnail;
        const size = thumbnail.getSize();
        console.log('[ScreenCapture] Screenshot size:', size.width, 'x', size.height);

        // Convert to PNG base64
        const pngBuffer = thumbnail.toPNG();
        const base64Image = pngBuffer.toString('base64');

        console.log('[ScreenCapture] Success! Image size:', Math.round(base64Image.length / 1024), 'KB');

        return base64Image;
    } catch (error) {
        console.error('[ScreenCapture] Failed:', error);
        throw error;
    }
}

/**
 * Get available screens and windows for capture
 */
export async function getCaptureSources() {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            fetchWindowIcons: true,
        });

        return sources.map(source => ({
            id: source.id,
            name: source.name,
            type: source.id.startsWith('screen') ? 'screen' as const : 'window' as const,
        }));
    } catch (error) {
        console.error('Failed to get capture sources:', error);
        return [];
    }
}
