import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isLocationFit } from "../scanner.mjs";

test("T-3: Table-driven location fit tests across Indian cities, foreign countries, and remotes", () => {
  const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

  const testCases = [
    { loc: "Bengaluru", src: "greenhouse", shouldBe: true },
    { loc: "Gurugram", src: "greenhouse", shouldBe: true },
    { loc: "Noida", src: "greenhouse", shouldBe: true },
    { loc: "New Delhi", src: "greenhouse", shouldBe: true },
    { loc: "Delhi", src: "greenhouse", shouldBe: true },
    { loc: "Mumbai", src: "greenhouse", shouldBe: true },
    { loc: "Chennai", src: "greenhouse", shouldBe: true },
    { loc: "Kolkata", src: "greenhouse", shouldBe: true },
    { loc: "Ahmedabad", src: "greenhouse", shouldBe: true },
    { loc: "Bengaluru, India", src: "greenhouse", shouldBe: true },
    { loc: "Remote, Brazil", src: "greenhouse", shouldBe: false },
    { loc: "Remote - Poland", src: "greenhouse", shouldBe: false },
    { loc: "Remote (France)", src: "greenhouse", shouldBe: false },
    { loc: "Remote, Spain", src: "greenhouse", shouldBe: false },
    { loc: "Remote, Ireland", src: "greenhouse", shouldBe: false },
    { loc: "Remote, Israel", src: "greenhouse", shouldBe: false },
    { loc: "Remote - Americas", src: "greenhouse", shouldBe: false },
    { loc: "Remote - US", src: "greenhouse", shouldBe: false },
    { loc: "Remote - United States", src: "greenhouse", shouldBe: false },
    { loc: "Remote, Canada", src: "greenhouse", shouldBe: false },
    { loc: "Hyderabad", src: "greenhouse", shouldBe: true },
    { loc: "Pune, Maharashtra", src: "greenhouse", shouldBe: true },
    { loc: "Remote India", src: "greenhouse", shouldBe: true },
    { loc: "India", src: "greenhouse", shouldBe: true },
    { loc: "Remote", src: "greenhouse", shouldBe: true },
    { loc: "Remote - APAC", src: "greenhouse", shouldBe: true },
    { loc: "", src: "naukri", shouldBe: true },
    { loc: "", src: "internshala", shouldBe: true },
    { loc: "", src: "greenhouse", shouldBe: false },
    { loc: "", src: "lever", shouldBe: false },
  ];

  testCases.forEach((tc) => {
    const res = isLocationFit(tc.loc, config, tc.src);
    assert.strictEqual(
      res,
      tc.shouldBe,
      `Location "${tc.loc || "(empty)"}" on ${tc.src} expected ${tc.shouldBe} but got ${res}`
    );
  });
});
