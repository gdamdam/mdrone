/**
 * BUG 1 — Space key hijacks focused buttons. The global keydown HOLD
 * toggle only exempted INPUT/TEXTAREA/contentEditable, so a keyboard
 * user who Tabs to a button (or select, link, ARIA widget) and presses
 * Space got preventDefault() + HOLD toggle instead of activating the
 * focused control. The predicate must also ignore key-repeat so holding
 * Space down doesn't machine-gun the transport.
 */
import { describe, it, expect } from "vitest";
import {
  shouldTriggerHoldToggle,
  type HoldKeyTargetLike,
} from "../../src/components/droneViewLogic";

const el = (
  tagName: string,
  attrs: Record<string, string> = {},
  isContentEditable = false,
): HoldKeyTargetLike => ({
  tagName,
  isContentEditable,
  getAttribute: (name: string) => attrs[name] ?? null,
});

const space = (target: HoldKeyTargetLike | null, repeat = false) => ({
  code: "Space",
  repeat,
  target,
});

describe("shouldTriggerHoldToggle", () => {
  it("fires for Space on a non-interactive target (body/div)", () => {
    expect(shouldTriggerHoldToggle(space(el("BODY")))).toBe(true);
    expect(shouldTriggerHoldToggle(space(el("DIV")))).toBe(true);
    expect(shouldTriggerHoldToggle(space(null))).toBe(true);
  });

  it("never fires for non-Space keys", () => {
    expect(shouldTriggerHoldToggle({ code: "KeyZ", target: el("BODY") })).toBe(false);
  });

  it("keeps the existing typing exemptions", () => {
    expect(shouldTriggerHoldToggle(space(el("INPUT")))).toBe(false);
    expect(shouldTriggerHoldToggle(space(el("TEXTAREA")))).toBe(false);
    expect(shouldTriggerHoldToggle(space(el("DIV", {}, true)))).toBe(false);
  });

  it("exempts focused buttons so Space activates them natively", () => {
    expect(shouldTriggerHoldToggle(space(el("BUTTON")))).toBe(false);
  });

  it("exempts selects and links with href", () => {
    expect(shouldTriggerHoldToggle(space(el("SELECT")))).toBe(false);
    expect(shouldTriggerHoldToggle(space(el("A", { href: "/about" })))).toBe(false);
  });

  it("still fires on a placeholder anchor without href (not focusable)", () => {
    expect(shouldTriggerHoldToggle(space(el("A")))).toBe(true);
  });

  it("exempts elements with interactive ARIA roles", () => {
    for (const role of [
      "button", "slider", "switch", "checkbox", "radio",
      "tab", "menuitem", "option", "listbox", "combobox", "spinbutton", "link",
    ]) {
      expect(shouldTriggerHoldToggle(space(el("DIV", { role }))), `role=${role}`).toBe(false);
    }
  });

  it("still fires for non-interactive roles", () => {
    expect(shouldTriggerHoldToggle(space(el("DIV", { role: "presentation" })))).toBe(true);
  });

  it("ignores key-repeat so holding Space doesn't retoggle HOLD", () => {
    expect(shouldTriggerHoldToggle(space(el("BODY"), true))).toBe(false);
  });
});
