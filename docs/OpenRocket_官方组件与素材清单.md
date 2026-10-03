# OpenRocket 官方组件、数据与素材清单

> 整理自 OpenRocket 官方文档（basic_rocket_design）+ 本地官方源码（swing/core 模块）。
> 用途：Web 重构（Vue3）的组件库、图标素材、数据来源，全部使用 OpenRocket 官方资源。
> 素材已拷贝至 `openrocket-web/public/ork-assets/`。

---

## 一、官方组件完整清单（4 类 21 种）

### 1. Assembly Components（装配组件，3 种）—— 无物理意义的框架容器

| 组件 | 图标文件 | 说明 | 特性 |
|---|---|---|---|
| **Stage（级）** | `stage-large.png` | 每枚火箭至少一级，基本框架 | 可重命名，有 Override/Comment tab |
| **Boosters（助推器）** | `boosters-large.png` | 只可挂到 body tube，可分离（如滑翔机） | 有 Separation/General/Override/Comment |
| **Pods（舱）** | `pods-large.png` | 只可挂到 body tube，不可分离（如侧挂电机） | 有 General/Override/Comment |

### 2. Body Components and Fin Sets（机身组件与尾翼，9 种）

| 组件 | 图标文件 | 参数（General tab） |
|---|---|---|
| **Nose Cone（头锥）** | `nosecone-large.png` | 形状（Ogive/Conical/Parabolic/Power）、Shape parameter、长度、基部直径、壁厚；Shoulder tab：肩部直径/长度/厚度、End capped |
| **Body Tube（机身管）** | `bodytube-large.png` | 长度、外径、内径、壁厚；Automatic 自动、Filled 实心；Motor tab 可设为电机座 |
| **Transition（过渡段）** | `transition-large.png` | 长度、前直径、后直径、形状 |
| **Trapezoidal fin（梯形尾翼）** | `trapezoidfin-large.png` | 根弦/尖弦/后掠/高度/厚度、翼型（Rounded）、数量、位置 |
| **Elliptical fin（椭圆尾翼）** | `ellipticalfin-large.png` | 同上（椭圆外形） |
| **Freeform fin（自由尾翼）** | `freeformfin-large.png` | 任意形状（打开形状编辑器） |
| **Tube fins（管尾翼）** | `tubefin-large.png` | 由机身管做成的外部尾翼 |
| **Rail button（导轨按钮）** | `railbutton-large.png` | 外挂导轨按钮 |
| **Launch lug（发射导环）** | `launchlug-large.png` | 长度、外径、内径、壁厚、径向角度 |

### 3. Inner Components（内部组件，5 种）

| 组件 | 图标文件 | 说明 |
|---|---|---|
| **Inner tube（内管）** | `innertube-large.png` | 内部管，可作电机座（Motor tab） |
| **Tube coupler（管接头）** | `tubecoupler-large.png` | 多级火箭连接两段 |
| **Centering ring（定心环）** | `centeringring-large.png` | 支撑电机等，自动取父管外径与内管内径 |
| **Bulkhead（隔框）** | `bulkhead-large.png` | 两区间的实体隔断 |
| **Engine block（发动机挡块）** | `engineblock-large.png` | 防止电机前移，可设相对位置（Top/Bottom of parent）+ Plus |

### 4. Mass Components（质量/回收组件，4 种）

| 组件 | 图标文件 | 说明 |
|---|---|---|
| **Parachute（降落伞）** | `parachute-large.png` | 回收；Plus、Packed length、Packed diameter |
| **Streamer（飘带）** | `streamer-large.png` | 阻力回收 |
| **Shock cord（减震绳）** | `shockcord-large.png` | 系住头锥，防丢失 |
| **Mass component（配重）** | `mass-large.png` | 调 CG；质量、近似密度、长度、直径 |

> 扩展组件（源码中另有图标）：Payload（有效载荷 `payload-small.png`）、Flight computer（飞行计算机 `flight-comp-small.png`）、Battery（电池）、Altimeter（高度计）、Tracker（追踪器）、Deployment charge（开伞火药）、Recovery hardware（回收五金）等。

---

## 二、组件配置窗口结构（官方）

**通用 Tabs（因组件而异）**：

