import { describe, expect, it } from "vitest";
import { calculateTotals } from "./index.js";

describe("calculateTotals", () => {
  it("calculates VAT after discount using halalas", () => {
    expect(calculateTotals([{productId:"1",name:"Latte",unitPrice:2000,quantity:2,taxRateBps:1500,discount:500}]))
      .toEqual({ subtotal:4000, discount:500, taxable:3500, tax:525, total:4025 });
  });
  it("rejects excessive discounts", () => {
    expect(() => calculateTotals([{productId:"1",name:"x",unitPrice:100,quantity:1,taxRateBps:1500,discount:101}])).toThrow();
  });
});
