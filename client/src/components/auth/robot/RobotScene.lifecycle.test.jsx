import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The WebGL robot's frame-loop lifecycle.
 *
 * Verified WITHOUT a real GPU: the assertions are about the loop's
 * bookkeeping (does it run, does the clock rebase, is the pose preserved),
 * not about pixels.
 *
 * jsdom has no WebGL context, so the GPU-bound modules are replaced with
 * fakes. Everything the assertions touch — `start`, `stop`, the frame loop,
 * the spring state and the clock — is the REAL implementation from the
 * source file.
 */

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  class FakeWebGLRenderer {
    constructor({ canvas } = {}) {
      this.domElement = canvas;
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.shadowMap = { enabled: false };
    }
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    getPixelRatio() {
      return 1;
    }
    getSize(target) {
      return target.set(1, 1);
    }
    getContext() {
      return null;
    }
    compile() {}
    dispose() {}
  }
  class FakePMREM {
    fromScene() {
      return { texture: { dispose: vi.fn() } };
    }
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer, PMREMGenerator: FakePMREM };
});

vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    constructor() {
      this.passes = [];
    }
    addPass(pass) {
      this.passes.push(pass);
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  },
}));

vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
  RenderPass: class {},
}));

vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    constructor() {
      this.resolution = { set() {} };
    }
    dispose() {}
  },
}));

vi.mock('three/examples/jsm/postprocessing/OutputPass.js', () => ({
  OutputPass: class {},
}));

const { RobotScene } = await import('./RobotScene.js');

/**
 * The scene builds its textures on a 2D canvas, which jsdom does not
 * implement. A minimal 2D context stub satisfies the calls Three.js makes.
 */
function stubCanvas2D() {
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') return null;
    return {
      canvas: this,
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {},
      drawImage() {},
      fillRect() {},
      clearRect() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      beginPath() {},
      closePath() {},
      fill() {},
      stroke() {},
      arc() {},
      fillText() {},
      measureText: () => ({ width: 0 }),
    };
  };
}
stubCanvas2D();

/** Builds a RobotScene with the GPU-bound pieces faked out. */
function makeScene() {
  const scene = new RobotScene(document.createElement('canvas'), { reducedMotion: false });
  scene.render = vi.fn();
  scene.update = vi.fn(() => false);
  return scene;
}

describe('RobotScene — frame loop lifecycle', () => {
  let rafCallbacks;

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      rafCallbacks[id - 1] = null;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not start a second loop when start() is called twice', () => {
    const scene = makeScene();
    scene.start();
    scene.start();
    expect(scene.running).toBe(true);
    expect(rafCallbacks.filter(Boolean)).toHaveLength(1);
  });

  it('cancels the pending frame on stop()', () => {
    const scene = makeScene();
    scene.start();
    const pending = scene.raf;
    scene.stop();
    expect(scene.running).toBe(false);
    expect(scene.raf).toBe(0);
    expect(rafCallbacks[pending - 1]).toBeNull();
  });

  it('rebases the frame clock on resume so the pose does not jump', () => {
    const scene = makeScene();
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1000);
    scene.start();
    expect(scene.last).toBe(1000);

    // The tab is hidden: the loop stops, and a minute of wall-clock passes.
    scene.stop();
    nowSpy.mockReturnValue(61_000);
    scene.start();

    // `start()` must rebase the clock to "now", otherwise the next frame's
    // dt would be the whole hidden duration and the springs would jump.
    expect(scene.last).toBe(61_000);

    // The next frame advances the clock by one frame, not by 60 seconds.
    scene.loop(61_016);
    expect(scene.last).toBe(61_016);
    expect(scene.time).toBeLessThan(0.1);

    nowSpy.mockRestore();
  });

  it('preserves the spring state across a stop/start cycle (no pose reset)', () => {
    const scene = makeScene();
    scene.neckYaw = { x: 0.4, v: 0.1 };
    scene.headYaw = { x: 0.7, v: 0.2 };
    scene.start();
    scene.stop();
    scene.start();
    expect(scene.neckYaw.x).toBe(0.4);
    expect(scene.headYaw.x).toBe(0.7);
  });

  it('leaves the scene alive after stop() — resources are not disposed', () => {
    const scene = makeScene();
    const dispose = vi.spyOn(scene, 'dispose');
    scene.start();
    scene.stop();
    // `dispose` is the only thing that tears down GPU resources; stop() must
    // not call it, so resuming after a tab switch keeps the same scene.
    expect(dispose).not.toHaveBeenCalled();
  });

  it('does not advance the simulation when reduced motion is set', () => {
    const scene = makeScene();
    scene.start();
    scene.reducedMotion = true;
    const timeBefore = scene.time;
    scene.loop(performance.now());
    expect(scene.time).toBe(timeBefore);
  });
});
