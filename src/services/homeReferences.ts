import type { HomeReferenceItem } from "../domain/conversationDrafts";
import type { ParsedReferenceDocument } from "./pdfReferences";
import { getFileFingerprint } from "./referenceCache";

export const buildHomeReferenceItems = (files: File[]): HomeReferenceItem[] =>
  files.map((file, index) => ({
    key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    fileName: file.name,
    fingerprint: getFileFingerprint(file),
    status: "parsing"
  }));

export const buildHomeReferenceStatusText = (items: HomeReferenceItem[], waitingForStart: boolean) => {
  if (items.length === 0) {
    return null;
  }
  const parsingCount = items.filter((item) => item.status === "parsing").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  if (parsingCount > 0) {
    return waitingForStart
      ? `正在本地解析参考，完成后会自动进入对话 · 剩余 ${parsingCount} 份`
      : `正在本地解析参考 · 剩余 ${parsingCount} 份`;
  }
  if (failedCount > 0) {
    return `参考已准备好，${failedCount} 份解析失败但会保留诊断`;
  }
  return `参考已准备好 · ${items.length} 份`;
};

export const removeHomeReferenceItem = ({
  files,
  items,
  key
}: {
  files: File[];
  items: HomeReferenceItem[];
  key: string;
}) => {
  const removedItem = items.find((item) => item.key === key);
  if (!removedItem) {
    return { files, items, removedItem: null };
  }
  return {
    files: files.filter((file) => getFileFingerprint(file) !== removedItem.fingerprint),
    items: items.filter((item) => item.key !== key),
    removedItem,
    hadResolvedDocuments: items.some((item) => item.document)
  };
};

export const resolveHomeReferenceDocuments = (
  items: HomeReferenceItem[],
  fallbackDocuments: ParsedReferenceDocument[],
  preferItemDocuments = false
) => {
  const itemDocuments = items
    .filter((item): item is HomeReferenceItem & { document: ParsedReferenceDocument } => Boolean(item.document))
    .map((item) => item.document);
  return itemDocuments.length > 0 || preferItemDocuments ? itemDocuments : fallbackDocuments;
};
