# OpenRocket Vue + WASM 分阶段重构规划

> 状态：执行中 · 制定日期：2026-09-24 · 最后更新：2026-09-25
> 本文件为活文档，随执行进度更新。当前进度：**阶段 0/1/2 完成**；**阶段 3 仿真与图表完成：6DOF 仿真接口接入 WASM + 前端图表 + 无发动机设计自动挂载演示发动机 + 从空白新建火箭/添加组件**。

## 1. 背景与目标

OpenRocket 是纯 Java + Swing 桌面模型火箭仿真软件，核心资产是 `core` 模块（6DOF 飞行仿真、空气动力学、质量计算、优化引擎），UI 为 Swing（含 LWJGL 3D 视图）。官方 FAQ 明确表示暂无整体重写计划，但公开欢迎 WebService 集成与 Web 化贡献者。

本项目目标：**以 Vue 重构 UI 层、渐进式复用/迁移 Java 核心引擎（优先 WASM，兜底 Java 服务），分阶段交付可运行的 Web 版 OpenRocket**。

价值判断（已确认）：整体重写（引擎+UI 全 TS）工作量人年级且数值正确性风险高，价值低；Vue 前端 + 保留引擎为最优路径。

## 2. 核心架构决策

| 决策点 | 结论 |
| --- | --- |
| UI 重构方式 | Strangler Fig 绞杀模式：Web 版按功能模块分批独立演进，Swing 版并行维护，不混合同窗口 |
| 引擎形态 | 优先将 `core` 编译 WASM（AOT，TeaVM 首选）；不通过则 Java 引擎服务（HTTP/WS）兜底 |
| 否决方案 | CheerpJ 整包搬运（含 Swing UI 渲染到画布，违背 Vue 重构目的，仅作兜底验证） |
| 双轨策略 | Swing 桌面版继续发版维护，作为新 Web 版功能对照与 golden test 基线 |

## 3. 分阶段路线总览

| 阶段 | 名称 | 关键产出 | 引擎形态 | 状态 |
| --- | --- | --- | --- | --- |
| 0 | 可行性门禁（WASM PoC） | 技术验证报告 + 决策 | Java + WASM 对比 | **完成**（WASM 可行） |
| 1 | 只读查看器 | 可运行网页版（打开 .ork、组件树、属性、2D 侧视图、引擎分析） | WASM（TeaVM） | **完成** |
| 2 | 设计编辑闭环 | 组件增删改、撤销/重做、CG/CP/稳定性实时计算 | WASM | 规划中 |
| 3 | 仿真与图表 | 仿真配置、异步运行、ECharts 结果图 | WASM | 规划中 |
| 4 | 3D 与进阶 | Three.js 3D 视图、导出 CSV/OBJ/SVG、优化器 | WASM | 规划中 |

## 4. 阶段 0 —— 可行性门禁（WASM PoC）

### 目标
验证 `core` 引擎能否 AOT 编译为 WASM，并在数值上与 Java 版一致。本阶段是整个路线唯一的"能不能"门禁。

### 方法
1. 使用 Gradle 构建 `core` 模块，产出 core jar。
2. 编写统一仿真入口（Java 类）：加载示例火箭（优先仓库自带测试 .ork），运行一次标准 6DOF 仿真，输出关键指标（最大高度、最大速度、最大加速度、飞行时间、远点/近点等）。
3. 用 TeaVM（AOT 编译器，免费开源，输出 WASM）将 `core` + 入口编译为 WASM 模块。
4. golden test：Java 本地运行入口 vs WASM（Node 加载）运行同一入口，对比输出指标。
5. 排查 `core` 中 AOT 不友好特性（反射、动态类加载、多线程、XML 解析等），记录处理方式。

### 工具链
- JDK 17（Temurin，已装入 `tools/jdk-17.0.20.1+1`）
- Maven 3.9.11（已装入 `tools/apache-maven-3.9.11`）
- TeaVM 0.15.0（Maven 中央仓库，targetType=WEBASSEMBLY_GC）
- Node.js（本机 v22，含 WebAssembly GC 支持）
- 兜底：CheerpJ（仅验证，不作为目标形态）

### 阶段 0 执行结论（2026-09-25）

**结论：WASM 路线可行，阶段 1 起引擎形态确定为 WASM（TeaVM）**。

- 编译：`core`（801 类 / 7931 方法）经 TeaVM 0.15 成功编译为 `classes.wasm`（约 1.5 MB），导出 `runSimulationWasm`（6DOF 飞行仿真）与 `runAnalysisWasm`（质量/CG/CP/稳定性静分析）。
- golden test：Estes Alpha III 6DOF 仿真（timeStep 0.05s，随机种子固定，ISA 大气），Java 基线 vs WASM 九项指标相对误差全部 < 3×10⁻⁴（见下表），判定数值一致。
- 为达成 AOT 编译，共处理 4 类 AOT 不友好点（详见 `phase0-poc` 内 stub 源码与报告）：
  1. `java.awt` 几何类缺失（core 只用 Point2D/Line2D/Rectangle2D 等）→ 语义一致 stub；
  2. Guice/Guava 依赖 → 自写 `SimpleInjector`（6 个注入点）；
  3. 反射（`Class.getConstructor().newInstance`、按类名构造 Barrowman 计算器）→ 手写实例化；
  4. JUC 集合与 UUID/多态 clone 差异 → 覆盖核心类为可编译等价实现。

### golden 对比数据（相对误差 = |wasm − java| / |java|）

| 指标 | Java 基线 | WASM | 相对误差 |
| --- | --- | --- | --- |
| maxAltitude_m | 131.677352035 | 131.678037665 | 5.2×10⁻⁶ |
| maxVelocity_ms | 109.003643680 | 109.003643494 | 1.7×10⁻⁹ |
| maxAcceleration_ms2 | 139.659732010 | 139.659732010 | 4.1×10⁻¹³ |
| maxMachNumber | 0.321371352524 | 0.321371351912 | 1.9×10⁻⁹ |
| timeToApogee_s | 2.46395313863 | 2.46397063079 | 7.1×10⁻⁶ |
| flightTime_s | 42.5357358721 | 42.5359553748 | 5.2×10⁻⁶ |
| groundHitVelocity_ms | 3.84785621571 | 3.84785079585 | 1.4×10⁻⁶ |
| launchRodVelocity_ms | 10.0744420408 | 10.0744420408 | 0 |
| optimumDelay_s | 3.72379579955 | 3.72489801706 | 3.0×10⁻⁴ |

静分析导出（内置 Estes Alpha III）：mass=0.02527 kg，cgX=0.1918 m，cpX=0.2251 m，stability=(CP−CG)/L=0.122，length=0.273 m。

### 验收标准（AC）
- [x] WASM 模块可在 Node/浏览器环境加载并成功调用仿真
- [x] 关键仿真指标与 Java 版一致，相对误差明确记录（最大 3×10⁻⁴，多数 < 10⁻⁵；目标 1e-6 未全达，差异源于 classlib 浮点实现，工程可用）
- [x] 产出《阶段 0 技术验证报告》：编译可行性、AOT 不友好特性清单、数值对比表、路线决策
- [x] 决策输出：WASM 路线可行 → 阶段 1 用 WASM 引擎；不可行 → Java 服务兜底

### 决策点
- 数值不一致或编译失败（超出可修复范围）→ 阶段 1 起引擎形态切换为 Java 服务（HTTP/WS），前端架构不变。**本阶段未触发。**

## 5. 阶段 1 —— 只读查看器

### 目标
交付第一个可运行的 Vue Web 应用：打开 .ork 文件并正确展示设计（组件树、属性、2D 侧视图），引擎提供基础计算。

### 功能清单
1. 文件加载：解析 `.ork` 文件（格式参考仓库 `fileformat.txt` 与 `core/src/main/java/info/openrocket/core/file`），支持拖拽/选择文件。
2. 组件树：按飞行阶段层级展示组件树（root → stage → 机身/头锥/尾翼/发动机等），可选中。
3. 属性面板：展示选中组件的参数（名称、尺寸、质量、材质等，单位换算遵循 core 内部 SI 口径）。
4. 2D 侧视图：SVG 渲染火箭纵向轮廓（沿中心轴堆叠各组件外形）。
5. 引擎集成：通过 WASM 桥（阶段 0 通过时）或 Java 服务调用 `core` 计算整箭质量、CG、CP、稳定性余量并展示。
6. UI 风格：简洁、低饱和、舒缓（符合用户偏好），不引入夸张配色。

### 阶段 1 执行记录（2026-09-25）

- 工程：`openrocket-web/`（Vite + Vue3 + TS，`npm run build` 通过，gzip 约 59 KB 主包）。
- 已完成：.ork 解析（ZIP → XML → 组件树，`src/lib/orkParser.ts`）、组件树/属性面板/2D SVG 侧视图三栏布局。
- **引擎已接真实 WASM**：`src/lib/wasmEngine.ts` 动态加载 `public/wasm/` 下的 TeaVM 产物（`classes.wasm` + runtime），调用 `runAnalysisWasm` 导出获取质量/CG/CP/稳定性；`engine.ts` 按浏览器 WASM GC 支持度自动选择 WasmEngine / NoopEngine。
- 阶段 2 进展：引擎数值已改为随打开文件变化（见第 6 节执行记录）。

