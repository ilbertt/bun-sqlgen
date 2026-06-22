CREATE TABLE payments (
  id       bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  deal_id  bigint NOT NULL REFERENCES deals(id),
  amount   numeric NOT NULL,
  paid_at  timestamptz NOT NULL DEFAULT now()
);
