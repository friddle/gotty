import { IDisposable, Terminal } from "@xterm/xterm";
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { ZModemAddon } from "./zmodem";

export class GoTTYXterm {
    // The HTMLElement that contains our terminal
    elem: HTMLElement;

    // The xtermjs.XTerm
    term: Terminal;

    resizeListener: () => void;

    message: HTMLElement;
    messageTimeout: number;
    messageTimer: NodeJS.Timeout;

    onResizeHandler: IDisposable;
    onDataHandler: IDisposable;

    fitAddOn: FitAddon;
    zmodemAddon: ZModemAddon;
    toServer: (data: string | Uint8Array) => void;
    encoder: TextEncoder

    constructor(elem: HTMLElement) {
        this.elem = elem;
        this.term = new Terminal();
        this.fitAddOn = new FitAddon();
        this.zmodemAddon = new ZModemAddon({
            toTerminal: (x: Uint8Array) => this.term.write(x),
            toServer: (x: Uint8Array) => this.sendInput(x)
        });
        this.term.loadAddon(new WebLinksAddon());
        this.term.loadAddon(this.fitAddOn);
        this.term.loadAddon(this.zmodemAddon);

        this.message = elem.ownerDocument.createElement("div");
        this.message.className = "xterm-overlay";
        this.messageTimeout = 2000;

        this.resizeListener = () => {
            this.fitAddOn.fit();
            this.term.scrollToBottom();
            this.showMessage(String(this.term.cols) + "x" + String(this.term.rows), this.messageTimeout);
        };

        this.term.open(elem);
        this.term.focus();
        this.resizeListener();

        window.addEventListener("resize", () => { this.resizeListener(); });
    };

    info(): { columns: number, rows: number } {
        return { columns: this.term.cols, rows: this.term.rows };
    };

    // This gets called from the Websocket's onReceive handler
    output(data: Uint8Array) {
        this.zmodemAddon.consume(data);
    };

    getMessage(): HTMLElement {
        return this.message;
    }

    showMessage(message: string, timeout: number) {
        this.message.innerHTML = message;
        this.showMessageElem(timeout);
    }

    showMessageElem(timeout: number) {
        this.elem.appendChild(this.message);

        if (this.messageTimer) {
            clearTimeout(this.messageTimer);
        }
        if (timeout > 0) {
            this.messageTimer = setTimeout(() => {
                try {
                    this.elem.removeChild(this.message);
                } catch (error) {
                    console.error(error);
                }
            }, timeout);
        }
    };

    removeMessage(): void {
        if (this.message.parentNode == this.elem) {
            this.elem.removeChild(this.message);
        }
    }

    setWindowTitle(title: string) {
        document.title = title;
    };

    setPreferences(value: object) {
        Object.keys(value).forEach((key) => {
            if (key == "EnableWebGL" && key) {
                this.term.loadAddon(new WebglAddon());
            } else if (key == "font-size") {
                this.term.options.fontSize = value[key]
            } else if (key == "font-family") {
                this.term.options.fontFamily = value[key]
            }
        });
    };

    sendInput(data: Uint8Array) {
        return this.toServer(data)
    }

    onInput(callback: (input: string) => void) {
        this.encoder = new TextEncoder()
        this.toServer = callback;

        // Expose sendInput function globally for mobile keyboard trigger
        (window as any).gottySendInput = (data: string) => {
            console.log('gottySendInput called:', data);
            this.toServer(this.encoder.encode(data));
        };

        // I *think* we're ok like this, but if not, we can dispose
        // of the previous handler and put the new one in place.
        if (this.onDataHandler !== undefined) {
            return
        }

        // Standard xterm.js input handler
        this.onDataHandler = this.term.onData((input) => {
            this.toServer(this.encoder.encode(input));
        });

        // Mobile-specific input handling
        this.setupMobileInput();
    }

    private setupMobileInput() {
        const termElement = this.elem.querySelector('.xterm-text-layer') || this.elem;
        const terminalElement = this.elem;

        // Detect iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // Detect mobile/touch devices
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // Only set up mobile-specific handlers on mobile/iOS devices
        if (!isMobile && !isIOS) {
            console.log('Desktop detected - skipping mobile input handlers');
            return;
        }

        // Handle beforeinput event - captures input BEFORE it's inserted (iOS compatible)
        terminalElement.addEventListener('beforeinput', (e: Event) => {
            const inputEvent = e as InputEvent;
            if (inputEvent.data && inputEvent.inputType === 'insertText') {
                console.log('beforeinput event:', inputEvent.data);
                // Send each character immediately for iOS
                this.toServer(this.encoder.encode(inputEvent.data));
                if (isIOS) {
                    e.preventDefault();
                }
            }
        }, { passive: false });

        // Handle textInput event for mobile virtual keyboards
        termElement.addEventListener('textInput', (e: Event) => {
            const inputEvent = e as InputEvent;
            if (inputEvent.data) {
                console.log('textInput event:', inputEvent.data);
                this.toServer(this.encoder.encode(inputEvent.data));
                e.preventDefault();
            }
        }, { passive: false });

        // Handle compositionupdate to get real-time input during IME composition
        terminalElement.addEventListener('compositionupdate', (e: Event) => {
            const compositionEvent = e as CompositionEvent;
            if (compositionEvent.data && isIOS) {
                // For iOS, send the new data immediately
                const newData = compositionEvent.data;
                // Send only the last character if data length > 0
                if (newData.length > 0) {
                    const lastChar = newData.slice(-1);
                    console.log('compositionupdate event (iOS):', lastChar);
                    this.toServer(this.encoder.encode(lastChar));
                }
            }
        });

        // Handle compositionend for IME (predictive text, auto-correct)
        terminalElement.addEventListener('compositionend', (e: Event) => {
            const compositionEvent = e as CompositionEvent;
            if (compositionEvent.data) {
                console.log('compositionend event:', compositionEvent.data);
                // For non-iOS, send the full composed text
                if (!isIOS) {
                    this.toServer(this.encoder.encode(compositionEvent.data));
                }
            }
        });

        // Handle input event as fallback for mobile browsers
        // For desktop, check isComposing to avoid sending text during IME composition
        terminalElement.addEventListener('input', (e: Event) => {
            const inputEvent = e as InputEvent;
            if (inputEvent.data) {
                // On desktop, don't send input during IME composition (wait for compositionend)
                const isComposing = (e.target as HTMLElement).isContentEditable ? false : (inputEvent as any).isComposing;
                if (!isComposing || isMobile) {
                    console.log('input event:', inputEvent.data);
                    this.toServer(this.encoder.encode(inputEvent.data));
                }
            }
        });

        // Ensure terminal gets focus on touch
        terminalElement.addEventListener('touchstart', () => {
            this.term.focus();
        }, { passive: true });
    }

    onResize(callback: (colmuns: number, rows: number) => void) {
        this.onResizeHandler = this.term.onResize(() => {
            callback(this.term.cols, this.term.rows);
        });
    };

    deactivate(): void {
        this.onDataHandler.dispose();
        this.onResizeHandler.dispose();
        this.term.blur();
    }

    reset(): void {
        this.removeMessage();
        this.term.clear();
    }

    close(): void {
        window.removeEventListener("resize", this.resizeListener);
        this.term.dispose();
    }

    disableStdin(): void {
        this.term.options.disableStdin = true;
    }

    enableStdin(): void {
        this.term.options.disableStdin = false;
    }

    focus(): void {
        this.term.focus();
    }
}
