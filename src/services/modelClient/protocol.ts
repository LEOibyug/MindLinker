import { answerModePrompts } from "../../domain/conversationDrafts";
import type { AnswerMode, ConversationDraft } from "../../domain/conversationDrafts";
import type { MarkedTerm } from "../../domain/explanations";
import type { InlineConversation, InlineConversationMessage } from "../../domain/inlineConversations";
import { buildReferenceContext } from "../pdfReferences";
import type { ParsedReferenceDocument } from "../pdfReferences";
import { buildReferenceToolMap } from "../referenceTools";

export const promptProtocolHeader = "MindLinker Prompt Protocol v1";

export const mathFormulaProtocol = `<math_formula_protocol>
- 数学公式使用 LaTeX。
- 行内公式使用 $...$ 或 \\(...\\)，不要写成 \\$...\\$。
- 块级公式必须使用三行标准格式：第一行只写 $$，第二行只写公式本体，第三行只写 $$。
- $$ 所在行只能包含 $$，不能包含“即”“公式为”等任何正文。
- 不要使用 \`\`\`math、\`\`\`latex 或任何代码围栏包裹数学公式。
- 不要使用 Markdown 引用块表达定义、公式或推导；不要在行首添加 >。
- 不要把数学符号写成行内代码；错误示例：\`i\`、\`a_i/b_i\`；正确写法：$i$、$a_i/b_i$。
- 禁止写成“即 $$...$$”“公式：$$...$$”或把句末标点放进公式分隔符。
- 分式必须写成 \\frac{...}{...}，例如 \\log\\frac{1}{p(x)}，不要写成 1/p(x) 这类斜杠形式。
</math_formula_protocol>`;

const rewriteReferences = [
  {
    title: "Deep Learning Notes.pdf · p.8",
    quote: "最大化正确类别的对数似然与最小化交叉熵目标等价；两者都鼓励模型提高真实标签对应类别的预测概率。"
  },
  {
    title: "Introduction to Information Theory.pdf · p.12",
    quote: "交叉熵衡量目标分布下使用预测分布编码样本时的平均编码代价。"
  }
];

export const buildRewritePrompt = (selectedText: string) => `${promptProtocolHeader}

<task>重写回答选区</task>

<instruction>
请重写下面的回答选区，使它更适合课程学习/论文阅读场景。
</instruction>

<input>
当前选区：
${selectedText}

参考片段：
${rewriteReferences.map((reference, index) => `${index + 1}. ${reference.title}\n${reference.quote}`).join("\n\n")}
</input>

<output_format>
- 只输出重写后的文本。
- 用清晰的学习笔记语言表达。
- 保留仍然有效的术语标记和解释锚点；如果重写导致原标记不再适用，说明需要重新生成解释。
</output_format>

<prohibitions>
- 不要引入与参考片段矛盾的新说法。
- 不要输出解释过程、JSON、标题字段或调试信息。
- 不要改写成过度口语化的说明。
</prohibitions>`;

export const buildChatInstructionText = (answerMode: AnswerMode) => `${promptProtocolHeader}

<task>
主回复生成
</task>

<instruction>
你是面向课程学习、理论知识和论文阅读的学习助手。请严格依据用户上传的参考材料优先回答；如果参考不足，明确说明。
</instruction>

<input>
- 用户问题在后续消息中给出。
- 参考材料的可提取文本会尽量完整提供；页面图片、图表和多模态附件只作为视觉补充随消息提供。
- 当前详细程度：${answerModePrompts[answerMode].label}。
</input>

<output_format>
- 输出只包含给用户看的主回复正文。
- 直接进入实质内容或合适的标题。
- 使用自然 Markdown 与 LaTeX 组织正文。
- 如需引用参考资料中的原始图片，只能使用参考上下文中列出的 <REFERENCE_IMAGE> id，并写成 [[ref-image:图片ID]] 或 <ref-image id="图片ID" />。
</output_format>

${mathFormulaProtocol}

<reference_image_protocol>
- 只有 <REFERENCE_IMAGE> 列出的图片可以被引用。
- 不要引用 PDF 页面截图、页面渲染图或 <IMAGE FOR PAGE: ...> 这类页面占位图。
- 不要编造图片 id；没有合适图片时直接用文字说明。
- 图片引用标签可以出现在回答的任意位置，应用会自动渲染对应图片。
</reference_image_protocol>

<answer_detail_protocol>
${answerModePrompts[answerMode].instruction}
</answer_detail_protocol>

<prohibitions>
- 不要输出内部字段名、JSON、调试信息或 answer-xxx 标签。
- 不要以“好的”、“当然”、“我是...助手”、“我将基于...”、“下面我将...”这类寒暄、自我介绍或任务复述开头。
- 不要自我介绍，不要说明你会做什么。
</prohibitions>`;

