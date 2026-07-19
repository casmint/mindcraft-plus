const COMBAT_STATE_TTL_MS = 5_000;

export function getCombatState(agent, now = Date.now()) {
    const state = agent.combatState;
    if (!state || now - state.lastSeenAt > COMBAT_STATE_TTL_MS) {
        agent.combatState = null;
        return null;
    }
    return state;
}

export function clearCombatState(agent, reason = 'cleared') {
    if (agent.combatState) {
        agent.combatState = null;
        if (agent.bot) agent.bot.combatStateReason = reason;
    }
}

export function claimCombatState(agent, enemy, threat, now = Date.now()) {
    const previous = getCombatState(agent, now);
    const targetId = enemy.id ?? enemy.uuid ?? enemy.name;
    if (previous && previous.targetId !== targetId && threat.stance !== 'ESCAPE') {
        return previous;
    }

    let stance = threat.stance;
    if (previous?.targetId === targetId && previous.stance !== stance && stance !== 'ESCAPE') {
        stance = previous.stance;
    }
    const ownerMode = stance === 'ENGAGE' ? 'self_defense' : 'cowardice';
    const state = {
        targetId,
        targetName: enemy.name,
        targetType: enemy.type ?? enemy.name,
        stance,
        ownerMode: previous?.targetId === targetId && stance !== 'ESCAPE'
            ? previous.ownerMode
            : ownerMode,
        startedAt: previous?.targetId === targetId ? previous.startedAt : now,
        lastSeenAt: now,
        reason: threat.reasonCode,
    };
    agent.combatState = state;
    return state;
}
