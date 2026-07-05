import { describe, expect, it } from "vitest";

import { reconcile, type ExistingCard } from "../src/reconcile.js";

const card = (componentId: string, nodeId: string): ExistingCard => ({
  componentId,
  nodeId,
});

describe("reconcile", () => {
  it("updates matches, adds newcomers, and leaves nothing stale on a clean superset", () => {
    const existing = [card("Button/Filled", "1:1"), card("Switch/On", "1:2")];
    const actions = reconcile(existing, ["Button/Filled", "Switch/On", "Chip/Assist"]);

    expect(actions.update).toEqual(["Button/Filled", "Switch/On"]);
    expect(actions.add).toEqual(["Chip/Assist"]);
    expect(actions.stale).toEqual([]);
  });

  it("tags cards gone from the catalog as stale without deleting them", () => {
    const existing = [card("Button/Filled", "1:1"), card("Fab/Legacy", "1:9")];
    const actions = reconcile(existing, ["Button/Filled"]);

    expect(actions.update).toEqual(["Button/Filled"]);
    expect(actions.add).toEqual([]);
    expect(actions.stale).toEqual([card("Fab/Legacy", "1:9")]);
  });

  it("matches by componentId regardless of position — a moved card still updates", () => {
    // The board order differs from the plan order; matching is by identity.
    const existing = [card("Switch/On", "1:2"), card("Button/Filled", "1:1")];
    const actions = reconcile(existing, ["Button/Filled", "Switch/On"]);

    expect(actions.update).toEqual(["Button/Filled", "Switch/On"]);
    expect(actions.stale).toEqual([]);
  });

  it("first stamp of a duplicated componentId wins the update; extras go stale", () => {
    const existing = [
      card("Button/Filled", "1:1"),
      card("Button/Filled", "1:5"),
    ];
    const actions = reconcile(existing, ["Button/Filled"]);

    expect(actions.update).toEqual(["Button/Filled"]);
    expect(actions.stale).toEqual([card("Button/Filled", "1:5")]);
  });

  it("preserves plan order for update and add buckets and ignores plan dupes", () => {
    const existing = [card("B", "1:2")];
    const actions = reconcile(existing, ["A", "B", "A"]);

    expect(actions.add).toEqual(["A"]);
    expect(actions.update).toEqual(["B"]);
  });

  it("an empty board adds everything", () => {
    const actions = reconcile([], ["A", "B"]);
    expect(actions.add).toEqual(["A", "B"]);
    expect(actions.update).toEqual([]);
    expect(actions.stale).toEqual([]);
  });
});
