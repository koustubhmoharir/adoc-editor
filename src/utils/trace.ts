
const globalObj = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {};

/**
 * Logs messages using console.log if trace logging is enabled.
 * This is controlled by the global variable __TEST_ENABLE_TRACE_LOGGING.
 * It is removed in production builds so it is safe to keep it permanently in the source.
 * @param args - The messages or objects to log.
 */
export function traceLog(...args: any[]) {
    if ((globalObj as any).__TEST_ENABLE_TRACE_LOGGING) {
        console.log(...args);
    }
}