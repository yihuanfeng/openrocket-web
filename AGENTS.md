# AGENTS.md — OpenRocket Web 重构项目协作说明

本文件面向参与本项目的 AI 代理（以及需要快速上手的人类协作者），说明项目目标、技术结构、关键约定、验证方式和当前状态。**先读本文件再动手**，避免重复踩坑或偏离既定方向。

---

## 1. 项目目标

把 OpenRocket（Java 火箭模拟器）重构为 **Vue3 + TypeScript 纯前端 Web 版**（`openrocket-web/`）。当前已实现的完整主线：

- 2D / 3D 火箭视图（横竖两种摆放、真实比例、剖视/实体、视角预设；尾翼按梯形/椭圆/自由/管翼四种外形渲染）
- 组件树 / 组件库 / 属性面板（增删改、轴向调整、半径继承）
- 组件全覆盖：级 / 助推器（并联级）/ 捆绑舱 / 头锥 / 机身管 / 过渡段 / 梯形·椭圆·自由·管尾翼 / 发射导环 / 导轨按钮 / 内部件（内管·管接头·定心环·隔框·挡块）/ 回收（伞·飘带·减震绳）/ 配重 —— 全部可创建，无"即将支持"
- 示例面板（6 个内置示例 + 16 个官方 .ork 示例，带缩略图）
- 发动机配置（26 款内置发动机 + .eng 导入）
- 仿真（JS 引擎：分析 + 2DOF 飞行仿真，发动机延迟扫描、多发动机对比）
- 设置面板（主布局切换、单位、外观[待开发]）
- UI：高饱和蓝主调、直线切分、紧凑

硬约束：**不使用本地 Java 兜底**（不依赖 openrocket Java 运行时）；官方语义/数据以 OpenRocket 官方仓库与 docs 为准。

## 2. 目录结构

```
/Users/cindy/work/openrocket          # git 仓库根（当前无远端）
├── openrocket-web/                    # Vue3+TS 前端（主开发目录）
│   ├── src/lib/                       # 核心逻辑（见 §3）
│   ├── src/components/                # UI 组件
│   ├── public/ork-assets/             # 官方素材（示例 .ork 16 个、缩略图、组件库 .orc、logo、wasm）
│   └── scripts/gen-thumbs.ts          # 缩略图批量生成脚本
├── docs/                              # 项目文档（重构规划、WASM 可行性报告、素材清单）
├── README.md                          # 项目介绍与快速开始
├── .github/workflows/deploy.yml       # GitHub Pages 自动部署
└── AGENTS.md                          # 本文件
```

> 仓库瘦身说明（2026-10-03）：已删除官方 Java 源码 `openrocket/`（约 745M，素材已全部入库 `public/ork-assets/`，需要时从 https://github.com/openrocket/openrocket 重新 clone）、WASM 实验工具链 `tools/`（JDK/Maven，约 479M，本地 Java 方案已弃用）、WASM 可行性 PoC `phase0-poc/`（编译产物已入库 `public/wasm/`）、`node_modules/` 与 `dist/`（可分别用 `npm ci` / `npm run build` 重建）。仓库总体积 1.4G → 21M → 12M。

## 3. 前端架构要点（改代码前必读）

### 数据与几何（`src/lib/`）

- `types.ts` — `RocketComponent` / `RocketModel` 结构定义。
- `geometry.ts` — **核心几何引擎** `layoutRocket(root)`：把组件树展开为 `GeoSeg[]`（每段含 z0/z1/r0/r1/depth）。轴向语义对齐官方（见 §5），半径继承：同 stage 无显式半径直系组件继承前一身体组件半径。**并联级**：boosters/pods 为并行容器（不产生自身段），其子级自鼻端布局并带 `xOff` 侧向偏移（主级最大半径 + 2mm 间隙，多个并联体依次右排）。
- `componentFactory.ts` — `makeComponent(type, params)`：按类型构造组件；`ComponentParams` 支持 `axialOffset` / `axialMethod`（'after' 等）。已覆盖全部官方组件类型（含 stage/boosters/pods/railbutton/tubefinset）。
- `presets.ts` — 6 个内置示例；`makeFin()` 辅助函数 = 尾翼根部覆盖管尾（AFTER + 负偏移，等效官方 BOTTOM）。
- `engines.ts` — 26 款内置发动机（Estes 全系，规格来自 Estes Engine Chart + ThrustCurve 认证值）；`parseEngFile()` 支持用户导入 .eng。
- `orkParser.ts` — 解析官方 .ork（ZIP，内部 JSZip 解压，node 环境需注入 `@xmldom/xmldom` 的 DOMParser）。
- `jsEngine.ts` / `wasmEngine.ts` — 仿真引擎（JS 为主；wasm 为备选，浏览器不支持 WebAssembly GC 时自动降级）。
- `designSerializer.ts` — RocketModel → 官方 design 动作序列。
- `orkSerializer.ts` / `rktParser.ts` — .ork 序列化 / Rocksim .rkt 解析。
- `materials.ts` — 材料数据（密度等）。
- `thumbPath.ts` — 缩略图几何（与 geometry.ts 共用 layoutRocket）。

### 视图组件

