import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDisconnectReason, parseKickReason } from '../../src/agent/connection_handler.js';

test('structured disconnect reasons retain their raw JSON instead of object coercion', () => {
    const reason = { translate: 'disconnect.spam', extra: [{ text: 'too many packets' }] };
    const formatted = formatDisconnectReason(reason);

    assert.match(formatted, /disconnect\.spam/);
    assert.doesNotMatch(formatted, /\[object Object\]/);
    assert.equal(parseKickReason(reason).type, 'behavior');
});
