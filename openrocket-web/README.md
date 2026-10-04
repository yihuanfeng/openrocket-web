# OpenRocket Web（前端）

OpenRocket 火箭模拟器的 Web 前端（Vue 3 + TypeScript + Vite）。纯前端实现，无后端、无需 Java。

## 目录说明

```
src/
├── lib/               # 核心逻辑
│   ├── geometry.ts    #   几何布局引擎（官方轴向语义 TOP/AFTER/MIDDLE/BOTTOM）
│   ├── componentFactory.ts  # 组件构造（轴向/半径/形状参数）
│   ├── presets.ts     #   内置示例火箭
│   ├── engines.ts     #   26 款 Estes 发动机 + .eng 导入
│   ├── jsEngine.ts    #   飞行仿真引擎（JS）
│   ├── wasmEngine.ts  #   WASM 引擎桥（浏览器不支持时自动降级）
│   ├── orkParser.ts   #   官方 .ork 解析（ZIP + XML）
│   ├── orkSerializer.ts / rktParser.ts  # 序列化 / Rocksim 导入
│   └── materials.ts   #   材料数据
├── components/        # UI 组件（2D/3D 视图、组件树/库/属性、示例、仿真、发动机配置、设置）
public/
├── ork-assets/        # 官方素材（示例 .ork、缩略图、组件库 .orc、图标、发动机规格）
└── wasm/              # WASM 引擎产物
scripts/gen-thumbs.ts  # 示例缩略图批量生成
```

## 常用命令

```bash
npm ci             # 安装依赖
npm run dev        # 开发模式（热更新，http://localhost:5173）
npm run build      # 类型检查 + 构建（TS6133 未使用变量会阻断构建）
npm run preview    # 预览生产构建（http://localhost:4173）
npm run gen:thumbs # 重生成示例缩略图（改 presets/geometry 后运行）
```

## 架构要点

- **几何**：`geometry.ts` 的 `layoutRocket(root)` 把组件树展开为带绝对轴向位置与半径的段列表，2D SVG 与 3D Canvas 共用同一几何，保证两视图一致。
- **轴向语义**：对齐 OpenRocket 官方——TOP/ABSOLUTE、AFTER（前一组件尾端 + offset）、MIDDLE、BOTTOM；尾翼默认根部对齐管尾（BOTTOM 等效）；伞/飘带为机身管子组件（管内前段回收舱）。
- **渲染**：2D 为 SVG 侧视图（竖/横）；3D 为 Canvas 2D 投影（三角面 + 深度排序 + 光照 + 程序化材质纹理）。
- **仿真**：JS 引擎（推力曲线 + 阻力 + 重力，2DOF），支持发动机延迟扫描与多发动机对比。

## 数据来源

组件规格、示例 .ork、发动机数据、图标均取自 OpenRocket 开源仓库（GPL-3.0，版权归原项目）。
