# Electro-HID - AI Interview Assistant

A privacy-first, offline AI interview assistant with real-time speech recognition and intelligent answer suggestions. Built with Electron, React, Whisper.cpp, and Llama.cpp.

## ✨ Features

- 🎤 **Local Speech Recognition** - Real-time transcription using Whisper.cpp (100% offline)
- 🤖 **AI Answer Generation** - Get professional interview answers using local LLM (Llama.cpp)
- 🪟 **Glassmorphism Overlays** - Beautiful, transparent UI inspired by Parakeet AI
- 🎯 **Auto Question Detection** - Automatically detects when interviewer stops talking
- 📝 **Q&A History** - Navigate through multiple interview questions and answers
- ⏱️ **Session Timer** - Track your interview duration
- 🎨 **Modern UI** - Sleek design with backdrop blur and dark theme
- 🔒 **Privacy First** - Everything runs locally, no data leaves your machine

## Project Structure

```
electro-hid/
├── electron/                 # Main process code
│   ├── main/
│   │   ├── index.ts         # Main entry point
│   │   ├── window.ts        # Window management
│   │   ├── ipc-handlers.ts  # IPC event handlers
│   │   └── whisper/
│   │       └── transcriber.ts # Whisper.cpp wrapper
│   ├── preload/
│   │   └── index.ts         # Preload script (IPC bridge)
│   └── types/
│       └── ipc.d.ts         # IPC type definitions
│
├── src/                      # Renderer process (React)
├── components/
│   │   ├── ui/              # shadcn components
│   │   ├── AudioRecorder/
│   │   └── TranscriptDisplay/
│   ├── hooks/
│   │   ├── useWhisper.ts
│   │   └── useAudioRecorder.ts
│   └── lib/
│       └── utils.ts
│
├── e2e/                      # Playwright E2E tests
│   ├── app.spec.ts
│   ├── helpers.ts
│   └── README.md
│
└── models/                   # Whisper model files (auto-downloaded)
```

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- Windows (for overlay features)

### Installation

```bash
# Install dependencies
bun install

# Build Electron main process
bun run build:electron

# Run in development mode
bun run dev
```

### Running Tests

```bash
# Run E2E tests
bun run test:e2e

# Run tests with UI visible
bun run test:e2e:headed

# Debug mode
bun run test:e2e:debug

# Interactive UI mode
bun run test:e2e:ui
```

## Architecture

### Main Process (Electron)
- **Whisper.cpp Integration** - Native transcription in main process
- **IPC Handlers** - Type-safe communication with renderer
- **Window Management** - Overlay configuration

### Renderer Process (React)
- **Component Architecture** - Modular, reusable components
- **Custom Hooks** - useWhisper, useAudioRecorder
- **Tailwind CSS** - Utility-first styling with shadcn/ui

### IPC Communication
```
Renderer → IPC → Main Process
    ↓                ↓
Audio Capture → Whisper.cpp
    ↓                ↓
Display ← IPC ← Transcription
```

## Technologies

- **Electron** - Desktop app framework
- **Vite** - Fast build tool
- **React + TypeScript** - UI framework
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **whisper-node** - Native Whisper.cpp bindings
- **Playwright** - E2E testing

## Development

```bash
# Start dev server
bun run dev

# Build for production
bun run build
bun run build:electron

# Start production build
bun run start
```

## Testing

See [E2E Testing Guide](./e2e/README.md) for detailed information.

## License

ISC
