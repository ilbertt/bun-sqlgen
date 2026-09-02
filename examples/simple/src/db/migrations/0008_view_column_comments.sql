-- A comment on a VIEW column is the view's own answer for that column, and it beats
-- the one on the base column underneath: a query selecting through `deal_details`
-- gets this, not what `deals.status` says.
COMMENT ON COLUMN deal_details.status IS
  'Lifecycle stage. @type ''draft'' | ''won'' | ''lost''';
-- The view's computed column: nothing underneath it to carry a comment at all.
COMMENT ON COLUMN deal_details.status_upper IS 'Status, uppercased. @notNull';
