type Message = { role: "user" | "assistant"; content: string; upload?: boolean; needsPhoto?: boolean; error?: boolean; stopped?: boolean };

export function wineHistory<T extends Message>(messages: T[]) {
  const list = [...messages].reverse().find((m) => m.role === "user" && m.upload && !m.needsPhoto);
  const conversation = messages.filter((m) => !m.upload && !m.needsPhoto && !m.error && !m.stopped);
  // The API accepts six history turns. Reserve two for the current list.
  return [
    ...conversation.slice(list ? -4 : -6),
    ...(list ? [list, { role: "assistant" as const, content: "Wine list updated. What do you want to know?" }] : []),
  ].map(({ role, content }) => ({ role, content }));
}

export function retainedMessages<T extends Message>(messages: T[]): T[] {
  const recent = messages.slice(-40);
  const list = [...messages].reverse().find((m) => m.role === "user" && m.upload && !m.needsPhoto);
  const listIndex = list ? messages.indexOf(list) : -1;
  return listIndex >= 0 && listIndex < messages.length - 40
    ? [...messages.slice(listIndex, listIndex + 2), ...messages.slice(-38)]
    : recent;
}
