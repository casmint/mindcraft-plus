import * as world from '../library/world.js';

const CREEPER_DANGER_RADIUS = 6;
const CLOSE_THREAT_RADIUS = 3;
const RECENT_DAMAGE_MS = 3_000;

function distanceBetween(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function entityTargetsBot(bot, entity) {
    const target = entity.target ?? entity.targetEntity ?? entity.targetId;
    if (!target) return false;
    return target === bot.entity || target === bot.entity.id || target.id === bot.entity?.id;
}

function hasWeapon(bot) {
    if (typeof bot.inventory?.items !== 'function') return true;
    const items = bot.inventory.items();
    return items.some(item => /(?:sword|axe)/.test(item.name) && !item.name.includes('pickaxe'));
}

export function hasLocalLineOfSight(bot, entity, localMap) {
    if (!localMap?.getAbsolute) return 'unknown';
    const from = {
        x: bot.entity.position.x,
        y: bot.entity.position.y + (bot.entity.height || 1.6),
        z: bot.entity.position.z,
    };
    const to = {
        x: entity.position.x,
        y: entity.position.y + (entity.height || 1),
        z: entity.position.z,
    };
    const steps = Math.max(1, Math.ceil(distanceBetween(from, to) * 2));
    let hasUnknown = false;
    for (let index = 1; index < steps; index++) {
        const fraction = index / steps;
        const cell = localMap.getAbsolute({
            x: Math.floor(from.x + (to.x - from.x) * fraction),
            y: Math.floor(from.y + (to.y - from.y) * fraction),
            z: Math.floor(from.z + (to.z - from.z) * fraction),
        });
        if (!cell?.observed) {
            hasUnknown = true;
            continue;
        }
        if (cell.isSolid) return false;
    }
    return hasUnknown ? 'unknown' : true;
}

export async function classifyHostileThreat(bot, entity, localMap, {
    now = () => Date.now(),
    reachabilityCheck = world.isClearPath,
    instincts = {},
    nearbyHostiles = 1,
    environmentDanger = false,
} = {}) {
    const combat = instincts.combat || bot.instincts?.combat || {};
    const distance = distanceBetween(bot.entity.position, entity.position);
    const isCreeper = entity.name === 'creeper';
    const close = distance <= CLOSE_THREAT_RADIUS;
    const highRisk = combat.avoidCreepers !== false && isCreeper && distance <= CREEPER_DANGER_RADIUS;
    const lineOfSight = hasLocalLineOfSight(bot, entity, localMap);
    const recentlyDamaged = Number.isFinite(bot.lastDamageTime) && now() - bot.lastDamageTime <= RECENT_DAMAGE_MS;
    const targeted = entityTargetsBot(bot, entity);
    let reachable = false;

    // A hidden hostile is not a reason to interrupt. Ask pathfinder only when
    // line-of-sight is blocked or incomplete, so a nearby open threat is cheap.
    if (!close && !highRisk && lineOfSight !== true && typeof reachabilityCheck === 'function') {
        try {
            reachable = await reachabilityCheck(bot, entity);
        } catch (error) {
            reachable = false;
        }
    }

    let credibility = 'IGNORE';
    let reasonCode = 'hidden_unreachable';
    if (highRisk) {
        credibility = 'EMERGENCY';
        reasonCode = 'creeper_danger_radius';
    } else if (recentlyDamaged || targeted) {
        credibility = 'AVOID';
        reasonCode = recentlyDamaged ? 'recent_damage' : 'targeting_bot';
    } else if (close) {
        credibility = 'AVOID';
        reasonCode = 'very_close';
    } else if (lineOfSight === true) {
        credibility = 'AVOID';
        reasonCode = 'clear_line_of_sight';
    } else if (reachable) {
        credibility = 'AVOID';
        reasonCode = 'reachable_path';
    } else if (lineOfSight === 'unknown') {
        credibility = 'WATCH';
        reasonCode = 'visibility_unknown';
    }
    const minimumHealthToFight = combat.minimumHealthToFight ?? 8;
    const minimumFoodToFight = combat.minimumFoodToFight ?? 6;
    const fightOnlyWhenHealthy = combat.fightOnlyWhenHealthy ?? true;
    const enoughHealth = typeof bot.health !== 'number' || bot.health >= minimumHealthToFight;
    const enoughFood = typeof bot.food !== 'number' || bot.food >= minimumFoodToFight;
    const canFight = combat.engageHostiles !== false && (!fightOnlyWhenHealthy || (enoughHealth && enoughFood));
    const fleeBelowHealth = combat.fleeBelowHealth ?? 6;
    const lowHealth = typeof bot.health === 'number' && bot.health < fleeBelowHealth;
    const unarmed = !hasWeapon(bot);
    const outOfFood = fightOnlyWhenHealthy && !enoughFood;
    const emergency = credibility === 'EMERGENCY' || lowHealth || environmentDanger
        || nearbyHostiles >= 3 || (credibility === 'AVOID' && (unarmed || outOfFood));
    let stance = 'IGNORE';
    if (credibility === 'WATCH') stance = 'WATCH';
    else if (credibility === 'AVOID') stance = emergency ? 'ESCAPE' : (close && canFight ? 'ENGAGE' : 'RETREAT');
    else if (credibility === 'EMERGENCY') stance = 'ESCAPE';

    return {
        level: stance,
        stance,
        credibility,
        reasonCode,
        distance,
        close,
        highRisk,
        lineOfSight,
        reachable,
        recentlyDamaged,
        targeted,
        lowHealth,
        unarmed,
        outOfFood,
        shouldFlee: stance === 'RETREAT' || stance === 'ESCAPE',
        eligibleForDefense: stance === 'ENGAGE',
    };
}
