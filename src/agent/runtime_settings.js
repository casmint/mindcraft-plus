import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

export class RuntimeSettings {
    constructor(botName, { root = './bots' } = {}) {
        this.filepath = `${root}/${botName}/runtime_settings.json`;
        this.data = {};
    }

    load() {
        if (existsSync(this.filepath)) this.data = JSON.parse(readFileSync(this.filepath, 'utf8')) || {};
        return this.data;
    }

    save() {
        mkdirSync(this.filepath.slice(0, this.filepath.lastIndexOf('/')), { recursive: true });
        writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
        console.log('runtime settings saved');
    }

    set(key, value) {
        this.data[key] = value;
        this.save();
        return value;
    }
}
