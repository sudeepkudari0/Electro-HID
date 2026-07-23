import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Loader2, Camera, Crop } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLLM } from '../../hooks/useLLM';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    isStreaming?: boolean;
    imageData?: string; // Optional image data sent by user
}

interface ChatPanelProps {
    onClose: () => void;
}

// Sub-component for cropping
function ImageCropper({ src, onCrop, onCancel }: { src: string, onCrop: (croppedBase64: string) => void, onCancel: () => void }) {
    const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const imageRef = useRef<HTMLImageElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setStartPos({ x, y });
        setCrop({ x, y, width: 0, height: 0 });
        setIsDragging(true);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        setCrop({
            x: Math.min(startPos.x, currentX),
            y: Math.min(startPos.y, currentY),
            width: Math.abs(currentX - startPos.x),
            height: Math.abs(currentY - startPos.y)
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleApply = () => {
        if (!imageRef.current) return;
        if (crop.width === 0 || crop.height === 0) {
            // Use full image
            onCrop(src);
            return;
        }

        const canvas = document.createElement('canvas');
        const scaleX = imageRef.current.naturalWidth / imageRef.current.width;
        const scaleY = imageRef.current.naturalHeight / imageRef.current.height;

        canvas.width = crop.width * scaleX;
        canvas.height = crop.height * scaleY;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(
                imageRef.current,
                crop.x * scaleX,
                crop.y * scaleY,
                crop.width * scaleX,
                crop.height * scaleY,
                0,
                0,
                crop.width * scaleX,
                crop.height * scaleY
            );
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const base64 = dataUrl.split(',')[1];
            onCrop(base64);
        }
    };

    return (
        <div className="absolute inset-0 z-50 bg-black/90 flex flex-col p-4 backdrop-blur-md rounded-lg">
            <div className="flex justify-between items-center mb-4">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                    <Crop className="w-4 h-4 text-indigo-400" />
                    Select Region
                </span>
                <div className="flex gap-2">
                    <button onClick={onCancel} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs transition-colors">Cancel</button>
                    <button onClick={handleApply} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold transition-colors">Apply</button>
                </div>
            </div>
            <div className="flex-1 rounded-lg overflow-hidden flex items-center justify-center cursor-crosshair border border-zinc-800 bg-zinc-950/50">
                <div
                    className="relative max-w-full max-h-full inline-block"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    <img
                        ref={imageRef}
                        src={`data:image/png;base64,${src}`}
                        className="max-w-full max-h-full object-contain pointer-events-none"
                        alt="Crop target"
                        draggable={false}
                    />
                    {(crop.width > 0 && crop.height > 0) && (
                        <div
                            className="absolute border-2 border-indigo-400 bg-indigo-400/20"
                            style={{
                                left: crop.x,
                                top: crop.y,
                                width: crop.width,
                                height: crop.height
                            }}
                        />
                    )}
                </div>
            </div>
            <p className="text-center text-xs text-zinc-400 mt-3 font-medium">Drag to select an area, or click Apply for full screen.</p>
        </div>
    );
}

export function ChatPanel({ onClose }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [rawCapture, setRawCapture] = useState<string | null>(null);
    const [attachedImage, setAttachedImage] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [isInjecting, setIsInjecting] = useState(false);
    const [isMirroring, setIsMirroring] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const { isGenerating, generateResponse } = useLLM({
        systemPrompt: "You are a helpful AI assistant integrated into an overlay tool. Be concise, direct, and helpful. Use markdown formatting where appropriate.",
    });

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        // Listen for the global shortcut toggle
        const cleanupShortcut = window.electronAPI.onShortcut('shortcut:toggle-mirroring', (data?: { isMirroring: boolean }) => {
            setIsMirroring(!!data?.isMirroring);
        });

        // Listen for mirrored keystrokes
        const cleanupKey = window.electronAPI.hid.onKeyPressed((char: string) => {
            if (char === 'BACKSPACE') {
                setInput(prev => prev.slice(0, -1));
            } else {
                setInput(prev => prev + char);
            }
        });

        return () => {
            cleanupShortcut();
            cleanupKey();
        };
    }, []);

    const handleAttachCapture = async () => {
        setIsCapturing(true);
        try {
            const result = await window.electronAPI.captureScreen();
            if (result.success && result.imageData) {
                setRawCapture(result.imageData);
            }
        } catch (error) {
            console.error('Failed to capture screen:', error);
        } finally {
            setIsCapturing(false);
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && !attachedImage) || isGenerating) return;

        const userText = input.trim();
        const imageToSend = attachedImage;
        setInput('');
        setAttachedImage(null);

        const userMsg: Message = { id: Date.now().toString(), role: 'user', text: userText, imageData: imageToSend || undefined };

        const assistantId = (Date.now() + 1).toString();
        const assistantMsg: Message = { id: assistantId, role: 'assistant', text: '', isStreaming: true };

        setMessages(prev => [...prev, userMsg, assistantMsg]);

        const contextMessages = messages.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n');
        let streamedText = '';

        try {
            await generateResponse(
                userText || 'Analyze this image.',
                contextMessages.length > 0 ? `Previous Conversation:\n${contextMessages}` : undefined,
                (chunk) => {
                    streamedText += chunk;
                    setMessages(prev =>
                        prev.map(m =>
                            m.id === assistantId ? { ...m, text: streamedText } : m
                        )
                    );
                },
                imageToSend || undefined
            );

            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantId ? { ...m, isStreaming: false } : m
                )
            );
        } catch (error) {
            console.error('Chat generation error:', error);
            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantId ? { ...m, text: streamedText + '\n\n**[Error generating response]**', isStreaming: false } : m
                )
            );
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col flex-1 h-full min-h-0 border-t border-[var(--border-subtle)] animate-slide-up bg-zinc-900 shadow-2xl relative">
            {/* Cropper Overlay */}
            {rawCapture && (
                <ImageCropper
                    src={rawCapture}
                    onCrop={(cropped) => {
                        setAttachedImage(cropped);
                        setRawCapture(null);
                    }}
                    onCancel={() => setRawCapture(null)}
                />
            )}

            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-sm z-10 relative shadow-sm">
                <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-indigo-400" />
                    <h2 className="text-sm font-semibold text-white tracking-wide">AI Assistant</h2>
                    {isMirroring && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] uppercase font-bold flex items-center gap-1 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                            Mirroring ON
                        </span>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition-all duration-200"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent select-text">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 opacity-60">
                        <Bot className="w-10 h-10" />
                        <p className="text-xs">Ask me anything...</p>
                        <p className="text-[10px]">You can attach screenshots for context.</p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-3 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                    >
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-zinc-800 border border-zinc-700'
                            }`}>
                            {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-indigo-400" />}
                        </div>

                        <div className={`max-w-[80%] min-w-0 overflow-hidden flex flex-col gap-2 rounded-2xl px-4 py-2.5 text-sm ${msg.role === 'user'
                                ? 'bg-indigo-600 text-white rounded-tr-sm shadow-md'
                                : 'bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-tl-sm shadow-md'
                            }`}>
                            {msg.imageData && (
                                <img src={`data:image/jpeg;base64,${msg.imageData}`} alt="Attached context" className="rounded-lg max-h-32 object-contain bg-black/20" />
                            )}
                            {msg.text && (
                                <div className="leading-relaxed text-sm select-text min-w-0 w-full">
                                    <ReactMarkdown
                                        components={{
                                            p({ children }) {
                                                return <p className="mb-2 last:mb-0">{children}</p>;
                                            },
                                            ul({ children }) {
                                                return <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1">{children}</ul>;
                                            },
                                            ol({ children }) {
                                                return <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1">{children}</ol>;
                                            },
                                            li({ children }) {
                                                return <li className="mb-0.5">{children}</li>;
                                            },
                                            h1({ children }) {
                                                return <h1 className="text-base font-semibold mt-3 mb-1.5 first:mt-0">{children}</h1>;
                                            },
                                            h2({ children }) {
                                                return <h2 className="text-sm font-semibold mt-2.5 mb-1.5 first:mt-0">{children}</h2>;
                                            },
                                            h3({ children }) {
                                                return <h3 className="text-xs font-semibold mt-2 mb-1 first:mt-0">{children}</h3>;
                                            },
                                            a({ href, children }) {
                                                return (
                                                    <a
                                                        href={href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={msg.role === 'user' ? 'text-white underline hover:opacity-80' : 'text-indigo-400 hover:text-indigo-300 underline'}
                                                    >
                                                        {children}
                                                    </a>
                                                );
                                            },
                                            blockquote({ children }) {
                                                return (
                                                    <blockquote className={`border-l-2 pl-3 italic my-2 ${msg.role === 'user' ? 'border-white/50 text-white/80' : 'border-indigo-500/50 text-zinc-400'
                                                        }`}>
                                                        {children}
                                                    </blockquote>
                                                );
                                            },
                                            code({ node, className, children, ...props }) {
                                                const match = /language-(\w+)/.exec(className || '');
                                                const isInline = !match;
                                                if (isInline) {
                                                    return (
                                                        <code
                                                            className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${msg.role === 'user'
                                                                    ? 'bg-indigo-700 text-white'
                                                                    : 'bg-zinc-900 text-emerald-400'
                                                                }`}
                                                            {...props}
                                                        >
                                                            {children}
                                                        </code>
                                                    );
                                                }
                                                const lang = match ? match[1] : '';
                                                const codeString = String(children).replace(/\n$/, '');
                                                return (
                                                    <div className="relative group my-3 rounded-lg overflow-hidden border border-zinc-700/50 w-full min-w-0">
                                                        <div className="flex items-center justify-between bg-zinc-800/80 px-3 py-1.5 border-b border-zinc-700/50">
                                                            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                                                                {lang || 'code'}
                                                            </span>
                                                            <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-200">
                                                                <button
                                                                    onClick={async () => {
                                                                        if (isInjecting) {
                                                                            await window.electronAPI.hid.stopTyping();
                                                                            setIsInjecting(false);
                                                                        } else {
                                                                            setIsInjecting(true);
                                                                            await window.electronAPI.hid.typeText(codeString);
                                                                            setIsInjecting(false);
                                                                        }
                                                                    }}
                                                                    className={`text-[10px] ${isInjecting ? 'text-red-400 hover:text-red-300' : 'text-emerald-500 hover:text-emerald-400'} font-medium transition-colors flex items-center gap-1`}
                                                                >
                                                                    {isInjecting ? 'Stop Typing' : 'Inject'}
                                                                </button>
                                                                <button
                                                                    onClick={() => navigator.clipboard.writeText(codeString)}
                                                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                                                                >
                                                                    Copy
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <pre className="!bg-zinc-950 !m-0 p-3 overflow-x-auto scrollbar-thin w-full max-w-full">
                                                            <code className={`${className || ''} text-xs font-mono leading-relaxed text-zinc-200`} {...props}>
                                                                {children}
                                                            </code>
                                                        </pre>
                                                    </div>
                                                );
                                            },
                                        }}
                                    >
                                        {msg.text}
                                    </ReactMarkdown>
                                </div>
                            )}
                            {msg.isStreaming && (
                                <span className="inline-block w-1.5 h-4 ml-1 bg-indigo-400 animate-pulse align-middle" />
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} className="h-1" />
            </div>

            {/* Input Area */}
            <div className="shrink-0 p-3 border-t border-zinc-800 bg-zinc-900/50 flex flex-col gap-2">
                {/* Attached Image Preview */}
                {attachedImage && (
                    <div className="relative self-start group mb-1">
                        <img src={`data:image/jpeg;base64,${attachedImage}`} alt="Preview" className="h-16 w-auto rounded-md border border-zinc-700 shadow-sm" />
                        <button
                            onClick={() => setAttachedImage(null)}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                )}

                <div className="relative flex items-center gap-2">
                    <button
                        onClick={handleAttachCapture}
                        disabled={isCapturing}
                        className={`p-2 rounded-lg transition-all duration-200 flex items-center justify-center border border-zinc-800 ${isCapturing
                                ? 'text-zinc-600 bg-zinc-900 cursor-not-allowed'
                                : 'text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800 bg-zinc-950'
                            }`}
                        title="Capture Screen Region"
                    >
                        {isCapturing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                    </button>

                    <div className="relative flex-1 flex items-center">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={attachedImage ? "Add a prompt about the image..." : "Type a message..."}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-4 pr-12 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none scrollbar-thin shadow-inner"
                            rows={1}
                            style={{ minHeight: '44px', maxHeight: '120px' }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={(!input.trim() && !attachedImage) || isGenerating}
                            className={`absolute right-2 p-2 rounded-lg transition-all duration-200 flex items-center justify-center ${(!input.trim() && !attachedImage) || isGenerating
                                    ? 'text-zinc-600 cursor-not-allowed'
                                    : 'text-indigo-400 hover:text-white hover:bg-indigo-600 shadow-sm'
                                }`}
                        >
                            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

