import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DragStateManager } from './utils/DragStateManager.js';
import {
  downloadExampleScenesFolder,
  ensureSceneAssetsForPath,
  getPosition,
  getQuaternion,
  initialSceneAssetPrefixes,
  toMujocoPos,
  preloadPolicyAssets,
  releasePolicyCaches,
  reloadScene,
  reloadPolicy
} from './mujocoUtils.js';
import { getSimulationThemeSettings, normalizeSimulationThemeName } from './theme.js';
import { REFLECTION_QUALITY_PRESETS } from './reflectionQuality.js';
import {
  clearHostDemoContainer,
  disposeObject3D,
  disposeWebGLRenderer,
  prepareMujocoWorkingDirectory,
  unmountMujocoWorkingDirectory
} from './hostDemoLifecycle.js';

const defaultPolicy = './examples/checkpoints/g1/amp_policy_walk_run_getup.json';
const defaultScene = 'g1_amp/scene_g1.xml';

/** Whether MuJoCo scene assets must be loaded before applying a policy. */
export function needsSceneReload(currentScenePath, nextScenePath, model) {
  const next = nextScenePath ?? defaultScene;
  return next !== currentScenePath || !model;
}

/** Horizontal knockdown push magnitude (N), applied in world XY; local Z (vertical) force component is zero. */
const KNOCKDOWN_FORCE_XY_MAG = 3400;

export class MuJoCoDemo {
  constructor(mujoco) {
    this.mujoco = mujoco;
    prepareMujocoWorkingDirectory(mujoco);

    this.params = {
      paused: true,
      current_motion: 'default',
      compliance_enabled: false,
      compliance_threshold: 10.0,
      cmdX: 0.0,
      cmdY: 0.0,
      cmdYaw: 0.0
    };
    this.policyRunner = null;
    this.kpPolicy = null;
    this.kdPolicy = null;
    this.actionTarget = null;
    this.model = null;
    this.data = null;
    this.simulation = null;
    this.currentPolicyPath = defaultPolicy;
    this.currentScenePath = defaultScene;

    // Pre-allocated policy state arrays to avoid GC pressure per physics tick
    this._cachedPolicyState = {
      jointPos: null, // Will be initialized when policy is loaded
      jointVel: null,
      rootPos: new Float32Array(3),
      rootQuat: new Float32Array(4),
      rootAngVel: new Float32Array(3),
      qvel_base: null, // Reference to rootAngVel
      complianceEnabled: false,
      complianceThreshold: 10.0,
      cmd: [0.0, 0.0, 0.0]
    };
    this._cachedPolicyState.qvel_base = this._cachedPolicyState.rootAngVel;

    this.bodies = {};
    this.lights = {};
    this.visualThemeName = 'dark';
    this.lightBaseIntensities = new Map();

    this.container = document.getElementById('mujoco-container');

    this.scene = new THREE.Scene();
    this.scene.name = 'scene';

    this.currentVisualSettings = getSimulationThemeSettings(this.visualThemeName);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / this.getViewH(), 0.001, 100);
    this.camera.name = 'PerspectiveCamera';
    this.camera.position.set(3.0, 2.2, 3.0);
    this.scene.add(this.camera);

    this.scene.background = new THREE.Color(...this.currentVisualSettings.backgroundRgb);
    this.scene.fog = null;

    this.ambientLight = new THREE.AmbientLight(0xffffff, this.currentVisualSettings.ambientIntensity);
    this.ambientLight.name = 'AmbientLight';
    this.scene.add(this.ambientLight);

    this.sonicHemi = new THREE.HemisphereLight(0x6a8aaa, 0x2a3a28, this.currentVisualSettings.sonicHemiIntensity);
    this.sonicHemi.name = 'SonicStyleHemisphere';
    this.scene.add(this.sonicHemi);

    this.sonicFill = new THREE.DirectionalLight(0x80c0ff, this.currentVisualSettings.sonicFillIntensity);
    this.sonicFill.name = 'SonicStyleFill';
    this.sonicFill.position.set(-3, 4, 2);
    this.scene.add(this.sonicFill);