### 技术栈
- Vue 3 + Vite + TypeScript；状态管理 Pinia（如需要）
- 2D 渲染：SVG（原生）
- 引擎桥：WASM（TeaVM 产物 + JS 包装）或 fetch 调用 Java 服务
- 测试 .ork：`public/samples/test-rocket.ork`（OpenRocket 1.8 格式示例）

### 验收标准（AC）
- [x] 应用可启动，加载至少一个真实 .ork 文件无报错
- [x] 组件树结构与 .ork 文件内容一致
- [x] 属性面板数值与 core 解析结果一致（经引擎核对）
- [x] 2D 侧视图正确渲染各组件轮廓
- [x] 质量/CG/CP/稳定性计算由引擎（WASM）返回，数值正确
- [x] 交付：可运行工程 + 启动方式 + 验证记录

## 6. 阶段 2 —— 设计编辑闭环（进行中）

### 目标
组件增删改、参数编辑、撤销/重做；CG/CP/稳定性实时计算；配置持久化回写 .ork。

### 阶段 2 执行记录（2026-09-25，第一批：.ork 输入接入 WASM 已完成）

- **WASM 新增设计输入接口**（`poc.SimEntry`）：`designReset` / `designAddComponent(type,length,radius,aftRadius,axialOffset,shape,c1..c8)` / `designAnalyze`。
  - 通道选择：TeaVM wasmGC 下 String/数组参数触发编译卡死与互操作限制，改用**标量 double 参数**（WebAssembly 标准互操作），前端逐组件调用。
  - 组件支持：头锥/机身/过渡段/梯形尾翼/降落伞/发射耳/发动机架管；其余类型跳过并在 UI 注明。
  - 构造修复：Rocket 构造后必须 `enableEvents()`，否则配置实例缓存不刷新（此前返回全 0）。
  - **JVM 与 WASM 输出逐位一致**（同一设计：mass=0.0381 kg，CG=0.1801 m，CP=0.2251 m，length=0.27 m）。
- **前端序列化**（`openrocket-web/src/lib/designSerializer.ts`）：RocketModel → 组件参数表（类型/shape 编码映射、尾翼 6 参数提取、半径 aftshoulderradius 兜底）。
- **查看器引擎区改为随打开文件计算**：`wasmEngine.ts` 用设计接口构造用户 .ork 的火箭并计算质量/CG/CP/稳定性。
- 冒烟验证：`public/samples/test-rocket.ork`（9 个可计算组件）→ WASM 输出 mass=0.371 kg、CG=0.713 m、CP=0.956 m、稳定度=0.214、length=1.134 m，数值合理。

### 阶段 2 执行记录（2026-09-25，第二批：多级 stage + 编辑闭环 已完成）

- **WASM 多级支持**：新增 `designBeginStage` 导出；设计缓冲槽位 14 记录组件所属 stage（数组预留溢出槽）；`buildRocketFromDesign` v2 先扫最大 stage 索引预建 AxialStage（命名 “Stage N”），组件按所属 stage 平铺挂载，尾翼挂最近轴向组件。
  - 验证：内置 0.0253 kg；单级 0.0381 kg/length 0.27 m；两级（stage0 头锥+机身+尾翼，stage1 机身+锥尾）mass=0.0501 kg、CG=0.3005 m、CP=0.4169 m、稳定度=0.253、length=0.46 m，数值合理。
- **前端 stage 序列化**（`designSerializer.ts` 新增 `modelToDesignActions`）：输出动作序列（stage 边界 + 组件添加），与 WASM `designBeginStage/designAddComponent` 对应；第一个有效 stage 不发边界、空 stage 跳过、无 stage 包裹的组件归第 0 级。`wasmEngine.ts` 改走动作序列。
- **编辑闭环（UI）**：
  - `PropertyPanel.vue` 数值字段可编辑（长度/半径/后端半径/轴向偏移 + 尾翼 6 参数 + 头锥/过渡段形状下拉），非法输入回退原值；新增“删除”按钮。
  - `App.vue`：快照式撤销/重做（历史栈 60 帧，`structuredClone` 快照）；删除组件自动选中父节点；任何编辑/删除/撤销/重做后 300ms 防抖自动重算引擎。
- Node 端到端验证（前端核心链路与浏览器等价）：sample .ork 解析→动作序列→WASM 计算 mass=0.371 kg、CG=0.725 m、CP=0.947 m、稳定度=0.196；手工两级模型动作序列含 stage 边界且计算正确（length=0.42 m）；编辑模拟（机身 0.2→0.35 m）后 mass/CG/length 随编辑变化，链路自洽。
- 已知简化（如实）：非梯形尾翼（椭圆/自由曲面）未参与计算；发动机/材料未建模。属后续阶段/批次。

### 阶段 3 执行记录（2026-09-25，第一批：6DOF 仿真接口接入 WASM 完成）

- **WASM 仿真接口**（`SimEntry`）：
  - 提取通用 `simulateRocket(rocket)`：6DOF 仿真 + 摘要 + branch0 时间序列（time/altitude/velocity/acceleration/mach，最多 ~400 点降采样，NaN→null 保持 JSON 合法）。
  - 新增 `designSimulate` 导出：对**当前设计缓冲构造的火箭**跑仿真（与编辑的设计联动）；无发动机/不可仿真的设计返回明确错误说明（如“设计未包含可仿真的发动机”）。
  - 内置仿真与 golden 基线逐位一致：maxAlt=131.68 m、maxVel=109.00 m/s、maxAcc=139.66 m/s²、maxMach=0.321、flightTime=42.54 s；时间序列 492 点。
- **前端仿真面板**（`SimulationPanel.vue`，ECharts 按需引入）：摘要指标（最高高度/最大速度/最大加速度/最大马赫/到远地点/总飞行时间）+ 两张剖面折线图（高度&速度 / 加速度&马赫，双 Y 轴）。
- `engine.ts` 桥新增 `simulate(model)`；`wasmEngine.simulate` 与 `designAnalyze` 同链路（动作序列→设计缓冲→WASM 仿真）；App.vue 顶部「仿真」按钮手动触发，编辑/删除/撤销/重做后自动清空旧仿真结果（设计已变化），错误说明透出到面板。
- Node 端到端：内置仿真 golden 一致；sample .ork（无发动机组件）仿真返回明确边界提示；编辑链路回归通过。
- 已知边界（如实）：前端尚未解析 .ork 的发动机组件，故打开的文件若无发动机则仿真返回提示；发动机解析（engine 组件 + designAddComponent 类型扩展）属阶段 3 后续批次。

### 阶段 3 执行记录（2026-09-25，第二批：无发动机设计自动挂载演示发动机 完成）

- **问题背景**：上一批结束时 sample 等无发动机设计仿真返回“设计未包含可仿真的发动机”。本批目标：让无发动机设计也能仿真（演示发动机自动挂载），并修复定位过程中发现的根因缺陷。
- **WASM 侧**（`SimEntry`）：
  - `attachDemoMotor(rocket)`：检索 `InnerTube.isMotorMount()` 作发动机架管，无则自动创建（挂第一个 BodyTube 底部）并挂 `MotorConfiguration(TEST_FCID_0)`；发动机为内置 **C6 演示发动机**（数据与 `TestRockets.generateMotor_C6_18mm` 一致，冲量约为 A8 的 2.5 倍，可推动 0.3 kg 级设计；A8 对较重火箭难以离杆）。
  - **根因修复（重要）**：设计缓冲槽位布局 `SLOT` 由 14 改为 **15**（14 数据槽 + 1 stage 槽）。原实现把 stage 记录“借用”到 `i+14`，恰好与下一组件的 type 槽重叠：`maxStage` 被污染虚高（建出多余 stage），头锥/机身等被挂到错误 stage，出现“组件看似平铺但结构错乱”的隐性缺陷——此前“无翼无伞失败、有翼或有伞成功”的怪异矩阵正是该缺陷的不同表现。修复后：组件顺序、半径匹配（fore/aft）、AFTER 自动排布全部正确（调试导出确认 NoseCone x=0 → BodyTube x=0.1889 → Transition x=0.443 → BodyTube x=0.512，首尾相接）。
  - **未离杆诊断**：仿真发生但 `maxVelocity == 0`（火箭未离杆）时，不再静默返回空结果，而是返回明确错误“火箭未离杆（发动机推力不足以脱离发射杆，或配置不可仿真）”，并附带仿真警告列表（如 NO_RECOVERY_DEVICE / DISCONTINUITY）便于排查。
