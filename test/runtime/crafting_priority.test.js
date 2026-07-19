import assert from 'node:assert/strict';
import test from 'node:test';

import {
    bestCombatWeapon,
    craftingPrerequisite,
    getNextGearCraft,
    missingToolKinds,
} from '../../src/agent/runtime/crafting_priority.js';
import { equipBestCombatWeapon } from '../../src/agent/library/skills.js';

function botWith(items, instincts = {}) {
    return {
        instincts,
        inventory: { items: () => items },
        async equip(item, destination) {
            this.equipped = { item, destination };
        },
    };
}

test('sword is selected before armor when the configured basic pickaxe already exists', () => {
    const bot = botWith([{ name: 'iron_pickaxe' }], {
        crafting: {
            craftShieldBeforeArmor: false,
            craftSwordBeforeArmor: true,
            preferWeaponBeforeArmor: true,
            minimumTools: { pickaxe: true, sword: true },
        },
    });
    const prerequisite = craftingPrerequisite(bot, 'iron_chestplate', bot.instincts,
        item => item === 'iron_sword');

    assert.equal(prerequisite, 'iron_sword');
    assert.deepEqual(missingToolKinds(bot, bot.instincts), ['sword']);
});

test('combat weapon selection never prefers a pickaxe over an available sword', async () => {
    const sword = { name: 'stone_sword', attackDamage: 5 };
    const pickaxe = { name: 'diamond_pickaxe', attackDamage: 9 };
    const bot = botWith([pickaxe, sword], {
        crafting: {
            avoidUsingPickaxeAsWeapon: true,
            keepBestWeaponEquippedNearHostiles: true,
        },
    });

    assert.equal(bestCombatWeapon(bot, bot.instincts), sword);
    assert.equal(await equipBestCombatWeapon(bot), true);
    assert.deepEqual(bot.equipped, { item: sword, destination: 'hand' });
});

test('diamond sword is planned before diamond armor after a pickaxe exists', () => {
    const bot = botWith([{ name: 'diamond_pickaxe' }, { name: 'diamond', count: 20 }], {
        crafting: { craftShieldBeforeArmor: false },
    });
    const next = getNextGearCraft(bot, bot.instincts, 'full diamond armor and tools', () => true);

    assert.deepEqual(next, { item: 'diamond_sword', reason: 'craftSwordBeforeArmor', priority: 3 });
    assert.equal(craftingPrerequisite(bot, 'diamond_helmet', bot.instincts, () => true), 'diamond_sword');
});

test('shield is planned before new armor when it is craftable', () => {
    const bot = botWith([{ name: 'diamond_pickaxe' }, { name: 'iron_ingot' }, { name: 'oak_planks' }], {
        crafting: { craftShieldBeforeArmor: true },
    });
    const next = getNextGearCraft(bot, bot.instincts, 'full diamond armor and tools', item => item === 'shield');

    assert.deepEqual(next, { item: 'shield', reason: 'craftShieldBeforeArmor', priority: 1 });
});

test('diamond armor proceeds after the configured diamond tools are present', () => {
    const bot = botWith([
        { name: 'diamond_pickaxe' }, { name: 'diamond_sword' },
        { name: 'diamond_shovel' }, { name: 'diamond_axe' },
    ], { crafting: { craftShieldBeforeArmor: false } });
    const next = getNextGearCraft(bot, bot.instincts, 'full diamond armor and tools', () => true);

    assert.equal(next.item, 'diamond_chestplate');
});
