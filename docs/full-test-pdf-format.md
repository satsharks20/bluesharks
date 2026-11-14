# Full-test PDF format

Use this format for every English or Math PDF uploaded through **Admin → Full tests**. The PDF must
contain selectable text, not scanned pages or photos.

Every question requires both a domain (`CATEGORY`) and a `SKILL`. The skill is saved with the
question and is used by drills, adaptive modules and student analytics. The importer does not infer
or guess skills.

## Complete structure

```text
SECTION: MATH

MODULE 1

QUESTION 1
CATEGORY: Algebra
SKILL: Linear equations in one variable
DIFFICULTY: MEDIUM
TYPE: MULTIPLE_CHOICE
PROMPT: If $3x + 7 = 22$, what is the value of $x$?
A: $3$
B: $5$
C: $7$
D: $15$
ANSWER: B
EXPLANATION: Subtract $7$ from both sides, then divide by $3$.
END QUESTION

END MODULE

MODULE 2 EASY
...questions numbered from QUESTION 1...
END MODULE

MODULE 2 HARD
...questions numbered from QUESTION 1...
END MODULE
```

Use `SECTION: READING_WRITING` for an English PDF. Each section PDF needs `MODULE 1`,
`MODULE 2 EASY`, and `MODULE 2 HARD`. `EASIER` and `HARDER` are also accepted.

## Question fields

Fields must appear in this order:

1. `CATEGORY` — required exact question-bank domain.
2. `SKILL` — required exact skill belonging to that category.
3. `DIFFICULTY` — `EASY`, `MEDIUM`, or `HARD`.
4. `TYPE` — optional; `MULTIPLE_CHOICE` is the default, or use `GRID_IN` for Math only.
5. `PASSAGE` — optional; used for Reading & Writing. In Math it appears before the prompt.
6. `PROMPT` — required question text.
7. `A`, `B`, `C`, `D` — required for multiple choice and omitted for grid-ins.
8. `ANSWER` — `A`–`D`, or accepted grid-in values such as `0.5 or 1/2`.
9. `EXPLANATION` — required.

End every question with `END QUESTION` and every module with `END MODULE`.

## Category and skill rules

Math categories are:

- `Algebra`
- `Advanced Math`
- `Problem-Solving and Data Analysis`
- `Geometry and Trigonometry`

Reading and Writing categories are:

- `Craft and Structure`
- `Information and Ideas`
- `Standard English Conventions`
- `Expression of Ideas`

Accepted skills come from the current question bank, not from a keyword list in the importer. Use
the exact skill shown under the selected category in the website's question editor; its Skill
dropdown is filtered whenever the Domain changes. Examples:

```text
CATEGORY: Algebra
SKILL: Linear functions
```

```text
CATEGORY: Craft and Structure
SKILL: Words in Context
```

```text
CATEGORY: Standard English Conventions
SKILL: Boundaries
```

The upload is rejected when `SKILL` is missing, unknown, or does not belong to `CATEGORY`. Errors
are grouped by invalid label so an administrator can fix the source document once and re-upload it.

## Grid-in example

```text
QUESTION 2
CATEGORY: Advanced Math
SKILL: Equivalent expressions
DIFFICULTY: HARD
TYPE: GRID_IN
PROMPT: What is the value of $\frac{1}{2}+\frac{1}{4}$?
ANSWER: 0.75 or 3/4
EXPLANATION: The sum is $\frac{3}{4}$, which equals $0.75$.
END QUESTION
```

Grid-in answers may contain digits, `.`, `/`, and an optional `-`. Each accepted form is separated
by `or`, a semicolon, or a comma followed by a space.

## Review behavior

After extraction, the review page shows a required Skill dropdown filtered by the selected Domain.
Changing the Domain clears the Skill so the administrator must choose a valid combination. Save is
disabled while any question has a missing or invalid skill. Publishing runs the same validation
again before questions are written to the final question collection.

The printable builder is available at `/full-test/format.html` on the website.
