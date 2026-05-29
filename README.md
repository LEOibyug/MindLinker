# MindLinker

MindLinker 是一个开源桌面学习助手，面向课程学习、理论知识梳理和论文阅读。它不是普通聊天机器人，而是围绕“参考资料 -> 主回复 -> 解释链 -> 位置提问 -> 知识图谱”的学习工作流设计：用户可以导入本地参考资料，生成基于参考的回答，并把回答中的关键概念继续展开为可探索的知识网络。

项目基于 Electron、React、TypeScript 和 Vite 构建，目标形态是本地桌面应用，而不是托管网页聊天界面。

## 功能特性

- **项目化工作区**：以学习项目为最上级目录，每个项目下管理参考资料和多个对话。
- **参考驱动对话**：支持导入 PDF、Markdown、文本等资料，本地解析后作为模型上下文参与回答。
- **可配置模型供应商**：支持多个自定义供应商，可选择当前使用的供应商；兼容 OpenAI Chat Completions 风格接口和 OpenAI Responses 风格接口。
- **主模型与 RAG 分离**：主模型配置和嵌入模型/RAG 配置相互独立；关闭 RAG 时会直接把结构化参考上下文发送给主模型。
- **PDF 结构化处理**：按页解析 PDF 文本，并为复杂页面保留图片/页面上下文，为后续多模态输入打基础。
- **解释链**：可抽取关键词生成解释，也可手动划词生成解释；解释项会在正文和解释卡片中以链接形式呈现。
- **位置提问**：可在回答的具体位置发起小窗问答，支持多轮追问，并可保存为正文中的位置标记。
- **知识图谱**：基于当前项目/对话中的概念、解释和参考构建知识关系图，并可点击节点查看详情。
- **本地持久化**：项目、对话、参考解析结果、解释链、位置提问和运行日志都会保存在本地，除非用户主动删除。
- **运行日志**：记录模型请求、模型回复和应用事件，并过滤常见密钥字段，便于定位真实供应商调用问题。

## 当前状态

MindLinker 仍处于早期开发阶段。核心阅读、参考导入、模型对话和解释链流程正在持续打磨；其中 **RAG** 和 **知识图谱** 两个功能目前只能视为实验性能力，可用性和稳定性都还不高，距离真正好用还有不少工作要做。

另外，部分功能的实际能力会直接受所使用模型能力影响。尤其是 PDF 页面图片理解、截图理解、复杂公式/表格解释、长上下文阅读和关键词抽取等能力，需要模型本身具备足够好的视觉、多模态、长上下文和结构化输出能力。

如果你对本地向量库、检索增强生成、知识图谱布局、概念抽取或学习型交互有改进想法，欢迎提交 Issue 或 Pull Request。尤其欢迎能复现真实学习场景问题的反馈、测试用例和小而清晰的修复提交。

## 截图

### 可导入多个参考，哪怕是课程所有ppt也不怕

![可导入多个参考，哪怕是课程所有ppt也不怕](<pics/可导入多个参考，哪怕是课程所有ppt也不怕.png>)

### 模型回复看不懂？一键划词解释，全局链接一劳永逸

![模型回复看不懂？一键划词解释，全局链接一劳永逸](<pics/模型回复看不懂？一键划词解释，全局链接一劳永逸.png>)

### 好多词语都不会？一键智能划词，让ai帮你划出关键词（猜你想问

![好多词语都不会？一键智能划词，让ai帮你划出关键词（猜你想问](<pics/好多词语都不会？一键智能划词，让ai帮你划出关键词（猜你想问.png>)

### 模型的解释还是看不懂？别怕，一问到底，一直问到懂！！

![模型的解释还是看不懂？别怕，一问到底，一直问到懂！！](<pics/模型的解释还是看不懂？别怕，一问到底，一直问到懂！！.png>)

### 想要探讨？直接开聊不等待，聊完还能打下标记，下次回来接着聊！！！

![想要探讨？直接开聊不等待，聊完还能打下标记，下次回来接着聊！！！](<pics/想要探讨？直接开聊不等待，聊完还能打下标记，下次回来接着聊！！！.png>)

## 快速开始

### 环境要求

- Node.js 20 或更新版本
- npm
- Git
- 如需调用真实模型，需要准备对应模型供应商的 API Key

### 安装依赖

```bash
npm install
```

### 启动桌面应用

```bash
npm run dev
```

该命令会启动 Vite 渲染进程并打开 Electron 桌面应用。

如需以接近生产的方式本地运行：

```bash
npm run start:desktop
```

### 不同平台运行

MindLinker 的目标形态是 Electron 桌面应用。开发和本地体验时，请优先使用 `npm run dev` 或 `npm run start:desktop`，不要只把它当作普通网页运行。

#### macOS

```bash
git clone git@github.com:LEOibyug/MindLinker.git
cd MindLinker
npm install
npm run dev
```

如果需要先构建再启动桌面应用：

```bash
npm run start:desktop
```

开发模式下通常不需要额外配置。未来如果制作正式安装包，可能还需要处理 macOS 代码签名、公证和 Gatekeeper 相关问题；这些不影响当前的本地开发运行。

#### Linux

```bash
git clone git@github.com:LEOibyug/MindLinker.git
cd MindLinker
npm install
npm run dev
```

