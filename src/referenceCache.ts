import type { ReferenceParseCacheEntry } from "./conversationDrafts";
import type { LearningProject } from "./domain";
import type { ParsedReferenceDocument } from "./pdfReferences";

export const getFileFingerprint = (file: File) => `${file.name}:${file.size}:${file.type || "application/octet-stream"}`;

export const cloneParsedReferenceForProject = (
  document: ParsedReferenceDocument,
  projectId: string,
  index: number,
  timestamp = Date.now()
): ParsedReferenceDocument => ({
  ...document,
  id: `${projectId}-reference-${index}-${timestamp}`
});

export const createReferenceCacheEntry = (
  document: ParsedReferenceDocument,
  fingerprint: string
): ReferenceParseCacheEntry => ({
  document: {
    ...document,
    id: `cache-${fingerprint}`
  }
});

const getRemainingProjectDocumentIds = (
  projects: LearningProject[],
  activeProjectId: string,
  removedDocumentIds: string[]
) =>
  new Set(
    projects.flatMap((project) =>
      project.id === activeProjectId
        ? project.documents.filter((id) => !removedDocumentIds.includes(id))
        : project.documents
    )
  );

export const pruneReferenceDocuments = ({
  activeProjectId,
  documents,
  projects,
  removedDocumentIds
}: {
  activeProjectId: string;
  documents: ParsedReferenceDocument[];
  projects: LearningProject[];
  removedDocumentIds: string[];
}) => {
  if (removedDocumentIds.length === 0) {
    return documents;
  }
  const remainingProjectDocumentIds = getRemainingProjectDocumentIds(projects, activeProjectId, removedDocumentIds);
  return documents.filter(
    (document) => !removedDocumentIds.includes(document.id) || remainingProjectDocumentIds.has(document.id)
  );
};

export const pruneReferenceCache = (
  cache: Record<string, ReferenceParseCacheEntry>,
  remainingDocuments: ParsedReferenceDocument[]
) =>
  Object.fromEntries(
    Object.entries(cache).filter(([, entry]) =>
      remainingDocuments.some(
        (document) =>
          document.title === entry.document.title &&
          document.version === entry.document.version &&
          document.kind === entry.document.kind
      )
    )
  );