| Tab | 内容 |
|---|---|
| **General** | 基本参数（数值输入 + spin + 滑块）、Automatic/Filled 复选；右侧：Component material（材料）、Component finish（表面处理，Set for all 应用到全火箭）；左下实时 **Component mass** |
| **Motor**（仅可装电机组件） | This component is a motor mount、Motor overhang、Ignition at（自动/抛射药+秒数，可每飞行配置覆盖） |
| **Shoulder**（头锥专用） | 肩部直径/长度/厚度、End capped |
| **Override** | Override mass、Override CG、覆盖全部子组件、Set coefficient of drag |
| **Appearance** | Figure style（2D：默认色/组件色/线型/边缘外观）；Appearance（3D：纹理/颜色/光泽/不透明度/偏移/旋转/重复） |
| **Recovery**（回收组件） | 部署方式（开伞高度 / 远地点） |
| **Comment** | 注释 |

**材料示例（官方）**：Cardboard（瓦楞纸，680 kg/m³）、Polystyrene（聚苯乙烯，1.05 g/cm³）；表面处理：Regular paint（常规喷漆，2.36 mil / 60 μm）。

---

## 三、官方数据素材（已拷入 ork-assets/）

### 示例火箭（examples/，16 个官方 .ork）
A simple model rocket、Parallel booster staging、Three stage low power rocket、Two stage high power rocket、Clustered motors、Dual parachute deployment、Tube fin rocket、Pods（airframes and winglets / powered with recovery deployment）、Deployable payload、Airstart timing、ARC payload rocket、Chute release、Simulation scripting、Simulation extensions、3D printable nose cone and fins、Boosted Dart 等。

### 官方电机推力库（thrustcurves/）
- `initial_motors.db`：官方内置电机库（含 Estes A8-3、B6-4、C6-3、C6-5、C6-7 等全系列推力曲线）
- `metadata.json`：元数据
- `RASAero/rasp.eng`：RASAero 推力格式

### 官方组件库（component-db/，30 个 .orc）
estes_classic.orc（Estes 经典部件）、BMS.ORC、generic_materials.orc（通用材料）、apogee.orc、bluetube.orc、competition_chutes.orc、giantleaprocketry.orc 及 internal 内部库（legacy 系列、Fruity Chutes 等）。

---

## 四、官方图标素材（ork-assets/）

| 目录 | 内容 |
|---|---|
| `component-icons/`（71 个） | 21 种组件 × {large, small, dark}，官方原版 PNG |
| `ui-icons/` | UI 操作图标：新建/打开/保存/打印、undo/redo、放大缩小、仿真运行/图表/导出、Rocksim/RASAero 导入、CG/CP 覆盖标记、隐藏/禁用、警示等 |
| `event-icons/` | 仿真事件：点火/升空/发射杆/发动机燃尽/远地点/抛射/触地 |
| `spheres/` | CG/CP 标记球（红/蓝/绿/黄/灰） |
| `logo/` | OpenRocket 应用图标（256px） |

---

## 五、官方 UI 布局（供 Web 重构对照）

官方主窗口 = **三个主 Tab**：`Rocket design` / `Motors & Configuration` / `Flight simulations`

### Rocket design（设计）页
- **左上**：组件树（Rocket > Stage > 组件），操作：Move up / Move down / Edit / New stage / Delete
- **右上**：Add new component 面板——4 类分区（Assembly / Body / Inner / Mass），每项带图标
- **下方**：火箭预览（2D 侧视图：刻度尺、CG 红点 / CP 蓝点、稳定性数值）；View Type 切换（Side view / Back / 3D）
- **左侧信息**：Length、max diameter、Mass with motors、Apogee、Max velocity、Max acceleration
- **右侧信息**：Stability、CG、CP（at M=0.30）
- **底部提示**：Click select / Shift-click multi / Double-click edit / Click-drag move

### Motors & Configuration（电机配置）页
- 配置操作：New / Rename / Remove / Copy Configuration
- 子 Tab：Motors / Recovery / Stages
- Motor mounts 列表（Body tube / Inner Tube 勾选）→ Select motor（弹出选择器：制造商筛选、总冲量 A~O 字母档、直径/长度限制、推力曲线、抛射延迟）→ Remove / Select ignition / Reset ignition

### Flight simulations（仿真）页
（对应官方 Flight simulations 主 Tab，含仿真列表、图表、事件等）

---

## 六、Web 重构对应关系（用户规划）

| 用户新布局 | 官方对应 | 说明 |
|---|---|---|
| 上：功能区 3 Tab | Rocket design / Motors & Configuration / Flight simulations | 完全对应官方三 Tab |
| 设计 Tab：左组件树 | 官方左上组件树 | 树 + Move up/down/Edit/New stage/Delete |
| 设计 Tab：右组件库 | 官方 Add new component 面板 | 4 类分区 + 官方图标（component-icons/） |
| 下：火箭预览 | 官方下方设计窗口 | 2D/3D 视图、刻度尺、CG/CP、稳定性 |
| 组件图标 | `component-icons/*-large.png` | 官方原版图标 |
