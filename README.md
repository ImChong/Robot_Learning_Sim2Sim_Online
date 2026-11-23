# Robot_Learning_Sim2Sim_Online

在线机器人策略 Sim2Sim 仿真 / Browser-based robot policy Sim2Sim demo.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen?logo=github)](https://imchong.github.io/Robot_Learning_Sim2Sim_Online/)
[![Deploy to GitHub Pages](https://github.com/ImChong/Robot_Learning_Sim2Sim_Online/actions/workflows/deploy.yml/badge.svg)](https://github.com/ImChong/Robot_Learning_Sim2Sim_Online/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[**在线体验 / Live Demo**](https://imchong.github.io/Robot_Learning_Sim2Sim_Online/)

在浏览器中通过 **MuJoCo WebAssembly + ONNX Runtime** 加载机器人场景与策略，实时运行、控制并可视化人形机器人动作。支持 G1 示例策略与动作数据，以及自定义 MJCF、ONNX Policy 和 Motion。

Run and visualize robot policies directly in your browser with **MuJoCo WASM + ONNX Runtime** — no backend required.

```bash
npm install
npm run dev
```

基于 [humanoid-policy-viewer](https://github.com/Axellwppr/humanoid-policy-viewer) 改造 · [开发计划 / TODO](TODO.md) · [MIT License](LICENSE)
