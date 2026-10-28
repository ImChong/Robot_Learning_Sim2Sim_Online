import * as ort from 'onnxruntime-web/wasm';
import { ONNXModule } from './onnxHelper.js';
import { Observations } from './observationHelpers.js';
import { TrackingHelper } from './trackingHelper.js';
import { toFloatArray } from './utils/math.js';

export class PolicyRunner {
  constructor(config, options = {}) {
    this.config = config;
    this.policyJointNames = (options.policyJointNames ?? config.policy_joint_names ?? []).slice();
    if (this.policyJointNames.length === 0) {
      throw new Error('PolicyRunner requires policy_joint_names in config');
    }
    this.numActions = this.policyJointNames.length;

    this.actionScale = toFloatArray(options.actionScale ?? config.action_scale, this.numActions, 1.0);
    this.defaultJointPos = toFloatArray(options.defaultJointPos ?? [], this.numActions, 0.0);
    this.actionClip = typeof config.action_clip === 'number' ? config.action_clip : 10.0;
    this.obsJointPosRelative = config.obs_joint_pos_relative === true;

    this.module = new ONNXModule(config.onnx);
    this.inputDict = {};
    this.isInferencing = false;
    this.lastActions = new Float32Array(this.numActions);

    this.tracking = null;
    if (config.tracking) {
      this.tracking = new TrackingHelper({
        ...config.tracking,
        policy_joint_names: this.policyJointNames
      });
    }

    this.obsModules = this._buildObsModules(config.obs_config);
    this.numObs = this.obsModules.reduce((sum, obs) => sum + (obs.size ?? 0), 0);
    this.historyLength = config.obs_config?.history_length || 1;

    // Pre-allocate arrays to reduce GC pressure during inferencing
    this.cachedJointPosRel = new Float32Array(this.numActions);
    this.fallbackJointPos = new Float32Array(this.numActions);
    this.historyCount = 0;
    this.fullObs = new Float32Array(this.numObs * this.historyLength);
    this.obsForPolicy = new Float32Array(this.numObs);
    this.target = new Float32Array(this.numActions);
    this._policyTensor = null;
    this._policyTensorSize = 0;
    this.lastRawAction = new Float32Array(this.numActions);
    this.lastExtraOutputs = {};
    this.lastStepAt = 0;
    this.stepCount = 0;
    this.onModuleInitProgress = typeof options.onInitProgress === 'function'
      ? options.onInitProgress
      : null;
  }

  async init() {
    await this.module.init((r) => this.onModuleInitProgress?.(r));
    this.reset();
  }

