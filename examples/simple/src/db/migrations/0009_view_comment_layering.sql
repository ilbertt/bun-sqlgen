CREATE TABLE deployments (
  id     bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  state  text NOT NULL,
  digest text
);

-- The table brands `state` and pins `digest`, which the catalog reports nullable.
COMMENT ON COLUMN deployments.state IS
  'Lifecycle state. @type ''pending'' | ''running'' | ''failed''';
COMMENT ON COLUMN deployments.digest IS 'Content hash of the built image. @notNull';

CREATE VIEW desired_deployments AS
SELECT
  id     AS deployment_id,
  state  AS deployment_state,
  digest AS deployment_digest
FROM deployments;

-- A view comment carrying only prose layers over the base column's rather than
-- replacing it: the doc is the view's, the `@type` and the `@notNull` still the table's.
COMMENT ON COLUMN desired_deployments.deployment_state IS
  'The release''s own state, beside the app''s.';
COMMENT ON COLUMN desired_deployments.deployment_digest IS
  'Digest the release should converge on.';