export const buildReferencePlanningPrompt = (
  prompt: string,
  documents: ParsedReferenceDocument[],
  searchContext = "",
  readHistory = ""
) => `${promptProtocolHeader}

<task>参考资料视觉补充规划</task>

<instruction>
最终回答请求会默认提供全部可提取文本。你不需要选择文本页来让模型“读文字”。
请根据用户问题、参考地图、文本搜索结果和已经补充过的视觉记录，选择下一轮最值得作为多模态图片输入补充的 PDF 页面图片和参考图片。
目标是在文本已经完整可见的基础上，补足图表、复杂公式、扫描页、网络拓扑、流程图、表格或排版信息。
如果某些页面文字很少、为空或 textQuality="poor"，说明文本解析可能不足，更应该主动选择页面图像来确认版面、公式、图表或扫描内容。
如果用户要求讲解整份材料、课程章节、论文或多个参考，请倾向于覆盖关键图表页和视觉密集页；不要只停留在前几页。
你可以多轮选择视觉补充：本轮看完后，如果仍需要更多图像才能可靠回答，请将 continueReading 设为 true；如果视觉补充已经足够，请设为 false。
文本搜索结果只是一种辅助线索。没有搜索命中并不表示参考资料中没有相关内容，也不表示用户问题无法根据参考回答。
</instruction>

<input>
用户问题：
${prompt}

参考地图：
${buildReferenceToolMap(documents) || "无"}

文本搜索工具结果：
${searchContext || "尚未执行文本搜索。"}

已经阅读过的记录：
${readHistory || "<NO_REFERENCE_READS_YET />"}
</input>

<tool_budget>
- 本轮 pages 最多选择 12 页；这里的 pages 表示需要作为页面图片补充的页，不表示文本页选择。
- 本轮 images 最多选择 3 张。
- 优先选择尚未补充过、且能补足当前视觉理解缺口的页面图片或参考图片。
- 文字很少、为空或 textQuality="poor" 的页面优先级更高，尤其当它与用户问题、目录、章节标题、图表或公式有关。
- 如果用户要求讲解整份材料，优先选择目录、总览、章节开头、关键定义/公式/图表页，而不是逐页全选。
- 如果问题明显聚焦某一主题，优先选择主题相关的图、表、公式页或扫描页。
- 如果文本搜索没有命中，仍要依据参考地图、页面摘要、章节标题、图表页和页面图片需求选择可能相关的视觉补充。
</tool_budget>

<search_result_limits>
- <NO_TEXT_SEARCH_HITS /> 只表示当前关键词没有在已提取文本中命中。
- <UNSEARCHABLE_PDF> 表示该 PDF 的文本可能不可检索，常见原因包括扫描件、图片型页面、OCR 缺失或复杂排版。
- 不要把“没有搜索命中”解释为“资料没有相关内容”。
- 不要因为搜索无命中而放弃选择页面；必要时选择概览页、目录页、章节开头、疑似相关页或需要图片理解的页面。
</search_result_limits>

<json_output_protocol>
{
  "continueReading": false,
  "reason": "简短说明本轮视觉补充目的，以及为什么需要或不需要继续补充",
  "pages": [
    {"documentId":"参考文档 id","pages":[1,2,3]}
  ],
  "images": ["REFERENCE_IMAGE id"]
}
</json_output_protocol>

<prohibitions>
- 只输出 JSON，不要输出解释。
- 不要选择参考地图中不存在的 documentId、页码或图片 id。
- pages 只能选择参考地图中 hasPageImage="true" 或明显需要视觉理解的页面。
</prohibitions>`;

