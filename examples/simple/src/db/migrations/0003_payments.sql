-- Payments made against a deal. A deal can have zero or many payments, which is
-- what makes the aggregate in the summary query interesting (a deal with no
-- payments must still appear, with a 0 total).
CREATE TABLE payments (
  id       bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  deal_id  bigint NOT NULL REFERENCES deals(id),
  amount   numeric NOT NULL,
  paid_at  timestamptz NOT NULL DEFAULT now()
);
