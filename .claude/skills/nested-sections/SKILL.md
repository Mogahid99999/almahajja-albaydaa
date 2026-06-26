# Nested Sections / Items — Data Model & Query Patterns

## What this skill covers
The recursive section tree that organises all content in this app. Every page in the student app (`SectionPage`) renders a single node from this tree — whether it's a top-level subject (العقيدة), a sub-topic (التوحيد), or a leaf book (كتاب التوحيد). The same template handles all levels. This skill describes the schema, key invariants, and the exact queries needed to populate that template.

---

## Recommended stack (if not yet decided)
**Next.js 14 + Prisma + PostgreSQL (Supabase)**

Rationale for the data layer specifically:
- PostgreSQL `WITH RECURSIVE` CTEs are the natural fit for rolling up lecture counts and progress across arbitrary-depth trees — no application-level recursion needed.
- Supabase Storage handles audio file upload URLs cleanly.
- Prisma gives type-safe access; raw SQL via `prisma.$queryRaw` is used only for the rollup queries where CTEs are required.

---

## Core invariants

1. **A section can hold child sections, lectures, or both.** There is no separate "item" type — a node is just a `Section`; whether it's a leaf is determined by the data, not the schema.
2. **Lectures always belong to exactly one section.** They cannot float without a parent.
3. **Progress never rolls sideways** — a user's progress in one branch of the tree has no effect on any other branch.
4. **Lecture counts and progress percentages shown in section headers are always aggregated across the full subtree** (all descendant sections), not just direct children.
5. **Draft lectures are invisible to students.** Rollup queries for students must filter `status = PUBLISHED`. Admin queries see all.
6. **Order is explicit** (`order Int`) on both sections and lectures. Display always sorts by `order ASC`, never by `createdAt`.
7. **Sheikh names shown on a section header** are derived from the distinct sheikhs of all published lectures in the subtree — not stored directly on the section.

---

## Prisma schema

```prisma
// schema.prisma

enum LectureStatus {
  DRAFT
  PUBLISHED
}

model Section {
  id          String    @id @default(cuid())
  title       String                          // e.g. "كتاب التوحيد"
  description String?
  coverImage  String?                         // Supabase Storage URL
  order       Int       @default(0)
  parentId    String?
  parent      Section?  @relation("SectionTree", fields: [parentId], references: [id])
  children    Section[] @relation("SectionTree")
  lectures    Lecture[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([parentId, order])
}

model Sheikh {
  id       String    @id @default(cuid())
  name     String    @unique
  lectures Lecture[]
}

model Lecture {
  id          String        @id @default(cuid())
  title       String
  audioUrl    String                          // Supabase Storage URL
  durationSec Int?                            // populated after upload processing
  order       Int           @default(0)
  status      LectureStatus @default(DRAFT)
  sectionId   String
  section     Section       @relation(fields: [sectionId], references: [id])
  sheikhId    String?
  sheikh      Sheikh?       @relation(fields: [sheikhId], references: [id])
  progress    UserLectureProgress[]
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([sectionId, order])
  @@index([status])
}

model UserLectureProgress {
  userId      String
  lectureId   String
  lecture     Lecture  @relation(fields: [lectureId], references: [id], onDelete: Cascade)
  positionSec Int      @default(0)
  completed   Boolean  @default(false)
  updatedAt   DateTime @updatedAt

  @@id([userId, lectureId])
  @@index([userId])
}
```

---

## Query patterns

### 1. Fetch a section page (student view)

Populates `{ title, description, sheikh, lectureCount, progress, subsections[], lectures[] }` as expected by `SectionPage`.

```ts
// lib/queries/section.ts

export async function getSectionPage(sectionId: string, userId: string) {
  // Step 1: Section metadata + direct children + direct lectures (Prisma)
  const section = await prisma.section.findUniqueOrThrow({
    where: { id: sectionId },
    include: {
      children: {
        orderBy: { order: "asc" },
      },
      lectures: {
        where: { status: "PUBLISHED" },
        orderBy: { order: "asc" },
        include: {
          sheikh: { select: { name: true } },
          progress: {
            where: { userId },
          },
        },
      },
    },
  });

  // Step 2: Subtree rollup (raw SQL — CTE required)
  const [rollup] = await prisma.$queryRaw<SubtreeRollup[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Section" WHERE id = ${sectionId}
      UNION ALL
      SELECT s.id FROM "Section" s
      JOIN subtree t ON s."parentId" = t.id
    )
    SELECT
      COUNT(l.id)                                           AS "totalLectures",
      COUNT(p.id) FILTER (WHERE p.completed = true)        AS "completedLectures",
      ARRAY_AGG(DISTINCT sh.name) FILTER (WHERE sh.name IS NOT NULL) AS "sheikhNames"
    FROM subtree st
    JOIN "Lecture" l ON l."sectionId" = st.id AND l.status = 'PUBLISHED'
    LEFT JOIN "UserLectureProgress" p ON p."lectureId" = l.id AND p."userId" = ${userId}
    LEFT JOIN "Sheikh" sh ON sh.id = l."sheikhId"
  `;

  // Step 3: Per-child-section rollup for subsection cards
  const childRollups = await getSubtreeRollupsForChildren(
    section.children.map((c) => c.id),
    userId
  );

  return { section, rollup, childRollups };
}

