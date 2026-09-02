ALTER TABLE deployments ADD COLUMN config jsonb;
COMMENT ON COLUMN deployments.config IS
  'Rendered deploy config. @type { replicas: number }';

-- The view exposes it without commenting it at all: the schema block's entry for
-- `deployment_config` inherits both the `@type` and the prose from the base column.
CREATE OR REPLACE VIEW desired_deployments AS
SELECT
  id     AS deployment_id,
  state  AS deployment_state,
  digest AS deployment_digest,
  config AS deployment_config
FROM deployments;
