-- Classifies each media item by whether it's a genuine camera capture. Files
-- with an EXIF Make (iPhone, DSLR, any camera) are 'camera'; WhatsApp images,
-- downloads, and screenshots — which have that metadata stripped — are 'other'.
-- Lets the day views show real photos while keeping messaging/download junk in
-- a separate bucket.
ALTER TABLE media ADD COLUMN origin TEXT NOT NULL DEFAULT 'camera';
CREATE INDEX idx_media_origin ON media(origin);
