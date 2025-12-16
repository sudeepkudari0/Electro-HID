# E2E Testing with Playwright

This directory contains end-to-end tests for the Electron application using Playwright.

## Running Tests

```bash
# Run all tests
bun run test:e2e

# Run tests in headed mode (see the app window)
bun run test:e2e:headed

# Run tests in debug mode
bun run test:e2e:debug

# Run specific test file
bunx playwright test e2e/app.spec.ts

# Generate test report
bunx playwright show-report
```

## Test Structure

- `app.spec.ts` - Main application tests
- `helpers.ts` - Reusable test utilities

## Test Coverage

### App Launch Tests
- ✅ Application launches successfully
- ✅ Window properties (frameless, transparent, always-on-top)
- ✅ UI elements render correctly

### Model Loading Tests
- ✅ Whisper model loads on first start
- ✅ Loading indicator appears
- ✅ Model status updates correctly

### Recording Tests
- ✅ Recording starts when button clicked
- ✅ Recording indicator shows when active
- ✅ Recording stops when stop button clicked

### Transcript Tests
- ✅ Placeholder text shows when idle
- ✅ Transcript container is scrollable
- ✅ Transcript clears on new recording

### Window Tests
- ✅ Frameless window
- ✅ Transparent background
- ✅ Always on top behavior

## Notes

- First test run may take longer due to Whisper model download (~75MB)
- Tests run sequentially (worker: 1) to avoid Electron conflicts
- Screenshots are captured in `e2e/screenshots/`
- Test artifacts (videos, traces) saved only on failure
