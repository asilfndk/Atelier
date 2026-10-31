-- v0.15.0-0.15.2 tracked ikas swatch types that aren't colors ("Kumaş Tipi", "Gemstone") as the
-- color, with a `?<type>=` URL. Since v0.15.3 they are part of the size label.
-- A fabric-only row can't name its fabric anymore and becomes the whole product: marked in stock
-- so that another fabric's stock doesn't fire a false restock. Prices don't vary by fabric.
UPDATE tracked_products SET
  last_in_stock = CASE
    WHEN target_size IS NULL AND url LIKE '%?kumas-tipi=%' THEN 1
    ELSE last_in_stock
  END,
  target_size = CASE
    WHEN target_size IS NOT NULL THEN target_color || ' · ' || target_size
    WHEN url LIKE '%?gemstone=%' THEN target_color
  END,
  target_color = NULL,
  url = substr(url, 1, instr(url, '?') - 1)
WHERE target_color IS NOT NULL
  AND (url LIKE '%?kumas-tipi=%' OR url LIKE '%?gemstone=%');
--> statement-breakpoint
-- Two fabric-only rows of one product are now the same row, which trackProduct wouldn't allow.
DELETE FROM tracked_products
WHERE brand IN ('konfuse', 'bushido')
  AND target_color IS NULL
  AND id NOT IN (
    SELECT min(id) FROM tracked_products
    WHERE target_color IS NULL
    GROUP BY url, target_size
  );