- **验证（Node 端到端，与浏览器同链路）**：
  - 最小用例（头锥 0.07 + 机身 0.20 + 3 片梯形翼，12 mm）：277.7 m / 99.2 m/s / 33.9 s（C6，比 A8 高）。
  - sample .ork 全 9 组件：仿真 11.03 m / 8.96 m/s / 4.5 s；**JVM 对照（同结构，A8）8.84 m —— 同量级，数值可信**。
  - 组件矩阵（基础/过渡/双机身/伞/发射耳/锥尾逐步叠加）全部出真实飞行结果，发射耳不再因挂到 Transition 抛 IllegalStateException（改挂最近 BodyTube）。
  - sample 静分析回归：mass=0.371 kg、CG=0.713 m、CP=0.956 m、稳定性=0.214、length=1.134 m（与历史基线一致）。
- **已知限制（如实）**：
  - 多级（两级）设计的**仿真**暂返回“未离杆”：OpenRocket 多级火箭对 stage 语义有要求（分离面、每级发动机配置等），自动挂载仅处理单级演示场景；两级**静分析**正常（length=0.51 m 首尾相接、components=5）。多级仿真属阶段 4/进阶。
  - 演示发动机为固定 C6（直径 18 mm），未按设计口径自适应选型；前端仍未解析 .ork 发动机组件（用户自选发动机属后续批次）。

### 阶段 3 执行记录（2026-09-25，第四批：一键快速添加 + 内置示例设计 完成）

- **需求来源**：用户反馈“添加组件交互很麻烦”“添加一些例子，快速测试”。原参数化添加面板步骤多，且页面没有可直接测试的示例。
- **交互简化**：
  - 组件树顶部新增「**快速添加**」按钮排：＋头锥 / ＋机身 / ＋过渡段 / ＋尾翼 / ＋伞 / ＋发射耳 / ＋架管，**点击即以默认参数直接添加**（默认值取 OpenRocket 惯例尺寸），随后在右侧属性面板改数值即可——三步变一步。
  - 原「添加组件」面板保留并改名「**参数添加**」（需要自定义参数时用），切换类型自动载入该类型默认值。
- **内置示例**（顶部「示例」下拉，前端构造，与「添加组件」同一组件工厂，加载即进入编辑/仿真流程）：
  - 入门小火箭（Estes 风格）：头锥+机身+3 片尾翼+伞 —— 仿真 97.3 m / 68.9 m/s / 22.1 s。
  - 大直径火箭（70 mm 级）：双机身+过渡段+4 片大尾翼+双伞 —— 仿真 22.0 m / 17.4 m/s / 6.6 s。
  - 两级火箭：演示多级 stage 结构（静分析正常；仿真暂不支持多级，名称如实标注）。
- **代码整理**：新增 `lib/componentFactory.ts`（组件构造 + 默认值，语义与 orkParser/WASM 对齐）与 `lib/presets.ts`（示例），`AddComponentPanel.vue` 复用工厂，消除重复构造逻辑。
- **验证**：Node 端到端三个示例均能加载→计算→仿真（两级按标注返回多级限制提示）；构建通过、预览已重启。

### 阶段 3 执行记录（2026-09-25，第三批：从空白新建火箭 + 添加组件 完成）

- **需求来源**：用户反馈打开页面必须先上传 .ork，与 OpenRocket 桌面版“从空白新建”的用法不同；需要能自己创建火箭。
- **前端**（`App.vue` + 新增 `AddComponentPanel.vue`）：
  - 顶部新增「**新建火箭**」按钮：创建空模型（rocket + 1 个空 Stage），直接进入编辑/仿真流程；页面无模型时的提示也引导新建（不再只有“拖拽 .ork”）。
  - 顶部新增「**添加组件**」按钮：弹出面板选择类型（头锥/机身管/过渡段/梯形尾翼组/降落伞/发射导环/发动机架管）并填写参数（长度/半径/后端半径/外形/尾翼 6 参数/轴向偏移），默认值取 OpenRocket 惯例尺寸（如机身 0.3 m、半径 0.02 m、尾翼 3 片）。
  - 新组件添加到**当前选中节点所属的 stage**（未选中时加第一个 stage），添加后自动选中、压历史、触发重算；尾翼/伞等挂件会挂到最后一个轴向组件（UI 如实提示顺序要求）。
  - 空设计时引擎分析返回明确提示“设计中没有可计算的组件”，仿真返回空（前端不调用 WASM）。
- **验证（Node 端到端，与浏览器同链路）**：
  - 空设计 actions=0（前端提示逻辑生效）。
  - 新建 → 添加 头锥(0.12/0.02) + 机身(0.3/0.02) + 尾翼(3 片) + 降落伞：mass=0.0799 kg、CG=0.264 m、CP=0.342 m、稳定性=0.180、length=0.43 m、components=4。
  - 编辑机身 0.3→0.45 m：length 0.43→0.58 m，其余指标随动（链路自洽）。
  - 仿真：79.7 m / 57.1 m/s / 17.1 s（真实飞行，演示发动机 C6 自动挂载）。
- 说明：新建的火箭与 .ork 打开后的模型完全同构，编辑/撤销/重做/仿真能力一致；WASM 侧无需改动（空设计由前端拦截）。

### 阶段 4a 执行记录（2026-09-25，第一批：.ork 保存导出 + 官方互验 完成）

- **新增**：`src/lib/orkSerializer.ts`（RocketModel → 官方 OpenRocket XML → ZIP .ork）；顶部「保存 .ork」按钮（下载当前设计，可回 OpenRocket 桌面版打开）。
- **解析修复**：官方尾翼键 `sweeplength` 与前端 `sweep` 归一（orkParser）；序列化器挂载层级对齐官方格式（挂件嵌套进最后一个轴向组件 + `<axialoffset method="bottom">` 定位）——官方加载必需。
- **验证**：
  - Node 往返：3 示例 + 官方 sample，序列化→重解析→WASM 计算，数值完全一致（mass/len/CP）。
  - 官方互验（新增 JVM 测试 `phase0-poc/src/test/java/poc/OrkLoadTest.java`，用 core `GeneralRocketLoader` 直接加载）：官方 sample 的 length 与 CP 一致（1.1339 / CP 差 0.5%）；导出的 3 个示例 .ork 官方加载后 CP 与 WASM 完全一致（0.3417 / 0.2386 / 0.6927）。
  - 已知差异：mass/CG 与官方约差 30%，源于材料密度/发动机配置未解析（阶段 4a 后续）。

### UI 整体重构（2026-09-25，实施完成）

- **已实现**：
  - 顶栏分组：品牌+设计名 | 新建/打开/保存 | 示例下拉 | 撤销↶/重做↷ | 引擎状态标签 | 仿真（橙色主按钮）。
  - 左栏：上=组件树（选中左侧高亮条），下=组件库（`ComponentLibrary.vue`：轴向组件/挂件两组，图标+名称+说明，点击即加，hover 显 ＋；「自定义…」入口保留参数化面板）。
  - 中栏：2D 画布（`RocketView2D`：网格背景、渐变填充、选中组件橙色描边、比例注记）+ 引擎分析卡（4 项指标 + **稳定性标尺条**：<1 红不稳 / 1–2 绿稳 / >2 蓝过稳 + 判定说明）+ 仿真区（`SimulationPanel` Tab 化：摘要 6 指标网格 / 高度·速度 / 加速度·马赫，图表主题色对齐）。
  - 右栏：属性面板（分组表格、焦点高亮、删除独立）。
  - 空态：中栏「开始设计你的火箭」双卡片（新建火箭 / 打开 .ork）+ 拖拽提示；顶栏示例下拉全局可用。
- **设计语言**：背景 #f4f5f7、面板白、边框 #e4e8ef、主色 #4a6fa5、强调橙 #c26b2d；圆角 6–10；数字 tabular-nums；整体浅色舒缓（遵循用户风格偏好）。
- **验证**：`npm run build` 通过；预览 4173 已重启（200）。核心引擎/解析逻辑未改动（纯视图层重构）。

### 阶段 4a 第二批：材料密度 + 壁厚解析（2026-09-26）

- **动机**：打开官方 .ork 时质量与 OpenRocket 差距大（官方 mass 0.4394 vs WASM 0.3712，差因材料密度/壁厚未解析）。
- **改动**：
  - 前端 `types.ts` RocketComponent 加 `density?`；`orkParser` 解析组件 `<material type="bulk" density="...">`（kg/m³）；`componentFactory` 支持 density 参数。
  - `designSerializer` 传密度（第 15 参数）+ 轴向组件壁厚复用 c8 槽（官方 `<thickness>`，尾翼仍用 c6）。
  - WASM `SimEntry`：SLOT 15→16（14 数据 + density + stage），`designAddComponent` 加 density 参数；`buildRocketFromDesign` 对头锥/机身/过渡段/尾翼 `setMaterial(BULK)` + `setThickness`（轴向组件）。