  async release() {
    while (this.isInferencing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await this.module?.release?.();
    this.tracking = null;
  }

  _buildObsModules(obsConfig) {
    const obsList = (obsConfig && Array.isArray(obsConfig.policy)) ? obsConfig.policy : [];
    return obsList.map((obsConfigEntry) => {
      const ObsClass = Observations[obsConfigEntry.name];
      if (!ObsClass) {
        throw new Error(`Unknown observation type: ${obsConfigEntry.name}`);
      }
      const kwargs = { ...obsConfigEntry };
      delete kwargs.name;
      return new ObsClass(this, kwargs);
    });
  }

  makePolicyState(state) {
    if (!state) {
      return state;
    }
    if (!this.obsJointPosRelative) {
      return state;
    }
    const jointPosAbs = state.jointPos ?? this.fallbackJointPos;
    const jointPosRel = this.cachedJointPosRel;
    for (let i = 0; i < this.numActions; i++) {
      jointPosRel[i] = jointPosAbs[i] - this.defaultJointPos[i];
    }
    const rel = this._relPolicyState ?? {
      jointPos: jointPosRel,
      jointPosAbs,
      jointVel: state.jointVel,
      rootPos: state.rootPos,
      rootQuat: state.rootQuat,
      rootAngVel: state.rootAngVel,
      qvel_base: state.qvel_base,
      complianceEnabled: state.complianceEnabled,
      complianceThreshold: state.complianceThreshold,
      cmd: state.cmd
    };
    if (!this._relPolicyState) {
      this._relPolicyState = rel;
      return rel;
    }
    rel.jointPosAbs = jointPosAbs;
    rel.jointVel = state.jointVel;
    rel.rootPos = state.rootPos;
    rel.rootQuat = state.rootQuat;
    rel.rootAngVel = state.rootAngVel;
    rel.qvel_base = state.qvel_base;
    rel.complianceEnabled = state.complianceEnabled;
    rel.complianceThreshold = state.complianceThreshold;
    rel.cmd = state.cmd;
    return rel;
  }

  _bindPolicyTensor() {
    const data = this.historyLength > 1 ? this.fullObs : this.obsForPolicy;
    const size = data.length;
    if (!this._policyTensor || this._policyTensorSize !== size) {
      this._policyTensor = new ort.Tensor('float32', data, [1, size]);
      this._policyTensorSize = size;
    }
    this.inputDict.policy = this._policyTensor;
  }

  reset(state = null) {
    this.inputDict = this.module.initInput() ?? {};
    this._policyTensor = null;
    this._policyTensorSize = 0;
    this.lastActions.fill(0.0);
    this.historyCount = 0;
    if (this.tracking) {
      this.tracking.reset(state);
    }
    const policyState = this.makePolicyState(state);
    // Bolt: Avoid for...of loops to prevent iterator allocation overhead
    for (let i = 0; i < this.obsModules.length; i++) {
      const obs = this.obsModules[i];
      if (typeof obs.reset === 'function') {
        obs.reset(policyState);
      }
    }
  }

  async step(state) {
    if (this.isInferencing) {
      return null;
    }

    if (!state) {
      throw new Error('PolicyRunner.step requires a state object');
    }

    this.isInferencing = true;
    try {
      if (this.tracking) {
        this.tracking.advance();
      }
      const policyState = this.makePolicyState(state);

      const obsForPolicy = this.obsForPolicy;
      let offset = 0;
      // Bolt: Avoid for...of loops to prevent iterator allocation overhead in hot path
      for (let i = 0; i < this.obsModules.length; i++) {
        const obs = this.obsModules[i];
        if (typeof obs.update === 'function') {
          obs.update(policyState);
        }
        const obsValue = obs.compute(policyState);
        // Bolt: TypedArray.set() natively accepts standard JS Arrays. Pass obsValue directly
        // to avoid intermediate Float32Array allocations and GC pressure in hot path.
        obsForPolicy.set(obsValue, offset);
        offset += obsValue.length;
      }

      if (this.historyLength > 1) {
        const fullObs = this.fullObs;
        if (this.historyCount === 0) {
          // Initialize history by broadcasting the first observation
          for (let i = 0; i < this.historyLength; i++) {
            fullObs.set(obsForPolicy, i * this.numObs);
          }
          this.historyCount = 1;
        } else {
          // Bolt: Use native TypedArray.copyWithin to efficiently shift the history buffer
          // avoiding an array of Float32Arrays and multiple manual .set() calls per tick
          fullObs.copyWithin(0, this.numObs);
          fullObs.set(obsForPolicy, (this.historyLength - 1) * this.numObs);
          if (this.historyCount < this.historyLength) {
            this.historyCount++;
          }
        }
      }
      this._bindPolicyTensor();

      const inferenceOutput = await this.module.runInference(this.inputDict);
      // Bolt: Avoid array destructuring in hot path to prevent iterator allocation overhead
      const result = inferenceOutput[0];
      const carry = inferenceOutput[1];

      if (carry) {
        // Bolt: Iterate manually instead of Object.keys(carry).length > 0 to avoid array allocation
        for (const key in carry) {
          if (Object.prototype.hasOwnProperty.call(carry, key)) {
            this.inputDict[key] = carry[key];
          }
        }
      }

      const action = result['action']?.data;
      if (!action || action.length !== this.numActions) {
        throw new Error('PolicyRunner received invalid action output');
      }

      this.lastRawAction.set(action);

      // Bolt: Update telemetry in-place to avoid allocating a new object and new arrays per tick
      this.lastExtraOutputs ??= {};

      for (const key in result) {
        if (key === 'action' || !Object.prototype.hasOwnProperty.call(result, key)) {
          continue;
        }
        const tensor = result[key];
        if (tensor?.data) {
          if (!this.lastExtraOutputs[key]) {
            this.lastExtraOutputs[key] = { dims: [], preview: [] };
          }
          const outputKey = this.lastExtraOutputs[key];

          if (tensor.dims) {
            outputKey.dims.length = tensor.dims.length;
            for (let i = 0; i < tensor.dims.length; i++) {
              outputKey.dims[i] = tensor.dims[i];
            }
          } else {
            outputKey.dims.length = 0;
          }

          const previewLen = Math.min(6, tensor.data.length);
          outputKey.preview.length = previewLen;
          for (let i = 0; i < previewLen; i++) {
            outputKey.preview[i] = tensor.data[i];
          }
        }
      }

      const clip = typeof this.actionClip === 'number' ? this.actionClip : Infinity;
      for (let i = 0; i < this.numActions; i++) {
        const value = action[i];
        const clamped = clip !== Infinity ? Math.max(-clip, Math.min(clip, value)) : value;
        this.lastActions[i] = clamped;
      }

      const target = this.target;
      for (let i = 0; i < this.numActions; i++) {
        target[i] = this.defaultJointPos[i] + this.actionScale[i] * this.lastActions[i];
      }

      this.lastStepAt = performance.now();
      this.stepCount += 1;
      return target;
    } finally {
      this.isInferencing = false;
    }
  }
}
