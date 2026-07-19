import { createHash } from 'crypto';
import { readFileSync, realpathSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDocument } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(__filename), '../..');
const TOP_LEVEL_FIELDS = new Set([
    'resources', 'survival', 'movement', 'building', 'mining', 'exploration', 'combat',
    'water', 'autonomy', 'assistant', 'creative', 'chaotic', 'crafting', 'task', 'codegen', 'ai', 'custom',
    'chat',
]);

const FIELD_TYPES = {
    'resources.startupWood.mode': ['logs', 'trees'],
    'resources.startupWood.count': 'number',
    'resources.minimums.*': 'number',
    'survival.shelterBeforeNight': 'boolean',
    'survival.returnToSafetyAtNight': 'boolean',
    'survival.avoidCavesUntilFood': 'number',
    'survival.stopMiningBelowHealth': 'number',
    'survival.stopMiningBelowFood': 'number',
    'survival.eatBelowFood': 'number',
    'survival.restBelowHealth': 'number',
    'survival.preferCookedFood': 'boolean',
    'survival.avoidDeepWaterWithoutGoal': 'boolean',
    'survival.avoidLavaUnlessPrepared': 'boolean',
    'movement.enableProgressWatchdog': 'boolean',
    'movement.stuckWindowMs': 'number',
    'movement.sampleIntervalMs': 'number',
    'movement.minHorizontalProgress': 'number',
    'movement.maxRecoveryAttempts': 'number',
    'movement.preferLocalNudgeRecovery': 'boolean',
    'movement.avoidJumpSpamWhenStuck': 'boolean',
    'movement.clearControlsOnStuck': 'boolean',
    'building.preferNearSpawn': 'boolean',
    'building.firstBasePriorities': 'string-array',
    'building.maxFirstShelterSize.*': 'number',
    'building.preferSmallStarterShelter': 'boolean',
    'building.preferFunctionalOverDecorative': 'boolean',
    'mining.preferredMineStyle': ['stair', 'branch', 'cave', 'surface'],
    'mining.avoidDiggingStraightDown': 'boolean',
    'mining.torchSpacing': 'number',
    'mining.returnWhenInventoryFull': 'boolean',
    'mining.stopIfPickaxeNearlyBroken': 'boolean',
    'mining.minimumPickaxeTierForIron': ['stone', 'iron', 'diamond', 'netherite'],
    'mining.minimumPickaxeTierForDiamond': ['iron', 'diamond', 'netherite'],
    'mining.defaultStrategy': ['casual', 'targeted'],
    'mining.allowTargetedMining': 'boolean',
    'mining.casualGrabNearbyOres': 'boolean',
    'mining.casualOreSearchRadius': 'number',
    'mining.targetedMiningRequiresExplicitGoal': 'boolean',
    'mining.targetedMiningPrepRequired': 'boolean',
    'mining.targetedMineStyle': ['stair', 'branch', 'cave'],
    'mining.targetedSearchPattern': ['branch', 'stair', 'cave'],
    'mining.maxTargetedDescentBlocks': 'number',
    'mining.returnIfUnprepared': 'boolean',
    'mining.allowAccessExcavation': 'boolean',
    'mining.maxAccessExcavationBlocks': 'number',
    'mining.maxAccessExcavationSeconds': 'number',
    'mining.maxAccessExcavationDistance': 'number',
    'mining.allowBreakingNaturalBlocksForOreAccess': 'boolean',
    'mining.preservePlacedUtilityBlocks': 'boolean',
    'mining.avoidBreakingBlocksBelowSelf': 'boolean',
    'mining.resourceTargets.*': 'object',
    'mining.mineFullOreVeins': 'boolean',
    'mining.expandOreVeins': 'boolean',
    'mining.maxVeinRadius': 'number',
    'mining.maxOreActionSeconds': 'number',
    'mining.oreEmergencyHardCap': 'number',
    'mining.stopVeinOnHazard': 'boolean',
    'mining.verifyAfterVein': 'boolean',
    'mining.exactOreCountRequiresExplicitFlag': 'boolean',
    'mining.treatOreCountOneAsVeinRequest': 'boolean',
    'exploration.defaultRadius': 'number',
    'exploration.maxWanderDistance': 'number',
    'exploration.returnHomeWhenLost': 'boolean',
    'exploration.markImportantLocations': 'boolean',
    'exploration.avoidNightExploration': 'boolean',
    'combat.engageHostiles': 'boolean',
    'combat.avoidCreepers': 'boolean',
    'combat.fightOnlyWhenHealthy': 'boolean',
    'combat.minimumHealthToFight': 'number',
    'combat.minimumFoodToFight': 'number',
    'combat.fleeBelowHealth': 'number',
    'combat.preferRetreatOverEscape': 'boolean',
    'combat.shortRetreatDistance': 'number',
    'combat.maxChaseSeconds': 'number',
    'combat.abandonLostTargetSeconds': 'number',
    'combat.escapeOnlyForEmergencies': 'boolean',
    'crafting.toolPriority': 'string-array',
    'crafting.materialUpgradeOrder': 'string-array',
    'crafting.preferWeaponBeforeArmor': 'boolean',
    'crafting.craftSwordBeforeArmor': 'boolean',
    'crafting.craftShieldBeforeArmor': 'boolean',
    'crafting.avoidUsingPickaxeAsWeapon': 'boolean',
    'crafting.keepBestWeaponEquippedNearHostiles': 'boolean',
    'crafting.minimumTools.*': 'boolean',
    'crafting.ironPriority': 'string-array',
    'crafting.diamondPriority': 'string-array',
    'water.avoidWaterUnlessNeeded': 'boolean',
    'water.exitWaterImmediately': 'boolean',
    'water.maxWaterRecoverySeconds': 'number',
    'water.avoidUnderwaterTasksWithoutAirPlan': 'boolean',
    'water.plugSingleSourceFlow': 'boolean',
    'water.maxSourcePlugRadius': 'number',
    'water.maxWaterBlocksForPlugging': 'number',
    'water.avoidPluggingNearLava': 'boolean',
    'water.preferPlugBlocks': 'string-array',
    'water.waterRecoveryCooldownMs': 'number',
    'chat.enableQuickChat': 'boolean',
    'chat.casualChatDoesNotInterrupt': 'boolean',
    'chat.classifyBeforePlanning': 'boolean',
    'chat.maxCasualReplyChars': 'number',
    'chat.useQuickModelForChat': 'boolean',
    'chat.askClarificationForAmbiguousCommands': 'boolean',
    'water.resolvedWaterCooldownMs': 'number',
    'water.maxSameWaterRecoveryRepeats': 'number',
    'water.treatFeetWaterAsEmergency': 'boolean',
    'water.stableFootingNearWaterIsSafe': 'boolean',
    'water.doNotJumpIfHeadroomBlocked': 'boolean',
    'water.preferHorizontalExitWhenCramped': 'boolean',
    'water.plugAttemptCooldownMs': 'number',
    'task.persistActiveGoals': 'boolean',
    'task.resumeActiveGoalAfterRestart': 'boolean',
    'task.preservePlayerAssignedGoals': 'boolean',
    'task.summarizeProgressOnRestart': 'boolean',
    'codegen.compactGeneratedCode': 'boolean',
    'codegen.maxGeneratedCodeLines': 'number',
    'codegen.preferExistingSkills': 'boolean',
    'codegen.rejectUnknownSkillCalls': 'boolean',
    'codegen.noFullCodeEchoInMemory': 'boolean',
    'codegen.requireLintableGeneratedCode': 'boolean',
    'autonomy.chooseGoalsWhenIdle': 'boolean',
    'autonomy.idleGoalIntervalSeconds': 'number',
    'autonomy.preferProgressOverWaiting': 'boolean',
    'autonomy.allowPlanChanges': 'boolean',
    'autonomy.askBeforeMajorProjects': 'boolean',
    'autonomy.maxAutonomousTaskMinutes': 'number',
    'assistant.prioritizePlayerRequests': 'boolean',
    'assistant.pauseAutonomyForPlayerTasks': 'boolean',
    'assistant.askClarifyingQuestions': 'boolean',
    'assistant.reportCompletion': 'boolean',
    'creative.planBeforeBuilding': 'boolean',
    'creative.usePalette': 'boolean',
    'creative.verifySections': 'boolean',
    'creative.maxSingleBuildVolume': 'number',
    'creative.preferSymmetry': 'boolean',
    'chaotic.unpredictability': 'number',
    'chaotic.allowDestructiveExperiments': 'boolean',
    'chaotic.allowCheatsIfAvailable': 'boolean',
    'chaotic.preferWeirdBuilds': 'boolean',
    'chaotic.escalateWhenBored': 'boolean',
    'ai.summary': 'string',
};

function isWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function deepMerge(base, override) {
    const result = clone(base);
    for (const [key, value] of Object.entries(override)) {
        result[key] = isPlainObject(result[key]) && isPlainObject(value)
            ? deepMerge(result[key], value)
            : clone(value);
    }
    return result;
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function getPath(object, parts) {
    let current = object;
    for (const part of parts) {
        if (!isPlainObject(current) || !(part in current)) return undefined;
        current = current[part];
    }
    return current;
}

function typeIsValid(value, expected) {
    if (Array.isArray(expected)) return expected.includes(value);
    if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (expected === 'boolean' || expected === 'string') return typeof value === expected;
    if (expected === 'object') return isPlainObject(value);
    if (expected === 'string-array') return Array.isArray(value) && value.every(item => typeof item === 'string');
    return true;
}

function validateInstinctObject(instincts, layerPath, { debug, logger }) {
    for (const key of Object.keys(instincts)) {
        if (!TOP_LEVEL_FIELDS.has(key) && debug) {
            logger.warn?.(`[instincts] unknown top-level field in ${layerPath}: ${key}`);
        }
    }
    for (const [fieldPath, expected] of Object.entries(FIELD_TYPES)) {
        const parts = fieldPath.split('.');
        if (parts.at(-1) === '*') {
            const parent = getPath(instincts, parts.slice(0, -1));
            if (!isPlainObject(parent)) continue;
            for (const [key, value] of Object.entries(parent)) {
                if (!typeIsValid(value, expected)) {
                    logger.warn?.(`[instincts] invalid ${parts.slice(0, -1).join('.')}.${key} in ${layerPath}; expected ${expected}.`);
                }
            }
            continue;
        }
        const value = getPath(instincts, parts);
        if (value !== undefined && !typeIsValid(value, expected)) {
            const description = Array.isArray(expected) ? expected.join('|') : expected;
            logger.warn?.(`[instincts] invalid ${fieldPath} in ${layerPath}; expected ${description}.`);
        }
    }
}

export function loadInstinctLayers(instinctLayers, { repositoryRoot = REPOSITORY_ROOT, logger = console, debug = false } = {}) {
    if (instinctLayers == null) return { layers: Object.freeze([]), instincts: deepFreeze({}) };
    if (!Array.isArray(instinctLayers) || instinctLayers.some(layer => typeof layer !== 'string' || layer.length === 0)) {
        throw new Error('profile.instinct_layers must be an array of non-empty repo-relative paths.');
    }
    const resolvedRoot = realpathSync(repositoryRoot);
    let merged = {};
    const layers = instinctLayers.map(configuredPath => {
        if (path.isAbsolute(configuredPath)) {
            throw new Error(`Instinct layer must be repo-relative, not absolute: ${configuredPath}`);
        }
        const unresolvedPath = path.resolve(resolvedRoot, configuredPath);
        if (!isWithin(resolvedRoot, unresolvedPath)) {
            throw new Error(`Instinct layer escapes the repository: ${configuredPath}`);
        }
        let resolvedPath;
        try {
            resolvedPath = realpathSync(unresolvedPath);
        } catch (error) {
            throw new Error(`Configured instinct layer is missing or unreadable: ${configuredPath}`, { cause: error });
        }
        if (!isWithin(resolvedRoot, resolvedPath) || !statSync(resolvedPath).isFile()) {
            throw new Error(`Configured instinct layer is not a regular repo-local file: ${configuredPath}`);
        }
        const content = readFileSync(resolvedPath, 'utf8');
        const document = parseDocument(content);
        if (document.errors.length > 0) {
            throw new Error(`Malformed YAML in instinct layer ${configuredPath}: ${document.errors.map(error => error.message).join('; ')}`);
        }
        const data = document.toJS();
        if (!isPlainObject(data)) {
            throw new Error(`Instinct layer must contain a YAML object: ${configuredPath}`);
        }
        const relativePath = path.relative(resolvedRoot, resolvedPath);
        validateInstinctObject(data, relativePath, { debug, logger });
        merged = deepMerge(merged, data);
        const layer = Object.freeze({
            path: relativePath,
            bytes: Buffer.byteLength(content),
            sha256: createHash('sha256').update(content).digest('hex'),
            instincts: deepFreeze(clone(data)),
        });
        logger.info?.(`[instincts] loaded ${layer.path} (${layer.bytes} bytes sha256=${layer.sha256.slice(0, 12)})`);
        return layer;
    });
    const instincts = deepFreeze(merged);
    if (debug) logger.info?.(`[instincts] merged ${JSON.stringify(instincts)}`);
    return Object.freeze({ layers: Object.freeze(layers), instincts });
}