export const buildReferenceSearchTermsPrompt = (
  prompt: string,
  documents: ParsedReferenceDocument[]
) => `${promptProtocolHeader}

<task>参考文本搜索词规划</task>

<instruction>
请根据用户问题和参考地图，给出最值得在 PDF 已提取文本中检索的关键词。关键词用于本地搜索工具，不是最终回答。
</instruction>

<input>
用户问题：
${prompt}

参考地图：
${buildReferenceToolMap(documents) || "无"}
</input>

<tool_description>
search_pdf_text 可在 PDF 已提取文本中检索多个关键词，并返回命中文本片段与页码标记。如果某个 PDF 没有可检索文本，工具会返回不可检索原因。搜索无命中只代表这些关键词没有在已提取文本中出现，不代表参考资料没有相关内容。
</tool_description>

<json_output_protocol>
{"terms":["关键词1","关键词2","关键词3"]}
</json_output_protocol>

<prohibitions>
- 只输出 JSON，不要输出解释。
- terms 最多 8 个。
- 关键词要短而具体，优先选择用户问题中的核心概念、公式名、方法名、章节名或同义英文术语。
- 不要输出完整句子。
</prohibitions>`;

export const buildExplainableTermsPrompt = (
  answer: string,
  documents: ParsedReferenceDocument[]
) => `${promptProtocolHeader}

<task>关键词抽取任务</task>

<instruction>
请阅读主回复和参考材料，梳理适合生成解释链的关键词、专有名词、理论概念、定理、公式名、符号含义、方法名和容易误解的短语。只抽取主回复中实际出现、用户点击后值得进一步了解的词语。
</instruction>

<input>
主回复：
${answer}

参考材料：
${buildReferenceContext(documents).slice(0, 12_000) || "无"}
</input>

<json_output_protocol>
{
  "terms": [
    {"id":"semantic-english-id","term":"主回复中出现的原词"}
  ]
}
</json_output_protocol>

<prohibitions>
- 不要输出 JSON 之外的说明文字。
- 不要抽取主回复中没有出现的词。
- 不要输出解释正文。
- 不要输出 [[ml:id]] 或任何解释链标记。
- id 使用小写英文、数字和连字符，term 保持主回复中的显示文字。
</prohibitions>`;

export const buildExplanationChainPrompt = (
  answer: string,
  markedTerms: MarkedTerm[],
  documents: ParsedReferenceDocument[],
  options: { allowNestedMarkers?: boolean } = {}
) => {
  const referenceContext = buildReferenceContext(documents).slice(0, 24_000);
  const termList = markedTerms.map((term) => `${term.ordinal}. id=${term.id}; term=${term.term}`).join("\n");
  const nestedMarkerInstruction = options.allowNestedMarkers
    ? "解释正文 body 中如果确实出现还值得继续解释的术语，请使用 [[ml:stable-english-id]]术语[[/ml]] 标记；结束标签必须严格为 [[/ml]]，严禁写成 [[/ml:id]]；裸 [[id]] 是非法格式，例如 [[convex-function]] 是错误写法，如果要标记凸函数，必须写成 [[ml:convex-function]]凸函数[[/ml]]；id 使用语义化英文小写短横线，不要复用 stable-english-id 这个示例 id；不要超过必要数量。"
    : "";

  return `${promptProtocolHeader}

<task>
解释链生成
</task>

<instruction>
为课程学习、理论知识和论文阅读场景生成名词解释。只解释“待解释词表”中列出的项目，一个 id 对应一个解释，不要合并同名词。优先使用参考材料，其次使用当前上下文。
</instruction>

<input>
上一阶段可见正文：
${answer}

参考材料：
${referenceContext || "无"}

待解释词表：
${termList}
</input>

<json_output_protocol>
[
  {"id":"与待解释词表一致的 id","term":"术语","body":"面向学习者的简洁解释","source":"尽量指出参考来源或当前回答","nested":["可继续解释的词"]}
]
</json_output_protocol>

${nestedMarkerInstruction ? `<explanation_body_marker_protocol>\n${nestedMarkerInstruction}\n</explanation_body_marker_protocol>` : ""}

<prohibitions>
- 不要输出 JSON 之外的说明文字。
- 不要解释待解释词表之外的项目。
- 不要合并同名但不同 id 的项目。
- 不要编造参考来源。
</prohibitions>`;
};

