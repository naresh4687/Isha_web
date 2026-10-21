-- Free-text note for orders that need manual attention (e.g. payment captured after reservation expired).
ALTER TABLE orders ADD COLUMN admin_note text;
