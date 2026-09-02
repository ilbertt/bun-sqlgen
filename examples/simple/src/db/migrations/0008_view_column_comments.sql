-- A comment on a VIEW column is the view's own answer for that column, and it beats
-- the one on the base column underneath: a query selecting through `deal_details`
-- gets these, not `deals.amount`'s.
COMMENT ON COLUMN deal_details.amount IS
  'Amount, as the view formats it. @type `${number}`';
-- The view's computed column: nothing underneath it to carry a comment at all.
COMMENT ON COLUMN deal_details.status_upper IS 'Status, uppercased. @notNull';
