# Robot_Learning_Sim2Sim_Online

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen?logo=github)](https://imchong.github.io/Robot_Learning_Sim2Sim_Online/)
[![Deploy to GitHub Pages](https://github.com/ImChong/Robot_Learning_Sim2Sim_Online/actions/workflows/deploy.yml/badge.svg)](https://github.com/ImChong/Robot_Learning_Sim2Sim_Online/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

这是一个基于 Vue 3 + Vuetify 的单页演示网站，用于在浏览器中运行 MuJoCo WebAssembly 场景，并使用 ONNX policy 驱动人形机器人运动。当前默认配置会从 `public/examples` 加载 G1 场景、policy 和 motion 数据。

在线地址：<https://imchong.github.io/Robot_Learning_Sim2Sim_Online/>

## 仓库说明
本仓库在实现上**引用并改造了**以下开源项目源码：
- 上游仓库：<https://github.com/Axellwppr/humanoid-policy-viewer>

当前仓库的主要工作包括：
- 将项目迁移到 `ImChong/Robot_Learning_Sim2Sim_Online`
- 适配 GitHub Pages 部署
- 保留原始网页演示能力，便于后续继续扩展 sim2sim demo

## 快速开始
```bash
npm install
npm run dev
```

## 项目结构
- `src/views/Demo.vue`：演示页面的主要 UI 控件
- `src/simulation/main.js`：MuJoCo、Three.js 渲染与 policy loop 的启动入口
- `src/simulation/mujocoUtils.js`：场景 / policy 加载工具与 MuJoCo 文件预加载逻辑
- `src/simulation/policyRunner.js`：ONNX 推理封装与 observation 管线
- `node_modules/mujoco-js/`：MuJoCo wasm 运行时（npm 包）
- `scripts/vite-plugin-mujoco-wasm.mjs`：构建时把 mujoco-js 内嵌的 base64 wasm 抽成独立 `.wasm` 并去掉调试段，运行时由 `src/simulation/loadMujoco.js` 流式加载
- `scripts/vite-plugin-scene-mesh-gzip.mjs`：构建时为 STL 网格生成 `.gz` 副本（GitHub Pages 不压缩 STL），加载器优先下载并解压
- `src/plugins/mdiIcons.js`：界面用到的 MDI 图标（内联 SVG），新增 `mdi-*` 图标需在此登记
- `public/examples/scenes/`：放置 MJCF 文件与 mesh 资源，运行时会预加载到 MuJoCo 的 MEMFS
- `public/examples/checkpoints/`：放置 policy 配置 JSON、ONNX 模型与 motion 数据

## 如何接入你自己的机器人、Policy 和 Motion
### 1）添加机器人 MJCF 与资源文件
- 新建目录：`public/examples/scenes/<robot>/`
- 将 MJCF 文件放到：`public/examples/scenes/<robot>/<robot>.xml`
- 将该 MJCF 依赖的 mesh / texture 一并放到同目录
- 把所有文件路径追加到 `public/examples/scenes/files.json`，这样加载器才能在 wasm 文件系统中预加载到 `/working/`
- 多个场景共用同一套网格时，把这些 XML 放在同一目录并使用相同的 `meshdir`（例如 `g1_amp/scene_g1.xml` 与 `g1_amp/g1_tracking.xml`）：MuJoCo 按文件路径缓存网格编译结果，路径相同才能在策略切换时复用下载和编译

### 2）添加 policy 配置与 ONNX 模型
- 新建：`public/examples/checkpoints/<robot>/tracking_policy.json`
- 将 Tracking ONNX 放到子目录，例如：`public/examples/checkpoints/<robot>/tracking/policy_latest.onnx`
- AMP 类策略同理放到独立子目录，例如：`public/examples/checkpoints/<robot>/walk_run_getup/model_60000.onnx`
- 确认 JSON 中以下字段正确：
  - `onnx.path` 指向正确的 ONNX 文件，例如 `./examples/checkpoints/<robot>/tracking/policy_latest.onnx`
  - `policy_joint_names` 与 MJCF actuator 中的关节名一致
  - `obs_config` 中使用的 observation 名称已在 `src/simulation/observationHelpers.js` 中实现
  - `action_scale`、`stiffness`、`damping`、`default_joint_pos` 的长度与 `policy_joint_names` 一致
- 如果你的 observation 设计与当前默认实现不同，需要同步修改：
  - `src/simulation/observationHelpers.js`
  - `src/simulation/policyRunner.js`

### 3）可选：添加 tracking motion
- 新建索引文件：`public/examples/checkpoints/<robot>/motions.json`
- 将每段 motion clip 放到：`public/examples/checkpoints/<robot>/motions/`
- 在 `tracking_policy.json` 中，把 `tracking.motions_path` 指向该索引文件
- policy 加载时会自动下载索引中列出的全部 motion 文件
- `motions.json` 建议包含：
  - `format`：`tracking-motion-index-v1`
  - `base_path`：motion 文件夹相对路径，例如 `./motions`
  - `motions`：`{ name, file }` 列表
- 每个 motion 文件至少应包含：
  - `joint_pos` 或 `jointPos`
  - `root_pos` 或 `rootPos`
  - `root_quat` 或 `rootQuat`（顺序为 `w, x, y, z`）

### 4）将应用指向你的机器人与 policy
更新 `src/simulation/main.js` 中的默认路径：
- `this.currentPolicyPath = './examples/checkpoints/<robot>/tracking_policy.json'`
- `await this.reloadScene('<robot>/<robot>.xml')`
- `await this.reloadPolicy('./examples/checkpoints/<robot>/tracking_policy.json')`

如果你希望同时保留多个机器人，也可以在 `src/views/Demo.vue` 中增加切换器，并调用：
- `demo.reloadScene(...)`
- `demo.reloadPolicy(...)`

当前控制面板的 Policy 下拉栏已接入 [Microduck](https://github.com/pollen-robotics/microduck) 的 sim2sim 策略，但它默认是隐藏项：只有用带解锁指令的网址打开页面（`https://<站点>/?unlock=microduck`，也支持 `#unlock=microduck`）时才会出现在下拉栏里，解锁状态记在 `sessionStorage`，当前标签页内重载页面依然有效。解锁后下拉栏里 Microduck 只有一个选项，选中后由控制面板内的状态机按钮切换行走 / 站立 / 坐下起立 / 前滚翻四种状态（前滚翻结束后自动回到行走）。四个状态共用 `microduck/scene.xml` 与 61 维观测合同，切换时只热替换 ONNX，与 G1 AMP / Tracking 的 `switchSceneAndPolicy` 路径相同。Microduck 同样复用 AMP 的摇杆：摇杆按 Microduck 的速度上限输出行走指令，摇杆左侧另有一组同样的状态机按钮（坐下/站起状态下再按一次即翻转姿态）。

![Microduck 状态机控制面板](docs/screenshots/microduck-state-machine-panel.png)

## 部署说明
本仓库已经接入 GitHub Pages，推送到 `main` 分支后会通过 GitHub Actions 自动构建并部署。

---

## 📅 计划与待办
关于项目的后续开发计划、键盘控制功能实现以及机器人强化学习训练的学习路径，请查看：
👉 [**TODO.md**](./TODO.md)

