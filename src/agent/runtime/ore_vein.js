// Ore veins can connect on faces, edges, or corners. Treating all 26 adjacent
// blocks as connected also catches ore exposed by the previous dig.
const ADJACENT = [];
for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
            if (x !== 0 || y !== 0 || z !== 0) ADJACENT.push([x, y, z]);
        }
    }
}

function key(position) {
    return `${position.x},${position.y},${position.z}`;
}

function withinRadius(origin, position, radius) {
    return Math.max(
        Math.abs(position.x - origin.x),
        Math.abs(position.y - origin.y),
        Math.abs(position.z - origin.z),
    ) <= radius;
}

export function isOreBlockName(name) {
    return typeof name === 'string' && (name.endsWith('_ore') || name === 'ancient_debris');
}

export function oreCollectionLimit({ requestedMinimum, mineFullVein = true, exactCount = false, hardCap = 64 }) {
    const cap = Math.max(1, hardCap);
    return mineFullVein && !exactCount ? cap : Math.min(Math.max(1, requestedMinimum), cap);
}

export function findConnectedOreVein(seed, blockNames, getBlock, {
    radius = 12,
    maxBlocks = 64,
} = {}) {
    if (!seed?.position || !blockNames.includes(seed.name)) return [];
    const result = [];
    const seen = new Set();
    const queue = [seed.position];
    while (queue.length > 0 && result.length < maxBlocks) {
        const position = queue.shift();
        const positionKey = key(position);
        if (seen.has(positionKey) || !withinRadius(seed.position, position, radius)) continue;
        seen.add(positionKey);
        const block = getBlock(position);
        if (!block || !blockNames.includes(block.name)) continue;
        result.push(block);
        for (const [x, y, z] of ADJACENT) {
            queue.push({ x: position.x + x, y: position.y + y, z: position.z + z });
        }
    }
    return result;
}
