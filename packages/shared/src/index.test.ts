import { describe, expect, it } from "vitest";
import { calculateLoyaltyPoints, calculateTotals, loyaltyTierForVisits, normalizeSaudiMobile } from "./index.js";

describe("calculateTotals", () => {
  it("calculates VAT after discount using halalas", () => {
    expect(calculateTotals([{productId:"1",name:"Latte",unitPrice:2000,quantity:2,taxRateBps:1500,discount:500}]))
      .toEqual({ subtotal:4000, discount:500, taxable:3500, tax:525, total:4025 });
  });
  it("rejects excessive discounts", () => {
    expect(() => calculateTotals([{productId:"1",name:"x",unitPrice:100,quantity:1,taxRateBps:1500,discount:101}])).toThrow();
  });
});

describe("loyalty", () => {
  it("promotes customers by completed visit count", () => {
    expect(loyaltyTierForVisits(0)).toBe("member");
    expect(loyaltyTierForVisits(5)).toBe("silver");
    expect(loyaltyTierForVisits(15)).toBe("gold");
    expect(loyaltyTierForVisits(30)).toBe("platinum");
  });

  it("earns whole points from taxable halalas with a tier multiplier", () => {
    expect(calculateLoyaltyPoints(2_050, "member")).toBe(20);
    expect(calculateLoyaltyPoints(2_050, "gold")).toBe(25);
  });

  it("normalizes Saudi mobile formats to one loyalty identity", () => {
    expect(normalizeSaudiMobile("0551234567")).toBe("+966551234567");
    expect(normalizeSaudiMobile("+966 55 123 4567")).toBe("+966551234567");
    expect(normalizeSaudiMobile("٠٥٥١٢٣٤٥٦٧")).toBe("+966551234567");
  });
});
