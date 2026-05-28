import type { MutableRefObject } from "react";
import {
  buildConversationDraft,
  completeConversationDraft,
  sanitizeProjectTitle
} from "../domain/conversationDrafts";
import type { ConversationDraft } from "../domain/conversationDrafts";
import { bindExplanationsToMarkedTerms } from "../domain/explanations";
import type { Explanation } from "../domain/explanations";
import { buildFallbackMarkedTerms } from "../domain/knowledgeGraph";
import {
  findChatModelConfig,
  requestChatCompletion,
  requestExplainableTerms,
  requestExplanationChain,
  requestProjectTitle
} from "../services/modelClient";
import type { ParsedReferenceDocument } from "../services/pdfReferences";
import {
  buildNeedsConfigurationDraft,
  buildStreamingDraft,
  chooseExplanationTerms,
  missingMainModelMessage,
  shouldLogStreamingChunk
} from "../services/conversationGeneration";
import type { StreamingLogState } from "../services/conversationGeneration";
import { appendRuntimeLog } from "../services/runtimeLog";
import { chunkMarkedTerms, getVisiblePartialMarkedAnswer, parseMarkedAnswer, stripExplainableMarkers } from "../domain/markedTerms";
import type { LearningProject, ProviderConfig } from "../domain/types";

type StateSetter<T> = (updater: T | ((value: T) => T)) => void;
type GenerationPhase = "idle" | "content" | "annotations" | "ready";
type ConversationStatus = LearningProject["conversations"][number]["status"];

const waitForMinimumGenerationFrame = () => new Promise((resolve) => window.setTimeout(resolve, 480));

export type UseConversationGenerationOptions = {
  activeConversationId: string;
  activeProjectId: string;
  activeProviderId: string;
  conversationDrafts: Record<string, ConversationDraft>;
  conversationExplanations: Record<string, Explanation[]>;
  customProviders: ProviderConfig[];
  activeConversationReferenceState: string;
  projectDocuments: ParsedReferenceDocument[];
  localProjects: LearningProject[];
  runningConversationIds: string[];
  streamingLogStateRef: MutableRefObject<Record<string, StreamingLogState>>;
  isConversationVisible: (conversationId: string, projectId: string) => boolean;
  markConversationRunning: (conversationId: string, status: "generating-content" | "generating-annotations") => void;
  markConversationSettled: (conversationId: string, status: "idle" | "ready") => void;
  setAnnotationsRevealed: StateSetter<boolean>;
  setAvailableExplanations: StateSetter<Explanation[]>;
  setConversationExplanations: StateSetter<Record<string, Explanation[]>>;
  setExplanationStack: StateSetter<Explanation[]>;
  setGenerationPhase: StateSetter<GenerationPhase>;
  setLocalProjects: StateSetter<LearningProject[]>;
  setNotice: StateSetter<string | null>;
  setProjectTitles: StateSetter<Record<string, string>>;
  setStoredConversationDrafts: StateSetter<Record<string, ConversationDraft>>;
  setVisibleConversationDrafts: StateSetter<Record<string, ConversationDraft>>;
  logDebugMessage: (message: string) => void;
};

