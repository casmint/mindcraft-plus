export function createActionResult({
    cleanup = {},
    evidence = {},
    message = '',
    reasonCode,
    retryable = false,
    status,
}) {
    return {
        cleanup,
        evidence,
        message,
        reasonCode,
        retryable,
        status,
    };
}
