import { describe, it, expect } from "vitest";

import { selectMode } from "../src/index.js";

describe("selectMode", () => {
  it("a pull_request runs in comment mode", () => {
    expect(
      selectMode({ eventName: "pull_request", developmentBranch: "main" }),
    ).toBe("comment");
    expect(
      selectMode({ eventName: "pull_request_target", developmentBranch: "main" }),
    ).toBe("comment");
  });

  it("a push to the development branch runs in baseline mode", () => {
    expect(
      selectMode({ eventName: "push", refName: "main", developmentBranch: "main" }),
    ).toBe("baseline");
  });

  it("a push to a non-development branch is skipped", () => {
    expect(
      selectMode({
        eventName: "push",
        refName: "feature/x",
        developmentBranch: "main",
      }),
    ).toBe("skip");
  });

  it("honors a non-default development branch", () => {
    expect(
      selectMode({ eventName: "push", refName: "trunk", developmentBranch: "trunk" }),
    ).toBe("baseline");
    expect(
      selectMode({ eventName: "push", refName: "main", developmentBranch: "trunk" }),
    ).toBe("skip");
  });

  it("workflow_dispatch baselines on the dev branch, else comments", () => {
    expect(
      selectMode({
        eventName: "workflow_dispatch",
        refName: "main",
        developmentBranch: "main",
      }),
    ).toBe("baseline");
    expect(
      selectMode({
        eventName: "workflow_dispatch",
        refName: "topic",
        developmentBranch: "main",
      }),
    ).toBe("comment");
  });

  it("an explicit override wins over the event", () => {
    expect(
      selectMode({
        eventName: "pull_request",
        developmentBranch: "main",
        override: "skip",
      }),
    ).toBe("skip");
    expect(
      selectMode({
        eventName: "push",
        refName: "feature/x",
        developmentBranch: "main",
        override: "baseline",
      }),
    ).toBe("baseline");
  });

  it("'auto' (or blank) override defers to the event", () => {
    expect(
      selectMode({
        eventName: "push",
        refName: "main",
        developmentBranch: "main",
        override: "auto",
      }),
    ).toBe("baseline");
    expect(
      selectMode({
        eventName: "push",
        refName: "main",
        developmentBranch: "main",
        override: "  ",
      }),
    ).toBe("baseline");
  });

  it("an unknown event comments only when a PR is in context", () => {
    expect(
      selectMode({ eventName: "schedule", developmentBranch: "main" }),
    ).toBe("skip");
    expect(
      selectMode({
        eventName: "schedule",
        developmentBranch: "main",
        prNumber: 7,
      }),
    ).toBe("comment");
  });
});
