import assert from 'node:assert/strict';
import test from 'node:test';

import { setSettings } from '../../src/agent/settings.js';
import { addBrowserViewer } from '../../src/agent/vision/browser_viewer.js';
import { VisionInterpreter } from '../../src/agent/vision/vision_interpreter.js';

test('disabled browser viewer returns before importing native viewer dependencies', async () => {
    setSettings({ render_bot_view: false });

    assert.equal(await addBrowserViewer({}, 0), false);
});

test('disabled AI vision does not initialize the camera renderer', () => {
    const interpreter = new VisionInterpreter({ name: 'fixture', bot: {} }, false);

    assert.equal(interpreter.camera, null);
    assert.equal(interpreter.cameraPromise, null);
});
