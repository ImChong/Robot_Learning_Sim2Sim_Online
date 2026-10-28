import * as THREE from 'three';
import { Reflector } from './utils/Reflector.js';
import { REFLECTION_QUALITY_PRESETS } from './reflectionQuality.js';
import { PolicyRunner } from './policyRunner.js';
import { preloadOnnxModel, releaseCachedOnnxModels } from './onnxHelper.js';
import { toFloatArray } from './utils/math.js';
import { disposeObject3D } from './hostDemoLifecycle.js';
import {
  createWeightedProgressReporter,
  fetchTextCached,
  gunzipBytes,
  isGzipData,
  readResponseBodyWithProgress
} from './fetchWithProgress.js';

const MOTION_INDEX_FORMAT = 'tracking-motion-index-v1';

/** MuJoCo mat_texrepeat for a material id (u/v repeat counts). */
function getMatTexRepeat(model, matId) {
  if (matId < 0) {
    return { u: 1, v: 1 };
  }
  const u = model.mat_texrepeat[matId * 2];
  const v = model.mat_texrepeat[(matId * 2) + 1];
  return {
    u: Number.isFinite(u) && u > 0 ? u : 1,
    v: Number.isFinite(v) && v > 0 ? v : 1
  };
}

/** Bake mat_texrepeat into plane UVs (Reflector shader ignores texture.repeat on the checker map). */
function applyMatTexRepeatToPlaneGeometry(geometry, repeatU, repeatV) {
  const uv = geometry.attributes.uv;
  if (!uv) {
    return;
  }
  const u = Number.isFinite(repeatU) && repeatU > 0 ? repeatU : 1;
  const v = Number.isFinite(repeatV) && repeatV > 0 ? repeatV : 1;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  }
  uv.needsUpdate = true;
}

function stripJsonExtension(path) {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.json$/i, '');
}

function normalizeMotionEntry(entry) {
  if (typeof entry === 'string') {
    return { name: stripJsonExtension(entry), file: entry, complianceSuitable: undefined };
  }
  if (entry && typeof entry === 'object') {
    const file = entry.file ?? entry.path ?? null;
    if (!file) {
      return null;
    }
    const name = entry.name ?? stripJsonExtension(file);
    const complianceSuitable = typeof entry.compliance_suitable === 'boolean'
      ? entry.compliance_suitable
      : undefined;
    return { name, file, complianceSuitable };
  }
  return null;
}

function parseMotionIndex(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.format !== MOTION_INDEX_FORMAT) {
    return null;
  }
  const motions = Array.isArray(payload.motions) ? payload.motions : [];
  return {
    basePath: payload.base_path ?? null,
    motions
  };
}

/** Motion names loaded before first interactive frame (others load on demand). */
const INITIAL_TRACKING_MOTION_NAMES = ['default'];

function motionIndexBaseUrl(index, motionsUrl) {
  if (!index.basePath) {
    return new URL('.', motionsUrl);
  }
  return new URL(index.basePath.endsWith('/') ? index.basePath : `${index.basePath}/`, motionsUrl);
}

async function fetchMotionClip(entry, baseUrl, onProgress) {
  if (!entry?.file || !entry?.name) {
    throw new Error('Motion index entries must include a name and file path.');
  }
  const clipUrl = new URL(entry.file, baseUrl).toString();
  return JSON.parse(await fetchTextCached(clipUrl, onProgress));
}

async function loadMotionIndex(indexPayload, motionsUrl, onProgress, options = {}) {
  const index = parseMotionIndex(indexPayload);
  if (!index) {
    onProgress?.(1);
    return null;
  }

  const baseUrl = motionIndexBaseUrl(index, motionsUrl);
  const motions = {};
  const motionMeta = {};
  const catalog = [];
  const entries = index.motions.map((entry) => normalizeMotionEntry(entry));
  const eagerNames = new Set(
    Array.isArray(options.eagerNames) && options.eagerNames.length > 0
      ? options.eagerNames
      : INITIAL_TRACKING_MOTION_NAMES
  );

  for (const entry of entries) {
    if (!entry?.file || !entry?.name) {
      continue;
    }
    catalog.push(entry);
    if (typeof entry.complianceSuitable === 'boolean') {
      motionMeta[entry.name] = { compliance_suitable: entry.complianceSuitable };
    }
  }

  const eagerEntries = catalog.filter((entry) => eagerNames.has(entry.name));
  const weights = eagerEntries.map(() => 1);
  const reporter = createWeightedProgressReporter(weights, onProgress);

  await Promise.all(
    eagerEntries.map(async (entry, i) => {
      const clip = await fetchMotionClip(entry, baseUrl, (r) => reporter(i, r));
      motions[entry.name] = clip;
    })
  );
  onProgress?.(1);
  return { motions, motionMeta, catalog, baseUrl: baseUrl.toString() };
}

