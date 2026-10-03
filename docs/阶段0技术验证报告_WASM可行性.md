# 阶段 0 技术验证报告：OpenRocket core 编译 WASM 可行性

> 日期：2026-09-25　工程：`phase0-poc/`　相关规划：`OpenRocket_Vue_WASM_重构规划.md`

## 1. 结论

**WASM 路线可行。** OpenRocket `core` 模块（801 类 / 7931 方法）经 TeaVM 0.15 成功 AOT 编译为 WebAssembly GC 模块（约 1.5 MB），在同一输入下与 Java 基线完成 golden 对比：飞行仿真九项指标相对误差全部 < 3×10⁻⁴（多数 < 10⁻⁵），判定数值一致。阶段 1 起引擎形态确定为 WASM（TeaVM），Java 服务方案降级为兜底。

## 2. 工具链与产物

| 项 | 值 |
| --- | --- |
| Java | Temurin JDK 17（`tools/jdk-17.0.20.1+1`，brew 安装失败后手动下载） |
| 构建 | Gradle（仓库 wrapper）产出 `core-26.xx-SNAPSHOT.jar`；Maven 3.9.11 驱动 TeaVM |
| AOT 编译器 | TeaVM 0.15.0，`targetType=WEBASSEMBLY_GC`，优化级 ADVANCED |
| 编译规模 | 801 类 / 7931 方法 |
| WASM 产物 | `phase0-poc/target/generated/wasm/teavm/classes.wasm`（1.5 MB）+ `classes.wasm-runtime.js` |
| 导出接口 | `runSimulationWasm`（6DOF 飞行仿真 → JSON 字符串）；`runAnalysisWasm`（质量/CG/CP/稳定性 → JSON 字符串） |
| 运行环境 | Node v22（含 WebAssembly GC）；浏览器需 Chrome/Edge 111+ 或 Safari 17+ |

## 3. AOT 不友好特性清单与处理方式

| 类别 | 具体问题 | 处理方式 | 位置 |
| --- | --- | --- | --- |
| AWT 几何类 | core 仿真路径引用 `java.awt.Color` 与 `Point2D/Line2D/Rectangle2D` 等 | 手写语义一致 stub（坐标、判定逻辑逐一对齐） | `phase0-poc/stubs-src/java/awt/*` |
| 日志框架 | `org.slf4j` 不存在于 TeaVM classlib | 手写 `Logger/LoggerFactory/Marker` stub | `phase0-poc/stubs-src/org/slf4j/*` |
| 依赖注入 | Guice+Guava 在 TeaVM 编译不通（MapMaker 依赖 JUC 锁/Unsafe） | 弃 Guice 运行时，自写 `poc.SimpleInjector`（按 Guice 7 接口），手工提供 6 个注入点 | `poc/SimpleInjector.java` |
| 反射 | `Class.getConstructor().newInstance()` 与按类名构造 Barrowman 计算器在 classlib 不支持 | `Simulation` stub 直接 new 引擎；两个 Barrowman 计算器改 `instanceof` 手工实例化 | `stubs-src/.../Simulation.java`、`BarrowmanStabilityCalculator`、`BarrowmanDragCalculator` |
| JUC 集合 | `AtomicInteger`、`ConcurrentHashMap`、`ConcurrentLinkedQueue` 等 classlib 缺失 | 覆盖为单线程等价实现（`int++`、`HashMap`、自定义队列） | `ModID`、`InstanceMap`、`Manufacturer`、`Rocket`、`FlightConfiguration` |
| 多态 clone | classlib `ArrayList.clone()` 不保留子类运行时类型 → 非法转型 | 覆盖 `info.openrocket.core.util.ArrayList` 的 clone 为拷贝构造 | `stubs-src/.../util/ArrayList.java` |
| UUID/排序 | `java.util.UUID`、`Collator` 等 classlib 语义差异 | 覆盖上层类改用字符串比较；常量 UUID 改 `fromString` | `FlightConfigurationId`、`Unit`、`ThrustCurveMotor`、`DesignationComparator`、`MotorConfigurationId` |
| 注解版本 | `@JSExport` 在 0.15 已更名 | 用 `org.teavm.interop.@Export(name=...)`，wasm 导出函数经 `instance.exports` 调用、`teavm.stringToJs` 转 JS 字符串 | `poc/SimEntry.java` |