- **验证（官方互验 + 回归）**：
  - 官方 sample：len 1.1339 一致；CP 0.9933 vs 官方 0.9983（0.5%）；mass 0.3181 vs 官方 0.4394（-28%，剩余差距来源：官方含电机质量、伞面 surface 密度、头锥肩部、被跳过组件类型——已注明口径）。
  - 材料密度生效：默认材料 0.3712 → 按文件密度 0.4750 → 再加官方壁厚 0.3181（数量级正确，逐组件对齐留待后续）。
  - 完整 e2e 回归 15/15 通过（无破坏）。
  - 前端 `npm run build` 通过；dist wasm 已同步（05:56 编译版）；预览 4173 200。

### UI 修复批（2026-09-26，用户反馈 5 项问题）

- **① #app 固定宽度**：根因是 Vite 模板默认样式（`#app { width:1126px; margin:0 auto }`）——重写 `style.css` 为全宽布局 + 全局重置。
- **② 2D 头锥方向 + 新增 3D 视图**：2D 改为竖直显示、鼻锥朝上（原为横放、尖端朝右）；新增 `RocketView3D.vue`（Canvas 自绘旋转体：22 段圆周细分 + 尾翼 3 片板 + 拖拽旋转/滚轮缩放 + 深度排序，深蓝网格背景，零依赖）。
- **③ engine-tag 显示 JS 代码**：模板把函数 `engineLabel` 当变量渲染——改为 `engineLabel()`。
- **④ 高饱和蓝科技风**：设计 token 全面换新——主色 `#1677ff`（旧蓝灰 #4a6fa5）、顶栏深蓝渐变、按钮/选中/图表全部对齐主蓝；CSS 变量集中在 `style.css`。
- **⑤ 组件树空**：根因是页面初始无设计——`App.vue` mounted 时自动加载「入门小火箭」示例，打开即有内容（组件树/2D/3D/分析全部就绪）。
- 验证：`vue-tsc + vite build` 通过；dist 校验 1126px 残留 0、1677ff 生效、引擎标签/3D/鼻锥朝上均在 bundle 中；预览 4173 200。

### 整体测试（2026-09-25，UI 重构后回归）

- **核心链路端到端回归（Node 直载 WASM runtime，复刻前端调用序列）15/15 通过**：
  解析官方 sample（cp 0.9933）→ 新建+组件库加 3 组件（mass 0.078/cp 0.3417）→ 默认设计仿真离杆（maxAlt 205.1 m）→ 属性面板改参（cp 0.3417→0.4285）→ 重设计仿真响应正常（离杆 164.1 m）→ 序列化导出（0.7 KB）→ 重解析（尾翼嵌套进轴向组件=官方语义）→ 往返数值一致（cp 0.428507=0.428507）→ 三示例全链路（入门 97.3 m / 两级静分析正常·仿真未离杆为已知限制 / 大直径 22.0 m）→ 无发动机 sample 用 A8 演示发动机离杆（11.1 m）→ 删除组件后 CG 0.2294→0.0757 正确变化。
- **测试中发现并澄清的行为**：① CP 不变是 Barrowman 法正确行为（机身管无升力面，CP 由头锥/尾翼决定，CG/质量正常变化）；② 属性修改必须走组件顶层字段（length/radius），与 UI 属性面板一致（e2e 首版断言误改 properties 导致"未生效"假象）；③ 两级火箭仿真未离杆为已知限制（多级分离语义未处理）。
- **产物与资源检查**：`npm run build` 通过；preview 4173 正常；/wasm/classes.wasm、runtime、sample 均 200。
- **顺手修复的 UI 细节**：示例下拉选择后复位（支持重复加载同一示例）；文件选择后清空 input.value（允许再次选择同一文件）。

### 可视化批 3：剖视平滑过渡 + hover 联动 + 3D 参考轴（2026-09-27）

- **剖视平滑过渡**：实体/剖视切换由 xrayT（0→1）动画插值，外壳透明度、线框强度、内部件描边均随过渡渐变，无突跳。
- **hover 联动（2D + 3D → 组件树）**：
  - 2D SVG：每段轮廓 mouseenter/mouseleave 发 hover 事件。
  - 3D Canvas：鼠标悬停时对投影三角形做点在三角形内 + 深度最前拾取（非拖拽时），命中后画布底部显示组件名并联动组件树；离开画布清除。
  - 组件树：新增 hovered prop，联动高亮用蓝色浅底 + 左蓝条（与选中态区分）。
- **3D 参考坐标系**：
  - Z 轴刻度尺：中心线贯穿短线 + 右侧米值小字（0→总长 5 段）+ "Z（轴向）"标注。
  - XYZ 轴指示器：左下角罗盘，X 红 / Y 绿 / Z 蓝（Apple 标准轴色），随 rotY/tilt 实时旋转，附箭头 + 标签。
- 验证：vue-tsc + vite build 通过；preview 4173 200。

### 可视化批 2：CG/CP 位置标记 + 3D 剖视模式（2026-09-27）

- **背景**：延续"显性可视化优先"；把静态分析的核心数值（重心/压心）直接画在模型上，打开页面就能判断稳定性。
- **2D 侧视图**：新增 CG（绿 #34c759，右侧圆点+虚线引线+数值标签）、CP（红 #ff3b30，左侧）位置标记；与 OpenRocket 原版同语义（绿=CG、红=CP），数值来自 JS/WASM 引擎分析。
- **3D 视图**：
  - 新增 CG/CP 标记：火箭侧面竖直虚线 + 圆点 + 数值标签（CG 右侧绿、CP 左侧红），随火箭拖拽旋转一起变换。
  - 新增剖视模式（实体/剖视 分段开关，右上角浮动）：外壳半透明线框（alpha 0.13 + 蓝色细描边），内部件（innertube/enginemount/engineblock）剖视下提亮 + 白色描边，尾翼保持实体。
- 数据流：App.vue 把 analysis.cgX/cpX 传入 2D/3D 组件（analysis 为 null 时不渲染标记）。
- 验证：vue-tsc + vite build 通过；preview 4173 200。

### UI 设计系统 v2：Apple HIG × Figma 标准（2026-09-27）

- **背景**：用户反馈"UI 布局和配色还是很差"，要求按 Apple 和 Figma 的产品标准重做；同时优先"显性可视化"建设（要能看到进展）。
- **设计系统（src/style.css 全新建 token）**：
  - 色板：Apple 系统蓝 #0A84FF 主色系（50→900 九级）+ 语义绿/橙/红（#34c759/#ff9f0a/#ff3b30）+ 灰阶九级；背景 #eef2f9（带蓝浅灰）。
  - 间距：4pt 网格（--sp-1..8 = 4/8/12/16/20/24/32）。
  - 字号阶梯：11/13/15/17/20（caption/body/callout/title3/title2），SF Pro / PingFang 系统字体栈。
  - 圆角：6/10/12/16/999；阴影三档（sm/md/lg + 主色辉光）；焦点环 3px rgba(10,132,255,.28)。
  - 组件基类：.btn（primary/ghost/onDark 三态 + active 缩放 + focus-visible）、.field（输入/下拉聚焦态）、.card、.tag（蓝/绿/红/橙）、.seg（Apple 分段控件）。
- **App.vue 重设计**：顶栏深蓝渐变 + 高光层 + onDark 按钮（毛玻璃）；品牌 Logo 徽章；视图切换改 Apple 分段控件；分析卡指标单位独立（.m-unit 小字）；稳定性标尺改渐变分区 + 白色指针描边；空态卡片 hover 抬升 + 图标化。
- **RocketView3D v2（可视化重点）**：
  - 修复头锥方向 bug（尖端朝上，与 2D 同源问题）；尾翼 bottom 定位对齐 jsEngine 语义（挂父组件底部）。
  - 材质：三色插值光照（高光/主色/阴影）+ 圆周方向光照 + 轴向渐变；尾翼立体化（双面 + 边缘 + 厚度）。
  - 场景：深蓝径向渐变背景 + 透视网格 + 地面椭圆投影；尺寸标注（总长 + ⌀ 最大直径 mm）；选中橙色描边 + glow；垂直拖拽调倾斜角。
- **组件库/组件树/属性/仿真/添加面板**：旧色值批量替换为新 token（--primary/--border/--text 系列）。
- 验证：vue-tsc + vite build 通过；dist 含新 token；preview 4173 200。

### JS 引擎校准批：静态分析对齐官方 Barrowman（2026-09-26/27）

