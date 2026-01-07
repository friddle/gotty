import { ConnectionFactory } from "./websocket";
import { Terminal, WebTTY, protocols } from "./webtty";
import { GoTTYXterm } from "./xterm";
import { NotificationManager } from "./notification";

// @TODO remove these
declare var gotty_auth_token: string;
declare var gotty_term: string;
declare var gotty_ws_query_args: string;

// Extract session ID from pathname
// Pathname format: /{session_id}/ or /{session_id}
const getSessionId = (): string => {
    const pathname = window.location.pathname;
    // Remove leading/trailing slashes and split
    const parts = pathname.split('/').filter(p => p.length > 0);
    return parts[0] || '';
};

const elem = document.getElementById("terminal")

if (elem !== null) {
    var term: Terminal;
    term = new GoTTYXterm(elem);

    const httpsEnabled = window.location.protocol == "https:";
    const queryArgs = (gotty_ws_query_args === "") ? "" : "?" + gotty_ws_query_args;
    const url = (httpsEnabled ? 'wss://' : 'ws://') + window.location.host + window.location.pathname + 'ws' + queryArgs;
    const args = window.location.search;
    const factory = new ConnectionFactory(url, protocols);
    const wt = new WebTTY(term, factory, args, gotty_auth_token);
    const closer = wt.open();

    // According to https://developer.mozilla.org/en-US/docs/Web/API/Window/unload_event
    // this event is unreliable and in some cases (Firefox is mentioned), having an
    // "unload" event handler can have unwanted side effects. Consider commenting it out.
    window.addEventListener("unload", () => {
        closer();
        term.close();
    });

    // Setup notification manager and SSE connection
    const notificationManager = new NotificationManager();
    if (notificationManager.isSupported()) {
        // Request notification permission
        notificationManager.requestPermission().then(granted => {
            if (granted) {
                console.log('Notification permission granted');

                // Connect to SSE notification stream
                const sessionId = getSessionId();
                if (sessionId) {
                    const protocol = window.location.protocol;
                    const host = window.location.host;
                    const sseUrl = `${protocol}//${host}/api/v1/notifications/stream?session_id=${sessionId}`;

                    console.log('Connecting to SSE:', sseUrl);
                    const eventSource = new EventSource(sseUrl);

                    eventSource.onopen = () => {
                        console.log('SSE connection established');
                    };

                    eventSource.onerror = (err) => {
                        console.error('SSE connection error:', err);
                    };

                    // Listen for specific notification types
                    const eventTypes = ['task_completed', 'error', 'progress', 'system_status'];

                    eventTypes.forEach(type => {
                        eventSource.addEventListener(type, (e) => {
                            try {
                                const data = JSON.parse(e.data);
                                console.log('Received notification:', data);

                                // Extract title and message from notification data
                                const title = data.Data?.title || data.Type || 'Notification';
                                const message = data.Data?.message || data.Data || '';
                                const notifType = data.Data?.level || data.Data?.type || 'info';

                                // Map notification types to sound types
                                let soundType = 'default';
                                if (data.Type === 'error' || notifType === 'error') {
                                    soundType = 'error';
                                } else if (data.Type === 'task_completed' || notifType === 'success') {
                                    soundType = 'success';
                                }

                                // Show notification with sound
                                notificationManager.show(title, {
                                    body: String(message),
                                    soundType: soundType
                                });
                            } catch (err) {
                                console.error('Failed to parse notification:', err);
                            }
                        });
                    });

                    // Cleanup on page unload
                    window.addEventListener("unload", () => {
                        eventSource.close();
                    });
                } else {
                    console.warn('No session ID found, cannot connect to SSE');
                }
            } else {
                console.log('Notification permission denied');
            }
        });
    }
};
