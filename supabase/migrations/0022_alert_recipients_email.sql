-- ============================================================
-- Phase 3 revision: alerts go by email, not SMS
-- ============================================================
-- SMS to Indian numbers requires TRAI DLT registration (3-10 working
-- days, ~₹5,900 one-time) regardless of provider (Twilio, MSG91, or
-- anyone else) — not feasible on a same-day timeline. Email has no
-- such registration requirement, so alert_recipients switches from
-- phone numbers to email addresses.

alter table alert_recipients rename column phone_number to email;

alter table alert_recipients
  add constraint chk_alert_recipients_email_format
  check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