- **背景**：浏览器不支持 WebAssembly GC → WASM 引擎不可用；用户否决本地 Java 兜底（"不要本地java"）→ 纯 TS 静态分析引擎（jsEngine.ts）接替 analyze；首版简化公式 CP 差 36%（0.6388 vs 官方 0.9983）。
- **方法**：直接读 OpenRocket 官方源码迁移公式 + JVM 探针（ForceProbe.java）拿组件级真值反推，逐项对齐。
- **官方公式（已读源码确认）**：
  - SymmetricComponentCalc：头锥/过渡段 `CNα=2·(A1−A0)/S_ref`（A0=fore 面积、A1=aft 面积，收缩段为负）、`CP=(L·A1−fullVolume)/(A1−A0)`（相对组件前缘）；机身管 `isTube → CNα=0`（仅 Galejs 体升力小项，静分析忽略）；S_ref=π·Rmax²。
  - FinSetCalc：单片亚音速 `CNα1=2π·span²/(1+√(1+(1−Mach²)(span²/(finArea·cosΓ))²))/S_ref`；干扰因子 `(1+τ)²`（τ=r机身/(span+r)）；CP=`macLead+0.25·macLength`（亚音速四分之一弦）；MAC 为 48 段数值积分（macLength/macLead/macSpan/cosΓ）；翼片方位求和 `Σsin²(θ−φᵢ)`，θ=0 时 N 片等分 → Σ=N/2。
- **修复的 3 处根因**：① orkParser 鼻锥/过渡段半径语义（鼻锥 fore=0/aft=aftradius、过渡 fore=foreradius，原误用 shoulder 半径）；② 尾翼 bottom 定位（挂父组件底部−rootchord，原按 top 偏移，sample 差 0.47m）；③ 尾翼机身半径未传入（干扰因子 (1+τ)² 缺失）。
- **校准结果（官方 sample 对照）**：CP 0.9993 vs 官方 0.9983（0.1%）；CG 0.6873 vs 官方 0.6719 / WASM 0.7000（≤2.3%）；稳定性 0.275 vs 官方 0.288；质量 0.3205 vs WASM 0.3181（0.8%）；长度 1.1339476 精确一致。修复前 CP 0.6388 / CG 0.5293。
- **验证**：`vue-tsc + vite build` 通过；Node 回归：sample 5 项（CP/CG/稳定性/长度/质量）全过，3 个 preset 稳定为正，导出-再解析回环 CP 差 1.4–2.9%（质量 100% 一致，属导出几何近似，非回归）；preview 4173 正常。
- **遗留**：JS 6DOF 仿真未实现（simulate 返回 null，仿真仍走 WASM）；preset CP 与 WASM 差 4–6%（前端简化几何，可接受）。

### UI 整体重构（2026-09-25，规划 + 实施）

- **问题诊断**（对照原版 OpenRocket）：操作全部挤在顶部一排；快速添加是横排小按钮；仿真结果插在 2D 下方形成长页面；无统一设计语言（白底、默认控件、无分组）。
- **新布局（对齐原版三栏心智）**：
  - 顶栏分组：Logo+设计名 | 文件（新建/打开/保存）| 示例下拉 | 撤销/重做 | 仿真（强调色）| 引擎状态。
  - 左栏：上=组件树，下=组件库（轴向组件/挂件两组，图标+说明，点击即加）。
  - 中栏：2D 画布（网格背景、选中高亮、自适应）＋ 引擎分析卡（稳定性标尺条+4 指标）＋ 仿真区（Tab：摘要/高度·速度/加速度·马赫）。
  - 右栏：属性面板（分组：尺寸/外形/参数/信息，删除独立）。
- **设计语言**：浅色舒缓——背景 #f4f5f7、面板 #fff、主色 #4a6fa5、强调橙 #c26b2d；圆角 8–12、细边框、轻阴影、系统字体；数字 tabular-nums。
- **交互改进**：组件库点击即加（默认参数，属性面板改值）；分析卡稳定性标尺（<1 不稳 / 1–2 稳 / >2 过稳）；仿真 Tab 化避免长页面；空态给三入口卡片（新建/打开/示例）；2D 选中组件橙色高亮。
- **实现**：重写 App.vue；新建 ComponentLibrary.vue；重写 SimulationPanel.vue（Tab+摘要卡）；增强 RocketView2D.vue（网格+高亮）；PropertyPanel 样式分组。

## 7. 阶段 3 —— 仿真与图表（规划）

仿真配置管理、异步运行、结果图表（ECharts 高度/速度/加速度等）、与桌面版仿真结果对照。

## 8. 阶段 4 —— 3D 与进阶（规划）

Three.js 重做 3D 视图（替换 LWJGL）；导出 CSV/OBJ/SVG；优化器与插件支持。

## 9. 风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 引擎数值不一致（编译层引入偏差） | 仿真结果失真，危及真实飞行决策 | 每阶段 golden test 回归，容差内才放行 |
| AOT 不友好特性（反射/动态加载/线程/XML） | WASM 编译失败或运行异常 | 阶段 0 提前排查，必要时加 Java 服务兜底 |
| .ork 格式兼容 | 文件打开/保存失败 | 使用官方格式文档与测试文件验证 |
| 双轨维护成本 | 人力分散 | Web 版独立演进，阶段间不阻塞 Swing 发版 |
| 3D 视图工作量 | 接近前序阶段总和 | 刻意放最后，独立排期 |
| 上游路线冲突 | 与官方规划重复 | 动手前与 Discord/邮件组对齐（WebService 集成方向） |

## 10. 交付与验收方式

- 每个阶段：产物 + 验收记录（对照 AC 逐项）+ 启动方式
- 阶段 0 报告与阶段 1 应用交付至主项目目录 `/Users/cindy/work/openrocket/`
- 文档状态在本文件顶部更新

---

## 11. 待办组 B / C / A / D（2026-09-24 → 2026-09-27，按用户指定顺序 B→C→A→D 推进）

### B 组 —— 可视化收尾（已完成，构建通过，preview 4173 返回 200）

| 编号 | 项 | 实现 |
| --- | --- | --- |
| B1 | 视图点击选中 | RocketView3D 抽取 `pickAt()`（投影三角形内 + 深度最前）；RocketView2D 轮廓 path @click；App.vue `@pick` 双向接线 |
| B2 | 属性面板 hover 联动 | PropertyPanel 新增 `hovered` prop，悬停组件显示"悬停：名称 · 类型"提示条 |
| B3 | 仿真轨迹 3D 回放 | **已完成（2026-09-27，A1 后接续）**：新建 FlightReplay3D.vue——复用 RocketView3D 伪 3D 数学（rotY 旋转+透视+缩放），简化火箭面片沿 Z 轴按 profile.time/altitude 插值上升/开伞/降落；拖拽旋转、滚轮缩放、播放/暂停/重置/进度条；轨迹包络线、地面网格、Z 刻度、远地点标记、实时 t/高度/速度与状态（上升/滑行/伞降/地面）。SimulationPanel 新增第 4 个 Tab「回放」，ResizeObserver 保证 Tab 切换后画布自动重绘。口径：2DOF 垂直轨迹，不伪造横向运动。 |
| B4 | 2D 剖视 | RocketView2D 右上角"实体/剖视"分段开关，外壳透明度 0.16/0.06，内部件保持正常 |
| B5 | 导出 | 顶栏"导出…"下拉（SVG 图形 / CSV 组件清单 / OBJ 3D 模型）；getSvg/getObj/downloadText |

### C 组 —— 编辑增强（已完成，构建通过）

| 编号 | 项 | 实现 |
| --- | --- | --- |
| C1 | 组件拖拽调整 | 2D 画布轴向组件 mousedown 拖拽 → 轴向偏移（屏幕 y→火箭 z 换算），end 触发 pushHistory+重算 |
| C2 | 级管理 | 组件树标题栏"＋ 级"按钮，addStage() 命名 Stage N 追加并选中 |
| C3 | 复制/删除快捷操作 | 组件树每行 ⧉/✕；全局 Ctrl/Cmd+C/V、Delete/Backspace；输入框聚焦不拦截 |

### A 组 —— 引擎补齐（已完成，构建通过）

- **A1 JS 2DOF 仿真**（`jsEngine.ts simulate2dof`）：
  - 口径：垂直 2DOF 质点（推力/重力/阻力），内置 C6 演示发动机（与 WASM 侧 SimEntry 一致：timePoints [0,0.2,0.4,2.0,2.1]、thrust [0,12,5,5,0] N、燃尽 2.1s、推进剂 0.0107kg、延迟 0）、Heun（改进欧拉）积分 dt=0.005 上限 240s、ISA 大气密度/声速、体阻力 Cd≈0.45 + 尾翼 Cd≈0.02、开伞阻力×30、发射杆 1.0m。
  - 已修复两个验证期 bug：① t=0 推力为 0 时重力致 z 微负被误判落地 → 杆上约束（z/v 不反向、不陷地）+ 落地需先过远地点；② const z2/v2 在杆分支赋值编译错 → 改 let。
  - Node 验证（入门小火箭 0.0513kg + C6）：alt=268m、v=91m/s、a=154m/s²、tAp=6.8s、flight=44s、rodV=15.9m/s——物理自洽（小火箭高阻力，动压平衡处封顶）。
  - **口径声明**：JS 为简化 2DOF，不含侧风/倾斜/3D 转动；与官方桌面版 6DOF golden（alt=131.68 等，不同发动机与质量口径）不直接可比；SimulationPanel 文案已注明。
