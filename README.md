# Synapse AI

### AI-powered interview practice platform with offline speech recognition, real-time delivery coaching, and LLM-generated feedback

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)](https://www.microsoft.com/windows)

<!-- ADD DEMO GIF HERE -->
<!-- INSTRUCTION: Record a demo of a practice session showing real-time feedback and export it to a GIF. Place the GIF in this directory and link it here as: ![Synapse AI Demo](./demo.gif) -->

Synapse AI is a privacy-first, offline desktop application designed to help you prepare and practice for interviews. By simulating real-world interview conditions, it provides immediate speech-to-text transcription, real-time delivery coaching metrics, and personalized, AI-generated answer feedback to help you boost your confidence and ace your next career opportunity.

---

## ✨ Features

- 🎤 **Real-Time Speech Recognition** - Lightning-fast streaming transcription via Deepgram WebSocket API, with offline fallbacks using Whisper.cpp or Moonshine ONNX.
- 🧠 **AI-Powered Answer Generation** - Get structured answer suggestions and follow-up questions using ultra-fast cloud providers (Groq, Gemini, OpenAI) or local LLMs (Ollama).
- 👻 **Stealth Teleprompter Mode** - Floating, completely transparent, and click-through overlay mode for covert interview assistance that works on top of any video conferencing app.
- 🎙️ **Interview Prep Dashboard** - A beautiful, aesthetic landing page that automatically tracks your historical practice sessions, including questions asked, session duration, and performance.
- 🔄 **Smart Audio & Echo Suppression** - Advanced dual-channel audio capture (microphone + system audio) with cross-channel echo suppression for seamless back-and-forth mock interviews.
- 📊 **Real-Time Delivery Analytics** - Keep track of pacing (words per minute), filler words (like "um", "ah", "like"), and talk-time ratios to improve your delivery flow.
- 📝 **Resume-Aware Feedback** - Input your professional background summary to receive personalized answer suggestions tailored specifically to your unique experience.
- ⭐ **STAR Method Suggestions** - Practice structuring your behavioral responses using the Situation, Task, Action, and Result (STAR) framework.
- 📄 **Practice Session Scoring & PDF Export** - Review multi-dimensional scores for your answers and export complete practice session reports to PDF for offline review.
- 💼 **Career Hub** - Search for active job listings across top platforms, block companies, and prepare specifically for those roles by importing their job descriptions directly into practice sessions.

---

## 🛠️ Tech Stack

- **Core & Desktop Shell:** [Electron](https://www.electronjs.org/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Build & Package Tooling:** [Vite](https://vite.dev/), [electron-builder](https://www.electron.build/)
- **UI Design System:** [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/)
- **Speech-to-Text Engines:** [Whisper.cpp](https://github.com/ggerganov/whisper.cpp), Moonshine ONNX
- **LLM Integrations:** [Ollama](https://ollama.com/) (Local), OpenAI SDK (Cloud)
- **PDF Generation:** `jspdf`

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+) or [Bun](https://bun.sh/)
- Windows OS (Required for transparent overlay features and desktop audio loopback capture)
- [Ollama](https://ollama.com/) (Required for local LLM execution)

### Installation

Clone the repository and install dependencies:

```bash
# Clone the repository
git clone https://github.com/sudeepkudari0/synapse-ai.git
cd synapse-ai

# Install dependencies using bun (or npm)
bun install
```

### Running Locally

```bash
# Build the Electron main and preload processes
bun run build:electron

# Start the application in development mode
bun run dev
```

### 🧠 Setting up AI Models

1. **Speech Recognition (STT):**
   Model files can be downloaded directly from the Settings Panel inside the application. The system manages downloading and switching between Whisper and Moonshine engines automatically.
   
2. **Local LLM Answers (Ollama):**
   Ensure Ollama is running on your machine. Pull your preferred model (e.g., `qwen2.5-coder:7b` or `llama3.1:8b`):
   ```bash
   ollama run qwen2.5-coder:7b
   ```

---

## 🧪 Testing

Synapse AI uses [Playwright](https://playwright.dev/) for end-to-end integration and smoke tests.

```bash
# Run all E2E tests
bun run test:e2e

# Run tests with a visible window (headed)
bun run test:e2e:headed

# Run tests in interactive UI mode
bun run test:e2e:ui
```

---

## 🏗️ Architecture

### Main Process (Electron)
- **STT Sidecar Integrations:** Manages native Whisper.cpp execution and Moonshine ONNX pipelines.
- **Window Management:** Configures practice overlay panels, resizing, position preservation, and desktop screen sharing.
- **IPC Handler Layer:** Handles type-safe, asynchronous calls from the React UI to retrieve/save settings, control windows, and execute system commands.

### Renderer Process (React)
- **Component Architecture:** Modern dashboard views (Overview, Career Hub, Settings) and a transparent Practice overlay widget.
- **Custom React Hooks:** `useWhisper`, `useMixedAudioRecorder`, and `useLLM` wrap side-effects and provide cleaner state consumption.
- **Local Storage / Settings:** Saves user configurations, resume context, and saved job descriptions securely on-device.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major architectural changes, please open an issue first to discuss what you would like to change.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the ISC License.
