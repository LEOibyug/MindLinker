export const normalizePlainTextForAnchor = (text: string) =>
  text
    .replace(/\[\[ml:([^\]\n]+)\]\]([\s\S]*?)\[\[\/ml(?::\1)?\]\]/g, "$2")
    .replace(/\[\[\/ml(?::[^\]\n]+)?\]\]/g, "")
    .replace(/\[\[ml:([^\]\n]+)\]\](?=\[\[ml:|\s|$|[，。；：、,.!?])/g, (_match, rawId: string) => rawId.trim())
    .replace(/\[\[ml:[^\]\n]+\]\]/g, "")
    .replace(/\[\[([^\]\n]{1,100})\]\]/g, (_match, rawId: string) => rawId.trim())
    .replace(/```(?:math|latex|tex)?/gi, "")
    .replace(/\$\$/g, "")
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
