import * as skills from '../library/skills.js';
import { exitWater } from './exit_water.js';

const RUNTIME_MODES = new Set(['direct', 'actiongraph']);

export function resolveRuntimeMode({ settingsMode, profileMode, logger = console } = {}) {
    const mode = profileMode || settingsMode || 'direct';
    if (RUNTIME_MODES.has(mode)) return mode;
    logger.warn?.(`[runtime] unsupported mode "${mode}"; using direct.`);
    return 'direct';
}

async function basicStartup(agent, context) {
    const evidence = {};
    const snapshot = agent.localBlockMap?.getSnapshot(agent.bot, {
        radius: 8,
        heightUp: 3,
        heightDown: 3,
    });
    if (snapshot) evidence.snapshot = snapshot.summarize();

    const waterState = snapshot && agent.waterDetector?.observe(agent.bot, snapshot);
    if (waterState?.requiresRecovery) {
        const waterResult = await exitWater(agent.bot, {
            detector: agent.waterDetector,
            localMap: agent.localBlockMap,
            signal: context.signal,
        });
        evidence.waterRecovery = waterResult;
        if (waterResult.status !== 'completed') {
            return { status: 'blocked', message: `basicStartup blocked: ${waterResult.reasonCode}.`, evidence };
        }
    }

    const startupWood = agent.instincts?.resources?.startupWood;
    const requestedLogs = startupWood?.count ?? 4;
    const collected = await skills.collectBlock(agent.bot, 'oak_log', requestedLogs);
    evidence.startupWood = { mode: startupWood?.mode ?? 'logs', requestedLogs, collected };
    return collected
        ? { status: 'completed', message: `basicStartup collected ${requestedLogs} oak logs.`, evidence }
        : { status: 'blocked', message: 'basicStartup could not verify startup wood collection.', evidence };
}

export class ActionGraphRunner {
    constructor(agent, { mode = 'direct', graphs = { basicStartup } } = {}) {
        this.agent = agent;
        this.mode = mode;
        this.graphs = graphs;
    }

    async run(graphName) {
        if (this.mode !== 'actiongraph') {
            const message = `ActionGraph ${graphName} not selected: runtime mode is direct; legacy commands remain active.`;
            console.log(`[runtime:direct] ${message}`);
            return { status: 'fallback', message };
        }
        const graph = this.graphs[graphName];
        if (!graph) {
            const message = `Unsupported ActionGraph task "${graphName}"; use a direct command instead.`;
            console.warn(`[runtime:actiongraph] ${message}`);
            return { status: 'unsupported', message };
        }

        console.log(`[runtime:actiongraph] starting ${graphName}`);
        let graphResult;
        const actionResult = await this.agent.actions.runAction(`graph:${graphName}`, async context => {
            graphResult = await graph(this.agent, context);
        });
        if (!actionResult.success) {
            return {
                status: 'failed',
                message: actionResult.message || `ActionGraph ${graphName} did not complete.`,
                graphResult,
            };
        }
        console.log(`[runtime:actiongraph] ${graphName} ${graphResult?.status || 'completed'}`);
        return graphResult || { status: 'completed', message: `ActionGraph ${graphName} completed.` };
    }
}
