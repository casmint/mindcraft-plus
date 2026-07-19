const DEFAULT_CRAFTING = {
    toolPriority: ['pickaxe', 'sword', 'shovel', 'axe'],
    materialUpgradeOrder: ['wood', 'stone', 'iron', 'diamond'],
    preferWeaponBeforeArmor: true,
    craftSwordBeforeArmor: true,
    craftShieldBeforeArmor: true,
    avoidUsingPickaxeAsWeapon: true,
    keepBestWeaponEquippedNearHostiles: true,
    minimumTools: { pickaxe: true, sword: true, shovel: false, axe: false },
    diamondPriority: [
        'diamond_pickaxe', 'diamond_sword', 'diamond_shovel', 'diamond_axe',
        'diamond_chestplate', 'diamond_leggings', 'diamond_helmet', 'diamond_boots',
    ],
};

const MATERIAL_NAMES = { wood: 'wooden', stone: 'stone', iron: 'iron', diamond: 'diamond' };

export function getCraftingInstincts(bot, instincts = bot.instincts || {}) {
    const configured = instincts.crafting || {};
    return {
        ...DEFAULT_CRAFTING,
        ...configured,
        minimumTools: { ...DEFAULT_CRAFTING.minimumTools, ...(configured.minimumTools || {}) },
    };
}

export function inventoryItemNames(bot) {
    return (bot.inventory?.items?.() || []).map(item => item.name);
}

export function isArmor(itemName) {
    return /(?:helmet|chestplate|leggings|boots)$/.test(itemName);
}

export function hasTool(names, tool) {
    return names.some(name => name.endsWith(`_${tool}`));
}

export function missingToolKinds(bot, instincts) {
    const crafting = getCraftingInstincts(bot, instincts);
    const names = inventoryItemNames(bot);
    return crafting.toolPriority.filter(tool => crafting.minimumTools[tool] && !hasTool(names, tool));
}

export function preferredToolCandidates(bot, tool, requestedItem, instincts) {
    const crafting = getCraftingInstincts(bot, instincts);
    const requestedMaterial = Object.values(MATERIAL_NAMES).find(material => requestedItem?.startsWith(`${material}_`));
    const materials = requestedMaterial
        ? [requestedMaterial, ...crafting.materialUpgradeOrder.map(material => MATERIAL_NAMES[material] || material)]
        : crafting.materialUpgradeOrder.map(material => MATERIAL_NAMES[material] || material);
    return [...new Set(materials)].map(material => `${material}_${tool}`);
}

export function getNextGearCraft(bot, instincts, goal = '', canCraft = () => true) {
    const crafting = getCraftingInstincts(bot, instincts);
    const names = inventoryItemNames(bot);
    const wantsDiamondGear = /diamond(?:\s+(?:armor|tools|gear))?/i.test(goal)
        || names.includes('diamond') || names.some(name => name.startsWith('diamond_'));
    const missing = item => !names.includes(item) && canCraft(item);

    if (crafting.craftShieldBeforeArmor && missing('shield')) {
        return { item: 'shield', reason: 'craftShieldBeforeArmor', priority: 1 };
    }
    if (wantsDiamondGear) {
        for (const item of crafting.diamondPriority) {
            if (!missing(item)) continue;
            return {
                item,
                reason: item.endsWith('_sword') ? 'craftSwordBeforeArmor' : 'diamondPriority',
                priority: crafting.diamondPriority.indexOf(item) + 2,
            };
        }
    }
    return null;
}

export function craftingPrerequisite(bot, requestedItem, instincts, canCraft) {
    if (!isArmor(requestedItem)) return null;
    const crafting = getCraftingInstincts(bot, instincts);
    const names = inventoryItemNames(bot);
    const tryCandidate = candidate => !names.includes(candidate) && canCraft(candidate) ? candidate : null;

    if (requestedItem.startsWith('diamond_')) {
        const next = getNextGearCraft(bot, instincts, 'diamond armor and tools', canCraft);
        if (next && next.item !== requestedItem && (!isArmor(next.item) || crafting.preferWeaponBeforeArmor)) {
            return next.item;
        }
    }

    if (requestedItem.startsWith('iron_') && Array.isArray(crafting.ironPriority)) {
        const requestedIndex = crafting.ironPriority.indexOf(requestedItem);
        const candidates = requestedIndex === -1
            ? crafting.ironPriority
            : crafting.ironPriority.slice(0, requestedIndex);
        for (const candidate of candidates) {
            if (isArmor(candidate)) continue;
            const prerequisite = tryCandidate(candidate);
            if (prerequisite) return prerequisite;
        }
    }
    if (crafting.craftShieldBeforeArmor) {
        const shield = tryCandidate('shield');
        if (shield) return shield;
    }
    const missing = missingToolKinds(bot, instincts);
    for (const tool of missing) {
        if (tool === 'sword' && !crafting.craftSwordBeforeArmor && !crafting.preferWeaponBeforeArmor) continue;
        for (const candidate of preferredToolCandidates(bot, tool, requestedItem, instincts)) {
            const prerequisite = tryCandidate(candidate);
            if (prerequisite) return prerequisite;
        }
    }
    return null;
}

export function bestCombatWeapon(bot, instincts) {
    const crafting = getCraftingInstincts(bot, instincts);
    const items = bot.inventory?.items?.() || [];
    const weapons = items.filter(item => item.name.includes('sword')
        || (item.name.includes('axe') && !item.name.includes('pickaxe')));
    if (weapons.length > 0) {
        return weapons.sort((left, right) => (right.attackDamage || 0) - (left.attackDamage || 0))[0];
    }
    if (crafting.avoidUsingPickaxeAsWeapon) return null;
    return items.filter(item => item.name.includes('pickaxe') || item.name.includes('shovel'))
        .sort((left, right) => (right.attackDamage || 0) - (left.attackDamage || 0))[0] || null;
}
