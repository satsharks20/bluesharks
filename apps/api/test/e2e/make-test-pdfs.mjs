// Builds the PDFs for test-uploads.e2e.ts: full-size demo tests (22/22/22 Math, 27/27/27 English)
// that use every feature of the format (formulas, money, display formulas, paragraphs, bullets,
// grid-ins), plus broken files. Plain text in the builder's layout, printed by headless Chrome.
//
//   node apps/api/test/e2e/make-test-pdfs.mjs <output folder>      (CHROME_PATH to override Chrome)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = resolve(process.argv[2]);
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const MODULES = ["MODULE 1", "MODULE 2 EASY", "MODULE 2 HARD"];
const SLOT = { "MODULE 1": "m1", "MODULE 2 EASY": "m2_easy", "MODULE 2 HARD": "m2_hard" };

function block(q, n) {
  const lines = [`QUESTION ${n}`, `CATEGORY: ${q.category}`, `SKILL: ${q.skill}`, `DIFFICULTY: ${q.difficulty}`];
  if (q.type) lines.push(`TYPE: ${q.type}`);
  if (q.passage) lines.push(`PASSAGE: ${q.passage}`);
  lines.push(`PROMPT: ${q.prompt}`);
  if (q.options) ["A", "B", "C", "D"].forEach((k, i) => lines.push(`${k}: ${q.options[i]}`));
  lines.push(`ANSWER: ${q.answer}`, `EXPLANATION: ${q.explanation}`, "END QUESTION");
  return lines.join("\n");
}

function documentText(section, modules, title) {
  const parts = [title, "", `SECTION: ${section}`, ""];
  for (const header of MODULES) {
    parts.push(header, "");
    modules[header].forEach((q, i) => parts.push(block(q, i + 1), ""));
    parts.push("END MODULE", "");
  }
  return parts.join("\n");
}

function toPdf(name, text, lineHeight = 1.35) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: Letter; margin: 0.6in; }
    body { margin: 0; font-family: "Courier New", monospace; font-size: 11pt; line-height: ${lineHeight}; white-space: pre-wrap; }
  </style></head><body>${esc(text)}</body></html>`;
  const htmlPath = join(OUT, `${name}.html`);
  writeFileSync(htmlPath, html);
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${join(OUT, `.chrome-${name}`)}`, "--no-pdf-header-footer", `--print-to-pdf=${join(OUT, `${name}.pdf`)}`, pathToFileURL(htmlPath).href], { stdio: "ignore" });
}

// ---------- Math ----------
const shuffleKeys = (correct, wrong, seed) => {
  const options = [...wrong];
  const index = seed % 4;
  options.splice(index, 0, correct);
  return { options, answer: "ABCD"[index] };
};