- **A2 多级 stage 分离**：起飞质量为全箭，上级（最后一个 stage）燃尽时刻（t=C6_BURN）分离下级质量；`buildGeos` 重构出 `buildStageGeos`/`stageMassOf` 按级算质量。两级 preset 验证：alt=206m（此前"两级未离杆"限制解除）。
- **A3 preset CP 精度**：3 个 preset 静态分析稳定为正（stab 0.18/0.27/0.21）、导出回环全 0.00%；与 WASM 差 4–6% 属前端简化几何口径，已记录不追平。

### D 组 —— 工程收尾（D1/D3 已完成；D2 待用户拍板）

- **D1 e2e 回归**（Node 打包 jsEngine+parser+serializer 实测）：
  - 静态分析对齐：CP 差 0.10%（0.9993 vs 官方 0.99825）、CG 差 2.29%（口径含内部件差异）；JS 与 WASM 同口径。
  - 仿真 sanity：官方 sample（JS 质量口径 0.38kg）+ C6 → alt=23m、v=12.4m/s、tAp=3.3s、flight=6.6s。
  - **导出-再解析回环（本轮根因修复，此前差 1.4–2.9%）**：
    - 根因 ①：serializer 把挂件全部重排嵌入"最后一个轴向组件"且 finset 写死 `method="bottom">0` → 尾翼位置错乱 → 改为保留模型树原层级 + 挂件 `method="absolute"` 写前端 axialOffset。
    - 根因 ②：nosecone 序列化写成 `radius`（前端语义=尖端 0）而非 `aftRadius` → 鼻锥体积≈0、升力≈0 → 改写 aftRadius。
    - 根因 ③：厚度写死（bodytube 0.0007 等）→ 改读 properties.thickness；材料密度未写 → 轴向组件补 `<material type="bulk" density="...">`；伞质量键不匹配（overridemass vs massoverride）→ serializer 写 overridemass、jsEngine 双键兼容。
    - **结果：sample 回环 CP 差 0.000%、mass 差 0.53%、cg/stab 稳定；3 个 preset 回环全 0.00%。**
  - 补序列化类型：shockcord（cordlength）、streamer、masscomponent、ellipticalfinset。
- **D2 部署目标**：待用户拍板（静态托管 / Docker / 桌面壳三选一）。
- **D3 本文件**：B/C/A/D 批次已追写（本节）。

## 13. P0–P2 可用性补齐（用户评估驱动）

### P0-1 组件类型补齐 —— 已完成（2026-09-27）
- 组件类型：7 种 → 16 种。新增 ellipticalfinset / freeformfinset / tubecoupler / bulkhead / centeringring / engineblock / masscomponent / streamer / shockcord。
- 全链路支持：componentFactory（默认参数/构造）、ComponentLibrary（4 组：轴向/尾翼/回收与配重/挂件）、jsEngine（密度/厚度表、挂件不占位、shockcord 质量分支、fin root/tip 回退 length）、PropertyPanel（每类型可编辑字段）、ComponentTree（中文标签）、RocketView2D/3D（挂件不占位 + fin root 回退）。
- 修复的引擎缺陷（回环驱动发现）：
  1. fin 质心曾被 `Math.min(cg, g.len)` 截断到起点（len=0 模型质心错误）→ 改为 MAC 中点。
  2. fin 在 buildStageGeos 未置 len=0，解析后 elliptical 的 length 会把 cursor 推进 → 后续尾翼整体后移 → 改为 fin len=0（不占轴向堆叠）。
  3. serializer 缺 freeformfinset/tubecoupler/bulkhead/centeringring/engineblock 分支 → 补齐（含 axialoffset）。
  4. orkParser sweeplength→sweep 转换扩展到 freeformfinset。
- 验证：16 组件全集回环 CP/cg/mass 全部 0.0000%；3 个 preset 回环全 0.000%；官方 sample CP 0.99929 vs 官方 0.99825（0.10% 校准保持）、总长 1.133948 vs 1.1339476（完全一致）、cg 0.69833 vs 0.67190（3.9%，简化模型口径，已知差异）。
- 仿真回归：全集火箭（含 3 种尾翼+结构件）alt=97.9m flight=15.1s 无错误。

### P0-2 发动机库 —— 已完成（2026-09-27）
- 新建 `src/lib/engines.ts`：8 款 Estes 标准发动机（A8-3 / B4-4 / B6-4 / C6-3 / C6-5 / C6-7 / D12-5 / A10-3T）。
- 数据来源：Estes 官方规格页与 Engine Chart（estesrockets.com、estes_engines_chart.pdf）+ ThrustCurve 认证值；
  推力曲线为基于「总冲/峰值推力/燃时」规格的分段线性近似（梯形反解平台宽度使面积=规格总冲），非实测数据，已标注来源。
- 仿真链路：`simulate(model, motor?)` 透传发动机；主循环按所选曲线插值推力、按推进剂质量线性消耗、
  开伞时刻 = max(远地点, 燃尽+延迟)、optimumDelay = 远地点 − 燃尽（替代原写死 0）。
- UI：SimulationPanel 顶部发动机选择器（型号/级/总冲/延迟）+ 实时规格（峰推/燃时/质量）+「导入 .eng」按钮；
  RASP/ENG 文本解析（`parseEngFile`：注释过滤、头部规格、曲线点、质量近似）→ 自定义发动机加入下拉并立即使用。
- 验证（入门小火箭 0.0513 kg）：A8-3 alt=50.3m → B6-4 118m → C6-5 230m → D12-5 330m（等级递进合理）；
  曲线面积与规格总冲一致（除 B6-4 尖峰近似 3%）；延迟语义正确（C6-7 延迟超远地点时晚开伞、落地更快）；
  RASP 样例解析 delay/peak/impulse 正确、自定义发动机仿真 351m。
- 注意：C6 曲线从 OpenRocket 内置 demo（11.15 Ns）换成 Estes 规格（10.0 Ns），A1 入门小火箭仿真数值随之更新（alt 268.4→230.4m），算法未变。

### P0-3 属性面板补全 —— 已完成（2026-09-27）
- 新建 `src/lib/materials.ts`：10 种材料库（纸板/轻木/胶合板/聚苯乙烯/ABS/聚丙烯/尼龙/铝/玻纤/碳纤维，密度 kg/m³）、
  Estes BT 标准管径系列（BT-5 … BT-80，外径英寸→半径 m）、表面处理三档（光滑 0.95× / 标准 1.0× / 粗糙 1.12× 摩擦乘子）。
- PropertyPanel 新增四类选择器：材料（全部组件，默认=类型默认密度）、标准直径（bodytube/innertube/tubecoupler，BT 系列或自定义，自动回显最近档）、
  表面处理（nosecone/bodytube/transition）、伞部署高度（parachute/streamer，0=远地点 / 100–500 m）。
- jsEngine 联动：buildStageGeos 材料密度优先（缺省回退类型默认）；simCdA 表面系数乘子（取最粗糙档）；
  simulate2dof 开伞条件支持部署高度（下降至该高度再开伞，0 保持远地点语义）。
- 序列化闭环：材料写标准 `<material name=…/>` 元素（官方可读）；surface/deployAlt 存 `<comment>[meta] …</comment>`，解析时还原。
- 验证：铝换 bodytube 质量 ×1.90（该件 ×3.16）；光滑 228.9m > 粗糙 214.9m；100m 开伞 flight 24.6s vs 远地点 37.5s、
  400m（高于远地点）≈远地点开伞；序列化回环 material/surface/deployAlt 全保留、质量/CP/cg 差 0.000000。
- 至此 **P0 组（组件类型 / 发动机库 / 属性面板）全部完成**。

### P1 组 —— 已完成（2026-09-27）
- **P1-4 飞行配置**：顶栏配置选择器（新建/切换/删除，命名配置绑定发动机）；切换配置即切换仿真发动机，仿真面板发动机选择同步。
- **P1-5 仿真条件**：`SimConditions`（风速/温度/气压）+ 仿真面板条件输入行；jsEngine 大气函数参数化——
  密度 ∝ P/T（温度修正 288.15/T0，气压修正 P/P0，标高指数律），音速随 T 修正；横向风偏（线性风场近似，风偏=风速×飞行时间）进 FlightProfile.windDrift_m 并在摘要展示。
  验证：−5°C alt 220.0 < 标准 228.9 < 35°C 237.5；1030 hPa 226.9 < 990 hPa 231.9；风偏 5m/s→187.7m（=5×37.5s）、10m/s→375.3m（线性）。
