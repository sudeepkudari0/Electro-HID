import { uIOhook, UiohookKey, UiohookKeyboardEvent } from 'uiohook-napi';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../types/ipc';

let isMirroring = false;
let mainWindowRef: BrowserWindow | null = null;
let hookStarted = false;

const keyMap: Record<number, { normal: string, shift: string }> = {
    [UiohookKey.A]: { normal: 'a', shift: 'A' },
    [UiohookKey.B]: { normal: 'b', shift: 'B' },
    [UiohookKey.C]: { normal: 'c', shift: 'C' },
    [UiohookKey.D]: { normal: 'd', shift: 'D' },
    [UiohookKey.E]: { normal: 'e', shift: 'E' },
    [UiohookKey.F]: { normal: 'f', shift: 'F' },
    [UiohookKey.G]: { normal: 'g', shift: 'G' },
    [UiohookKey.H]: { normal: 'h', shift: 'H' },
    [UiohookKey.I]: { normal: 'i', shift: 'I' },
    [UiohookKey.J]: { normal: 'j', shift: 'J' },
    [UiohookKey.K]: { normal: 'k', shift: 'K' },
    [UiohookKey.L]: { normal: 'l', shift: 'L' },
    [UiohookKey.M]: { normal: 'm', shift: 'M' },
    [UiohookKey.N]: { normal: 'n', shift: 'N' },
    [UiohookKey.O]: { normal: 'o', shift: 'O' },
    [UiohookKey.P]: { normal: 'p', shift: 'P' },
    [UiohookKey.Q]: { normal: 'q', shift: 'Q' },
    [UiohookKey.R]: { normal: 'r', shift: 'R' },
    [UiohookKey.S]: { normal: 's', shift: 'S' },
    [UiohookKey.T]: { normal: 't', shift: 'T' },
    [UiohookKey.U]: { normal: 'u', shift: 'U' },
    [UiohookKey.V]: { normal: 'v', shift: 'V' },
    [UiohookKey.W]: { normal: 'w', shift: 'W' },
    [UiohookKey.X]: { normal: 'x', shift: 'X' },
    [UiohookKey.Y]: { normal: 'y', shift: 'Y' },
    [UiohookKey.Z]: { normal: 'z', shift: 'Z' },
    [UiohookKey[1]]: { normal: '1', shift: '!' },
    [UiohookKey[2]]: { normal: '2', shift: '@' },
    [UiohookKey[3]]: { normal: '3', shift: '#' },
    [UiohookKey[4]]: { normal: '4', shift: '$' },
    [UiohookKey[5]]: { normal: '5', shift: '%' },
    [UiohookKey[6]]: { normal: '6', shift: '^' },
    [UiohookKey[7]]: { normal: '7', shift: '&' },
    [UiohookKey[8]]: { normal: '8', shift: '*' },
    [UiohookKey[9]]: { normal: '9', shift: '(' },
    [UiohookKey[0]]: { normal: '0', shift: ')' },
    [UiohookKey.Comma]: { normal: ',', shift: '<' },
    [UiohookKey.Period]: { normal: '.', shift: '>' },
    [UiohookKey.Slash]: { normal: '/', shift: '?' },
    [UiohookKey.Semicolon]: { normal: ';', shift: ':' },
    [UiohookKey.Quote]: { normal: "'", shift: '"' },
    [UiohookKey.BracketLeft]: { normal: '[', shift: '{' },
    [UiohookKey.BracketRight]: { normal: ']', shift: '}' },
    [UiohookKey.Backslash]: { normal: '\\', shift: '|' },
    [UiohookKey.Minus]: { normal: '-', shift: '_' },
    [UiohookKey.Equal]: { normal: '=', shift: '+' },
    [UiohookKey.Space]: { normal: ' ', shift: ' ' },
    [UiohookKey.Enter]: { normal: '\n', shift: '\n' },
    [UiohookKey.Numpad0]: { normal: '0', shift: '0' },
    [UiohookKey.Numpad1]: { normal: '1', shift: '1' },
    [UiohookKey.Numpad2]: { normal: '2', shift: '2' },
    [UiohookKey.Numpad3]: { normal: '3', shift: '3' },
    [UiohookKey.Numpad4]: { normal: '4', shift: '4' },
    [UiohookKey.Numpad5]: { normal: '5', shift: '5' },
    [UiohookKey.Numpad6]: { normal: '6', shift: '6' },
    [UiohookKey.Numpad7]: { normal: '7', shift: '7' },
    [UiohookKey.Numpad8]: { normal: '8', shift: '8' },
    [UiohookKey.Numpad9]: { normal: '9', shift: '9' },
    [UiohookKey.NumpadMultiply]: { normal: '*', shift: '*' },
    [UiohookKey.NumpadAdd]: { normal: '+', shift: '+' },
    [UiohookKey.NumpadSubtract]: { normal: '-', shift: '-' },
    [UiohookKey.NumpadDecimal]: { normal: '.', shift: '.' },
    [UiohookKey.NumpadDivide]: { normal: '/', shift: '/' }
};

// Map uIOhook keycodes to character strings
function mapKeyToChar(e: UiohookKeyboardEvent): string | null {
    if (e.keycode === UiohookKey.Backspace) return 'BACKSPACE';
    
    const mapping = keyMap[e.keycode];
    if (mapping) {
        return e.shiftKey ? mapping.shift : mapping.normal;
    }
    
    return null;
}

function onKeydown(e: UiohookKeyboardEvent) {
    if (!isMirroring || !mainWindowRef || mainWindowRef.isDestroyed()) return;
    
    const char = mapKeyToChar(e);
    if (char) {
        mainWindowRef.webContents.send(IPC_CHANNELS.HID_KEY_PRESSED, char);
    }
}

export function startKeyMirror(mainWindow: BrowserWindow) {
    mainWindowRef = mainWindow;
    isMirroring = true;
    
    if (!hookStarted) {
        uIOhook.on('keydown', onKeydown);
        uIOhook.start();
        hookStarted = true;
    }
    console.log('[HID] Keystroke mirroring STARTED');
}

export function stopKeyMirror() {
    isMirroring = false;
    console.log('[HID] Keystroke mirroring STOPPED');
}

export function toggleKeyMirror(mainWindow: BrowserWindow): boolean {
    if (isMirroring) {
        stopKeyMirror();
        return false;
    } else {
        startKeyMirror(mainWindow);
        return true;
    }
}
