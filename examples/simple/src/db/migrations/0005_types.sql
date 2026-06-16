CREATE TYPE deal_stage AS ENUM ('lead', 'negotiation', 'won', 'lost');

CREATE TABLE deal_meta (
  id       bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  deal_id  bigint NOT NULL REFERENCES deals(id),
  stage    deal_stage NOT NULL,
  tags     text[] NOT NULL DEFAULT '{}',
  details  jsonb,
  scores   int4[]
);
