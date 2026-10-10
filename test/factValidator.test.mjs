import test from "node:test";
import assert from "node:assert/strict";
import { validateFactGrounding, TECH_SYNONYMS } from "../llm/factValidator.mjs";

const sampleCV = `# Arjun Verma
**Software Engineer**
Email: arjun@example.com | Phone: +91 9876543210 | Location: Bengaluru, India

## Professional Summary
Software Engineer with hands-on experience in backend API development, microservices, and databases.
Improved API response times by 15% and deployed scalable Node.js services.

## Technical Skills
- **Languages:** Python, JavaScript, SQL
- **Frameworks & Libraries:** Node.js, Express, React
- **Databases & Tools:** PostgreSQL, MongoDB, Docker, Git

## Projects
### Task Management Microservice
- Designed REST APIs using Node.js and Express with PostgreSQL database.
- Containerized the application using Docker and reduced build time by 20%.

## Work Experience
### Backend Intern - Apex Labs (Bengaluru)
- Duration: Jan 2024 - June 2024
- Built secure authentication APIs with JWT tokens.

## Education
- **B.Tech Computer Science Engineering**
- Institution: Vellore Institute of Technology
- Year: 2024 | CGPA: 8.5/10
`;

test("T9 Fact Validator: Legitimate response with grounded facts and synonyms passes", () => {
  const legitResume = {
    name: "Arjun Verma",
    summary: "Software Engineer skilled in Python and Node.js with experience optimizing API response times by 15%.",
    skills: [
      { category: "Languages", items: ["Python", "JavaScript"] },
      { category: "Frameworks", items: ["Node.js", "Express", "React"] },
      { category: "Databases", items: ["PostgreSQL", "MongoDB"] },
      { category: "Tools", items: ["Docker", "Git"] },
    ],
    experience: [
      {
        company: "Apex Labs",
        title: "Backend Intern",
        bullets: ["Developed backend services and authentication workflows using JWT."],
      },
    ],
    projects: [
      {
        name: "Task Management Microservice",
        bullets: ["Reduced build time by 20% using Docker containerization."],
      },
    ],
    education: [
      {
        institution: "Vellore Institute of Technology",
        degree: "B.Tech Computer Science Engineering",
        year: "2024",
      },
    ],
  };

  const result = validateFactGrounding(legitResume, sampleCV);
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.violations.length, 0);
});

test("T9 Fact Validator: Tech synonyms (e.g. JS -> JavaScript, Postgres -> PostgreSQL) pass", () => {
  const synonymResume = {
    skills: [
      { category: "Languages", items: ["JS"] }, // CV has JavaScript
      { category: "Databases", items: ["Postgres"] }, // CV has PostgreSQL
    ],
  };

  const result = validateFactGrounding(synonymResume, sampleCV);
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.violations.length, 0);
});

test("T9 Fact Validator: Poisoned response with invented skill is rejected", () => {
  const poisonedResume = {
    skills: [
      { category: "Languages", items: ["Python", "Rust", "Solidity"] },
    ],
  };

  const result = validateFactGrounding(poisonedResume, sampleCV);
  assert.strictEqual(result.isValid, false);
  assert.ok(result.violations.some((v) => v.includes('Invented skill: "Rust"')));
  assert.ok(result.violations.some((v) => v.includes('Invented skill: "Solidity"')));
});

test("T9 Fact Validator: Poisoned response with invented employer is rejected", () => {
  const poisonedResume = {
    experience: [
      {
        company: "Google LLC", // Not in CV
        title: "Software Engineer Intern",
        bullets: ["Built cloud services."],
      },
    ],
  };

  const result = validateFactGrounding(poisonedResume, sampleCV);
  assert.strictEqual(result.isValid, false);
  assert.ok(result.violations.some((v) => v.includes('Invented employer: "Google LLC"')));
});

test("T9 Fact Validator: Poisoned response with invented institution is rejected", () => {
  const poisonedResume = {
    education: [
      {
        institution: "Stanford University", // Not in CV
        degree: "M.S. Computer Science",
      },
    ],
  };

  const result = validateFactGrounding(poisonedResume, sampleCV);
  assert.strictEqual(result.isValid, false);
  assert.ok(result.violations.some((v) => v.includes('Invented institution: "Stanford University"')));
});

test("T9 Fact Validator: Poisoned response with fabricated metric/number is rejected", () => {
  const poisonedResume = {
    summary: "Led high-impact engineering team and scaled traffic by 500% across 50 microservices.", // 500% and 50 not in CV
    projects: [
      {
        name: "Task App",
        bullets: ["Generated $100000 revenue in 30 days."], // 100000 and 30 not in CV
      },
    ],
  };

  const result = validateFactGrounding(poisonedResume, sampleCV);
  assert.strictEqual(result.isValid, false);
  assert.ok(result.violations.some((v) => v.includes("Invented or modified number/metric")));
});
