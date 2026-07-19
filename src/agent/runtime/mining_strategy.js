const DEFAULT_RESOURCE_TARGETS = {
    diamond: { preferredY: -58, minY: -60, maxY: -54, requiredPickaxeTier: 'iron', preferredStrategy: 'targeted', avoidLava: true },
    iron: { preferredY: 16, minY: 8, maxY: 24, requiredPickaxeTier: 'stone', preferredStrategy: 'targeted' },
    copper: { preferredY: 48, minY: 40, maxY: 56, requiredPickaxeTier: 'stone', preferredStrategy: 'targeted' },
    coal: { preferredY: 80, minY: 48, maxY: 96, requiredPickaxeTier: 'wood', preferredStrategy: 'casual_or_targeted', preferMountains: true },
    redstone: { preferredY: -58, minY: -60, maxY: -54, requiredPickaxeTier: 'iron', preferredStrategy: 'targeted' },
    lapis: { preferredY: 0, minY: -16, maxY: 16, requiredPickaxeTier: 'stone', preferredStrategy: 'targeted' },
    gold: { preferredY: -16, minY: -24, maxY: -8, requiredPickaxeTier: 'iron', preferredStrategy: 'targeted' },
    emerald: { preferredY: 236, minY: 120, maxY: 256, requiredPickaxeTier: 'iron', preferredStrategy: 'biome_specific', biomeHint: 'mountains' },
    ancient_debris: { preferredY: 15, minY: 13, maxY: 17, requiredPickaxeTier: 'diamond', preferredStrategy: 'targeted', dimension: 'nether' },
};

const PICKAXE_TIERS = { wooden: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 };
const REQUIRED_TIERS = { wood: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 };

export function normalizeMiningResource(resource) {
    const name = String(resource || '').toLowerCase().replace(/^deepslate_/, '').replace(/_ore$/, '');
    return name === 'lapis_lazuli' ? 'lapis' : name;
}

export function getResourceMiningTarget(resource, instincts = {}) {
    const key = normalizeMiningResource(resource);
    const configured = instincts.mining?.resourceTargets?.[key] || {};
    const fallback = DEFAULT_RESOURCE_TARGETS[key];
    return fallback ? { resource: key, ...fallback, ...configured } : null;
}

export function getCurrentY(bot) {
    return Math.floor(bot.entity?.position?.y ?? 0);
}

export function classifyMiningIntent(goalText, { visibleOre = false } = {}) {
    const text = String(goalText || '').toLowerCase();
    if (/nearby|grab\s+(?:that|the)|exposed|this\s+cave|explor/.test(text)) {
        return visibleOre ? 'casual_ore_grab' : 'opportunistic_mining';
    }
    if (/(?:mine\s+for|go\s+get|get|obtain|targeted)/.test(text) && /diamond|iron|copper|coal|redstone|lapis|gold|emerald|ancient debris/.test(text)) {
        return visibleOre ? 'casual_ore_grab' : 'targeted_resource_mining';
    }
    return 'unknown';
}

function bestPickaxeTier(bot) {
    const items = [...(bot.inventory?.items?.() || []), bot.heldItem].filter(Boolean);
    return items.reduce((best, item) => {
        const material = Object.keys(PICKAXE_TIERS).find(tier => item.name === `${tier}_pickaxe`);
        return material && PICKAXE_TIERS[material] > best ? PICKAXE_TIERS[material] : best;
    }, -1);
}

export function isPreparedForTargetedMining(resource, bot, instincts = {}) {
    const target = getResourceMiningTarget(resource, instincts);
    if (!target) return { prepared: false, reasonCode: 'unknown_resource' };
    const survival = instincts.survival || {};
    const mining = instincts.mining || {};
    if (bestPickaxeTier(bot) < (REQUIRED_TIERS[target.requiredPickaxeTier] ?? 0)) {
        return { prepared: false, reasonCode: `missing_${target.requiredPickaxeTier}_pickaxe` };
    }
    if (typeof bot.health === 'number' && bot.health < (survival.stopMiningBelowHealth ?? 8)) return { prepared: false, reasonCode: 'low_health' };
    if (typeof bot.food === 'number' && bot.food < (survival.stopMiningBelowFood ?? 4)) return { prepared: false, reasonCode: 'low_food' };
    if (mining.returnWhenInventoryFull && bot.inventory?.emptySlotCount?.() === 0) return { prepared: false, reasonCode: 'inventory_full' };
    return { prepared: true, reasonCode: 'prepared', target };
}

export function planTargetYDescent(resource, bot, instincts = {}) {
    const target = getResourceMiningTarget(resource, instincts);
    if (!target) return { action: 'blocked', reasonCode: 'unknown_resource' };
    const currentY = getCurrentY(bot);
    if (currentY >= target.minY && currentY <= target.maxY) {
        return { action: 'search', currentY, targetY: target.preferredY, target };
    }
    const maxDescent = instincts.mining?.maxTargetedDescentBlocks ?? 96;
    if (currentY > target.preferredY && currentY - target.preferredY > maxDescent) {
        return { action: 'blocked', reasonCode: 'max_targeted_descent_exceeded', currentY, targetY: target.preferredY, target };
    }
    return { action: currentY > target.preferredY ? 'descend' : 'ascend', currentY, targetY: target.preferredY, target };
}

export function shouldUseTargetedMining(resource, { goalText = '', visibleOre = false } = {}, instincts = {}) {
    if (instincts.mining?.allowTargetedMining === false || visibleOre) return false;
    if (instincts.mining?.targetedMiningRequiresExplicitGoal !== false) {
        return classifyMiningIntent(goalText, { visibleOre }) === 'targeted_resource_mining';
    }
    return Boolean(getResourceMiningTarget(resource, instincts));
}
