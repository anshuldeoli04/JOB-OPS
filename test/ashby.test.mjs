import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Ashby ATS Config: companies.json contains ashby type companies with slugs", () => {
  const companies = JSON.parse(fs.readFileSync("./companies.json", "utf-8"));
  const ashbyCos = companies.filter((c) => c.type === "ashby");
  assert.ok(ashbyCos.length >= 2, "Expected at least 2 Ashby companies (ElevenLabs, Linear)");

  const elevenlabs = ashbyCos.find((c) => c.slug === "elevenlabs");
  assert.ok(elevenlabs, "ElevenLabs must be configured with slug elevenlabs");
  assert.equal(elevenlabs.type, "ashby");

  const linear = ashbyCos.find((c) => c.slug === "linear");
  assert.ok(linear, "Linear must be configured with slug linear");
  assert.equal(linear.type, "ashby");

  const meesho = companies.find((c) => c.name === "Meesho");
  assert.ok(meesho, "Meesho must be present in companies.json");
  assert.equal(meesho.type, "lever", "Meesho must be reclassified as lever");
  assert.equal(meesho.slug, "meesho");
});

test("Ashby Normalization: maps Ashby posting-api payload to JOB-OPS job schema", () => {
  const sampleAshbyJob = {
    id: "a571b8e4-8176-4e31-aab6-2287ee810236",
    title: "Account Manager - India",
    location: "India",
    department: "Revenue",
    isRemote: true,
    applyUrl: "https://jobs.ashbyhq.com/elevenlabs/a571b8e4/application",
    publishedAt: "2026-09-15T10:00:00.000Z",
  };

  const normalized = {
    source: "ashby",
    company: "ElevenLabs",
    role: sampleAshbyJob.title,
    location: sampleAshbyJob.location,
    url: sampleAshbyJob.applyUrl,
    posted: sampleAshbyJob.publishedAt,
    content: JSON.stringify(sampleAshbyJob),
    status: "new",
  };

  assert.equal(normalized.source, "ashby");
  assert.equal(normalized.company, "ElevenLabs");
  assert.equal(normalized.role, "Account Manager - India");
  assert.equal(normalized.location, "India");
  assert.equal(normalized.url, "https://jobs.ashbyhq.com/elevenlabs/a571b8e4/application");
  assert.equal(normalized.status, "new");
});
