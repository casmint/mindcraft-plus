import { createActionResult } from './action_result.js';

function countByName(items) {
    const counts = {};
    for (const item of items || []) {
        if (!item?.name || !Number.isFinite(item.count)) continue;
        counts[item.name] = (counts[item.name] || 0) + item.count;
    }
    return counts;
}

export function snapshotInventory(bot) {
    return countByName(bot.inventory?.items?.() || []);
}

export function inventoryDelta(before, after) {
    const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const delta = {};
    for (const name of [...names].sort()) {
        const change = (after?.[name] || 0) - (before?.[name] || 0);
        if (change !== 0) delta[name] = change;
    }
    return delta;
}

export function verifyInventoryIncrease({ before, after, itemName, requested = 1 }) {
    const delta = inventoryDelta(before, after);
    const verifiedCount = Math.max(0, delta[itemName] || 0);
    const evidence = { after, before, delta, itemName, requested, verifiedCount };

    if (verifiedCount >= requested) {
        return createActionResult({
            status: 'completed',
            reasonCode: 'inventory_delta_verified',
            message: `Verified ${verifiedCount} ${itemName} added to inventory.`,
            evidence,
        });
    }
    if (verifiedCount > 0) {
        return createActionResult({
            status: 'partial',
            reasonCode: 'inventory_delta_partial',
            message: `Verified ${verifiedCount} of ${requested} requested ${itemName}.`,
            retryable: true,
            evidence,
        });
    }
    return createActionResult({
        status: 'blocked',
        reasonCode: 'inventory_delta_missing',
        message: `No ${itemName} inventory increase was observed.`,
        retryable: true,
        evidence,
    });
}

export function verifyAnyInventoryIncrease({ before, after, requested = 1 }) {
    const delta = inventoryDelta(before, after);
    const verifiedCount = Object.values(delta)
        .filter(change => change > 0)
        .reduce((total, change) => total + change, 0);
    const evidence = { after, before, delta, requested, verifiedCount };

    if (verifiedCount >= requested) {
        return createActionResult({
            status: 'completed',
            reasonCode: 'inventory_gain_verified',
            message: `Verified ${verifiedCount} item(s) added to inventory.`,
            evidence,
        });
    }
    if (verifiedCount > 0) {
        return createActionResult({
            status: 'partial',
            reasonCode: 'inventory_gain_partial',
            message: `Verified ${verifiedCount} inventory item(s), fewer than ${requested} requested.`,
            retryable: true,
            evidence,
        });
    }
    return createActionResult({
        status: 'blocked',
        reasonCode: 'inventory_gain_missing',
        message: 'No inventory gain was observed.',
        retryable: true,
        evidence,
    });
}