Linux 下需要图形桌面环境。若在服务器、容器或无桌面环境中运行，Electron 窗口可能无法启动，需要额外配置 X11、Wayland 或远程桌面环境。

不同发行版可能需要安装 Electron 依赖的系统库，例如 GTK、NSS、X11/Wayland 相关库。若 Electron 启动时报系统库缺失，请按报错提示安装对应发行版的软件包。

#### Windows

Windows 下建议使用系统原生环境运行，例如 PowerShell 或 `cmd.exe`，不要求使用 WSL。

PowerShell：

```powershell
git clone git@github.com:LEOibyug/MindLinker.git
cd MindLinker
npm install
```

当前 `dev:electron` 脚本使用了 macOS/Linux shell 风格的环境变量写法：

```bash
VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron .
```

因此在 Windows 原生 PowerShell 或 `cmd.exe` 中直接运行 `npm run dev` 可能失败。当前推荐使用两个终端手动启动。

终端 1：

```bash
npm run dev:renderer
```

终端 2：

```powershell
$env:VITE_DEV_SERVER_URL="http://127.0.0.1:5173"
npx electron .
```

如果使用 `cmd.exe`，终端 2 可改为：

```bat
set VITE_DEV_SERVER_URL=http://127.0.0.1:5173
npx electron .
```

后续可以引入 `cross-env`，将脚本改为跨平台写法，让 Windows、macOS 和 Linux 都能直接使用 `npm run dev`，不需要用户切换 shell。

#### 浏览器预览与桌面应用的区别

`npm run preview` 只用于预览 Vite 构建后的渲染页面，不代表完整桌面应用环境。涉及本地文件、Electron 主进程、桌面窗口和应用级持久化的功能，应使用 Electron 启动方式验证。

#### 关于安装包

项目目前还没有接入 `electron-builder`、Electron Forge 等打包工具，也没有正式的 `.dmg`、`.exe`、`.AppImage` 或 `.deb` 发布产物。当前推荐方式是源码本地运行；如需面向普通用户分发，还需要补充跨平台打包、签名和发布流程。

## 配置模型

进入应用设置页后，可以添加或修改模型供应商配置：

- 供应商名称
- Base URL
- API Key
- API 格式：OpenAI 兼容 Chat Completions 或 OpenAI Responses
- 主模型名称

请使用带有视觉能力的模型作为主模型。MindLinker 会在处理 PDF 页面图片、截图、扫描内容和复杂排版时把图像上下文交给模型；如果主模型不支持视觉输入，相关页面只能依赖文本解析结果，回答质量会明显下降。推荐优先尝试 `gpt5.5` 或 `gpt5.4`，也可以使用你的供应商提供的其他视觉模型。部分功能的上限与模型能力直接挂钩：模型越擅长视觉理解、长上下文阅读、公式推理和稳定 JSON 输出，MindLinker 的参考阅读、解释链和位置提问体验通常越好。

RAG 与嵌入模型在独立区域配置。未开启 RAG 时，应用不会强制等待嵌入模型，而是把解析后的参考资料作为结构化上下文交给主模型。

请不要把 API Key、私人参考资料或本地运行数据提交到仓库。

## 开发

常用命令：

```bash
npm test
npm run build
```

脚本说明：

- `npm run dev`：以开发模式启动渲染进程和 Electron。
- `npm run app`：`npm run dev` 的别名。
- `npm run start:desktop`：先构建，再启动 Electron。
- `npm test`：运行一次 Vitest 测试。
- `npm run test:watch`：以 watch 模式运行 Vitest。
- `npm run build`：执行 TypeScript 检查并构建渲染端。

维护记录见 [MAINTENANCE.md](MAINTENANCE.md)。修复 bug 时应尽量包含聚焦的回归测试、验证命令和清晰的 git 提交信息。

## 项目结构

```text
electron/              Electron 主进程与 preload 脚本
src/                   React 渲染端、领域逻辑、测试与运行日志
src/pdfReferences.ts   本地 PDF/参考资料解析
src/runtimeLog.ts      渲染端运行日志工具
src/KnowledgeGraphView.tsx
                       知识图谱界面
MAINTENANCE.md         维护与修复记录
```

## 数据与隐私

MindLinker 的应用数据默认保存在本地。模型请求只会发送到用户配置的供应商，但请求内容可能包含用户提示词、解析后的参考资料以及对话上下文。处理私人或敏感文档前，请先确认所用模型供应商的数据政策。

运行日志用于本地调试。虽然日志会过滤常见密钥字段，但在公开分享日志前仍应自行检查。

## 路线图

- macOS 应用打包与发布产物。
- 更完整的本地向量库管理、导入和导出流程。
- 更强的知识图谱布局控制与导出能力。
- 对扫描版 PDF、复杂表格和多模态页面图像的更稳健处理。
- 计划支持多篇长论文输入时，依据标题与摘要的选择性上下文优化与模型回复优化。
- 可选的项目备份与同步能力。

## 贡献

欢迎提交 Issue 和 Pull Request。请尽量保持改动聚焦；涉及行为变化时，请补充测试，并在说明中写清楚用户可感知的影响。

提交 PR 前建议运行：

```bash
npm test
npm run build
```

## 许可证

MindLinker 使用 MIT License 发布。详见 [LICENSE](LICENSE)。