function mathQuestion(i, level) {
  const d = level === "m1" ? "MEDIUM" : level === "m2_easy" ? "EASY" : "HARD";
  const k = i + (level === "m2_easy" ? 3 : level === "m2_hard" ? 7 : 0);
  switch (i % 8) {
    case 0: {
      const a = 3 + (k % 5), x = 4 + (k % 6), b = 7 + k;
      const { options, answer } = shuffleKeys(`$${x}$`, [`$${x + 1}$`, `$${x + 3}$`, `$${a * x}$`], k);
      return { category: "Algebra", skill: "Linear equations in one variable", difficulty: d, prompt: `If $${a}x + ${b} = ${a * x + b}$, what is the value of $x$?`, options, answer, explanation: `Subtract $${b}$ from both sides to get $${a}x = ${a * x}$, then divide by $${a}$.` };
    }
    case 1: {
      const fee = 60 + 10 * (k % 5), month = 20 + 4 * (k % 4);
      const { options, answer } = shuffleKeys(`$${month}n + ${fee}$`, [`$${fee}n + ${month}$`, `$${fee + month}n$`, `$${month}(n + ${fee})$`], k);
      return { category: "Algebra", skill: "Linear functions", difficulty: d, prompt: `A gym charges a one-time fee of $\\$${fee}$ plus $\\$${month}$ per month for a membership. Which expression gives the total cost, in dollars, of a membership for $n$ months?`, options, answer, explanation: `The monthly charge is $${month}n$ and the one-time fee of $\\$${fee}$ is added once.` };
    }
    case 2: {
      const a = 2 + (k % 3), b = 3 + (k % 4);
      return { category: "Advanced Math", skill: "Equivalent expressions", difficulty: d, type: "GRID_IN", prompt: `What is the value of $\\frac{1}{${a}} + \\frac{1}{${a}}$ when it is written as a fraction?`, answer: `2/${a}${a === 2 ? " or 1" : ""}`, explanation: `Two equal fractions add to $\\frac{2}{${a}}$.` };
    }
    case 3: {
      const x = 2 + (k % 5), y = 1 + (k % 3);
      const { options, answer } = shuffleKeys(`$${x}$`, [`$${y}$`, `$${x + y}$`, `$${x * 2}$`], k);
      return { category: "Algebra", skill: "Systems of two linear equations in two variables", difficulty: d, prompt: `Solve the system of equations.\n\n$$x + y = ${x + y}$$\n\n$$x - y = ${x - y}$$\n\nWhat is the value of $x$?`, options, answer, explanation: `Adding the equations gives $2x = ${2 * x}$, so $x = ${x}$.` };
    }
    case 4: {
      const r = 3 + (k % 5);
      const { options, answer } = shuffleKeys(`$${r * r}\\pi$`, [`$${2 * r}\\pi$`, `$${r}\\pi$`, `$${r * r * 2}\\pi$`], k);
      return { category: "Geometry and Trigonometry", skill: "Circles", difficulty: d, prompt: `A circle in the $xy$-plane has a radius of $${r}$ units. Which expression gives the area of the circle, in square units, where the area of a circle is $\\pi r^2$?`, options, answer, explanation: `$A = \\pi r^2 = \\pi(${r})^2 = ${r * r}\\pi$.` };
    }
    case 5: {
      const v = -(2 + (k % 4)) - 0.5;
      return { category: "Algebra", skill: "Linear equations in one variable", difficulty: d, type: "GRID_IN", prompt: `If $2x + ${Math.abs(2 * v) + 3} = 3$, what is the value of $x$?`, answer: `${v} or ${2 * v}/2`, explanation: `$2x = ${2 * v}$, so $x = ${v}$.` };
    }
    case 6: {
      const n = 4 + (k % 9);
      const { options, answer } = shuffleKeys(`$${n}$`, [`$${n * n}$`, `$\\sqrt{${n}}$`, `$${2 * n}$`], k);
      return { category: "Advanced Math", skill: "Equivalent expressions", difficulty: d, prompt: `What is the value of $\\sqrt{${n * n}}$?`, options, answer, explanation: `$${n} \\times ${n} = ${n * n}$, so $\\sqrt{${n * n}} = ${n}$.` };
    }
    default: {
      const p = 10 + 5 * (k % 6), price = 40 + 20 * (k % 4);
      const result = (price * (100 + p)) / 100;
      return { category: "Problem-Solving and Data Analysis", skill: "Percentages", difficulty: d, type: "GRID_IN", prompt: `The price of a jacket was $\\$${price}$. The price was increased by $${p}\\%$. What is the new price of the jacket, in dollars?`, answer: Number.isInteger(result) ? `${result}` : `${result}`, explanation: `$${price} \\times ${(100 + p) / 100} = ${result}$.` };
    }
  }
}

