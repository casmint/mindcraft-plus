import { createHash } from 'crypto';
import { readFileSync, realpathSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(__filename), '../..');
const DYNAMIC_MARKERS = [
    '$SELF_PROMPT', '$MEMORY', '$STATS', '$INVENTORY', '$ACTION', '$COMMAND_DOCS',
    '$CODE_DOCS', '$EXAMPLES', '$TO_SUMMARIZE', '$CONVO', '$LAST_GOALS', '$BLUEPRINTS',
];

function isWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function instructionBlock(layers) {
    if (layers.length === 0) return '';
    return [
        '## Profile instruction layers',
        'These are durable Mindcraft Plus profile instructions. They are not memory, chat, or runtime authority.',
        ...layers.map(layer => `### ${layer.path}\n${layer.content}`),
    ].join('\n\n');
}

export function loadInstructionLayers(instructionLayers, { repositoryRoot = REPOSITORY_ROOT, logger = console } = {}) {
    if (instructionLayers == null) return [];
    if (!Array.isArray(instructionLayers) || instructionLayers.some(layer => typeof layer !== 'string' || layer.length === 0)) {
        throw new Error('profile.instruction_layers must be an array of non-empty repo-relative paths.');
    }

    const resolvedRoot = realpathSync(repositoryRoot);
    return instructionLayers.map(configuredPath => {
        if (path.isAbsolute(configuredPath)) {
            throw new Error(`Instruction layer must be repo-relative, not absolute: ${configuredPath}`);
        }
        const unresolvedPath = path.resolve(resolvedRoot, configuredPath);
        if (!isWithin(resolvedRoot, unresolvedPath)) {
            throw new Error(`Instruction layer escapes the repository: ${configuredPath}`);
        }
        let resolvedPath;
        try {
            resolvedPath = realpathSync(unresolvedPath);
        } catch (error) {
            throw new Error(`Configured instruction layer is missing or unreadable: ${configuredPath}`, { cause: error });
        }
        if (!isWithin(resolvedRoot, resolvedPath) || !statSync(resolvedPath).isFile()) {
            throw new Error(`Configured instruction layer is not a regular repo-local file: ${configuredPath}`);
        }
        const content = readFileSync(resolvedPath, 'utf8');
        const layer = Object.freeze({
            path: path.relative(resolvedRoot, resolvedPath),
            content,
            bytes: Buffer.byteLength(content),
            sha256: createHash('sha256').update(content).digest('hex'),
        });
        logger.info?.(`[profile instructions] loaded ${layer.path} (${layer.bytes} bytes sha256=${layer.sha256.slice(0, 12)})`);
        return layer;
    });
}

export function composePromptWithInstructionLayers(prompt, layers = []) {
    if (layers.length === 0) return prompt;
    const block = instructionBlock(layers);
    const firstMarker = DYNAMIC_MARKERS
        .map(marker => ({ marker, index: prompt.indexOf(marker) }))
        .filter(({ index }) => index >= 0)
        .sort((left, right) => left.index - right.index)[0];
    if (!firstMarker) return `${prompt}\n\n${block}`;
    return `${prompt.slice(0, firstMarker.index)}${block}\n\n${prompt.slice(firstMarker.index)}`;
}