export const buildProjectTitlePrompt = (
  prompt: string,
  referenceTitles: string[],
  documents: ParsedReferenceDocument[],
  context: { projectTitle?: string; conversationTitle?: string } = {}
) => `${promptProtocolHeader}

<task>项目标题生成任务</task>

<instruction>
请根据用户问题、参考材料标题、参考材料摘要和已有项目/对话上下文，归纳一个 4 到 12 个字的学习标题。
</instruction>

<input>
用户问题：
${prompt}

已有上下文：
项目：${context.projectTitle?.trim() || "新项目"}
对话：${context.conversationTitle?.trim() || "新对话"}

参考材料：
${referenceTitles.length > 0 ? referenceTitles.join("、") : "无"}

参考材料摘要：
${buildReferenceContext(documents).slice(0, 5000) || "无"}
</input>

<output_format>
- 只输出标题。
- 标题长度为 4 到 12 个字。
- 不要引号、解释或标点。
</output_format>

<prohibitions>
- 不要依据主回复正文或模型回答命名。
- 不要输出 Markdown、JSON 或多行内容。
- 不要使用“新项目”“新对话”等占位词。
</prohibitions>`;

export const buildInlineConversationTitlePrompt = (conversation: InlineConversation) => `${promptProtocolHeader}

<task>位置问答标题生成任务</task>

<instruction>
请根据保存的位置问答内容，归纳一个 4 到 12 个字的标题，便于用户在汇总面板中识别。
</instruction>

<input>
提问位置：
${conversation.positionLabel}

问答内容：
${conversation.messages.map((message) => `${message.role === "user" ? "用户" : "回答"}：${message.content}`).join("\n")}
</input>

<output_format>
- 只输出标题。
- 标题长度为 4 到 12 个字。
- 不要引号、解释、编号或标点。
</output_format>

<prohibitions>
- 不要输出 Markdown、JSON 或多行内容。
- 不要使用“位置问答”“新的问答”等占位词。
</prohibitions>`;

export const buildInlineQuestionPrompt = (
  question: string,
  draft: ConversationDraft | null,
  documents: ParsedReferenceDocument[],
  positionLabel: string,
  messages: InlineConversationMessage[]
) => `${promptProtocolHeader}

<task>位置提问回答</task>

<instruction>
回答用户在主回复某个位置插入的局部提问。请依据参考材料、主回复全文、提问位置标记和已有小窗问答，直接回答当前问题。
</instruction>

<input>
提问位置标记：
${positionLabel}

主回复：
${draft?.answerMarkdown || "当前对话还没有主回复正文。"}

参考材料：
${buildReferenceContext(documents).slice(0, 18_000) || "无"}

已有小窗问答：
${messages.length > 0 ? messages.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n") : "无"}

当前问题：
${question}
</input>

<output_format>
- 只输出当前问题的回答正文。
- 回答应当聚焦提问位置与当前问题。
- 可以引用主回复或参考材料中的概念，但不要改写主回复全文。
</output_format>

<prohibitions>
- 不要输出 JSON、调试信息或内部字段名。
- 不要复述完整主回复。
- 不要编造参考材料中不存在的来源。
</prohibitions>`;
