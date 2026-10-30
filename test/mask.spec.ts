import { maskNumber } from "../src/common/mask";

describe("maskNumber", () => {
  it("keeps the country prefix and last four digits only", () => {
    expect(maskNumber("917042306233")).toBe("91******6233");
  });

  it("fully masks anything too short to partially reveal", () => {
    expect(maskNumber("12345")).toBe("*****");
  });

  it("copes with a missing number", () => {
    expect(maskNumber(undefined)).toBe("");
  });
});
