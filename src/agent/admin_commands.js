import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import settings from '../../settings.js';

const TEMPLATE = { authorized_players: [] };

export function loadLocalAdmins({ filepath = './config/local_admins.json', logger = console } = {}) {
    if (!existsSync(filepath)) {
        mkdirSync(path.dirname(filepath), { recursive: true });
        writeFileSync(filepath, JSON.stringify(TEMPLATE, null, 2), 'utf8');
        logger.warn?.('local admin file created; add your Minecraft name before using admin commands');
        return new Set();
    }
    const data = JSON.parse(readFileSync(filepath, 'utf8'));
    logger.info?.('local admin file loaded');
    return new Set((data.authorized_players || []).map(name => String(name).toLowerCase()));
}

function state(value) { return value ? 'on' : 'off'; }
function compactModes(agent) { return Object.entries(agent.bot.modes.getJson()).map(([name, on]) => `${name}:${state(on)}`).join(', '); }

export class AdminCommands {
    constructor(agent, { admins = loadLocalAdmins(), profilesDir = './profiles' } = {}) {
        this.agent = agent;
        this.admins = admins;
        this.profilesDir = profilesDir;
    }

    matches(message) {
        const prefix = this.agent.prompter.profile.admin?.prefix || settings.admin?.prefix || '!surfski';
        return String(message).trim().toLowerCase().startsWith(prefix.toLowerCase());
    }

    authorized(username) {
        return this.admins.has(String(username).toLowerCase());
    }

    async handle(username, message) {
        const prefix = this.agent.prompter.profile.admin?.prefix || settings.admin?.prefix || '!surfski';
        const parts = String(message).trim().slice(prefix.length).trim().split(/\s+/).filter(Boolean);
        const command = (parts.shift() || 'help').toLowerCase();
        console.log(`admin command parsed: ${command}`);
        if (!this.authorized(username)) {
            console.warn(`admin command denied: ${username} ${command}`);
            return 'not authorized';
        }
        console.log(`admin command authorized: ${command}`);
        if (command === 'help' || command === 'commands') return 'admin: chatlayer, profile, showcommands, mode, selfprompt, status, help';
        if (command === 'chatlayer') return this.toggle('chatlayer', parts, 'chat layer');
        if (command === 'showcommands') return this.toggle('showcommands', parts, 'show commands');
        if (command === 'selfprompt') return this.selfPrompt(parts);
        if (command === 'mode') return this.mode(parts);
        if (command === 'profile') return this.profile(parts);
        if (command === 'status') return this.status();
        return 'unknown admin command; try !surfski help';
    }

    toggle(key, args, label) {
        const value = (args[0] || 'status').toLowerCase();
        const current = key === 'chatlayer' ? this.chatEnabled() : settings.show_command_syntax !== 'none';
        if (value === 'status') return `${label}: ${state(current)}`;
        if (!['on', 'off'].includes(value)) return `${label}: use on, off, or status`;
        const enabled = value === 'on';
        if (key === 'chatlayer') this.agent.runtimeSettings.set('chatlayer', enabled);
        else { settings.show_command_syntax = enabled ? 'full' : 'none'; this.agent.runtimeSettings.set('showcommands', enabled); }
        console.log(`admin setting changed: ${key}=${enabled}`);
        return `${label}: ${state(enabled)}`;
    }

    chatEnabled() { return this.agent.runtimeSettings.data.chatlayer ?? this.agent.prompter.profile.chat?.enableQuickChat ?? settings.chat?.enableQuickChat ?? false; }
    async selfPrompt(args) {
        const value = (args[0] || 'status').toLowerCase();
        const active = this.agent.self_prompter.isActive();
        if (value === 'status') return `self-prompting: ${state(active)}`;
        if (value === 'off') {
            await this.agent.self_prompter.stop(false);
            this.agent.runtimeSettings.set('selfprompt', false);
            return 'self-prompting: off';
        }
        if (value === 'on') {
            const goal = this.agent.durableTask?.activeGoal;
            if (!goal) return 'self-prompting: off (no active task)';
            this.agent.self_prompter.start(goal); this.agent.runtimeSettings.set('selfprompt', true); return 'self-prompting: on';
        }
        return 'self-prompting: use on, off, or status';
    }

    async mode(args) {
        const modes = this.agent.bot.modes;
        const name = args[0]?.toLowerCase();
        if (!name || name === 'status') return `modes: ${compactModes(this.agent)}`;
        if (name === 'list') return `modes: ${Object.keys(modes.getJson()).join(', ')}`;
        if (!modes.exists(name)) return `unknown mode: ${name}`;
        const value = (args[1] || 'status').toLowerCase();
        if (value === 'status') return `mode ${name}: ${state(modes.isOn(name))}`;
        if (!['on', 'off'].includes(value)) return `mode ${name}: use on, off, or status`;
        const enabled = value === 'on';
        if (!enabled && modes.isOn(name) && this.agent.actions.currentActionLabel === `mode:${name}`) {
            await this.agent.actions.stop({ reason: `admin disabled mode:${name}` });
        }
        modes.setOn(name, enabled);
        this.agent.runtimeSettings.data.modeOverrides ||= {};
        this.agent.runtimeSettings.data.modeOverrides[name] = enabled;
        this.agent.runtimeSettings.save();
        return `mode ${name}: ${state(enabled)}`;
    }

    profile(args) {
        const value = args[0];
        if (!value || value.toLowerCase() === 'status') return `profile: ${this.agent.activeProfileName()}${this.agent.runtimeSettings.data.pendingProfile ? `; pending: ${this.agent.runtimeSettings.data.pendingProfile}` : ''}`;
        if (value.toLowerCase() === 'list') return `available profiles: ${readdirSync(this.profilesDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).join(', ')}`;
        const names = readdirSync(this.profilesDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
        const matched = names.find(name => name.toLowerCase() === value.toLowerCase());
        if (!matched) return `unknown profile: ${value}`;
        this.agent.runtimeSettings.set('pendingProfile', matched);
        console.log(`profile switch queued: ${matched}`);
        return `profile switch queued: ${matched}; applies when idle/restart`;
    }

    status() {
        const p = this.agent.bot.entity?.position;
        return `profile:${this.agent.activeProfileName()} runtime:${this.agent.runtimeMode} chat:${state(this.chatEnabled())} selfprompt:${state(this.agent.self_prompter.isActive())} action:${this.agent.actions.currentActionLabel || 'idle'} task:${this.agent.durableTask?.activeGoal || 'none'}${p ? ` pos:${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` : ''}`;
    }
}