处理原则：**能改 stub 覆盖上层类就不动 core 源码**——所有兼容层位于 `phase0-poc/stubs-src/`，core 源码仅以 jar 方式引用，未修改。

## 4. golden 对比

输入：Estes Alpha III 测试火箭，6DOF 仿真（`Simulation`，timeStep 0.05 s，随机种子 `0x3161`，ISA 标准大气）。
Java 基线由同一 `SimEntry` 在 JVM 运行，重跑两次数值完全复现；WASM 由 Node 加载 `classes.wasm` 调用 `runSimulationWasm`。

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

误差来源说明：classlib 的 `Math` 函数与集合迭代实现与 JVM 存在浮点级差异；`optimumDelay` 依赖对时序的数值寻根，对微小输入差异最敏感（3×10⁻⁴）。对工程使用（飞行高度、速度、落点预估）精度充足；如后续需要与桌面版逐位一致，可对差异最大路径做定点替换。

静分析导出（`runAnalysisWasm`，内置 Estes Alpha III）：

| 项 | 值 |
| --- | --- |
| 质量 | 0.02527 kg |
| 重心 CG | 0.1918 m（自鼻尖） |
| 压心 CP | 0.2251 m（自鼻尖） |
| 静稳定度 | 0.122（口径：(CP−CG)/箭长） |
| 箭长 | 0.273 m |

## 5. 性能观察

- WASM 模块加载 + 首次仿真：Node 环境秒级（JS 解析 152 ms + 仿真运行），浏览器端含 runtime 脚本注入与实例化，预计 1–2 s 量级，适合异步执行。
- 单次 6DOF 仿真在 WASM 内为毫秒级；阶段 3 图表若需多时间步输出，可复用同一实例避免重复初始化。

## 6. 风险与后续

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| .ork 输入未接入 WASM | 当前导出基于内置测试火箭；把用户 .ork 传入 WASM 构造 Rocket 需引入 XML 解析（`JAXB/SAX` 在 TeaVM 的可用性需评估） | 阶段 2 优先验证；若 XML 路径成本高，可走"前端解析 .ork → 结构化参数传入 WASM"路线 |
| 运行非确定性 | 两次 WASM 运行存在 ~10⁻⁴ 级差异（集合迭代顺序对浮点累积顺序的影响），Java 基线完全确定 | 每阶段 golden 回归固定输入即可满足验收；如需复现精确轨迹需消除无序集合 |
| 引擎规模扩展 | 仿真全链路编译已通；后续 3D/优化器等模块引入新依赖需回归 | 沿用阶段 0 的 stub 覆盖流程 |
| 浏览器兼容 | WASM GC 需 Chrome/Edge 111+、Safari 17+、Firefox 120+ | 前端做能力检测，不支持的浏览器显示明确提示 |

## 7. 产物位置

- 工程与源码：`phase0-poc/`（`pom.xml`、`src/`、`stubs-src/`、`stubs.jar`、`wasm-run/run.mjs`）
- 基线数据：`phase0-poc/golden/java-result.json`（含运行日志）、`golden/wasm-result.json`
- 复现命令：
  - Java 基线：`java -cp "target/classes:<core jar>:$(cat runtime-classpath.txt | tr '\n' ':')" poc.SimEntry`
  - 重编 WASM：`mvn compile`（TeaVM 自动构建）
  - WASM 运行：`node wasm-run/run.mjs`（当前脚本调用 `runAnalysisWasm`）