type SubtreeRollup = {
  totalLectures: bigint;
  completedLectures: bigint;
  sheikhNames: string[] | null;
};
```

> **Note on `bigint`:** PostgreSQL `COUNT()` returns `bigint`; cast with `Number(rollup.totalLectures)` before sending to the client.

---

### 2. Per-child rollup (subsection cards)

The horizontal subsection scroller needs `{ lectureCount, progress% }` per child. Run one CTE, not N+1 queries.

```ts
async function getSubtreeRollupsForChildren(
  childIds: string[],
  userId: string
): Promise<Record<string, { lectureCount: number; progressPct: number }>> {
  if (childIds.length === 0) return {};

  const rows = await prisma.$queryRaw<ChildRollupRow[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, id AS "rootId" FROM "Section" WHERE id = ANY(${childIds}::text[])
      UNION ALL
      SELECT s.id, t."rootId" FROM "Section" s
      JOIN subtree t ON s."parentId" = t.id
    )
    SELECT
      st."rootId"                                                   AS "sectionId",
      COUNT(l.id)                                                   AS "totalLectures",
      COUNT(p.id) FILTER (WHERE p.completed = true)                AS "completedLectures"
    FROM subtree st
    JOIN "Lecture" l ON l."sectionId" = st.id AND l.status = 'PUBLISHED'
    LEFT JOIN "UserLectureProgress" p ON p."lectureId" = l.id AND p."userId" = ${userId}
    GROUP BY st."rootId"
  `;

  return Object.fromEntries(
    rows.map((r) => {
      const total = Number(r.totalLectures);
      const completed = Number(r.completedLectures);
      return [
        r.sectionId,
        {
          lectureCount: total,
          progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
        },
      ];
    })
  );
}

type ChildRollupRow = {
  sectionId: string;
  totalLectures: bigint;
  completedLectures: bigint;
};
```

---

### 3. Admin: flat tree for the parent-section dropdown

The upload form shows a searchable nested-tree dropdown. Fetch the full tree in one query, then build the tree client-side (avoids recursive round-trips).

```ts
// Returns all sections as a flat list with depth, for the upload form dropdown.
export async function getAllSectionsFlat() {
  return prisma.$queryRaw<FlatSection[]>`
    WITH RECURSIVE tree AS (
      SELECT id, title, "parentId", 0 AS depth, ARRAY[title] AS path
      FROM "Section" WHERE "parentId" IS NULL
      UNION ALL
      SELECT s.id, s.title, s."parentId", t.depth + 1, t.path || s.title
      FROM "Section" s JOIN tree t ON s."parentId" = t.id
    )
    SELECT id, title, "parentId", depth, path
    FROM tree
    ORDER BY path
  `;
}

type FlatSection = {
  id: string;
  title: string;
  parentId: string | null;
  depth: number;
  path: string[];
};
```

Client-side, use `depth` to compute `paddingRight: 12 + depth * 20` (matching the design spec in `UploadLecture.prompt.md`).

---

### 4. Save / update lecture progress

Called on audio position change (debounced, ~5s) and on completion detection (>= 90% played).

```ts
export async function saveLectureProgress(
  userId: string,
  lectureId: string,
  positionSec: number,
  durationSec: number
) {
  const completed = durationSec > 0 && positionSec / durationSec >= 0.9;

  await prisma.userLectureProgress.upsert({
    where: { userId_lectureId: { userId, lectureId } },
    create: { userId, lectureId, positionSec, completed },
    update: {
      positionSec,
      // Never un-complete a lecture once it's been marked complete.
      ...(completed ? { completed: true } : {}),
    },
  });
}
```

---

### 5. Home screen — top-level sections with progress

```ts
export async function getHomeSections(userId: string) {
  const roots = await prisma.section.findMany({
    where: { parentId: null },
    orderBy: { order: "asc" },
    select: { id: true, title: true, coverImage: true },
  });

  const rollups = await getSubtreeRollupsForChildren(
    roots.map((r) => r.id),
    userId
  );

  return roots.map((r) => ({ ...r, ...rollups[r.id] }));
}
```

---

## Indexing notes

The indexes declared in the schema cover the hot paths:

| Index | Why |
|---|---|
| `Section(parentId, order)` | Fetching children of a node in display order |
| `Lecture(sectionId, order)` | Fetching lectures of a node in display order |
| `Lecture(status)` | Filtering PUBLISHED vs DRAFT without a full scan |
| `UserLectureProgress(userId)` | All progress rows for a given user |

The recursive CTEs join on `Section.id` (PK) and `Lecture.sectionId` (indexed), so they remain fast up to several thousand sections.

---

## What this model does NOT do

- **No attachments table yet.** Attachments are out of scope for MVP. When added, they'll join to `Lecture`, not `Section`.
- **No Sheikh ↔ Section direct relation.** Sheikh names on the section header are always derived from the lecture subtree. This keeps the data consistent automatically.
- **No separate "item" type.** A leaf section (no children) is just a section with `children = []`. The UI hides the subsections scroller when `children` is empty — that's purely a presentational concern.