export const useConversationGeneration = ({
  activeConversationId,
  activeProjectId,
  activeProviderId,
  conversationDrafts,
  conversationExplanations,
  customProviders,
  activeConversationReferenceState,
  projectDocuments,
  localProjects,
  runningConversationIds,
  streamingLogStateRef,
  isConversationVisible,
  markConversationRunning,
  markConversationSettled,
  setAnnotationsRevealed,
  setAvailableExplanations,
  setConversationExplanations,
  setExplanationStack,
  setGenerationPhase,
  setLocalProjects,
  setNotice,
  setProjectTitles,
  setStoredConversationDrafts,
  setVisibleConversationDrafts,
  logDebugMessage
}: UseConversationGenerationOptions) => {
  const markDraftNeedsConfiguration = (
    conversationId: string,
    draft: ConversationDraft,
    projectId = activeProjectId,
    foregroundOnStart = true
  ) => {
    const nextDraft = buildNeedsConfigurationDraft(draft);
    setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: nextDraft }));
    markConversationSettled(conversationId, "idle");
    if (foregroundOnStart || isConversationVisible(conversationId, projectId)) {
      setGenerationPhase("idle");
      setAnnotationsRevealed(false);
    }
    setNotice(missingMainModelMessage);
    logDebugMessage("跳过模型请求：没有可用的主模型 API 配置");
  };

  const generateConversation = async (
    conversationId: string,
    draft: ConversationDraft,
    documents: ParsedReferenceDocument[],
    projectId: string = activeProjectId,
    foregroundOnStart = true
  ) => {
    let foregroundGeneration = foregroundOnStart;
    const shouldUpdateVisibleConversation = () => foregroundGeneration || isConversationVisible(conversationId, projectId);
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      markDraftNeedsConfiguration(conversationId, draft, projectId, foregroundOnStart);
      return;
    }

    const projectSnapshot = localProjects.find((project) => project.id === projectId);
    const conversationSnapshot = projectSnapshot?.conversations.find((conversation) => conversation.id === conversationId);
    const isFirstProjectConversation = !projectSnapshot || projectSnapshot.conversations[0]?.id === conversationId;
    const applyGeneratedTitle = (title: string) => {
      const cleanTitle = sanitizeProjectTitle(title);
      if (!cleanTitle) {
        return;
      }
      if (isFirstProjectConversation) {
        setProjectTitles((titles) => ({ ...titles, [projectId]: cleanTitle }));
      }
      setLocalProjects((projects) =>
        projects.map((project) =>
          project.id === projectId
            ? {
                ...project,
                title: isFirstProjectConversation ? cleanTitle : project.title,
                conversations: project.conversations.map((conversation) =>
                  conversation.id === conversationId ? { ...conversation, title: cleanTitle } : conversation
                )
              }
            : project
        )
      );
      setStoredConversationDrafts((drafts) =>
        drafts[conversationId]
          ? {
              ...drafts,
              [conversationId]: {
                ...drafts[conversationId],
                title: cleanTitle
              }
            }
          : drafts
      );
    };

    markConversationRunning(conversationId, "generating-content");
    delete streamingLogStateRef.current[conversationId];
    if (shouldUpdateVisibleConversation()) {
      setGenerationPhase("content");
    }
    setNotice("正在请求主模型");
    logDebugMessage(`开始请求模型：${chatConfig.provider.name} / ${chatConfig.model.name}`);
    try {
      const runtimeContext = {
        projectId,
        conversationId,
        projectTitle: projectSnapshot?.title,
        conversationTitle: conversationSnapshot?.title ?? draft.title
      };
      const answerPromise = requestChatCompletion(
        draft.prompt,
        documents,
        chatConfig.provider,
        chatConfig.model,
        draft.answerMode,
        (partialAnswer) => {
          const visibleAnswer = getVisiblePartialMarkedAnswer(partialAnswer);
          if (!visibleAnswer.trim()) {
            return;
          }
          const previousLog = streamingLogStateRef.current[conversationId] ?? { lastLength: 0, lastLoggedAt: 0 };
          const now = Date.now();
          if (shouldLogStreamingChunk(previousLog, { rawLength: partialAnswer.length, now })) {
            appendRuntimeLog("model", "主模型流式片段", {
              ...runtimeContext,
              visibleLength: visibleAnswer.length,
              rawLength: partialAnswer.length
            });
            streamingLogStateRef.current[conversationId] = { lastLength: partialAnswer.length, lastLoggedAt: now };
          }
          setVisibleConversationDrafts((drafts) => ({
            ...drafts,
            [conversationId]: buildStreamingDraft(draft, visibleAnswer)
          }));
          if (shouldUpdateVisibleConversation()) {
            setGenerationPhase("idle");
          }
        },
        runtimeContext
      );
      const titlePromise = requestProjectTitle(
        draft.prompt,
        draft.referenceTitles,
        documents,
        chatConfig.provider,
        chatConfig.model,
        {
          projectTitle: projectSnapshot?.title,
          conversationTitle: conversationSnapshot?.title ?? draft.title
        }
      )
        .then(applyGeneratedTitle)
        .catch((error) => logDebugMessage(error instanceof Error ? error.message : String(error)));
      const [answerMarkdown] = await Promise.all([
        answerPromise,
        waitForMinimumGenerationFrame()
      ]);
      const parsedAnswer = parseMarkedAnswer(answerMarkdown);
      const cleanAnswer = parsedAnswer.cleanMarkdown;
      const completedDraft = completeConversationDraft({
        ...draft,
        answerMarkdown: cleanAnswer,
        explanationTerms: [],
        modelStatus: "generated"
      });
      setStoredConversationDrafts((drafts) => ({ ...drafts, [conversationId]: completedDraft }));
      setConversationExplanations((items) => ({ ...items, [conversationId]: items[conversationId] ?? [] }));
      if (shouldUpdateVisibleConversation()) {
        setVisibleConversationDrafts((drafts) => ({ ...drafts, [conversationId]: completedDraft }));
        setAvailableExplanations([]);
        setExplanationStack([]);
        setAnnotationsRevealed(false);
        setGenerationPhase("ready");
        setNotice("回答已生成");
      }
      foregroundGeneration = false;
      logDebugMessage("模型主回复生成完成");
      void titlePromise;
      markConversationSettled(conversationId, "ready");
      delete streamingLogStateRef.current[conversationId];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStoredConversationDrafts((drafts) => ({
        ...drafts,
        [conversationId]: {
          ...draft,
          answerMarkdown: buildNeedsConfigurationDraft(draft).answerMarkdown,
          modelStatus: "failed",
          modelError: message,
          generated: false
        }
      }));
      markConversationSettled(conversationId, "idle");
      delete streamingLogStateRef.current[conversationId];
      if (shouldUpdateVisibleConversation()) {
        setGenerationPhase("idle");
      }
      setNotice(message);
      logDebugMessage(message);
    }
  };

  const generateExplanationsForConversation = async (
    conversationId: string = activeConversationId,
    projectId: string = activeProjectId,
    documents: ParsedReferenceDocument[] = projectDocuments,
    draft: ConversationDraft | null = conversationDrafts[activeConversationId] ?? null,
    referenceState = activeConversationReferenceState
  ) => {
    if (!draft?.answerMarkdown.trim()) {
      setNotice("当前回答为空，无法生成解释链");
      return;
    }
    if (runningConversationIds.includes(conversationId)) {
      setNotice("当前对话仍在生成中，请稍后再试");
      return;
    }
    const chatConfig = findChatModelConfig(customProviders, activeProviderId);
    if (!chatConfig) {
      setNotice(missingMainModelMessage);
      return;
    }
    const shouldUpdateVisibleConversation = () => isConversationVisible(conversationId, projectId);
    const parsedAnswer = parseMarkedAnswer(draft.answerMarkdown);
    const cleanAnswer = parsedAnswer.cleanMarkdown;
    const runtimeContext = {
      projectId,
      conversationId,
      conversationTitle: draft.title
    };

    markConversationRunning(conversationId, "generating-annotations");
    if (shouldUpdateVisibleConversation()) {
      setGenerationPhase("annotations");
      setNotice("正在生成解释链");
      setExplanationStack([]);
    }

    try {
      const extractedTerms = await requestExplainableTerms(
        cleanAnswer,
        documents,
        chatConfig.provider,
        chatConfig.model,
        runtimeContext
      );
      const fallbackTerms = extractedTerms.length > 0 || parsedAnswer.terms.length > 0 ? [] : buildFallbackMarkedTerms(cleanAnswer);
      const explanationTerms = chooseExplanationTerms({
        extractedTerms,
        legacyTerms: parsedAnswer.terms,
        fallbackTerms
      });
      appendRuntimeLog("model", "解释词表确定", {
        ...runtimeContext,
        extractedTermCount: extractedTerms.length,
        legacyMarkerTermCount: extractedTerms.length > 0 ? 0 : parsedAnswer.terms.length,
        fallbackTermCount: fallbackTerms.length,
        terms: explanationTerms.map((term) => ({ id: term.id, term: term.term, ordinal: term.ordinal }))
      });
      setStoredConversationDrafts((drafts) => ({
        ...drafts,
        [conversationId]: {
          ...(drafts[conversationId] ?? draft),
          answerMarkdown: cleanAnswer,
          explanationTerms
        }
      }));
      if (explanationTerms.length === 0) {
        setConversationExplanations((items) => ({ ...items, [conversationId]: [] }));
        if (shouldUpdateVisibleConversation()) {
          setAvailableExplanations([]);
          setAnnotationsRevealed(false);
          setNotice("没有找到适合解释的关键词");
        }
        return;
      }

      const explanationGroups = chunkMarkedTerms(explanationTerms);
      const groupedExplanations = await Promise.all(
        explanationGroups.map((termGroup, groupIndex) =>
          requestExplanationChain(
            cleanAnswer,
            termGroup,
            documents,
            chatConfig.provider,
            chatConfig.model,
            referenceState,
            { allowNestedMarkers: false, reason: "answer" },
            { ...runtimeContext, explanationGroup: groupIndex + 1, explanationGroupCount: explanationGroups.length }
          )
        )
      );
      const cleanedExplanations = bindExplanationsToMarkedTerms(
        groupedExplanations.flat().map((explanation) => ({
          ...explanation,
          body: stripExplainableMarkers(explanation.body),
          nested: []
        })),
        explanationTerms
      );
      setConversationExplanations((items) => ({ ...items, [conversationId]: cleanedExplanations }));
      if (shouldUpdateVisibleConversation()) {
        setAvailableExplanations(cleanedExplanations);
        setExplanationStack([]);
        setAnnotationsRevealed(cleanedExplanations.length > 0);
        setNotice(cleanedExplanations.length > 0 ? "解释链生成完成" : "解释链为空");
      }
      logDebugMessage(
        cleanedExplanations.length > 0
          ? `解释链生成完成：${cleanedExplanations.length} 项`
          : "解释链为空"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      logDebugMessage(message);
    } finally {
      markConversationSettled(conversationId, "ready");
      if (shouldUpdateVisibleConversation()) {
        setGenerationPhase("ready");
      }
    }
  };

  return {
    generateConversation,
    generateExplanationsForConversation
  };
};
