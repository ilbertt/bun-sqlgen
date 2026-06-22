import { withTypes } from '@repo/bun-sqlgen';
import { SQL } from 'bun';

const sql = withTypes(new SQL(Bun.env.DATABASE_URL ?? 'postgres://localhost/example'));

// The schema only applies in the throwaway DB because sqlgen.config.ts loaded the
// citext extension, stubbed app_current_actor(), and stripped CONCURRENTLY. With
// that done, these queries type exactly like any other.

// `slug` is citext, typed `string` by its COMMENT ON COLUMN @type; `body` is the
// one nullable column, the rest are NOT NULL.
const article = await sql.GetArticle`
  SELECT id, slug, title, body, created_by
  FROM articles WHERE slug = ${'hello-world'}
`;
console.log(article[0]?.slug, article[0]?.body); // string, string | null

// @ts-expect-error — `body` is `string | null`, so it isn't assignable to `string`
const body: string = article[0]!.body;
console.log(body);

// LEFT JOIN widens the author side: `email` (citext) and `name` are NOT NULL in the
// schema but nullable here because a row may have no matching author.
const withAuthor = await sql.ListArticlesWithAuthor`
  SELECT a.id, a.title, au.email, au.name
  FROM articles a
  LEFT JOIN authors au ON au.id = a.author_id
`;
console.log(withAuthor[0]?.email, withAuthor[0]?.name); // string | null, string | null
