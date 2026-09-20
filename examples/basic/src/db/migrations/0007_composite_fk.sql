-- A composite foreign key: it lands on each of its columns, paired with the column
-- that one actually points at.
CREATE TABLE tenants (
  region text NOT NULL,
  code   text NOT NULL,
  PRIMARY KEY (region, code)
);

CREATE TABLE tenant_notes (
  id     bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  region text NOT NULL,
  code   text NOT NULL,
  body   text,
  CONSTRAINT tenant_notes_tenant_fkey FOREIGN KEY (region, code) REFERENCES tenants (region, code)
);
