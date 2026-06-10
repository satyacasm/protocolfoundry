import { afterEach, describe, expect, it } from "vitest";
import { reportPath, signReport, verifyReportSignature } from "../src/lib/report-sign";

const ENV_KEYS = ["PF_DASHBOARD_SECRET", "PF_DASHBOARD_PASSWORD"] as const;
const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("report signatures", () => {
  it("round-trips a signed link and rejects tampering", () => {
    delete process.env.PF_DASHBOARD_SECRET;
    process.env.PF_DASHBOARD_PASSWORD = "hunter2";
    const sig = signReport("acme", 3, "hunter2");

    expect(verifyReportSignature("acme", 3, sig)).toBe(true);
    expect(verifyReportSignature("acme", 4, sig)).toBe(false);
    expect(verifyReportSignature("other", 3, sig)).toBe(false);
    expect(verifyReportSignature("acme", 3, sig.slice(0, -1) + "0")).toBe(false);
    expect(verifyReportSignature("acme", 3, undefined)).toBe(false);
    expect(verifyReportSignature("acme", 3, "")).toBe(false);
  });

  it("embeds the signature in the link path", () => {
    delete process.env.PF_DASHBOARD_SECRET;
    process.env.PF_DASHBOARD_PASSWORD = "hunter2";
    expect(reportPath("acme", 3)).toBe(`/reports/acme/3?sig=${signReport("acme", 3, "hunter2")}`);
  });

  it("requires no signature in open mode (dashboard itself is unprotected)", () => {
    delete process.env.PF_DASHBOARD_SECRET;
    delete process.env.PF_DASHBOARD_PASSWORD;
    expect(verifyReportSignature("acme", 3, undefined)).toBe(true);
    expect(reportPath("acme", 3)).toBe("/reports/acme/3");
  });

  it("prefers PF_DASHBOARD_SECRET over the password", () => {
    process.env.PF_DASHBOARD_SECRET = "dedicated-secret";
    process.env.PF_DASHBOARD_PASSWORD = "hunter2";
    expect(verifyReportSignature("acme", 3, signReport("acme", 3, "dedicated-secret"))).toBe(true);
    expect(verifyReportSignature("acme", 3, signReport("acme", 3, "hunter2"))).toBe(false);
  });
});