// ---------- Reading & Writing ----------
function rwQuestion(i, level) {
  const d = level === "m1" ? "MEDIUM" : level === "m2_easy" ? "EASY" : "HARD";
  const k = i + (level === "m2_easy" ? 2 : level === "m2_hard" ? 5 : 0);
  switch (i % 5) {
    case 0: {
      const { options, answer } = shuffleKeys("meticulous", ["careless", "hostile", "brief"], k);
      return { category: "Craft and Structure", skill: "Words in Context", difficulty: d, passage: `The botanist's field notes from expedition ${k + 1} were remarkably ______: every leaf, root, and seed was recorded in exact detail, with drawings that later researchers relied on for decades.`, prompt: "Which choice completes the text with the most logical and precise word or phrase?", options, answer, explanation: `"Meticulous" means extremely careful and precise, which matches notes that record every detail.` };
    }
    case 1: {
      const { options, answer } = shuffleKeys("Both texts agree that the bridge changed the town, but Text 2 doubts it was for the better.", ["Text 1 rejects the claim made in Text 2.", "The texts describe two different bridges.", "Text 2 offers new evidence that supports Text 1 completely."], k);
      return { category: "Craft and Structure", skill: "Cross-Text Connections", difficulty: d, passage: `Text 1\nWhen the river bridge opened in 1891, trade in the town doubled within a decade, and the historian Mara Ellis credits the bridge for nearly all of that growth.\n\nText 2\nOther historians accept that the bridge brought trade but note that it also drew business away from the old market square, which never recovered.`, prompt: "Based on the texts, how would the author of Text 2 most likely respond to Ellis's view?", options, answer, explanation: "Text 2 accepts the growth but adds a cost that Text 1 does not mention." };
    }
    case 2: {
      const { options, answer } = shuffleKeys("includes", ["include", "including", "to include"], k);
      return { category: "Standard English Conventions", skill: "Form, Structure, and Sense", difficulty: d, passage: `The committee reviewed every proposal carefully, and its final report ______ three clear recommendations for the city council.`, prompt: "Which choice completes the text so that it conforms to the conventions of Standard English?", options, answer, explanation: `The singular subject "report" needs the singular verb "includes."` };
    }
    case 3: {
      const { options, answer } = shuffleKeys("The Atacama receives less than 1 millimeter of rain a year, making it drier than most of the world's deserts.", ["Deserts cover about one third of Earth's land.", "Scientists study the Atacama to learn about Mars.", "The Sahara is larger than the Atacama."], k);
      return { category: "Expression of Ideas", skill: "Rhetorical Synthesis", difficulty: d, passage: `While researching a topic, a student has taken the following notes:\n• The Atacama Desert is in Chile.\n• Parts of it receive less than 1 millimeter of rain a year.\n• Most deserts receive up to 250 millimeters of rain a year.`, prompt: "The student wants to emphasize how dry the Atacama is. Which choice most effectively uses relevant information from the notes to accomplish this goal?", options, answer, explanation: "Only this choice compares the Atacama's rainfall with that of other deserts." };
    }
    default: {
      const { options, answer } = shuffleKeys("However,", ["Therefore,", "For example,", "Similarly,"], k);
      return { category: "Expression of Ideas", skill: "Transitions", difficulty: d, passage: `Early critics dismissed the painter's late work as unfinished. ______ recent exhibitions have shown that the rough brushwork was a deliberate choice that later artists admired.`, prompt: "Which choice completes the text with the most logical transition?", options, answer, explanation: `The second sentence contrasts with the first, so "However" fits.` };
    }
  }
}

const build = (section, count, make, title) =>
  documentText(section, Object.fromEntries(MODULES.map((m) => [m, Array.from({ length: count }, (_, i) => make(i, SLOT[m]))])), title);

const math = build("MATH", 22, mathQuestion, "SAT Sharks Demo Test - Math");
const english = build("READING_WRITING", 27, rwQuestion, "SAT Sharks Demo Test - English");
toPdf("demo-math", math);
toPdf("demo-english", english, 1.5);
// Same English text, double spaced: wrapped lines must still be joined.
toPdf("demo-english-double", english, 2);
// Broken files.
// A module header typed twice (so Module 2 Hard is missing).
toPdf("bad-math", math.replace("MODULE 2 HARD", "MODULE 2 EASY"));
// A category that is not in the bank, and a formula KaTeX cannot draw.
toPdf("bad-category", math.replaceAll("CATEGORY: Geometry and Trigonometry", "CATEGORY: Calculus").replace("$\\sqrt{", "$\\sqrt{{"));
toPdf("bad-skill", math.replaceAll("SKILL: Circles", "SKILL: Calculus"));
// A dollar amount written as plain "$70" in Math.
toPdf("bad-money", math.replace(/\$\\\$(\d+)\$/, (_match, amount) => `$${amount}`));
console.log("done");
