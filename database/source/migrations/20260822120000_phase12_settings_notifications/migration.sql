-- Phase 12 hardens the canonical settings/preference/notification tables that
-- were introduced by the baseline migration. Application validation remains
-- authoritative for per-key ranges; these constraints prevent invalid storage
-- shapes from bypassing the service layer.
ALTER TABLE "SystemSetting"
  ADD CONSTRAINT "SystemSetting_key_not_blank_check"
  CHECK (length(btrim("key")) > 0),
  ADD CONSTRAINT "SystemSetting_valueType_check"
  CHECK ("valueType" IN ('BOOLEAN', 'INTEGER', 'STRING', 'JSON'));

ALTER TABLE "UserPreference"
  ADD CONSTRAINT "UserPreference_listViewMode_check"
  CHECK ("listViewMode" IN ('TABLE', 'CARDS'));

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_title_not_blank_check"
  CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "Notification_message_not_blank_check"
  CHECK (length(btrim("message")) > 0);
