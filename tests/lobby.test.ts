import { describe, it, expect } from "vitest";
import { laneStatus, laneSignature } from "../src/client/lobby";
import { emptyLanes } from "../src/shared/protocol";

describe("laneStatus", () => {
  it("classifies each lane relative to the viewer", () => {
    const lanes = emptyLanes();
    lanes[0].claimedBy = "me";
    lanes[1].claimedBy = "other";
    lanes[2].claimedBy = "other";
    lanes[2].filled = true;
    expect(laneStatus(lanes[0], "me", "me")).toBe("yours");
    expect(laneStatus(lanes[1], "me", "me")).toBe("claimed");
    expect(laneStatus(lanes[2], "me", "me")).toBe("filled");
    expect(laneStatus(lanes[3], "me", "me")).toBe("open");
  });
});

describe("laneSignature", () => {
  // The signature is the reconcile key: a card is only rebuilt (destroying its
  // in-progress form input) when its signature changes. So it must be stable
  // for server-irrelevant churn and change when the rendered content changes.
  it("is stable when the lane's server state is unchanged", () => {
    const a = emptyLanes()[0];
    a.claimedBy = "me";
    const b = { ...a };
    expect(laneSignature(a, "me")).toBe(laneSignature(b, "me"));
  });

  it("does not change when an unrelated other-owner claim churns", () => {
    // A lane claimed by another player, then re-claimed by a different other
    // player, should keep the same signature (the card renders "Claimed…"
    // either way — no need to rebuild).
    const l1 = emptyLanes()[0];
    l1.claimedBy = "alice";
    const l2 = emptyLanes()[0];
    l2.claimedBy = "bob";
    expect(laneSignature(l1, "me")).toBe(laneSignature(l2, "me"));
  });

  it("changes when the lane becomes filled", () => {
    const before = emptyLanes()[0];
    before.claimedBy = "me";
    const after = { ...before, filled: true, horseName: "Seabiscuit", image: "data:image/x" };
    expect(laneSignature(before, "me")).not.toBe(laneSignature(after, "me"));
  });

  it("changes when ownership flips to or from you", () => {
    const mine = emptyLanes()[0];
    mine.claimedBy = "me";
    const theirs = emptyLanes()[0];
    theirs.claimedBy = "other";
    expect(laneSignature(mine, "me")).not.toBe(laneSignature(theirs, "me"));
  });

  it("changes when a name is edited and saved", () => {
    const before = emptyLanes()[0];
    before.claimedBy = "me";
    before.filled = true;
    before.horseName = "Old";
    const after = { ...before, horseName: "New" };
    expect(laneSignature(before, "me")).not.toBe(laneSignature(after, "me"));
  });
});