    this.sonicRim = new THREE.DirectionalLight(0xffffff, this.currentVisualSettings.sonicRimIntensity);
    this.sonicRim.name = 'SonicStyleRim';
    this.sonicRim.position.set(-2, 2.5, 4);
    this.scene.add(this.sonicRim);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderScale = Math.min(window.devicePixelRatio, 2);
    this.reflectionQuality = 2;
    this.reflectors = [];
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, this.getViewH());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    /** 不使用 ACES 等胶片映射，避免整体发灰/偏色，保持 MJCF 设计的白黑金属对比 */
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.simStepHz = 0;
    this._stepFrameCount = 0;
    this._stepLastTime = performance.now();
    this._lastRenderTime = 0;
    /** @type {number} remaining physics substeps for AMP knockdown disturbance */
    this._knockdownSubstepsRemaining = 0;
    /** Unit direction in world XY for the current knockdown burst (set when queued). */
    this._knockdownDirX = 1;
    this._knockdownDirY = 0;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.7, 0);
    this.controls.panSpeed = 2;
    this.controls.zoomSpeed = 1;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.10;
    this.controls.screenSpacePanning = true;
    this.controls.update();

    this._onWindowResizeBound = this.onWindowResize.bind(this);
    window.addEventListener('resize', this._onWindowResizeBound);

    this.dragStateManager = new DragStateManager(this.scene, this.renderer, this.camera, this.container.parentElement, this.controls);

    this.followEnabled = false;
    this.followHeight = 0.75;
    this._customViewApplied = false;
    this.followLerp = 0.05;
    this.followTarget = new THREE.Vector3();
    this.followTargetDesired = new THREE.Vector3();
    this.followDelta = new THREE.Vector3();
    this.followOffset = new THREE.Vector3();
    this.followInitialized = false;
    this.followBodyId = null;
    this.followDistance = this.camera.position.distanceTo(this.controls.target);

    this._dragForceVec = new THREE.Vector3();
    this._dragPointVec = new THREE.Vector3();
    this._lightLookAt = new THREE.Vector3();

    // Bolt: Use pre-allocated Arrays instead of Maps for high-frequency state caching
    // to avoid iterator allocations and map lookup overhead per tick.
    this.lastSimState = {
      bodies: [],
      lights: [],
      tendons: {
        count: 0,
        matrix: new THREE.Matrix4()
      }
    };

    this.renderer.setAnimationLoop(this.render.bind(this));

    this.reloadScene = reloadScene.bind(this);
    this.reloadPolicy = reloadPolicy.bind(this);
  }

  async init(onProgress) {
    const report = (t) => {
      if (typeof onProgress === 'function') {
        onProgress(Math.min(1, Math.max(0, t)));
      }
    };
    const sceneDownload = 0.52;
    const sceneBuild = 0.13;
    const policy = 0.35;

    await downloadExampleScenesFolder(this.mujoco, (p) => {
      report(sceneDownload * p);
    }, { prefixes: initialSceneAssetPrefixes() });
    report(sceneDownload);
    await this.reloadScene(defaultScene);
    this.updateFollowBodyId();
    report(sceneDownload + sceneBuild);
    await this.reloadPolicy(defaultPolicy, {
      onInitProgress: (p) => {
        report(sceneDownload + sceneBuild + policy * p);
      }
    });
    report(1);
    this.alive = true;
  }

  async reload(mjcf_path) {
    await this.reloadScene(mjcf_path);
    this.updateFollowBodyId();
    this.timestep = this.model.opt.timestep;
    this.decimation = Math.max(1, Math.round(0.02 / this.timestep));

    await this.reloadPolicy(this.currentPolicyPath ?? defaultPolicy);
    console.log('timestep:', this.timestep, 'decimation:', this.decimation);
    this.alive = true;
  }

  async switchSceneAndPolicy(scenePath, policyPath, options = {}) {
    const nextScenePath = scenePath ?? defaultScene;
    const nextPolicyPath = policyPath ?? defaultPolicy;
    const shouldReloadScene = needsSceneReload(this.currentScenePath, nextScenePath, this.model);
    const report = (t) => {
      if (typeof options.onProgress === 'function') {
        options.onProgress(Math.min(1, Math.max(0, t)));
      }
    };
    const sceneDownload = shouldReloadScene ? 0.52 : 0;
    const sceneBuild = shouldReloadScene ? 0.13 : 0;
    const policyWeight = 1 - sceneDownload - sceneBuild;

    if (shouldReloadScene) {
      while (this.policyRunner?.isInferencing) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // Policy JSON/ONNX/ORT runtime don't depend on the scene: load them alongside it.
      preloadPolicyAssets(nextPolicyPath, options.onnxPath);
      await ensureSceneAssetsForPath(this.mujoco, nextScenePath, (p) => {
        report(sceneDownload * p);
      });
      report(sceneDownload);
      await this.reloadScene(nextScenePath);
      this.updateFollowBodyId();
      this.timestep = this.model.opt.timestep;
      this.decimation = Math.max(1, Math.round(0.02 / this.timestep));
      report(sceneDownload + sceneBuild);
    } else {
      report(0);
    }

    const { onProgress, ...policyOptions } = options;
      await this.reloadPolicy(nextPolicyPath, {
      ...policyOptions,
      onInitProgress: (p) => {
        report(sceneDownload + sceneBuild + policyWeight * p);
      }
    });
    if (shouldReloadScene) {
      this.applySceneView(this.policyRunner?.config?.view);
    }
    report(1);
    console.log('scene:', this.currentScenePath, 'timestep:', this.timestep, 'decimation:', this.decimation);
    this.alive = true;
  }

  /**
   * Warm the caches for a policy the user is about to pick (policy menu hover/focus):
   * download its scene files into MEMFS and preload its JSON / ONNX session.
   */
  prefetchSceneAndPolicy(scenePath, policyPath, onnxPath) {
    if (!this.mujoco) {
      return;
    }
    preloadPolicyAssets(policyPath, onnxPath);
    ensureSceneAssetsForPath(this.mujoco, scenePath ?? defaultScene).catch(() => {});
  }

  applySceneView(view) {
    const cameraPos = view?.cameraPosition;
    const target = view?.target;
    if (Array.isArray(cameraPos) && cameraPos.length >= 3) {
      this.camera.position.set(
        Number(cameraPos[0]) || 0,
        Number(cameraPos[1]) || 0,
        Number(cameraPos[2]) || 0
      );
    } else if (this._customViewApplied) {
      this.camera.position.set(3.0, 2.2, 3.0);
    }
    if (Array.isArray(target) && target.length >= 3) {
      this.controls.target.set(
        Number(target[0]) || 0,
        Number(target[1]) || 0,
        Number(target[2]) || 0
      );
    } else if (this._customViewApplied) {
      this.controls.target.set(0, 0.7, 0);
    }
    if (typeof view?.followHeight === 'number' && Number.isFinite(view.followHeight)) {
      this.followHeight = view.followHeight;
    } else if (this._customViewApplied) {
      this.followHeight = 0.75;
    }
    this.followDistance = this.camera.position.distanceTo(this.controls.target);
    this.followInitialized = false;
    this._customViewApplied = Boolean(view);
    this.controls.update();
  }

  setFollowEnabled(enabled) {
    this.followEnabled = Boolean(enabled);
    this.followInitialized = false;
    if (this.followEnabled) {
      this.followOffset.subVectors(this.camera.position, this.controls.target);
      if (this.followOffset.lengthSq() === 0) {
        this.followOffset.set(0, 0, 1);
      }
      this.followOffset.setLength(this.followDistance);
      this.camera.position.copy(this.controls.target).add(this.followOffset);
      this.controls.update();
    }
  }

  async releasePolicyResources() {
    if (!this.policyRunner) {
      return;
    }
    await this.policyRunner.release();
    this.policyRunner = null;
  }

  /**
   * Release MuJoCo, ONNX, and WebGL resources so Parkour can run alone in the tab.
   */
  async dispose() {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this.alive = false;

    this.dragStateManager?.dispose?.();
    this.dragStateManager = null;

    while (this.policyRunner?.isInferencing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await this.releasePolicyResources();
    releasePolicyCaches();

    if (this.simulation) {
      this.simulation.free();
      this.simulation = null;
      this.model = null;
      this.data = null;
    }

    const mujocoRoot = this.scene?.getObjectByName('MuJoCo Root');
    if (mujocoRoot) {
      this.scene.remove(mujocoRoot);
      disposeObject3D(mujocoRoot);
    }

    for (const reflector of this.reflectors ?? []) {
      reflector.dispose?.();
    }
    this.reflectors = [];
    this.bodies = {};
    this.lights = {};

    if (this._onWindowResizeBound) {
      window.removeEventListener('resize', this._onWindowResizeBound);
      this._onWindowResizeBound = null;
    }

    this.controls?.dispose?.();
    disposeObject3D(this.scene);
    disposeWebGLRenderer(this.renderer);
    this.renderer = null;
    clearHostDemoContainer(this.container);

    unmountMujocoWorkingDirectory(this.mujoco);
    this.mujoco = null;
    this.scene = null;
    this.camera = null;
    this.container = null;
    this.controls = null;
    this.bodies = {};
    this.lights = {};
    this.reflectors = [];
    this._cachedPolicyState = {
      jointPos: null,
      jointVel: null,
      rootPos: new Float32Array(3),
      rootQuat: new Float32Array(4),
      rootAngVel: new Float32Array(3),
      qvel_base: null,
      complianceEnabled: false,
      complianceThreshold: 10.0,
      cmd: [0.0, 0.0, 0.0]
    };
    this._cachedPolicyState.qvel_base = this._cachedPolicyState.rootAngVel;
  }

  setVisualTheme(name) {
    this.visualThemeName = normalizeSimulationThemeName(name);
    this.currentVisualSettings = getSimulationThemeSettings(this.visualThemeName);
    this.applyVisualTheme();
  }

  applyVisualTheme() {
    if (!this.currentVisualSettings) {
      return;
    }

    if (this.scene?.background) {
      this.scene.background.setRGB(...this.currentVisualSettings.backgroundRgb);
    } else if (this.scene) {
      this.scene.background = new THREE.Color(...this.currentVisualSettings.backgroundRgb);
    }

    if (this.scene) {
      this.scene.fog = null;
    }

    if (this.ambientLight) {
      this.ambientLight.intensity = this.currentVisualSettings.ambientIntensity;
    }

    if (this.sonicHemi) {
      this.sonicHemi.intensity = this.currentVisualSettings.sonicHemiIntensity;
    }
    if (this.sonicFill) {
      this.sonicFill.intensity = this.currentVisualSettings.sonicFillIntensity;
    }
    if (this.sonicRim) {
      this.sonicRim.intensity = this.currentVisualSettings.sonicRimIntensity;
    }

    for (const [index, light] of Object.entries(this.lights ?? {})) {
      if (!light) {
        continue;
      }
      const lightIndex = Number(index);
      const baseIntensity = this.lightBaseIntensities.get(lightIndex) ?? light.intensity ?? 1;
      this.lightBaseIntensities.set(lightIndex, baseIntensity);
      light.intensity = baseIntensity * this.currentVisualSettings.lightIntensityScale;
    }
  }

  updateFollowBodyId() {
    if (Number.isInteger(this.pelvis_body_id)) {
      this.followBodyId = this.pelvis_body_id;
      return;
    }
    if (this.model && this.model.nbody > 1) {
      this.followBodyId = 1;
    }
  }

  updateCameraFollow() {
    if (!this.followEnabled) {
      return;
    }
    const bodyId = Number.isInteger(this.followBodyId) ? this.followBodyId : null;
    if (bodyId === null) {
      return;
    }
    const cached = this.lastSimState.bodies[bodyId];
    if (!cached) {
      return;
    }
    this.followTargetDesired.set(cached.position.x, this.followHeight, cached.position.z);
    if (!this.followInitialized) {
      this.followTarget.copy(this.followTargetDesired);
      this.followInitialized = true;
    } else {
      this.followTarget.lerp(this.followTargetDesired, this.followLerp);
    }

    this.followDelta.subVectors(this.followTarget, this.controls.target);
    this.controls.target.copy(this.followTarget);
    this.camera.position.add(this.followDelta);
  }

  applyMujocoPositionControl(simCtrl) {
    const actionTarget = this.actionTarget;
    const ctrlMin = this.ctrlMinPolicy;
    const ctrlMax = this.ctrlMaxPolicy;
    for (let i = 0; i < this.numActions; i++) {
      const ctrl_adr = this.ctrl_adr_policy[i];
      let ctrlValue = actionTarget ? actionTarget[i] : 0.0;
      const min = ctrlMin[i];
      const max = ctrlMax[i];
      if (min < max) {
        ctrlValue = Math.min(Math.max(ctrlValue, min), max);
      }
      simCtrl[ctrl_adr] = ctrlValue;
    }
  }

  applyJointPositionControl(simQpos, simQvel, simCtrl) {
    const actionTarget = this.actionTarget;
    const kpPolicy = this.kpPolicy;
    const kdPolicy = this.kdPolicy;
    const ctrlMin = this.ctrlMinPolicy;
    const ctrlMax = this.ctrlMaxPolicy;

    for (let i = 0; i < this.numActions; i++) {
      const qpos_adr = this.qpos_adr_policy[i];
      const qvel_adr = this.qvel_adr_policy[i];
      const ctrl_adr = this.ctrl_adr_policy[i];

      const targetJpos = actionTarget ? actionTarget[i] : 0.0;
      const kp = kpPolicy ? kpPolicy[i] : 0.0;
      const kd = kdPolicy ? kdPolicy[i] : 0.0;
      const torque = kp * (targetJpos - simQpos[qpos_adr]) - kd * simQvel[qvel_adr];
      let ctrlValue = torque;

      const min = ctrlMin[i];
      const max = ctrlMax[i];
      if (min < max) {
        ctrlValue = Math.min(Math.max(ctrlValue, min), max);
      }
      simCtrl[ctrl_adr] = ctrlValue;
    }
  }

  applyUnitreePositionControl(simQpos, simQvel, simCtrl) {
    const actionTarget = this.actionTarget;
    const kpPolicy = this.kpPolicy;
    const kdPolicy = this.kdPolicy;
    const Y1Policy = this.Y1Policy;
    const Y2Policy = this.Y2Policy;
    const effortLimitPolicy = this.effortLimitPolicy;
    const X1Policy = this.X1Policy;
    const X2Policy = this.X2Policy;
    const frictionStaticPolicy = this.frictionStaticPolicy;
    const frictionDynamicPolicy = this.frictionDynamicPolicy;
    const frictionActivationVelPolicy = this.frictionActivationVelPolicy;
    const ctrlMin = this.ctrlMinPolicy;
    const ctrlMax = this.ctrlMaxPolicy;

    for (let i = 0; i < this.numActions; i++) {
      const qpos_adr = this.qpos_adr_policy[i];
      const qvel_adr = this.qvel_adr_policy[i];
      const ctrl_adr = this.ctrl_adr_policy[i];

      const targetJpos = actionTarget ? actionTarget[i] : 0.0;
      const kp = kpPolicy ? kpPolicy[i] : 0.0;
      const kd = kdPolicy ? kdPolicy[i] : 0.0;
      const qpos = simQpos[qpos_adr];
      const qvel = simQvel[qvel_adr];
      let torque = kp * (targetJpos - qpos) - kd * qvel;
      const sameDirection = qvel * torque > 0;
      const y1 = Y1Policy ? Y1Policy[i] : Infinity;
      const y2 = Y2Policy ? Y2Policy[i] : y1;
      const effortLimit = effortLimitPolicy ? effortLimitPolicy[i] : Infinity;
      let maxEffort = Math.min(sameDirection ? y1 : y2, effortLimit);
      const x1 = X1Policy ? X1Policy[i] : Infinity;
      const x2 = X2Policy ? X2Policy[i] : Infinity;
      const absVel = Math.abs(qvel);
      if (Number.isFinite(x1) && Number.isFinite(x2) && absVel >= x1) {
        const denom = Math.max(x2 - x1, 1e-6);
        maxEffort = Math.max((-maxEffort / denom) * (absVel - x1) + maxEffort, 0.0);
      }
      torque = Math.max(-maxEffort, Math.min(maxEffort, torque));
      const fs = frictionStaticPolicy ? frictionStaticPolicy[i] : 0.0;
      const fd = frictionDynamicPolicy ? frictionDynamicPolicy[i] : 0.0;
      const va = frictionActivationVelPolicy ? Math.max(frictionActivationVelPolicy[i], 1e-6) : 0.01;
      torque -= fs * Math.tanh(qvel / va) + fd * qvel;

      let ctrlValue = torque;

      const min = ctrlMin[i];
      const max = ctrlMax[i];
      if (min < max) {
        ctrlValue = Math.min(Math.max(ctrlValue, min), max);
      }
      simCtrl[ctrl_adr] = ctrlValue;
    }
  }

  async main_loop() {
    if (!this.policyRunner) {
      return;
    }

    while (this.alive) {
      const loopStart = performance.now();

      if (!this.params.paused && this.model && this.data && this.simulation && this.policyRunner) {
        const state = this.readPolicyState();

        try {
          this.actionTarget = await this.policyRunner.step(state);
        } catch (e) {
          console.error('Inference error in main loop:', e);
          this.alive = false;
          break;
        }
        if (!this.alive || !this.model || !this.data || !this.simulation || !this.policyRunner) {
          break;
        }

        const simQpos = this.simulation.qpos;
        const simQvel = this.simulation.qvel;
        const simCtrl = this.simulation.ctrl;
        const simQfrcApplied = this.simulation.qfrc_applied;
        const simXpos = this.simulation.xpos;
        const simXquat = this.simulation.xquat;

        for (let substep = 0; substep < this.decimation; substep++) {
          if (!this.alive || !this.simulation) {
            break;
          }
          if (this.control_type === 'joint_position') {
            this.applyJointPositionControl(simQpos, simQvel, simCtrl);
          } else if (this.control_type === 'unitree_position') {
            this.applyUnitreePositionControl(simQpos, simQvel, simCtrl);
          } else if (this.control_type === 'mujoco_position') {
            this.applyMujocoPositionControl(simCtrl);
          } else if (this.control_type === 'torque') {
            console.error('Torque control not implemented yet.');
          }

          simQfrcApplied.fill(0.0);

          if (this._knockdownSubstepsRemaining > 0) {
            this.applyPelvisKnockdownForceXYPlane(simXpos);
            this._knockdownSubstepsRemaining -= 1;
          }

          const dragged = this.dragStateManager?.physicsObject;
          if (dragged && dragged.bodyID) {
            const bodyID = dragged.bodyID;
            const bodyGroup = this.bodies[bodyID];
            if (bodyGroup) {
              getPosition(simXpos, bodyID, bodyGroup.position);
              getQuaternion(simXquat, bodyID, bodyGroup.quaternion);
            }
            if (this.mujocoRoot) {
              this.mujocoRoot.updateWorldMatrix(true, true);
            }
            this.dragStateManager.update();
            const force = toMujocoPos(
              this._dragForceVec
                .copy(this.dragStateManager.currentWorld)
                .sub(this.dragStateManager.worldHit)
                .multiplyScalar(60.0)
            );
            const forceMagnitude = Math.sqrt(force.x * force.x + force.y * force.y + force.z * force.z);
            const maxForce = 30.0;
            if (forceMagnitude > maxForce) {
              const scale = maxForce / forceMagnitude;
              force.x *= scale;
              force.y *= scale;
              force.z *= scale;
            }
            this._dragPointVec.copy(this.dragStateManager.worldHit);
            const point = toMujocoPos(this._dragPointVec);
            this.simulation.applyForce(force.x, force.y, force.z, 0, 0, 0, point.x, point.y, point.z, bodyID);
          }

          this.simulation.step();
        }

        for (let b = 0; b < this.model.nbody; b++) {
          if (!this.bodies[b]) {
            continue;
          }
          if (!this.lastSimState.bodies[b]) {
            this.lastSimState.bodies[b] = {
              position: new THREE.Vector3(),
              quaternion: new THREE.Quaternion()
            };
          }
          const cached = this.lastSimState.bodies[b];
          getPosition(simXpos, b, cached.position);
          getQuaternion(simXquat, b, cached.quaternion);
        }

        const numLights = this.model.nlight;
        const simLightXpos = this.simulation.light_xpos;
        const simLightXdir = this.simulation.light_xdir;
        for (let l = 0; l < numLights; l++) {
          if (!this.lights[l]) {
            continue;
          }
          if (!this.lastSimState.lights[l]) {
            this.lastSimState.lights[l] = {
              position: new THREE.Vector3(),
              direction: new THREE.Vector3()
            };
          }
          const cached = this.lastSimState.lights[l];
          getPosition(simLightXpos, l, cached.position);
          getPosition(simLightXdir, l, cached.direction);
        }

        this.lastSimState.tendons.count = this.model.nwrap;

        this._stepFrameCount += 1;
        const now = performance.now();
        const elapsedStep = now - this._stepLastTime;
        if (elapsedStep >= 500) {
          this.simStepHz = (this._stepFrameCount * 1000) / elapsedStep;
          this._stepFrameCount = 0;
          this._stepLastTime = now;
        }
      } else {
        this.simStepHz = 0;
        this._stepFrameCount = 0;
        this._stepLastTime = performance.now();
      }

      const loopEnd = performance.now();
      const elapsed = (loopEnd - loopStart) / 1000;
      const target = this.timestep * this.decimation;
      const sleepTime = Math.max(0, target - elapsed);
      await new Promise((resolve) => setTimeout(resolve, sleepTime * 1000));
    }
  }

  getViewH() {
    const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 58;
    return window.innerHeight - headerH;
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / this.getViewH();
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, this.getViewH());
    this._lastRenderTime = 0;
    this.render();
  }

  setRenderScale(scale) {
    const clamped = Math.max(0.5, Math.min(2.0, scale));
    this.renderScale = clamped;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, this.getViewH());
    this._lastRenderTime = 0;
    this.render();
  }

  getReflectionQualityPreset(level = this.reflectionQuality) {
    const index = Math.max(0, Math.min(REFLECTION_QUALITY_PRESETS.length - 1, Math.round(level)));
    return REFLECTION_QUALITY_PRESETS[index];
  }

  setReflectionQuality(level) {
    const index = Math.max(0, Math.min(REFLECTION_QUALITY_PRESETS.length - 1, Math.round(level)));
    this.reflectionQuality = index;
    const preset = REFLECTION_QUALITY_PRESETS[index];
    for (const reflector of this.reflectors) {
      reflector.setReflectionQuality?.(preset.size, preset.multisample);
    }
    this._lastRenderTime = 0;
    this.render();
  }

  getSimStepHz() {
    return this.simStepHz;
  }

  /**
   * Queue several physics substeps of large wrench on the pelvis (AMP-only UI)
   * to knock the robot down for get-up / recovery testing.
   */
  queueKnockdownDisturbance() {
    if (!this.simulation || !this.model) {
      return;
    }
    const cryptoRandom = typeof window !== 'undefined' && window.crypto
      ? window.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
      : Math.random();
    const theta = cryptoRandom * Math.PI * 2;
    this._knockdownDirX = Math.cos(theta);
    this._knockdownDirY = Math.sin(theta);
    this._knockdownSubstepsRemaining = 14;
  }

  /**
   * Floating-base pelvis id for wrenches (never world body 0).
   */
  resolvePelvisBodyId() {
    const map = this.bodyIdByName;
    if (map && Number.isInteger(map.pelvis) && map.pelvis > 0) {
      return map.pelvis;
    }
    if (map && Number.isInteger(map.base) && map.base > 0) {
      return map.base;
    }
    if (Number.isInteger(this.pelvis_body_id) && this.pelvis_body_id > 0) {
      return this.pelvis_body_id;
    }
    if (Number.isInteger(this.followBodyId) && this.followBodyId > 0) {
      return this.followBodyId;
    }
    return 1;
  }

  /**
   * Applies a horizontal-only force on the pelvis at its current body origin (world xpos).
   * Does not modify qpos — disturbance is purely physical (mj_applyFT).
   */
  applyPelvisKnockdownForceXYPlane(simXpos = null) {
    const bodyId = this.resolvePelvisBodyId();
    if (!Number.isInteger(bodyId) || bodyId < 1) {
      return;
    }
    const xp = simXpos || this.simulation.xpos;
    const idx = bodyId * 3;
    const px = xp[idx];
    const py = xp[idx + 1];
    const pz = xp[idx + 2];
    const fx = KNOCKDOWN_FORCE_XY_MAG * this._knockdownDirX;
    const fy = KNOCKDOWN_FORCE_XY_MAG * this._knockdownDirY;
    const fz = 0;
    this.simulation.applyForce(fx, fy, fz, 0, 0, 0, px, py, pz, bodyId);
  }

  readPolicyState() {
    const qpos = this.simulation.qpos;
    const qvel = this.simulation.qvel;

    // Initialize lazily based on numActions (which changes on policy load)
    if (!this._cachedPolicyState.jointPos || this._cachedPolicyState.jointPos.length !== this.numActions) {
      this._cachedPolicyState.jointPos = new Float32Array(this.numActions);
      this._cachedPolicyState.jointVel = new Float32Array(this.numActions);
    }

    const jointPos = this._cachedPolicyState.jointPos;
    const jointVel = this._cachedPolicyState.jointVel;
    for (let i = 0; i < this.numActions; i++) {
      const qposAdr = this.qpos_adr_policy[i];
      const qvelAdr = this.qvel_adr_policy[i];
      jointPos[i] = qpos[qposAdr];
      jointVel[i] = qvel[qvelAdr];
    }

    const rootPos = this._cachedPolicyState.rootPos;
    rootPos[0] = qpos[0];
    rootPos[1] = qpos[1];
    rootPos[2] = qpos[2];

    const rootQuat = this._cachedPolicyState.rootQuat;
    rootQuat[0] = qpos[3];
    rootQuat[1] = qpos[4];
    rootQuat[2] = qpos[5];
    rootQuat[3] = qpos[6];

    const rootAngVel = this._cachedPolicyState.rootAngVel;
    rootAngVel[0] = qvel[3];
    rootAngVel[1] = qvel[4];
    rootAngVel[2] = qvel[5];

    const complianceEnabled = Boolean(this.params?.compliance_enabled);
    const rawThreshold = Number(this.params?.compliance_threshold);
    const complianceThreshold = Number.isFinite(rawThreshold) ? rawThreshold : 10.0;

    this._cachedPolicyState.complianceEnabled = complianceEnabled;
    this._cachedPolicyState.complianceThreshold = complianceThreshold;
    this._cachedPolicyState.cmd[0] = this.params.cmdX;
    this._cachedPolicyState.cmd[1] = this.params.cmdY;
    this._cachedPolicyState.cmd[2] = this.params.cmdYaw;

    return this._cachedPolicyState;
  }

  applyPolicyInitialState() {
    const initialState = this.policyInitialState;
    if (!initialState || !this.simulation || !this.qpos_adr_policy) {
      return;
    }

    // Bolt: Cache simulation arrays to avoid repeated Emscripten view allocations
    const simQpos = this.simulation.qpos;

    const rootPos = initialState.root_pos;
    if (Array.isArray(rootPos) && rootPos.length >= 3) {
      simQpos[0] = Number(rootPos[0]) || 0.0;
      simQpos[1] = Number(rootPos[1]) || 0.0;
      simQpos[2] = Number(rootPos[2]) || 0.0;
    }

    const rootQuat = initialState.root_quat;
    if (Array.isArray(rootQuat) && rootQuat.length >= 4) {
      simQpos[3] = Number(rootQuat[0]) || 1.0;
      simQpos[4] = Number(rootQuat[1]) || 0.0;
      simQpos[5] = Number(rootQuat[2]) || 0.0;
      simQpos[6] = Number(rootQuat[3]) || 0.0;
    }

    const jointPosArray = initialState.joint_pos_array;
    if (Array.isArray(jointPosArray) && jointPosArray.length === this.numActions) {
      for (let i = 0; i < this.numActions; i++) {
        simQpos[this.qpos_adr_policy[i]] = Number(jointPosArray[i]) || 0.0;
      }
    } else {
      const jointRules = initialState.joint_pos ?? {};
      for (let i = 0; i < this.numActions; i++) {
        const jointName = this.policyJointNames[i];
        for (const [pattern, value] of Object.entries(jointRules)) {
          const regex = new RegExp(`^${pattern}$`);
          if (regex.test(jointName)) {
            simQpos[this.qpos_adr_policy[i]] = Number(value) || 0.0;
          }
        }
      }
    }

    const simQvel = this.simulation.qvel;
    for (let i = 0; i < simQvel.length; i++) {
      simQvel[i] = 0.0;
    }
    this.simulation.forward();
  }

  resetSimulation() {
    if (!this.simulation) {
      return;
    }
    this._knockdownSubstepsRemaining = 0;
    this.params.paused = true;
    this.simulation.resetData();
    this.applyPolicyInitialState();
    this.simulation.forward();
    this.actionTarget = null;
    if (this.policyRunner) {
      const state = this.readPolicyState();
      this.policyRunner.reset(state);
      this.params.current_motion = 'default';
    }
    this.params.paused = false;
  }

  render() {
    if (!this.model || !this.data || !this.simulation) {
      return;
    }
    const now = performance.now();
    if (now - this._lastRenderTime < 30) {
      return;
    }
    this._lastRenderTime = now;

    this.updateCameraFollow();
    this.controls.update();

    // Bolt: Use traditional for loop over Arrays instead of Map iterators
    // to avoid allocating Iterator objects during high-frequency render loops.
    for (let b = 0; b < this.lastSimState.bodies.length; b++) {
      const cached = this.lastSimState.bodies[b];
      if (cached && this.bodies[b]) {
        this.bodies[b].position.copy(cached.position);
        this.bodies[b].quaternion.copy(cached.quaternion);
        this.bodies[b].updateWorldMatrix();
      }
    }

    for (let l = 0; l < this.lastSimState.lights.length; l++) {
      const cached = this.lastSimState.lights[l];
      if (cached && this.lights[l]) {
        this.lights[l].position.copy(cached.position);
        this._lightLookAt.copy(cached.direction).add(this.lights[l].position);
        this.lights[l].lookAt(this._lightLookAt);
      }
    }

    if (this.mujocoRoot && this.mujocoRoot.cylinders) {
      const numWraps = this.lastSimState.tendons.count;
      this.mujocoRoot.cylinders.count = numWraps;
      this.mujocoRoot.spheres.count = numWraps > 0 ? numWraps + 1 : 0;
      this.mujocoRoot.cylinders.instanceMatrix.needsUpdate = true;
      this.mujocoRoot.spheres.instanceMatrix.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