/** Prefixes (e.g. `g1/`) used to filter entries in examples/scenes/files.json. */
export function sceneAssetPrefixesForPath(scenePath) {
  const slash = scenePath.indexOf('/');
  if (slash < 0) {
    return [];
  }
  return [scenePath.slice(0, slash + 1)];
}

export function initialSceneAssetPrefixes() {
  return ['g1_amp/'];
}

export function filterSceneFilesByPrefixes(allFiles, prefixes) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    return allFiles;
  }
  return allFiles.filter((rel) => prefixes.some((prefix) => rel.startsWith(prefix)));
}

/**
 * Production builds ship `<mesh>.gz` copies (scripts/vite-plugin-scene-mesh-gzip.mjs) because
 * static hosts such as GitHub Pages serve STL files without compression.
 */
const COMPRESSED_SCENE_ASSET_RE = /\.stl$/i;
const useCompressedSceneAssets = import.meta.env?.PROD === true
  && typeof DecompressionStream === 'function';

async function fetchCompressedSceneAsset(url, signal, onProgress) {
  try {
    const response = await fetch(`${url}.gz`, { signal });
    if (!response.ok) {
      return null;
    }
    const bytes = await readResponseBodyWithProgress(response, onProgress);
    // A host may already have decoded it via Content-Encoding.
    return isGzipData(bytes) ? await gunzipBytes(bytes) : bytes;
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    console.warn(`Compressed scene asset unavailable, using ${url}:`, error);
    return null;
  }
}