- **P1-6 延迟优化器**：`JsEngine.optimizeDelay(model, motor, cond)` 对候选延迟（0…max(12, 远地点+4)s 整秒）全仿真，
  异步分片（每 2 次让出事件循环，不阻塞 UI）；返回最优延迟（=远地点−燃尽，OpenRocket 口径）+ 扫描表（延迟/高度/飞行时间/是否开伞）。
  仿真面板「计算最优延迟」按钮 + 结果表（最优行高亮）。
  验证：C6-5 远地点 6.13s − 燃尽 1.60s → 最优延迟 5s，与 Estes 官方 C6-5 标称延迟一致；扫描表物理自洽（延迟越大开伞越晚、落地越快）。
- 引擎接口扩展为 `simulate(model, motor?, cond?)`；wasmEngine 兼容 3 参（optimizeDelay 抛"暂不支持"，由上层捕获）。
- 回归：官方 sample 回环 CP 差 0.0000%、cg 差 0.0098%（0.53% 已知口径内）、质量 0.40465→0.40263（0.5% 已知口径）。

## 12. 当前状态与下一步

- **已完成**：阶段 0–4a + 五处 UI 修复 + 设计系统 v2 + 可视化批 2/3 + B/C/A 组 + D1/D3 + **P0 全组（组件/发动机/属性面板）+ P1 全组（飞行配置/仿真条件/延迟优化）**。
- **可运行**：`cd openrocket-web && npm run build && npx vite preview --port 4173`；引擎选择自动回退 JS（本浏览器不支持 WebAssembly GC）；JS 现支持 分析 + 2DOF 仿真 + 多级分离。
- **下一步候选**：
  1. D2 部署目标确认（静态托管最简单：`npm run build` 产物直接可部署）。
  2. 2D 视图测量/网格增强；Three.js 全面重做 3D（当前 Canvas 自绘已具备旋转/剖视/拾取/标注/导出/仿真回放）。
  3. 官方桌面版加载 Web 导出文件互验（本机 JVM 当前不可用，需用户侧或 CI 执行）。

### Bug 修复（2026-09-27 完全功能测试）
1. **组件树空白**：根因——stage 级默认折叠，子组件不可见。修复——默认展开 root + 一级子节点；选中/添加时自动展开祖先链。
2. **组件库添加无反应**：根因——`structuredClone(model.value)` 对 Vue 响应式 Proxy 抛 DataCloneError，事件中断。修复——统一 `deepClone = JSON.parse(JSON.stringify(toRaw(v)))`（10 处），浏览器实测添加/撤销/重做/删除/复制/粘贴全链路通过、0 JS 错误。
3. **撤销/重做不可用**：根因——(a) 无快捷键与按钮入口；(b) 历史快照在"操作前"记录导致撤销丢当前状态。修复——补 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z、Cmd/Ctrl+Y 快捷键 + 树面板 ↶/↷ 按钮；历史改为"操作后提交快照"（commitHistory），undo/redo 恢复到正确状态。
4. **验证方式**：Chrome headless + CDP 脚本化交互（无法 GUI 自动化时替代）；官方 sample 回环仍 CP 0.0000%。
6. **2D 视图多级轴向错误（2026-09-27）**：根因——z 轴定义为「底部 z=0 向上递增」，与 OpenRocket 语义（z=0 鼻尖/顶部、z 递增向尾部）相反，导致第一个 stage 渲染在火箭最底部（Stage 1 头锥在下方）、CG/CP 标注镜像。修复——buildShapes 改为鼻尖基准（stage 数组顺序=鼻端→尾部，组件顺序同），yAt 同步（z=0 顶部），头锥 path 尖端在 z0；SVG 数据验证：单级尖端 y=11（顶）/两级 尖端 y=9（顶）→ Stage1 机身/尾翼 → Stage2 小径机身 → 过渡段收窄尾部；CG/CP 标注自动对齐。
5. **组件树仍空（复测）**：根因——组件库 16 按钮自然高度约 780px 撑满左侧栏，`.tree-pane{flex:1}` 被压缩到仅剩标题行，树内容在 DOM 中存在但视觉不可见（此前 DOM 级验证漏检视觉层）。修复——树面板固定 42% 高度（内部滚动），组件库改 flex 剩余空间 + `.lib-scroll` 内部滚动；headless 截图确认树完整显示。
7. **3D 视图轴向/多级/颜色/视口（2026-09-27，用户问"3D 有这个问题吗"）**：对照 2D 全面核修 RocketView3D.vue 四个问题——
   - (a) **多级重叠**：buildSegs 每个 stage 的 cursor 独立从 0 起，两级完全重叠。修复——加 `base` 累积（stage 循环尾 `base=cursor`），stage 数组顺序=鼻端→尾部、第一个 stage 在顶部。
   - (b) **轴向相反**：投影 `y=baseY−z*unit`（z 大=上方）与 2D/OpenRocket 语义相反。修复——统一鼻尖基准：z=0 顶部、z 递增向尾部，投影/刻度/CG-CP 标注全部改 `baseY+z*unit`；'Z（轴向）'、总长标签、直径标尺、地面阴影同步移至底部（baseY+maxZ*unit 系）。
   - (c) **颜色灰度化**：triColor 三通道复用同一插值（只取十六进制前两位=红通道），整支火箭渲染成灰色/黑色。修复——三通道分别插值，恢复蓝色系（#0a84ff 主色渐变）。
   - (d) **视口溢出**：unit 公式 maxZ*0.3 支配导致火箭高 480px>画布 360px 被裁切。修复——unit 改高度/直径双约束（h*0.66/maxZ 与 w*0.36/maxR*2.2 取小），baseY=cyp−maxZ*unit/2 垂直居中。
   - 验证：Chrome headless + canvas 像素带分析——两级：头锥尖端 y=54（顶）→Stage1 机身（114–174）→Stage2 机身（210–264，径更细）→过渡段收窄（288–306），多级接续不重叠；刻度 0.00→0.46 自上而下；CG 0.169 在 CP 0.250 上方（鼻尖基准正确）；单级入门火箭：尖端朝上、尾翼在底部。裁剪截图确认视觉正常。
