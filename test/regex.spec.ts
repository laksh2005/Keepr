import { escapeRegExp } from "../src/common/regex";

describe("escapeRegExp", () => {
  it("makes an unbalanced group harmless instead of throwing", () => {
    // "delete (" used to throw Invalid regular expression, which surfaced to the
    // sender as silence.
    expect(() => new RegExp(escapeRegExp("("), "i")).not.toThrow();
  });

  it("stops a catastrophic backtracking pattern from being compiled as one", () => {
    // "delete (a+)+$" hung for over two minutes before this.
    const pattern = new RegExp(escapeRegExp("(a+)+$"), "i");
    const started = Date.now();
    pattern.test("a".repeat(40) + "!");
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("treats a dot as a literal dot, not as any character", () => {
    // Otherwise "delete ." matches every memory containing any character at all.
    const pattern = new RegExp(escapeRegExp("."), "i");
    expect(pattern.test("no dot here")).toBe(false);
    expect(pattern.test("ends with a dot.")).toBe(true);
  });

  it("leaves ordinary search terms alone", () => {
    expect(escapeRegExp("pizza")).toBe("pizza");
  });
});
