import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';

import { AdminCommands, loadLocalAdmins } from '../../src/agent/admin_commands.js';
import { RuntimeSettings } from '../../src/agent/runtime_settings.js';

function agent() {
    const modes = { cowardice: true, unstuck: true };
    const runtimeSettings = { data: {}, set(key, value) { this.data[key] = value; }, save() {} };
    return {
        prompter: { profile: { name: 'Surfski', chat: {} } }, runtimeSettings,
        runtimeMode: 'direct', durableTask: { activeGoal: 'Mine diamonds' },
        actions: { currentActionLabel: '' }, self_prompter: { isActive: () => false, stop() {}, start() {} },
        bot: { entity: { position: { x: 1, y: 64, z: 2 } }, modes: {
            getJson: () => ({ ...modes }), exists: name => name in modes,
            isOn: name => modes[name], setOn: (name, value) => { modes[name] = value; },
        } },
        activeProfileName: () => 'Surfski',
    };
}

test('authorized admin toggles chatlayer and mode while unauthorized admin is denied', async () => {
    const commands = new AdminCommands(agent(), { admins: new Set(['player']), profilesDir: './profiles' });
    assert.equal(await commands.handle('Other', '!surfski chatlayer off'), 'not authorized');
    assert.equal(await commands.handle('Player', '!surfski chatlayer off'), 'chat layer: off');
    assert.equal(await commands.handle('Player', '!surfski chatlayer'), 'chat layer: off');
    assert.equal(await commands.handle('Player', '!surfski mode cowardice off'), 'mode cowardice: off');
    assert.equal(await commands.handle('Player', '!surfski mode cowardice'), 'mode cowardice: off');
});

test('admin defaults report status, lists modes, queues profiles, and provides help', async () => {
    const commands = new AdminCommands(agent(), { admins: new Set(['player']), profilesDir: './profiles' });
    assert.match(await commands.handle('Player', '!surfski mode'), /^modes:/);
    assert.match(await commands.handle('Player', '!surfski showcommands'), /^show commands:/);
    assert.match(await commands.handle('Player', '!surfski selfprompt'), /^self-prompting:/);
    assert.match(await commands.handle('Player', '!surfski status'), /runtime:direct/);
    assert.match(await commands.handle('Player', '!surfski help'), /chatlayer/);
    assert.match(await commands.handle('Player', '!surfski profile list'), /surfski-autonomous/);
    assert.equal(await commands.handle('Player', '!surfski profile surfski-chaotic'), 'profile switch queued: surfski-chaotic; applies when idle/restart');
});

test('runtime settings persist and missing local authorization file is created', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mindcraft-admin-'));
    const state = new RuntimeSettings('Test', { root });
    state.load(); state.set('chatlayer', false);
    assert.equal(new RuntimeSettings('Test', { root }).load().chatlayer, false);
    const adminsPath = path.join(root, 'config', 'local_admins.json');
    assert.equal(loadLocalAdmins({ filepath: adminsPath }).size, 0);
    assert.equal(existsSync(adminsPath), true);
});
