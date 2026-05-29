import { useMemo } from "react";
import { buildConversationDraft } from "../../domain/conversationDrafts";
import type { ConversationDraft } from "../../domain/conversationDrafts";
import type { Explanation } from "../../domain/explanations";
import { bindExplanationsToAnswerText } from "../../domain/explanations";
import type { InlineConversation } from "../../domain/inlineConversations";
import { buildDraftKnowledgeGraph, buildProjectKnowledgeGraph } from "../../domain/knowledgeGraph";
import { referenceChangePlans } from "../../domain/types";
import type { ConversationKnowledgeGraph, LearningProject, VectorStore } from "../../domain/types";
import type { ParsedReferenceDocument } from "../../services/pdfReferences";

const emptyKnowledgeGraph: ConversationKnowledgeGraph = {
  nodes: [],
  edges: []
};

const emptyConversation = {
  id: "",
  title: "",
  status: "idle" as const,
  explanationSeed: "",
  referenceState: "refs:empty"
};

const emptyProject: LearningProject = {
  id: "",
  title: "",
  documents: [],
  conversations: [emptyConversation]
};

export type UseAppDerivedStateOptions = {
  activeConversationId: string;
  activeProjectId: string;
  activeProviderId: string;
  conversationDrafts: Record<string, ConversationDraft>;
  conversationExplanations: Record<string, Explanation[]>;
  explanationStack: Explanation[];
  includedDocumentIds: Record<string, string[]>;
  inlineConversations: InlineConversation[];
  localProjects: LearningProject[];
  localVectorStores: VectorStore[];
  parsedReferences: ParsedReferenceDocument[];
  projectTitles: Record<string, string>;
  referencePlanId: string | null;
  runningConversationIds: string[];
};

export const useAppDerivedState = ({
  activeConversationId,
  activeProjectId,
  activeProviderId,
  conversationDrafts,
  conversationExplanations,
  explanationStack,
  includedDocumentIds,
  inlineConversations,
  localProjects,
  localVectorStores,
  parsedReferences,
  projectTitles,
  referencePlanId,
  runningConversationIds
}: UseAppDerivedStateOptions) => {
  const activeProject = localProjects.find((project) => project.id === activeProjectId) ?? localProjects[0] ?? emptyProject;
  const activeConversation =
    activeProject.conversations.find((conversation) => conversation.id === activeConversationId) ??
    activeProject.conversations[0] ??
    emptyConversation;
  const activeProjectTitle = projectTitles[activeProject.id] ?? activeProject.title;
  const activeDocumentIds = includedDocumentIds[activeProject.id] ?? activeProject.documents;
  const sampleReferences = useMemo<ParsedReferenceDocument[]>(() => [], []);
  const allDocuments = useMemo(() => [...sampleReferences, ...parsedReferences], [parsedReferences, sampleReferences]);
  const projectDocuments = allDocuments.filter((document) => activeDocumentIds.includes(document.id));
  const activeDraft = conversationDrafts[activeConversation.id] ?? null;
  const activeConversationRunning = runningConversationIds.includes(activeConversation.id);
  const activeKnowledgeGraphResult = useMemo(() => {
    try {
      return {
        graph: buildProjectKnowledgeGraph(
          activeProject,
          activeProjectTitle,
          projectDocuments,
          conversationDrafts,
          conversationExplanations
        ),
        error: null as Error | null
      };
    } catch (error) {
      return {
        graph: buildDraftKnowledgeGraph({
          ...(activeDraft ?? buildConversationDraft(activeConversation.title, [], false, "balanced")),
          title: activeConversation.title
        }),
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }, [activeConversation.title, activeDraft, activeProject, activeProjectTitle, conversationDrafts, conversationExplanations, projectDocuments]);
  const activeKnowledgeGraph = activeKnowledgeGraphResult.graph || emptyKnowledgeGraph;
  const visibleStack = useMemo(() => [...explanationStack].reverse(), [explanationStack]);
  const activeConversationExplanations = useMemo(
    () => conversationExplanations[activeConversation.id] ?? [],
    [activeConversation.id, conversationExplanations]
  );
  const renderedConversationExplanations = useMemo(
    () => bindExplanationsToAnswerText(activeDraft?.answerMarkdown ?? "", activeConversationExplanations),
    [activeDraft?.answerMarkdown, activeConversationExplanations]
  );
  const activeReferencePlan = referencePlanId
    ? referenceChangePlans.find((plan) => plan.id === referencePlanId) ?? null
    : null;
  const projectVectorStores = localVectorStores.filter((store) => store.projectId === activeProject.id);
  const activeInlineConversations = inlineConversations.filter(
    (conversation) =>
      (!conversation.projectId || conversation.projectId === activeProject.id) &&
      (!conversation.conversationId || conversation.conversationId === activeConversation.id)
  );

  return {
    activeConversation,
    activeConversationExplanations,
    activeConversationRunning,
    activeDocumentIds,
    activeDraft,
    activeInlineConversations,
    activeKnowledgeGraph,
    activeKnowledgeGraphResult,
    activeProject,
    activeProjectTitle,
    activeProviderId,
    activeReferencePlan,
    allDocuments,
    projectDocuments,
    projectVectorStores,
    renderedConversationExplanations,
    visibleStack
  };
};
