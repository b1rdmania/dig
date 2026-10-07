import { describe, expect, it } from "vitest";
import { retainedMessages, wineHistory } from "./history";
const list = { role: "user" as const, content: "Chablis 2022", upload: true };
const ack = { role: "assistant" as const, content: "Wine list updated. What do you want to know?", upload: true };
const turns = Array.from({ length: 44 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: String(i) }));
describe("wine-list context", () => {
  it("keeps the list inside the API's six-turn window", () => {
    const history = wineHistory([list, ack, ...turns]);
    expect(history).toHaveLength(6);
    expect(history[4]).toEqual({ role: "user", content: list.content });
    expect(history[0].content).toBe("40");
  });
  it("uses the latest successful list and ignores failed uploads", () => {
    const history = wineHistory([list, ack, { ...list, content: "Rioja" }, ack, { ...list, content: "", needsPhoto: true }]);
    expect(history[0].content).toBe("Rioja");
    expect(history).toHaveLength(2);
  });
  it("retains the active list when saving a long conversation", () => {
    const saved = retainedMessages([list, ack, ...turns]);
    expect(saved).toHaveLength(40);
    expect(saved[0]).toBe(list);
    expect(wineHistory(saved)[4].content).toBe(list.content);
    expect(wineHistory([])).toEqual([]);
  });
});