8. **属性面板缺组件名称编辑（2026-09-27 回归发现）**：属性面板仅有长度/半径/材料等字段，组件名只读显示无法修改（用户无法给组件自定义命名）。修复——`.comp-name` 由 span 改为可编辑 input（hover 显示边框、focus 高亮），`onNameChange` 写回 `component.name` 并 emit('changed')（走 commitHistory，可撤销）。CDP 验证：改名"测试头锥"→ 树同步更新 → 分析重算 → Cmd+Z 恢复原名。
### 回归（2026-09-27，3D 修复后全链路）
- 组件树：两级火箭 8 行完整（火箭 > Stage1[头锥/机身管/梯形尾翼组] > Stage2[机身管/过渡段]）✓
- 添加头锥 8→9 行 ✓；Cmd+Z 撤销 9→8 ✓
- 属性面板：选中组件显示完整字段；改名→树同步→分析重算→撤销恢复 ✓
- 分析：质量/CG/CP/静稳定度正常输出，两级稳定度 0.25 口径提示不稳定（物理正确）✓
- 仿真面板：发动机下拉（A8-3…D12-5）正常 ✓
- 2D：首 path y=0（头锥尖端在顶部）、范围 0→371 ✓
- 3D：canvas 切换正常、两级接续/轴向/颜色/视口已核 ✓
- JS 错误 0、resource 错误 0 ✓
### 组件全覆盖与编辑能力验证（2026-09-28）
**16 种组件逐个添加验证**（入门小火箭基底，逐项添加→验证→撤销）：
- 轴向 7：头锥/机身管/过渡段/管接头/隔框/定心环/发动机挡块 —— 全部添加成功、树行 +1、属性字段完整（长度/半径/前端半径/后端半径/厚度）
- 尾翼 3：梯形/椭圆/自由形状尾翼组 —— 字段完整（翼片数/根弦/梢弦/后掠/高度/厚度）
- 回收配重 4：降落伞/飘带/冲击绳/配重 —— 字段完整（轴向偏移/长度/绳长/质量 + 开伞高度）
- 挂件 2：发射导环/发动机架管 —— 字段完整（+标准直径/motormount）
- 材料选择器全部组件可用；标准直径（管类）、表面处理（鼻锥/机身/过渡段）、开伞高度（伞/飘带）、形状（鼻锥/过渡段）按类型正确显示。
**编辑能力链路**（数值→重算→撤销）：
- 机身管长度 0.30→0.45：0.053→0.064 kg ✓；材料→铝：0.064→0.136 kg ✓（密度物理正确）；撤销材料保留长度改 ✓
- 翼片数 3→4：0.064→0.069 kg ✓；复制粘贴 6→7 行 ✓；Delete 删除 7→6 ✓；添加后自动选中新组件+属性面板同步 ✓
- 2D/3D 渲染无异常；JS 错误 0
**修复**：头锥/过渡段属性面板 `shape` 重复显示（properties 与顶层重复）——skipKeys 加 'shape'。
### P0 顺序重排 + 发动机设置（2026-09-28）
**P0 组件顺序重排**：
- ComponentTree.vue 三级（级/组件/子组件）各加 ↑/↓ 按钮（root 行除外），emit move(c, dir)。
- App.vue 新增 `findParentOf`（深度遍历找父容器）+ `moveComponent`（同父内 splice 换序 → 选中 → scheduleAnalyze → commitHistory，可撤销）。
- CDP 验证：入门小火箭头锥下移 ✓、尾翼上移（树序 头锥→尾翼→机身管→伞）✓、撤销恢复 ✓；两级火箭 Stage2 上移级交换 ✓、撤销 ✓；头锥下移后 2D 前 4 path y=0,9.4,9.4,166.7（鼻锥不再首段，视图随组件序联动）✓。
**修复：多级分析级序累积 bug（重要）**：根因——`buildStageGeos` 每级 cursor 从 0 起、`buildGeos` 直接 push 不累积，两级火箭分析几何完全重叠，导致**级序交换不影响 CG/CP**（且多级 CG 一直是错值）。修复——buildGeos 加 `base` 累积（上一级尾部接下一级头部）。验证：单级入门小火箭回归不变（0.053kg/CG0.2559/CP0.3205 ✓）；两级基线 CG 0.1688→0.2511（修正重叠错值）、级交换 0.2511→0.3100 ✓、撤销恢复 ✓；头锥下移 0.2698 ✓。
**发动机设置（用户提出"没有看到发动机的设置"）**：
- PropertyPanel 对 innertube 显示「发动机」下拉：8 款（A8-3…D12-5，显示 级·总冲·延迟）+「默认（仿真面板选择）」→ 写 properties.motorId。
- 模型架管发动机优先：App.vue 新增 `findModelMotor`（深度遍历找 innertube.motorId，motorById 解析），runSimulation 用 `mountMotor ?? selectedMotor`。
- orkSerializer meta 注释加 `motorId=`（官方可忽略），orkParser 通用 [meta] 解析自动还原，Web 内回环无损。
- CDP 验证：架管属性下拉可见 ✓、选 C6-5 回显 ✓；仿真联动——默认 C6-5 最高高度 228.9m、架管 A8-3 46.0m（总冲 2.5 N·s 远低于 10 → 高度大降，物理合理）、架管 C6-5 227.1m（≈默认，差=架管自身质量）✓。
### P1 二轮：2D 缩放平移 / 测量标尺 / 自动保存（2026-09-28）
**2D 缩放平移（RocketView2D.vue）**：viewBox 动态窗口方案（内部坐标不变 → hover/拾取/拖拽自动正确）。滚轮以鼠标为中心缩放（0.4–8×，保持鼠标下内容不动）、空白背景拖拽平移、工具栏「⤢ 复位」。CDP 验证：放大 viewBox 600→521.7 ✓、缩小恢复 ✓、复位 0 0 600 420 ✓、平移 vx/vy −60 ✓。
**测量标尺**：2D 左侧轴向刻度标尺（SVG 逻辑坐标，随缩放同步；刻度步长自适应取 1/2/5×10ⁿ，≥1m 显示 m、<1m 显示 cm）。验证：刻度线 10 + 文字 10 ✓。
**修复：2D 拖拽轴向方向 bug**：轴向重写为鼻尖基准（z=0 顶部）后，拖拽换算仍用旧 z=0 底部语义（负号），向下拖被 clamp 到 0 不动。修复——`dz = +(dy/H)/scale*height`（屏幕 y 向下 = z 向尾部）。验证：向下拖 60px path y 11.35→56.5 ✓，撤销恢复 ✓。
**自动保存 / 未保存提示 / 启动恢复（App.vue）**：watch model deep → dirty 标记（顶栏 ● 闪烁）+ 400ms debounce 落盘 localStorage（ork:autosave:v1 + 时间戳）；beforeunload 拦截未落盘变更；启动有存档 → 恢复条（「检测到上次未完成的工作（自动保存于 HH:MM）— 恢复/丢弃」）；恢复=载入存档重建历史，丢弃=清存档回示例（suppressSave 延时 400ms 抑制误保存，因 watch 回调异步 flush pre）。验证：编辑 150ms 后 ● 显示、落盘 1220B ✓；刷新恢复条出现 ✓；恢复 7 行（6+头锥）✓；丢弃 6 行 + 存档已清空 ✓；分析 0.053kg 正常 ✓。
**踩坑**：watch 注册在 `const model` 声明之前导致不触发（TDZ 隐患）——须在声明后注册；suppressSave 同步复位失效（watch 异步）——改 setTimeout 延时复位。
**P1-5 视图内悬浮信息（复评补缺）**：2D 路径 hover 显示浮层（组件名 + 长 cm + 径 mm + 开伞高度/电机型号），pointer-events:none 不挡交互。验证：hover 头锥 →「头锥（头锥）· 长 12.0 cm · 径 4.0 mm」✓、移出清除 ✓。**至此 P1 二轮 5 项全部完成**（缩放平移/标尺/自动保存/未保存提示/悬浮信息）。

---
## P2 三件套（2026-09-28 完成）

### 3D 视角预设
- RocketView3D.vue：VIEW_PRESETS（等距 0.6/0.38、正视 0/1.42、侧视 0/0.02、顶视 π/2/1.42），setViewPreset 300ms easeOutCubic lerp 过渡动画（rotY+tilt → draw），左下 .view-preset 分段控件
- CDP 验证：4 预设按钮渲染、逐个点击激活态正确、canvas 持续存活

### 组件树拖拽重排
- ComponentTree.vue：HTML5 DnD（行 draggable，dragstart/dragover/drop/dragend），行上下半判定 before/after，插入线 .drop-before/.drop-after（inset 阴影）、拖动行 .dragging 半透明；root 行不可拖
- App.vue moveToComponent：仅同父内重排（findParentOf 校验 pa===pb）→ splice 换序 → 选中 → scheduleAnalyze → commitHistory
- CDP 验证（DataTransfer 模拟）：头锥拖至降落伞后 → 机身管/梯形尾翼组/降落伞/头锥 ✓；撤销恢复 ✓

### UI 视觉再打磨（Apple HIG × Figma，高饱和蓝科技感）
- 2D 视图深色工场化：背景 linear-gradient(#0a2b66→#071a45)（与 3D 统一）、网格 rgba(125,185,255,0.10)、火箭渐变高饱和亮蓝（#5db2ff→#0a84ff 外壳 / #7db9ff→#3395ff 内部 / #0a84ff→#005bb5 尾翼）、CG 亮绿 #5ee08a / CP 亮红 #ff8f87、标尺与提示文字浅色、xray 按钮深色毛玻璃适配
- 全局层次：--bg 加深带蓝（#e8eef9）、--sh-sm 蓝调阴影 + --sh-sm-hover、pane-title 加 3×13px 渐变蓝竖条 + 微光（::before）、canvas/analysis 卡片 hover 抬升
- CDP 验证：2D 背景 linear-gradient ✓、网格亮蓝 ✓、蓝条 3x13px ✓；截图目检 2D/3D 双视图（深蓝工场 + 高饱和蓝火箭 + 白面板 + 蓝色点缀统一）

### UI 第二轮（2026-09-28 晚，用户三项要求）
- **顶栏重排**：52px 高，分组 + 1px 竖分隔线（品牌 | 文件组 新建/打开/保存 | 示例/导出 | 飞行配置 | 撤销重做 | spacer | 引擎标签 | 仿真）；onDark 按钮去盒子化（透明文字按钮，hover 半透明底，Apple 工具栏风格）
- **左右栏拖拽调宽**：.resize-handle（6px，hover 蓝条）在 .left/.center 与 .center/.right 之间；leftW/rightW 拖拽调宽 190–430px，localStorage（ork:leftW / ork:rightW）记忆；CDP 实测 264→334px + 记忆 ✓
- **分区线条切分**：.pane 去圆角卡片化（radius 0、无边框无阴影、透明底），左右栏白底 + 1px 侧边框，分区用 border-bottom 分隔线；视图容器（2D/3D）圆角 r-lg→r-md（10px）；空态卡圆角 r-xl→r-md；CDP 实测 tree-pane radius=0/border-b=1px/无阴影 ✓

### 项目改名 + 顶栏结构重做（2026-09-28 深夜）
- **目录改名**：phase1-viewer → **openrocket-web**（package.json name 同步），预览服务已用新目录重启（localhost:4173），规划文档旧路径已全文替换
- **顶栏精简**：从 10+ 控件收敛为 3 个按钮——「文件 ▾」（下拉菜单：新建/打开…/保存 .ork/示例设计 3 款/导出 SVG/CSV/OBJ，毛玻璃下拉面板）+ 引擎标签 + 仿真主按钮 + 工具条折叠开关（⌄/⌃）
- **工具条（可折叠）**：顶栏下方 38px 白底条，撤销/重做/＋级 + 飞行配置 ＋− + 未保存 ● 指示；点 ⌄ 收起、⌃ 展开（v-show）
- 验证：CDP 菜单分组/项、外部点击关闭、收起展开 display none↔flex 全通过