- `RocketView2D.vue` — SVG 侧视图（竖=鼻锥朝上，横=鼻锥朝左），真实长径比；PX=420/view.height；组件悬浮信息、CG/CP 标记 tooltip。
- `RocketView3D.vue` — Canvas 2D 投影渲染（三角面 + 深度排序 + 光照），带程序化材质纹理（碳纤维/金属拉丝/玻纤光泽/布料网格，`MAT_MAP`）；视角预设（等距/正视/侧视/顶视）；CG/CP 标记命中检测 tooltip。
- `ExamplesPanel.vue` / `PropertyPanel.vue` / `ComponentLibrary.vue` / `SimulationPanel.vue` / `MotorConfigPanel.vue` — 功能面板。

### 持久化（localStorage 键）

`ork:layout`('v'|'h')、`ork:workW/H`、`ork:leftW`/`ork:rightW`（左右栏宽）、`ork:mcpLeftW`（发动机面板左列宽）、`ork:unit`('m'|'mm'|'cm')、`ork:autosave:v1`、`ork:orient`('vertical'|'horizontal')。

## 4. 常用命令（在 `openrocket-web/` 下执行）

```bash
npm ci             # 安装依赖（node_modules 已从仓库清理，首次/恢复时执行）
npm run dev        # 开发模式（热更新，默认 5173）
npm run build      # vue-tsc -b && vite build —— **TS6133 未使用变量会阻断构建**；产物 dist/
npm run preview    # 生产预览（伺服 dist/，默认 4173）
npm run gen:thumbs # 重生成示例缩略图（改 presets/geometry 后必须重跑）
```

## 5. 官方轴向语义锚点（已核实源码，勿重查）

- TOP/ABSOLUTE：pos = offset
- AFTER（无 axialoffset 元素）：pos = 前一组件尾端 + offset
- MIDDLE：pos = offset + (outerLen - innerLen)/2
- BOTTOM：pos = offset + (outerLen - innerLen)
- 官方尾翼 = bodytube 子组件 + `method="bottom"`（根部对齐管底、覆盖管尾段）
- 官方伞/飘带 = bodytube 子组件 + 显式 offset（管内前段"回收舱"），**不是** stage 直系吊在尾部

## 6. 验证约定

- **改完必须 `npm run build` 通过**（vue-tsc 类型检查）。
- 几何/布局核验（node 侧）：`npx esbuild src/lib/presets.ts --bundle --format=esm --outfile=/tmp/presets_bundle.mjs`（geometry/engines 同法），node 直跑 `layoutRocket()` dump 段数据（z0/z1/r0/r1）核对位置。
- 浏览器核验（CDP）：Chrome headless `--remote-debugging-port=9224 --user-data-dir=/tmp/cdp-profile`，手写 `/tmp/verify_*.mjs`（Runtime.evaluate + Input.dispatchMouseEvent）。**页面改码后必须 reload 才加载新 bundle**。
- **优先数据/bbox 核验，不靠截图交付**（用户明确要求）。
- 官方示例 .ork 是 ZIP：parseOrk 收 ArrayBuffer，返回 `{root,...}` 需取 `.root`。

## 7. 协作约定（用户强约束，违背即返工）

- 禁用「最终 / 完美 / 无错」等夸张词；回复客观、有依据。
- **指令严格全量执行**：不擅自缩小范围、不改指令、不"乱搞东西"。
- UI：高饱和蓝主调、直线切分（不要大圆角）、紧凑；设置面板居中、左侧 tabs。
- 官方数据/语义以 `openrocket/` 源码与官方 docs 为准；质量近似值必须标注来源与口径。
- 资源借用：官方 .ork / 图标 / 发动机规格已入库；**不要向仓库外添加虚构素材**。

## 8. 当前状态与待办

### 已完成（近期主线）

- 尾翼轴向：makeFin 全覆盖管尾（6 内置示例全部对齐）
- 尾翼外形：2D/3D 按梯形（多边形）/椭圆（Q 曲线）/自由（点序列剪式）/管翼（矩形）四种外形渲染
- 组件全覆盖：boosters/pods 并联级布局（GeoSeg.xOff）、railbutton、tubefinset 全部可创建，组件库无"即将支持"
- 发动机库 8 → 26 款（A3/A8/B4/B6/C6/C11/D12/E9/E12/F15 各延迟变体），D12 直径修正为 24mm
- 伞/飘带回归机身管内前段（bodytube 子组件 + offset）
- 3D 部件程序化材质纹理（碳纤维/拉丝/玻纤/布料）
- CG/CP 标记 tooltip（2D SVG + 3D Canvas 命中检测）
- GitHub Pages 自动部署 workflow（已提交，**待用户 push + 在仓库 Settings→Pages 开启 GitHub Actions**）
- 资源全部改为 BASE_URL 相对路径（子路径部署不 404；组件图标已修复）

### 待办（按优先级）

1. **GH Pages 上线**：用户 push 仓库到 GitHub + 开启 Pages（Actions 源）
2. 官方 `.orc` 组件预设库解析集成（已入库 `public/ork-assets/component-db/`：Estes 经典、Semroc、BMS 等 10+ 厂商真实在售部件，做成"预设部件库"）
3. 工程级/高发比示例的内部件树结构梳理（内部件应挂 bodytube 下而非 stage 直系，当前导致尾部组件略偏后）
4. 设置面板「外观」tab
5. 官方材质库（材料数据）借用
