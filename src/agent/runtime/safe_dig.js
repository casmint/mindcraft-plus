import Vec3 from 'vec3';
import { admitPhysicalAction } from './physical_action_limiter.js';

function isPassable(block) {
    return !block || ['air', 'cave_air', 'void_air', 'water'].includes(block.name) || block.boundingBox === 'empty';
}

function requiredPickaxe(blockName) {
    if (blockName === 'ancient_debris') return 'diamond';
    if (blockName === 'diamond_ore' || blockName === 'deepslate_diamond_ore'
        || blockName.includes('redstone_ore') || blockName.includes('gold_ore')) return 'iron';
    return null;
}

function hasRequiredPickaxe(item, tier) {
    if (!tier) return true;
    const name = item?.name || '';
    const ranks = { wooden: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 };
    const found = Object.keys(ranks).find(material => name === `${material}_pickaxe`);
    return found != null && ranks[found] >= ranks[tier];
}

export function safeDigTimeoutMs(block) {
    const name = block?.name || '';
    if (name === 'ancient_debris' || name.includes('obsidian')) return 45_000;
    if (name === 'deepslate_diamond_ore') return 15_000;
    if (name === 'diamond_ore') return 12_000;
    if (name.startsWith('deepslate_')) return 12_000;
    if (name.endsWith('_ore') || name === 'stone' || name === 'cobblestone') return 8_000;
    if (/(?:_log|_wood|_stem|_hyphae)$/.test(name)) return 8_000;
    if (['dirt', 'sand', 'gravel'].includes(name)) return 3_000;
    return 8_000;
}

export async function safeDigBlock(bot, block, {
    maxRetries = 2,
    log = () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    if (!block?.position) return { status: 'blocked', reasonCode: 'unknown_block' };
    if (!admitPhysicalAction(bot, `dig:${block.name}`).allowed) {
        return { status: 'blocked', reasonCode: 'runtime_rate_limited' };
    }
    const position = block.position;
    const timeoutMs = safeDigTimeoutMs(block);
    for (let retry = 0; retry <= maxRetries; retry++) {
        if (bot.interrupt_code) return { status: 'cancelled', reasonCode: 'interrupted', retries: retry };
        const current = bot.blockAt(new Vec3(position.x, position.y, position.z));
        if (isPassable(current) || current.name !== block.name) {
            return { status: 'completed', reasonCode: 'block_changed', retries: retry };
        }
        try {
            await bot.tool.equipForBlock(current);
        } catch (error) {
            return { status: 'blocked', reasonCode: 'wrong_tool', retries: retry };
        }
        const itemId = bot.heldItem?.type ?? null;
        if (!current.canHarvest(itemId) || !hasRequiredPickaxe(bot.heldItem, requiredPickaxe(current.name))) {
            log(`Dig failed wrong_tool ${current.name}.`);
            return { status: 'blocked', reasonCode: 'wrong_tool', retries: retry };
        }
        const startedAt = Date.now();
        log(`Dig started ${current.name} with ${bot.heldItem?.name || 'unknown'} timeoutMs=${timeoutMs}.`);
        let timeoutHandle;
        const timeout = new Promise(resolve => {
            timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
        });
        const digPromise = Promise.resolve().then(() => bot.dig(current))
            .then(() => 'resolved')
            .catch(() => 'dig_error');
        const result = await Promise.race([
            digPromise,
            timeout,
        ]);
        clearTimeout(timeoutHandle);
        if (bot.interrupt_code) return { status: 'cancelled', reasonCode: 'interrupted', retries: retry };
        await sleep(50);
        const after = bot.blockAt(new Vec3(position.x, position.y, position.z));
        if (isPassable(after) || after?.name !== current.name) {
            log(`Dig completed ${current.name} elapsedMs=${Date.now() - startedAt}.`);
            return { status: 'completed', reasonCode: 'block_changed', retries: retry };
        }
        if (result === 'timeout') bot.stopDigging?.();
        if (retry < maxRetries) log(`Dig retry ${current.name} still present retry=${retry + 1}.`);
    }
    return { status: 'blocked', reasonCode: 'dig_timeout_block_still_present', retries: maxRetries };
}
