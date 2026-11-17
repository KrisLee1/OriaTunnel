export type SavedCommand = {
  id: string;
  command: string;
  keywords: string[];
};
export type SavedCommandLibrary = { revision: number; entries: SavedCommand[] };

const normalized = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase();

export function commandKeywords(input: string) {
  const seen = new Set<string>();
  return input
    .split(/[,，、\n]/u)
    .map((k) => k.trim())
    .filter((keyword) => {
      const key = normalized(keyword);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function matchingCommands(entries: SavedCommand[], input: string) {
  const query = normalized(input);
  if (!query) return [];
  return entries
    .map((entry) => {
      let rank = 3;
      for (const keyword of entry.keywords) {
        const key = normalized(keyword);
        if (key === query) {
          rank = 0;
          break;
        }
        if (key.startsWith(query)) rank = Math.min(rank, 1);
        else if (key.includes(query)) rank = Math.min(rank, 2);
      }
      return { entry, rank };
    })
    .filter((result) => result.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .map((result) => result.entry);
}
