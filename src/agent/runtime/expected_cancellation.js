export function isExpectedGoalChangedError(error) {
    const name = error?.name || '';
    const message = error?.message || String(error || '');
    return name === 'GoalChanged' || /GoalChanged|The goal was changed before it could be completed/i.test(message);
}