async function fetchSceneAssetBytes(rel, url, signal, onProgress) {
  if (useCompressedSceneAssets && COMPRESSED_SCENE_ASSET_RE.test(rel)) {
    const bytes = await fetchCompressedSceneAsset(url, signal, onProgress);
    if (bytes) {
      return bytes;
    }
  }
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load scene asset ${url}: ${response.status}`);
  }
  return readResponseBodyWithProgress(response, onProgress);
}

function sceneAssetExistsInFs(mujoco, relativePath) {
  return mujoco.FS.analyzePath(`/working/${relativePath}`).exists;
}

export async function reloadScene(mjcf_path) {
  this.currentScenePath = mjcf_path;
  // Free the previous scene's GPU buffers, textures and reflector render targets; otherwise
  // every policy switch leaks them and later switches/rendering get slower.
  const previousRoot = this.scene.getObjectByName('MuJoCo Root');
  this.scene.remove(previousRoot);
  for (const reflector of this.reflectors ?? []) {
    reflector.dispose?.();
  }
  disposeObject3D(previousRoot);
  const mujoco = this.mujoco;
  console.log('Loading scene:', mjcf_path);

  [this.model, this.data, this.simulation, this.bodies, this.lights] =
    await loadSceneFromURL(mujoco, mjcf_path, this);
  this.lightBaseIntensities = new Map(
    Object.entries(this.lights ?? {}).flatMap(([index, light]) => (
      light ? [[Number(index), light.intensity ?? 1]] : []
    ))
  );
  this.applyVisualTheme?.();

  const textDecoder = new TextDecoder();
  const namesArray = new Uint8Array(this.model.names);

  this.jointNamesMJC = [];
  for (let j = 0; j < this.model.njnt; j++) {
    let start_idx = this.model.name_jntadr[j];
    let end_idx = start_idx;
    while (end_idx < namesArray.length && namesArray[end_idx] !== 0) {
      end_idx++;
    }
    this.jointNamesMJC.push(textDecoder.decode(namesArray.subarray(start_idx, end_idx)));
  }

  this.defaultJposPolicy = null;

  this.policyJointNames = null;
  this.ctrl_adr_policy = [];
  this.qpos_adr_policy = [];
  this.qvel_adr_policy = [];
  this.numActions = 0;

  this.timestep = this.model.opt.timestep;
  this.decimation = Math.max(1, Math.round(0.02 / this.timestep));
  this.policyInitialState = null;
}

/**
 * Start fetching a policy's JSON (and, for tracking policies, its motion index and eager clips)
 * plus its ONNX model and ORT runtime, so they load while the MuJoCo scene is still loading.
 */
export function preloadPolicyAssets(policyPath, onnxPath) {
  preloadOnnxModel(onnxPath);
  if (!policyPath) {
    return;
  }
  // Errors resurface when reloadPolicy() requests the same files.
  fetchTextCached(policyPath)
    .then((text) => {
      const motionsPath = JSON.parse(text)?.tracking?.motions_path;
      if (!motionsPath) {
        return null;
      }
      const motionsUrl = new URL(motionsPath, window.location.href);
      return fetchTextCached(motionsUrl.toString()).then((indexText) => {
        const index = parseMotionIndex(JSON.parse(indexText));
        if (!index) {
          return;
        }
        const baseUrl = motionIndexBaseUrl(index, motionsUrl);
        for (const entry of index.motions.map(normalizeMotionEntry)) {
          if (entry?.file && INITIAL_TRACKING_MOTION_NAMES.includes(entry.name)) {
            fetchTextCached(new URL(entry.file, baseUrl).toString()).catch(() => {});
          }
        }
      });
    })
    .catch(() => {});
}

/** Drop preloaded and cached ONNX sessions (host demo teardown). */
export function releasePolicyCaches() {
  releaseCachedOnnxModels();
}

export async function reloadPolicy(policy_path, options = {}) {
  this.currentPolicyPath = policy_path;
  console.log('Reloading policy:', policy_path);

  while (this.policyRunner?.isInferencing) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (this.policyRunner) {
    await this.policyRunner.release();
    this.policyRunner = null;
  }

  const reportInit = (t) => {
    if (typeof options.onInitProgress === 'function') {
      options.onInitProgress(Math.min(1, Math.max(0, t)));
    }
  };

  const policyJsonText = await fetchTextCached(policy_path, (r) => {
    reportInit(0.12 * r);
  });
  const config = JSON.parse(policyJsonText);
  if (options?.onnxPath) {
    config.onnx = { ...(config.onnx ?? {}), path: options.onnxPath };
  }

  let trackingConfig = null;
  if (config.tracking) {
    trackingConfig = { ...config.tracking };
    if (trackingConfig.motions_path && !trackingConfig.motions) {
      const motionsUrl = new URL(trackingConfig.motions_path, window.location.href);
      const motionIndexText = await fetchTextCached(motionsUrl.toString(), (r) => {
        reportInit(0.12 + 0.1 * r);
      });
      const payload = JSON.parse(motionIndexText);
      const indexedMotions = await loadMotionIndex(payload, motionsUrl, (r) => {
        reportInit(0.22 + 0.38 * r);
      }, { eagerNames: INITIAL_TRACKING_MOTION_NAMES });
      if (indexedMotions) {
        trackingConfig.motions = indexedMotions.motions;
        trackingConfig.motion_meta = indexedMotions.motionMeta;
        trackingConfig.motion_catalog = indexedMotions.catalog;
        trackingConfig.motion_base_url = indexedMotions.baseUrl;
      } else {
        trackingConfig.motions = payload;
      }
      reportInit(0.6);
    } else {
      reportInit(0.6);
    }
  } else {
    reportInit(0.6);
  }

  const policyJointNames = Array.isArray(config.policy_joint_names)
    ? config.policy_joint_names
    : null;
  if (!policyJointNames || policyJointNames.length === 0) {
    throw new Error('Policy configuration must include a non-empty policy_joint_names list');
  }

  configureJointMappings(this, policyJointNames);
  const configDefaultJointPos = Array.isArray(config.default_joint_pos)
    ? config.default_joint_pos
    : null;
  if (configDefaultJointPos) {
    if (configDefaultJointPos.length !== this.numActions) {
      throw new Error(
        `default_joint_pos length ${configDefaultJointPos.length} does not match policy_joint_names length ${this.numActions}`
      );
    }
    this.defaultJposPolicy = new Float32Array(configDefaultJointPos);
  }
  this.kpPolicy = toFloatArray(config.stiffness, this.numActions, 0.0);
  this.kdPolicy = toFloatArray(config.damping, this.numActions, 0.0);
  this.effortLimitPolicy = toFloatArray(config.effort_limit, this.numActions, Infinity);
  this.X1Policy = toFloatArray(config.X1, this.numActions, Infinity);
  this.X2Policy = toFloatArray(config.X2, this.numActions, Infinity);
  this.Y1Policy = toFloatArray(config.Y1, this.numActions, Infinity);
  this.Y2Policy = toFloatArray(config.Y2, this.numActions, Infinity);
  this.frictionStaticPolicy = toFloatArray(config.Fs, this.numActions, 0.0);
  this.frictionDynamicPolicy = toFloatArray(config.Fd, this.numActions, 0.0);
  this.frictionActivationVelPolicy = toFloatArray(config.Va, this.numActions, 0.01);
  this.control_type = config.control_type ?? 'joint_position';
  this.policyInitialState = config.initial_state ?? null;

  const simConfig = config.sim ?? {};
  const controlDt = Number(
    simConfig.control_dt ?? (simConfig.timestep && simConfig.decimation ? simConfig.timestep * simConfig.decimation : 0.02)
  );
  this.decimation = Math.max(1, Math.round(controlDt / this.timestep));

  if (trackingConfig) {
    trackingConfig.policy_joint_names = policyJointNames.slice();
  }

  this.simulation.resetData();
  this.applyPolicyInitialState?.();
  this.simulation.forward();
  this.policyRunner = new PolicyRunner(
    {
      ...config,
      tracking: trackingConfig,
      policy_joint_names: policyJointNames,
      action_scale: config.action_scale,
      default_joint_pos: this.defaultJposPolicy
    },
    {
      policyJointNames,
      actionScale: config.action_scale,
      defaultJointPos: this.defaultJposPolicy,
      onInitProgress: (r) => {
        reportInit(0.6 + 0.4 * r);
      }
    }
  );
  await this.policyRunner.init();
  reportInit(1);

  const state = this.readPolicyState?.();
  if (state) {
    this.policyRunner.reset(state);
  } else {
    this.policyRunner.reset();
  }

  this.params.current_motion = 'default';
}

export async function loadSceneFromURL(mujoco, filename, parent) {
  parent.reflectors = [];
  if (parent.simulation) {
    parent.simulation.free();
    parent.simulation = null;
    parent.model = null;
    parent.data = null;
  }

  const model = mujoco.MjModel.loadFromXML('/working/' + filename);
  const data = new mujoco.MjData(model);
  const simulation = createSimulationWrapper(mujoco, model, data);

  const textDecoder = new TextDecoder('utf-8');
  const names_array = new Uint8Array(model.names);
  const fullString = textDecoder.decode(model.names);
  const names = fullString.split(textDecoder.decode(new ArrayBuffer(1)));

  const mujocoRoot = new THREE.Group();
  mujocoRoot.name = 'MuJoCo Root';
  parent.scene.add(mujocoRoot);

  const bodies = {};
  const meshes = {};
  const lights = [];
  parent.bodyIdByName = Object.create(null);
  parent.pelvis_body_id = undefined;

  let material = new THREE.MeshPhysicalMaterial();
  material.color = new THREE.Color(1, 1, 1);

  for (let g = 0; g < model.ngeom; g++) {
    if (!(model.geom_group[g] < 3)) { continue; }

    let b = model.geom_bodyid[g];
    let type = model.geom_type[g];
    let size = [
      model.geom_size[(g * 3) + 0],
      model.geom_size[(g * 3) + 1],
      model.geom_size[(g * 3) + 2]
    ];

    if (!(b in bodies)) {
      bodies[b] = new THREE.Group();

      let start_idx = model.name_bodyadr[b];
      let end_idx = start_idx;
      while (end_idx < names_array.length && names_array[end_idx] !== 0) {
        end_idx++;
      }
      let name_buffer = names_array.subarray(start_idx, end_idx);
      bodies[b].name = textDecoder.decode(name_buffer);
      parent.bodyIdByName[bodies[b].name] = b;

      bodies[b].bodyID = b;
      bodies[b].has_custom_mesh = false;

      if (bodies[b].name === 'base' || bodies[b].name === 'pelvis' || bodies[b].name === 'trunk_base') {
        parent.pelvis_body_id = b;
      }
    }

    let geometry = new THREE.SphereGeometry(size[0] * 0.5);
    if (type == mujoco.mjtGeom.mjGEOM_PLANE.value) {
      // Special handling for plane later.
    } else if (type == mujoco.mjtGeom.mjGEOM_HFIELD.value) {
      // TODO: Implement this.
    } else if (type == mujoco.mjtGeom.mjGEOM_SPHERE.value) {
      geometry = new THREE.SphereGeometry(size[0]);
    } else if (type == mujoco.mjtGeom.mjGEOM_CAPSULE.value) {
      geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2.0, 20, 20);
    } else if (type == mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) {
      geometry = new THREE.SphereGeometry(1);
    } else if (type == mujoco.mjtGeom.mjGEOM_CYLINDER.value) {
      geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2.0);
    } else if (type == mujoco.mjtGeom.mjGEOM_BOX.value) {
      geometry = new THREE.BoxGeometry(size[0] * 2.0, size[2] * 2.0, size[1] * 2.0);
    } else if (type == mujoco.mjtGeom.mjGEOM_MESH.value) {
      let meshID = model.geom_dataid[g];

      if (!(meshID in meshes)) {
        geometry = new THREE.BufferGeometry();

        let vertex_buffer = model.mesh_vert.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3);
        for (let v = 0; v < vertex_buffer.length; v += 3) {
          let temp = vertex_buffer[v + 1];
          vertex_buffer[v + 1] = vertex_buffer[v + 2];
          vertex_buffer[v + 2] = -temp;
        }

        let normal_buffer = model.mesh_normal.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3);
        for (let v = 0; v < normal_buffer.length; v += 3) {
          let temp = normal_buffer[v + 1];
          normal_buffer[v + 1] = normal_buffer[v + 2];
          normal_buffer[v + 2] = -temp;
        }

        let uv_buffer = model.mesh_texcoord.subarray(
          model.mesh_texcoordadr[meshID] * 2,
          (model.mesh_texcoordadr[meshID] + model.mesh_vertnum[meshID]) * 2);
        let triangle_buffer = model.mesh_face.subarray(
          model.mesh_faceadr[meshID] * 3,
          (model.mesh_faceadr[meshID] + model.mesh_facenum[meshID]) * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertex_buffer, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normal_buffer, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv_buffer, 2));
        // Same index type three.js would pick, copied natively instead of via a JS array.
        const IndexArray = model.mesh_vertnum[meshID] > 65535 ? Uint32Array : Uint16Array;
        geometry.setIndex(new THREE.BufferAttribute(new IndexArray(triangle_buffer), 1));
        meshes[meshID] = geometry;
      } else {
        geometry = meshes[meshID];
      }

      bodies[b].has_custom_mesh = true;
    }

    let texture = undefined;
    let color = [
      model.geom_rgba[(g * 4) + 0],
      model.geom_rgba[(g * 4) + 1],
      model.geom_rgba[(g * 4) + 2],
      model.geom_rgba[(g * 4) + 3]
    ];
    if (model.geom_matid[g] != -1) {
      let matId = model.geom_matid[g];
      color = [
        model.mat_rgba[(matId * 4) + 0],
        model.mat_rgba[(matId * 4) + 1],
        model.mat_rgba[(matId * 4) + 2],
        model.mat_rgba[(matId * 4) + 3]
      ];

      texture = undefined;
      const mjNTEXROLE = 10;
      const mjTEXROLE_RGB = 1;
      let texId = model.mat_texid[(matId * mjNTEXROLE) + mjTEXROLE_RGB];

      if (texId != -1) {
        let width = model.tex_width[texId];
        let height = model.tex_height[texId];
        let offset = model.tex_adr[texId];
        let channels = model.tex_nchannel[texId];
        let texData = model.tex_data;
        let rgbaArray = new Uint8Array(width * height * 4);
        for (let p = 0; p < width * height; p++) {
          rgbaArray[(p * 4) + 0] = texData[offset + ((p * channels) + 0)];
          rgbaArray[(p * 4) + 1] = channels > 1 ? texData[offset + ((p * channels) + 1)] : rgbaArray[(p * 4) + 0];
          rgbaArray[(p * 4) + 2] = channels > 2 ? texData[offset + ((p * channels) + 2)] : rgbaArray[(p * 4) + 0];
          rgbaArray[(p * 4) + 3] = channels > 3 ? texData[offset + ((p * channels) + 3)] : 255;
        }
        texture = new THREE.DataTexture(rgbaArray, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
        const { u: repeatU, v: repeatV } = getMatTexRepeat(model, matId);
        texture.repeat.set(repeatU, repeatV);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
      }
    }

    const matId = model.geom_matid[g];
    const alpha = color[3] <= 1 ? color[3] : color[3] / 255;
    const roughnessFromShininess = matId !== -1
      ? THREE.MathUtils.clamp(1.0 - model.mat_shininess[matId], 0.04, 1.0)
      : undefined;
    const materialOptions = {
      color: new THREE.Color(color[0], color[1], color[2]),
      transparent: alpha < 1.0,
      opacity: alpha
    };
    // Only pass material values that exist: undefined ones are ignored by three.js anyway,
    // but each one logs a console warning (4 per geom per scene load).
    if (matId !== -1) {
      materialOptions.specularIntensity = model.mat_specular[matId];
      materialOptions.reflectivity = model.mat_reflectance[matId];
      materialOptions.roughness = roughnessFromShininess;
      materialOptions.metalness = model.mat_metallic[matId];
    }
    if (texture) {
      materialOptions.map = texture;
    }

    const useMeshStandard = type === mujoco.mjtGeom.mjGEOM_MESH.value;
    let currentMaterial;
    if (useMeshStandard) {
      const maxRgb = Math.max(color[0], color[1], color[2]);
      const isDark = maxRgb < 0.38;
      const isVeryDark = maxRgb < 0.28;
      const stdOpts = {
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: alpha < 1.0,
        opacity: alpha,
        metalness: isVeryDark ? 0 : isDark ? 0.22 : 0.38,
        roughness: isVeryDark ? 1 : isDark ? 0.62 : 0.5,
      };
      if (texture) {
        stdOpts.map = texture;
      }
      currentMaterial = new THREE.MeshStandardMaterial(stdOpts);
    } else {
      currentMaterial = new THREE.MeshPhysicalMaterial(materialOptions);
    }

    let mesh = new THREE.Mesh();
    if (type == 0) {
      const reflectionPreset = parent.getReflectionQualityPreset?.() ?? REFLECTION_QUALITY_PRESETS[2];
      const planeGeometry = new THREE.PlaneGeometry(100, 100);
      if (texture) {
        const { u: repeatU, v: repeatV } = getMatTexRepeat(model, matId);
        applyMatTexRepeatToPlaneGeometry(planeGeometry, repeatU, repeatV);
        texture.repeat.set(1, 1);
      }
      mesh = new Reflector(planeGeometry, {
        clipBias: 0.003,
        texture,
        textureWidth: reflectionPreset.size,
        textureHeight: reflectionPreset.size,
        multisample: reflectionPreset.multisample
      });
      if (!parent.reflectors) {
        parent.reflectors = [];
      }
      parent.reflectors.push(mesh);
      mesh.rotateX(-Math.PI / 2);
      mesh.material.depthWrite = false;
      mesh.renderOrder = -1;
    } else {
      mesh = new THREE.Mesh(geometry, currentMaterial);
    }

    mesh.castShadow = g == 0 ? false : true;
    mesh.receiveShadow = type != 7;
    mesh.bodyID = b;
    bodies[b].add(mesh);
    getPosition(model.geom_pos, g, mesh.position);
    if (type != 0) {
      getQuaternion(model.geom_quat, g, mesh.quaternion);
    }
    if (type == 4) {
      mesh.scale.set(size[0], size[2], size[1]);
    }
  }

  let tendonMat = new THREE.MeshPhongMaterial();
  tendonMat.color = new THREE.Color(0.8, 0.3, 0.3);
  mujocoRoot.cylinders = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1),
    tendonMat,
    1023
  );
  mujocoRoot.cylinders.receiveShadow = true;
  mujocoRoot.cylinders.castShadow = true;
  mujocoRoot.add(mujocoRoot.cylinders);
  mujocoRoot.spheres = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 10),
    tendonMat,
    1023
  );
  mujocoRoot.spheres.receiveShadow = true;
  mujocoRoot.spheres.castShadow = true;
  mujocoRoot.add(mujocoRoot.spheres);

  for (let l = 0; l < model.nlight; l++) {
    let light = new THREE.SpotLight();
    if (model.light_type[l] == 0) {
      light = new THREE.SpotLight();
    } else if (model.light_type[l] == 1) {
      light = new THREE.DirectionalLight();
    } else if (model.light_type[l] == 2) {
      light = new THREE.PointLight();
    } else if (model.light_type[l] == 3) {
      light = new THREE.HemisphereLight();
    }
    if (model.light_diffuse && model.light_diffuse.length >= (l + 1) * 3) {
      const r = model.light_diffuse[(l * 3) + 0];
      const g = model.light_diffuse[(l * 3) + 1];
      const b = model.light_diffuse[(l * 3) + 2];
      const max = Math.max(r, g, b);
      if (max > 0) {
        light.color.setRGB(r / max, g / max, b / max);
        light.intensity = max;
      } else {
        light.color.setRGB(1, 1, 1);
        light.intensity = 1;
      }
    }
    light.decay = model.light_attenuation[l] * 100;
    light.penumbra = 0.5;
    if (model.light_castshadow) {
      light.castShadow = model.light_castshadow[l] !== 0;
    } else {
      light.castShadow = true;
    }

    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 30;
    if (bodies[0]) {
      bodies[0].add(light);
    } else {
      mujocoRoot.add(light);
    }
    lights.push(light);
  }
  if (model.nlight == 0) {
    let light = new THREE.DirectionalLight();
    mujocoRoot.add(light);
  }

  for (let b = 0; b < model.nbody; b++) {
    if (b == 0 || !bodies[0]) {
      mujocoRoot.add(bodies[b]);
    } else if (bodies[b]) {
      bodies[0].add(bodies[b]);
    } else {
      bodies[b] = new THREE.Group();
      bodies[b].name = names[b + 1];
      bodies[b].bodyID = b;
      bodies[b].has_custom_mesh = false;
      bodies[0].add(bodies[b]);
    }
  }

  parent.mujocoRoot = mujocoRoot;
  if (parent.lastSimState) {
    parent.lastSimState.bodies = [];
    parent.lastSimState.lights = [];
    parent.lastSimState.tendons = {
      count: 0,
      matrix: parent.lastSimState.tendons?.matrix ?? new THREE.Matrix4()
    };
  }

  if (parent.lastSimState?.bodies) {
    parent.lastSimState.bodies.length = 0;
  }
  if (parent.lastSimState?.lights) {
    parent.lastSimState.lights.length = 0;
  }

  return [model, data, simulation, bodies, lights];
}

function configureJointMappings(demo, jointNames) {
  const model = demo.model;
  const mujoco = demo.mujoco;

  demo.policyJointNames = jointNames.slice();

  const jointTransmission = mujoco.mjtTrn.mjTRN_JOINT.value;
  const actuator2joint = [];
  for (let i = 0; i < model.nu; i++) {
    if (model.actuator_trntype[i] !== jointTransmission) {
      throw new Error(`Actuator ${i} transmission type is not mjTRN_JOINT`);
    }
    actuator2joint.push(model.actuator_trnid[2 * i]);
  }

  demo.ctrl_adr_policy = [];
  demo.qpos_adr_policy = [];
  demo.qvel_adr_policy = [];
  demo.ctrlMinPolicy = new Float32Array(jointNames.length);
  demo.ctrlMaxPolicy = new Float32Array(jointNames.length);

  const ctrlRange = model.actuator_ctrlrange;

  for (let i = 0; i < jointNames.length; i++) {
    const name = jointNames[i];
    const jointIdx = demo.jointNamesMJC.indexOf(name);
    if (jointIdx < 0) {
      throw new Error(`Joint "${name}" not found in MuJoCo model`);
    }
    const actuatorIdx = actuator2joint.findIndex((jointId) => jointId === jointIdx);
    if (actuatorIdx < 0) {
      throw new Error(`No actuator mapped to joint "${name}"`);
    }
    demo.ctrl_adr_policy.push(actuatorIdx);
    demo.qpos_adr_policy.push(model.jnt_qposadr[jointIdx]);
    demo.qvel_adr_policy.push(model.jnt_dofadr[jointIdx]);

    let min = -Infinity;
    let max = Infinity;
    if (ctrlRange && ctrlRange.length >= (actuatorIdx + 1) * 2) {
      const rMin = ctrlRange[actuatorIdx * 2];
      const rMax = ctrlRange[(actuatorIdx * 2) + 1];
      if (Number.isFinite(rMin) && Number.isFinite(rMax) && rMin < rMax) {
        min = rMin;
        max = rMax;
      }
    }
    demo.ctrlMinPolicy[i] = min;
    demo.ctrlMaxPolicy[i] = max;
  }

  demo.numActions = jointNames.length;

  demo.defaultJposPolicy = new Float32Array(demo.numActions);
  demo.defaultJposPolicy.fill(0.0);
}

/** Scene files being downloaded, per MuJoCo instance (each has its own MEMFS). */
const pendingSceneAssets = new WeakMap();

export async function downloadExampleScenesFolder(mujoco, onProgress, options = {}) {
  const prefixes = options.prefixes ?? null;
  const listUrl = './examples/scenes/files.json';
  const allFiles = JSON.parse(await fetchTextCached(listUrl, (r) => {
    onProgress?.(0.02 * r);
  }));

  const scopedFiles = filterSceneFilesByPrefixes(allFiles, prefixes);
  const filesToDownload = scopedFiles.filter((rel) => !sceneAssetExistsInFs(mujoco, rel));
  if (filesToDownload.length === 0) {
    onProgress?.(1);
    return;
  }

  const base = './examples/scenes/';
  const weights = filesToDownload.map(() => 1);
  const reporter = createWeightedProgressReporter(weights, (overall) => {
    onProgress?.(0.02 + 0.98 * overall);
  });

  const writeToFs = (relativePath, data) => {
    if (/(^|\/)\.\.(\/|$)/.test(relativePath) || relativePath.startsWith('/')) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    const split = relativePath.split('/');
    let working = '/working/';
    for (let f = 0; f < split.length - 1; f++) {
      working += split[f];
      if (!mujoco.FS.analyzePath(working).exists) {
        mujoco.FS.mkdir(working);
      }
      working += '/';
    }
    mujoco.FS.writeFile('/working/' + relativePath, data);
  };

  const downloadToFs = async (rel, onFileProgress) => {
    const url = base + rel;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const buf = await fetchSceneAssetBytes(rel, url, controller.signal, onFileProgress);
      if (rel.match(/\.(png|stl|skn)$/i)) {
        writeToFs(rel, buf);
      } else {
        writeToFs(rel, new TextDecoder('utf-8').decode(buf));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // A prefetch (policy menu hover) and the actual switch may want the same files: share the
  // in-flight request, and retry on our own if the shared one failed.
  let pending = pendingSceneAssets.get(mujoco);
  if (!pending) {
    pending = new Map();
    pendingSceneAssets.set(mujoco, pending);
  }
  await Promise.all(
    filesToDownload.map((rel, i) => {
      const inFlight = pending.get(rel);
      if (inFlight) {
        return inFlight.then(() => reporter(i, 1), () => downloadToFs(rel, (r) => reporter(i, r)));
      }
      const task = downloadToFs(rel, (r) => reporter(i, r)).finally(() => pending.delete(rel));
      pending.set(rel, task);
      return task;
    })
  );
  onProgress?.(1);
}

/** Download scene assets for the given path if they are not already in the MuJoCo MEMFS. */
export async function ensureSceneAssetsForPath(mujoco, scenePath, onProgress) {
  const prefixes = sceneAssetPrefixesForPath(scenePath);
  if (prefixes.length === 0) {
    onProgress?.(1);
    return;
  }
  await downloadExampleScenesFolder(mujoco, onProgress, { prefixes });
}

export function getPosition(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      buffer[(index * 3) + 0],
      buffer[(index * 3) + 2],
      -buffer[(index * 3) + 1]
    );
  }
  return target.set(
    buffer[(index * 3) + 0],
    buffer[(index * 3) + 1],
    buffer[(index * 3) + 2]
  );
}

export function getQuaternion(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      -buffer[(index * 4) + 1],
      -buffer[(index * 4) + 3],
      buffer[(index * 4) + 2],
      -buffer[(index * 4) + 0]
    );
  }
  return target.set(
    buffer[(index * 4) + 0],
    buffer[(index * 4) + 1],
    buffer[(index * 4) + 2],
    buffer[(index * 4) + 3]
  );
}

export function toMujocoPos(target) {
  return target.set(target.x, -target.z, target.y);
}


function createSimulationWrapper(mujoco, model, data) {
  const force = new Float64Array(3);
  const torque = new Float64Array(3);
  const point = new Float64Array(3);

  return {
    get qpos() { return data.qpos; },
    get qvel() { return data.qvel; },
    get ctrl() { return data.ctrl; },
    get qfrc_applied() { return data.qfrc_applied; },
    get xpos() { return data.xpos; },
    get xquat() { return data.xquat; },
    get light_xpos() { return data.light_xpos; },
    get light_xdir() { return data.light_xdir; },
    get ten_wrapadr() { return model.ten_wrapadr; },
    get ten_wrapnum() { return model.ten_wrapnum; },
    get wrap_xpos() { return data.wrap_xpos; },
    step() {
      mujoco.mj_step(model, data);
    },
    resetData() {
      mujoco.mj_resetData(model, data);
    },
    forward() {
      mujoco.mj_forward(model, data);
    },
    applyForce(fx, fy, fz, tx, ty, tz, px, py, pz, bodyId) {
      force[0] = fx; force[1] = fy; force[2] = fz;
      torque[0] = tx; torque[1] = ty; torque[2] = tz;
      point[0] = px; point[1] = py; point[2] = pz;
      mujoco.mj_applyFT(model, data, force, torque, point, bodyId, data.qfrc_applied);
    },
    free() {
      data.delete();
      model.delete();
    }
  };
}
