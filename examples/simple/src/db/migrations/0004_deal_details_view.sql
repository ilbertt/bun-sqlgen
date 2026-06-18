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
