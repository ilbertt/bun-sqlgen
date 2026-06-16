-- A convenience view joining deals to their owner. Querying THROUGH a view is a
-- good inference test: the planner inlines the view, so EXPLAIN exposes the
-- underlying base columns (d.status, u.email, ...) and nullability still traces
-- correctly. The view's own computed column (status_upper) stays nullable.
CREATE VIEW deal_details AS
SELECT
  d.id            AS deal_id,
  d.status,
  d.amount,
  u.email,
  u.display_name,
  upper(d.status) AS status_upper
FROM deals d
JOIN users u ON u.id = d.user_id;
