export class NotificationManager {
    private permission: NotificationPermission = 'default';
    private hasSupport: boolean = false;
    private audioContext: AudioContext | null = null;

    constructor() {
        this.hasSupport = 'Notification' in window;
        this.permission = Notification.permission;

        // Initialize AudioContext for notification sounds
        if ('AudioContext' in window) {
            this.audioContext = new AudioContext();
        }
    }

    async requestPermission(): Promise<boolean> {
        if (!this.hasSupport) {
            console.warn('Notification API not supported');
            return false;
        }

        if (this.permission === 'granted') {
            return true;
        }

        const result = await Notification.requestPermission();
        this.permission = result;
        return result === 'granted';
    }

    playNotificationSound(type: string = 'default') {
        if (!this.audioContext) return;

        // Resume audio context if suspended (required by browsers after user interaction)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Create oscillator for notification sound
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Different sounds for different types
        switch (type) {
            case 'error':
                oscillator.frequency.value = 200;
                oscillator.type = 'sawtooth';
                break;
            case 'success':
                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                break;
            default:
                oscillator.frequency.value = 440;
                oscillator.type = 'sine';
        }

        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);

        oscillator.start();
        oscillator.stop(this.audioContext.currentTime + 0.5);
    }

    show(title: string, options?: NotificationOptions & { soundType?: string }): Notification | null {
        if (!this.hasSupport || this.permission !== 'granted') {
            console.warn('Cannot show notification:', this.permission);
            return null;
        }

        // Play notification sound
        if (options?.soundType) {
            this.playNotificationSound(options.soundType);
        }

        const notifOptions: NotificationOptions = {
            icon: '/icon_192.png',
            badge: '/icon_192.png',
            ...options
        };

        // Remove soundType from options as it's not part of NotificationOptions
        delete (notifOptions as any).soundType;

        return new Notification(title, notifOptions);
    }

    getPermissionStatus(): NotificationPermission {
        return this.permission;
    }

    isSupported(): boolean {
        return this.hasSupport;
    }
}
