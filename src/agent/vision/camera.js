import fs from 'fs/promises';
import { Vec3 } from 'vec3';
import { EventEmitter } from 'events';

export class Camera extends EventEmitter {
    static async create(bot, fp) {
        const [
            { Viewer },
            { WorldView },
            { getBufferFromStream },
            THREEModule,
            { createCanvas },
            workerThreads,
        ] = await Promise.all([
            import('prismarine-viewer/viewer/lib/viewer.js'),
            import('prismarine-viewer/viewer/lib/worldView.js'),
            import('prismarine-viewer/viewer/lib/simpleUtils.js'),
            import('three'),
            import('node-canvas-webgl/lib/index.js'),
            import('worker_threads'),
        ]);
        global.Worker = workerThreads.default?.Worker || workerThreads.Worker;
        const camera = new Camera(bot, fp, {
            Viewer,
            WorldView,
            getBufferFromStream,
            THREE: THREEModule.default || THREEModule,
            createCanvas,
        });
        await camera._init();
        camera.emit('ready');
        return camera;
    }

    constructor (bot, fp, dependencies) {
        super();
        this.bot = bot;
        this.fp = fp;
        this.dependencies = dependencies;
        this.viewDistance = 12;
        this.width = 800;
        this.height = 512;
        this.canvas = dependencies.createCanvas(this.width, this.height);
        this.renderer = new dependencies.THREE.WebGLRenderer({ canvas: this.canvas });
        this.viewer = new dependencies.Viewer(this.renderer);
    }
  
    async _init () {
        const botPos = this.bot.entity.position;
        const center = new Vec3(botPos.x, botPos.y+this.bot.entity.height, botPos.z);
        this.viewer.setVersion(this.bot.version);
        // Load world
        const worldView = new this.dependencies.WorldView(this.bot.world, this.viewDistance, center);
        this.viewer.listen(worldView);
        worldView.listenToBot(this.bot);
        await worldView.init(center);
        this.worldView = worldView;
    }
  
    async capture() {
        const center = new Vec3(this.bot.entity.position.x, this.bot.entity.position.y+this.bot.entity.height, this.bot.entity.position.z);
        this.viewer.camera.position.set(center.x, center.y, center.z);
        await this.worldView.updatePosition(center);
        this.viewer.setFirstPersonCamera(this.bot.entity.position, this.bot.entity.yaw, this.bot.entity.pitch);
        this.viewer.update();
        this.renderer.render(this.viewer.scene, this.viewer.camera);

        const imageStream = this.canvas.createJPEGStream({
            bufsize: 4096,
            quality: 100,
            progressive: false
        });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot_${timestamp}`;

        const buf = await this.dependencies.getBufferFromStream(imageStream);
        await this._ensureScreenshotDirectory();
        await fs.writeFile(`${this.fp}/${filename}.jpg`, buf);
        console.log('saved', filename);
        return filename;
    }

    async _ensureScreenshotDirectory() {
        let stats;
        try {
            stats = await fs.stat(this.fp);
        } catch (e) {
            if (!stats?.isDirectory()) {
                await fs.mkdir(this.fp);
            }
        }
    }
}
  
