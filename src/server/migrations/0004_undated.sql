-- Marks media whose capture date could not be determined by any means (no
-- EXIF, no filename date) and which have been relocated out of the fabricated
-- date tree into <photos|videos>/undated/. The date views exclude these so a
-- guessed/placeholder date never pollutes the timeline; a dedicated "Undated"
-- view lists them instead.
ALTER TABLE media ADD COLUMN is_undated INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_media_undated ON media(is_undated);
