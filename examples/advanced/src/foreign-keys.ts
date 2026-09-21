import { schema } from '#queries.gen.ts';

// Foreign keys hang off the column they constrain, so a reference can be followed
// without knowing the constraint's name up front.
const dealsToUsers = schema.deals._columns.user_id._foreignKeys.deals_user_id_fkey;
console.log(dealsToUsers._references._relationName); // 'users'
console.log(dealsToUsers._references._columnName); // 'id'

// A composite key appears on each of its columns, each paired with the column it
// actually points at — `region` to `region`, `code` to `code`, not both to the first.
const notes = schema.tenant_notes._columns;
console.log(notes.region._foreignKeys.tenant_notes_tenant_fkey._references._columnName); // 'region'
console.log(notes.code._foreignKeys.tenant_notes_tenant_fkey._references._columnName); // 'code'

// @ts-expect-error — `body` participates in no foreign key, so its map is empty
console.log(notes.body._foreignKeys.tenant_notes_tenant_fkey);
